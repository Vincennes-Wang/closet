import { SEASONS, SCENES } from './options.js';
import { getNode, split, seasonsFor, labelOf, visibleTaxonomy, allTaxonomy, nameError, newCategoryRow } from './taxonomy.js';
import { createPicker, parseFilter, filterParams } from './picker.js';
import { openStore, groupByCategory } from './store.js';
import { SLOTS, getSlot, itemsForSlot, taxonomyForSlot, slotState, outfitError, outfitSeasons, outfitsUsing, emptySlots } from './outfit.js';
import { createImageLoader } from './thumbs.js';
import { hitTest, moveBy, setSize, setRotation, shiftLayer, resetSlot } from './layout.js';
import { prepareImage, makeThumb } from './image.js';
import { THUMB_SIDE, RESULTS_DELAY_MS, WEATHER } from './config.js';
import { buildBackup, parseBackup } from './backup.js';
import { ymd, weekDates, dayLabel, seasonsForTemp, weatherIcon, rankOutfits, upcomingPlansUsing, loadWeather } from './week.js';
import {
  startJob, pauseJob, continueJob, cancelJob, summarize, resumeQueue, eventLines, noteResultsLoad, noteWait, noteResultsShown,
  guessBackend, estimateMs, remainingMs, minutesText,
} from './queue.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

// 打不开数据库时不留空白页：
// - VersionError：数据库已被新版本升级，这个页面是旧版本 → 提示刷新，并让 Service Worker 检查更新
// - BlockedError：别的标签页还开着旧版本，挡住了升级 → 提示关闭其他页面
const fakeDbVersion = new URLSearchParams(location.search).get('fakeDbVersion'); // 测试用：模拟旧代码请求低版本
async function openOrExplain() {
  try {
    return await openStore(globalThis.indexedDB, fakeDbVersion ? { version: Number(fakeDbVersion) } : undefined);
  } catch (err) {
    const text = err.name === 'VersionError' ? '有新版本，请刷新'
      : err.name === 'BlockedError' ? err.message : `打不开数据：${err.message}`;
    if (err.name === 'VersionError') navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    document.body.classList.add('fatal');
    $('fatal').replaceChildren(el('p', { textContent: text }),
      el('button', { type: 'button', className: 'primary', textContent: '刷新', onclick: () => location.reload() }));
    $('fatal').hidden = false;
    document.documentElement.dataset.ready = 'fatal';
    return null;
  }
}
const store = await openOrExplain();
if (!store) await new Promise(() => {}); // 停在提示页，不执行后面的代码
// 分类表（自建分类、改名、隐藏），启动时和每次 render 读取。界面显示的分类都从这里算（4c）
let catRows = await store.listCategoryRows();
const tax = () => visibleTaxonomy(catRows);
const label = (id) => labelOf(id, catRows);
// 这个 id（一级、二级，或没有二级的一级）在可见分类里吗？用来过滤 AI 建议
const isVisible = (id) => tax().some((c) => c.id === id || c.subs.some((s) => s.id === id));
const urls = new Set(); // 当前显示中的 object URL（编辑弹窗大图），重新渲染时统一释放
const images = createImageLoader(store); // 网格、搭配卡片：按需加载缩略图

function objectUrl(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; }

// ---------- 表单：分类两级单选，季节、场景多选，其余文字 ----------
// options：字符串，或 { value, label }（分类用 id 作值、中文名作显示）
function chips(name, options, selected, multiple) {
  const box = el('div', { className: 'chips', role: multiple ? 'group' : 'radiogroup' });
  for (const o of options) {
    const { value, label } = typeof o === 'string' ? { value: o, label: o } : o;
    const b = el('button', { type: 'button', className: 'chip', textContent: label });
    b.dataset.value = value;
    b.setAttribute('aria-pressed', String(selected.includes(value)));
    b.addEventListener('click', () => {
      if (!multiple) for (const o of box.children) o.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', String(!(multiple && b.getAttribute('aria-pressed') === 'true')));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    box.append(b);
  }
  box.dataset.name = name;
  return box;
}
const picked = (box) => [...box.children].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.value);
const setPicked = (box, values) => { for (const b of box.children) b.setAttribute('aria-pressed', String(values.includes(b.dataset.value))); };

// 编辑表单（新录入走待确认列表）。换分类不改用户已选的季节。
// 分类选项 = 可见分类；衣物当前所在的分类即使已隐藏也列出来，避免编辑时丢掉
function editTaxonomy(v) {
  const all = allTaxonomy(catRows);
  return all.filter((c) => !c.hidden || c.id === v.categoryId)
    .map((c) => ({ ...c, subs: c.subs.filter((s) => !s.hidden || s.id === v.subcategoryId) }));
}
function itemFields(v = {}) {
  const opts = (nodes) => nodes.map((n) => ({ value: n.id, label: n.zh }));
  const options = editTaxonomy(v);
  const category = chips('category', opts(options), v.categoryId ? [v.categoryId] : [], false);
  const subBox = el('div');
  let sub = null;
  const seasons = chips('seasons', SEASONS, v.seasons ?? [], true);
  // 二级分类随一级分类变化；没有二级分类的一级不显示这一行
  const renderSubs = (selected) => {
    const c = options.find((x) => x.id === picked(category)[0]);
    sub = c?.subs.length ? chips('subcategory', opts(c.subs), selected ? [selected] : [], false) : null;
    subBox.replaceChildren(sub ? el('div', { className: 'field' }, el('span', { textContent: '细分' }), sub) : '');
  };
  renderSubs(v.subcategoryId);
  category.addEventListener('change', () => renderSubs(null));
  const scenes = chips('scenes', SCENES, v.scenes ?? [], true);
  const text = (label, value, placeholder) => {
    const input = el('input', { type: 'text', value: value ?? '', placeholder });
    return { input, row: el('label', { className: 'field' }, el('span', { textContent: label }), input) };
  };
  const name = text('名称', v.name, '可不填');
  const color = text('颜色', v.color, '如 藏青');
  const block = (label, node) => el('div', { className: 'field' }, el('span', { textContent: label }), node);
  const node = el('div', { className: 'fields' },
    block('分类', category), subBox, block('季节', seasons), block('场景', scenes), name.row, color.row);
  return {
    node,
    values: () => ({
      categoryId: picked(category)[0],
      subcategoryId: sub ? picked(sub)[0] ?? null : null,
      seasons: picked(seasons),
      scenes: picked(scenes),
      name: name.input.value,
      color: color.input.value,
    }),
  };
}

// 分类没选全时的提示；选全了返回 ''。内置一级有二级时必须选二级；自建一级可以不选
function categoryError(v) {
  if (!v.categoryId) return '请选择分类';
  if (getNode(v.categoryId)?.subs.length && !v.subcategoryId) return '请选择细分';
  return '';
}

// ---------- 录入：选图只缩图、存进抠图队列，不加载模型 ----------
$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const errors = [];
  for (const [i, file] of files.entries()) {
    $('queueMsg').textContent = `正在读取照片 ${i + 1} / ${files.length}`;
    try {
      const img = await prepareImage(file);
      const thumb = await makeThumb(img.blob, img.hasAlpha, THUMB_SIDE);
      await store.enqueue({ original: img.blob, hasAlpha: img.hasAlpha, thumb });
    } catch (err) { errors.push(`${file.name} 读取失败：${err.message}`); }
  }
  $('queueMsg').textContent = errors.join('；');
  renderQueue();
});

// ---------- 衣橱 ----------
function tile(item) {
  const b = el('button', { type: 'button', className: 'tile' },
    lazyImg(item),
    el('span', { textContent: item.name || label(item.subcategoryId ?? item.categoryId) }));
  b.addEventListener('click', () => openEdit(item));
  return b;
}

function lazyImg(item) {
  const img = el('img', { alt: '', className: item.hasAlpha ? 'alpha' : '' });
  images.observe(img, item);
  return img;
}

function renderGroups(container, items) {
  container.replaceChildren(...groupByCategory(items).map((g) =>
    el('section', { className: 'group' },
      el('h2', { textContent: `${label(g.categoryId)} · ${g.items.length}` }),
      el('div', { className: 'grid' }, ...g.items.map(tile)))));
}

// ---------- 页面切换（衣橱 / 搭配 / 下周）和 URL hash ----------
// hash = 当前页面（v=outfits、v=week）+ 衣橱筛选（picker.js filterParams）。抠图队列自动刷新后仍在
const VIEWS = ['closet', 'outfits', 'week'];
let view = new URLSearchParams(location.hash.slice(1)).get('v');
if (!VIEWS.includes(view)) view = 'closet';
function writeHash() {
  const p = picker ? filterParams(picker.getFilter()) : new URLSearchParams(location.hash.slice(1));
  if (view !== 'closet') p.set('v', view); else p.delete('v');
  const h = p.toString();
  history.replaceState(null, '', location.pathname + location.search + (h ? `#${h}` : ''));
}
function showView(v) {
  view = v;
  document.body.classList.toggle('view-outfits', v === 'outfits');
  document.body.classList.toggle('view-week', v === 'week');
  for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  writeHash();
  if (v === 'outfits') renderOutfits(); else $('outfitList').replaceChildren();
  if (v === 'week') renderWeek(); else $('weekList').replaceChildren();
  images.sweep();
}
for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => showView(b.dataset.v));

// 衣橱用衣物选择器（picker.js）
let picker = null;
let showArchived = false;
async function render() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
  const [all, rows] = await Promise.all([store.list({ includeArchived: true }), store.listCategoryRows()]);
  catRows = rows;
  const taxonomy = visibleTaxonomy(rows);
  showStorage(all);
  showBackupAge(all.length);
  const active = all.filter((i) => !i.archived);
  picker ??= createPicker($('closet'), {
    filter: parseFilter(location.hash, taxonomy),
    onFilterChange: writeHash,
    onSelect: openEdit,
    labelFor: (item) => itemName(item),
    images,
  });
  picker.setData(all, taxonomy);
  $('closet').hidden = !active.length;
  $('empty').hidden = active.length > 0;
  const archived = all.filter((i) => i.archived);
  const btn = $('archivedBtn');
  btn.hidden = !archived.length;
  btn.textContent = `已归档（${archived.length} 件）${showArchived ? ' ▴' : ' ▾'}`;
  btn.setAttribute('aria-expanded', String(showArchived && archived.length > 0));
  $('archived').hidden = !(showArchived && archived.length);
  if (!$('archived').hidden) renderGroups($('archived'), archived);
  else $('archived').replaceChildren();
  images.sweep();
  if (view === 'outfits') renderOutfits();
  if (view === 'week') renderWeek();
}
$('archivedBtn').addEventListener('click', () => { showArchived = !showArchived; render(); });

// ---------- 编辑 ----------
function openEdit(item) {
  const dialog = $('editDialog');
  const fields = itemFields(item);
  const msg = el('p', { className: 'error' });
  const act = (label, fn, cls = '') => el('button', { type: 'button', className: cls, textContent: label, onclick: async () => {
    try { if (await fn() !== false) { dialog.close(); render(); } } catch (err) { msg.textContent = err.message; }
  } });
  const buttons = item.archived
    ? [act('恢复', () => store.unarchive(item.id), 'primary'),
       act('彻底删除', async () => confirm(await usedText(item.id, '删除后这些搭配里显示"已删除"，') + '彻底删除后无法恢复，确定吗？')
         ? store.remove(item.id) : false, 'danger')]
    : [act('保存', () => {
        const v = fields.values();
        if (categoryError(v)) { msg.textContent = categoryError(v); return false; }
        return store.update(item.id, v);
      }, 'primary'),
       act('归档', async () => {
         const used = await usedText(item.id, '归档后这些搭配里显示"已归档"。');
         return !used || confirm(`${used}确定吗？`) ? store.archive(item.id) : false;
       })];
  $('editForm').replaceChildren(
    el('img', { src: objectUrl(item.image), alt: '', className: item.hasAlpha ? 'thumb alpha' : 'thumb' }),
    fields.node, msg,
    el('div', { className: 'actions' }, ...buttons, el('button', { type: 'button', textContent: '取消', onclick: () => dialog.close() })),
  );
  dialog.showModal();
  dialog.focus(); // showModal 默认聚焦第一个按钮（"上衣"），iOS 会在它外面画焦点圈
}

// "这件衣服在 N 套搭配里，……"；不在搭配里返回 ''
async function usedText(itemId, consequence) {
  const n = outfitsUsing(itemId, await store.listOutfits()).length;
  return n ? `这件衣服在 ${n} 套搭配里，${consequence}` : '';
}

// ---------- 分类管理（4c，规则见 CLAUDE.md「分类规则」） ----------
// 内置：改名、隐藏 / 显示；自建：改名、隐藏 / 显示、删除（分类下没有衣物时）；自建一级可选放进哪个搭配位置。
// 箱包、配饰、帽子、套装这类没有二级的内置分类，不能新建二级（用户 2026-10-11 定）
const SLOT_CHOICES = [['', '不放进搭配'], ...SLOTS.map((s) => [s.id, s.zh])];
async function openCategories() {
  const dialog = $('editDialog');
  const msg = el('p', { className: 'error' });
  const items = await store.list({ includeArchived: true });
  const countOf = (id) => items.filter((i) => i.categoryId === id || i.subcategoryId === id).length;
  const rowOf = (id) => catRows.find((r) => r.id === id);
  const refresh = async () => { catRows = await store.listCategoryRows(); draw(); };
  const act = (fn) => async () => { msg.textContent = ''; try { await fn(); await refresh(); } catch (err) { msg.textContent = err.message; } };
  const btn = (text, fn, cls = 'small') => el('button', { type: 'button', className: cls, textContent: text, onclick: act(fn) });

  // 改名：内置分类存 { id, zh }（保留已有的 hidden），自建分类改 zh
  const rename = (n, parentId) => async () => {
    const zh = prompt('新名称', n.zh);
    if (zh === null || zh.trim() === n.zh) return;
    const err = nameError(catRows, parentId, zh, n.id);
    if (err) throw new Error(err);
    await store.putCategoryRow({ ...(rowOf(n.id) ?? { id: n.id }), zh: zh.trim() });
  };
  const setHidden = (n, hidden) => async () => {
    const count = countOf(n.id);
    if (hidden && count && !confirm(`这个分类下有 ${count} 件衣物，隐藏后它们只在"全部"里显示。确定吗？`)) return;
    await store.putCategoryRow({ ...(rowOf(n.id) ?? { id: n.id }), hidden });
  };
  const remove = (n) => async () => {
    const subs = catRows.filter((r) => r.builtin === false && r.parentId === n.id).length;
    if (!confirm(`删除"${n.zh}"${subs ? `和它下面的 ${subs} 个二级分类` : ''}吗？`)) return;
    await store.removeCategoryRow(n.id);
  };
  const addSub = (c) => async () => {
    const zh = prompt(`在"${c.zh}"下新建二级分类，名称：`);
    if (zh === null) return;
    const err = nameError(catRows, c.id, zh);
    if (err) throw new Error(err);
    await store.putCategoryRow(newCategoryRow({ parentId: c.id, zh }));
  };

  // 一行：名称、件数、改名、隐藏 / 显示、删除（自建）
  function line(n, parentId) {
    const count = countOf(n.id);
    const row = el('div', { className: `cat-row${n.hidden ? ' cat-hidden' : ''}` },
      parentId ? '' : el('span', { textContent: n.icon, ariaHidden: 'true' }),
      el('span', { className: 'cat-name', textContent: n.zh }),
      el('span', { className: 'muted', textContent: `${count} 件${n.hidden ? ' · 已隐藏' : ''}` }),
      btn('改名', rename(n, parentId)),
      btn(n.hidden ? '显示' : '隐藏', setHidden(n, !n.hidden)));
    if (!n.builtin) {
      const del = btn('删除', remove(n), 'small danger');
      const subCount = parentId ? 0 : catRows.filter((r) => r.builtin === false && r.parentId === n.id).reduce((k, r) => k + countOf(r.id), 0);
      if (count + subCount) { del.disabled = true; del.title = '分类下还有衣物，先把衣物移到别的分类'; }
      row.append(del);
      if (count + subCount) row.append(el('span', { className: 'muted', textContent: '有衣物，不能删除' }));
    }
    row.dataset.id = n.id;
    return row;
  }

  function draw() {
    const all = allTaxonomy(catRows);
    const tops = all.map((c) => {
      const box = el('div', { className: 'cat-top' }, line(c, null));
      box.dataset.id = c.id;
      if (!c.builtin) { // 自建一级：搭配位置
        const sel = el('select', { ariaLabel: '搭配位置' }, ...SLOT_CHOICES.map(([v, t]) => el('option', { value: v, textContent: t, selected: (c.slot ?? '') === v })));
        sel.onchange = act(() => store.putCategoryRow({ ...rowOf(c.id), slot: sel.value || null }));
        box.append(el('div', { className: 'cat-row' }, el('span', { className: 'muted', textContent: '搭配位置' }), sel));
      }
      const canHaveSubs = !c.builtin || getNode(c.id).subs.length > 0;
      box.append(el('div', { className: 'cat-subs' }, ...c.subs.map((s) => line(s, c.id)),
        canHaveSubs ? btn('＋ 新建二级分类', addSub(c)) : ''));
      return box;
    });
    // 新建一级分类：名称 + 搭配位置
    const name = el('input', { type: 'text', placeholder: '新一级分类名称，如 泳衣' });
    const slot = el('select', { ariaLabel: '搭配位置' }, ...SLOT_CHOICES.map(([v, t]) => el('option', { value: v, textContent: t })));
    const create = btn('新建一级分类', async () => {
      const err = nameError(catRows, null, name.value);
      if (err) throw new Error(err);
      await store.putCategoryRow(newCategoryRow({ zh: name.value, slot: slot.value || null }));
    }, 'primary');
    $('editForm').replaceChildren(
      el('h2', { textContent: '管理分类' }),
      el('p', { className: 'muted', textContent: '内置分类可以改名、隐藏；自己建的分类还可以删除（分类下没有衣物时）。自建分类不参与自动识别，录入时手动选。' }),
      msg, ...tops,
      el('div', { className: 'cat-new' }, name, el('label', { className: 'field' }, el('span', { textContent: '放进搭配的哪个位置' }), slot), create),
      el('div', { className: 'actions' }, el('button', { type: 'button', textContent: '完成', onclick: () => dialog.close() })));
  }
  draw();
  // 关闭（"完成"或 Esc）后刷新衣橱和待确认列表，显示新名称
  dialog.addEventListener('close', () => { render(); renderQueue(); }, { once: true });
  dialog.showModal();
  dialog.focus();
}
$('catBtn').addEventListener('click', () => openCategories());

// ---------- 搭配 ----------
const STATE_TEXT = { deleted: '已删除', archived: '已归档' };
const itemName = (item) => item.name || label(item.subcategoryId ?? item.categoryId);

// 一个槽位的小图：有衣物显示缩略图，已删除 / 已归档显示文字
function slotThumb(id, byId) {
  const state = slotState(id, byId);
  if (state === 'ok') return lazyImg(byId.get(id));
  return el('span', { className: `slot-missing ${state ?? 'empty'}`, textContent: STATE_TEXT[state] ?? '' });
}

// 搭配卡片：名称、场景 · 季节、合成图（thumbs.js，按需生成并缓存）；已删除、已归档的衣物不画，另起一行写明。
// 搭配页和"下周"选搭配共用；tag：卡片顶部的标签（如"适合"）
function outfitCard(o, byId, onclick, tag = '') {
  const seasons = outfitSeasons(o, byId);
  const counts = {};
  for (const s of SLOTS) { const st = slotState(o.slots[s.id], byId); if (STATE_TEXT[st]) counts[st] = (counts[st] ?? 0) + 1; }
  const missing = Object.entries(counts).map(([st, n]) => `${n} 件${STATE_TEXT[st]}`).join('，');
  const img = el('img', { className: 'outfit-img', alt: o.name || '搭配' });
  images.observeOutfit(img, o, byId);
  const card = el('button', { type: 'button', className: 'outfit-card', onclick },
    tag ? el('span', { className: 'fit-tag', textContent: tag }) : '',
    el('span', { className: 'outfit-name', textContent: o.name || '未命名搭配' }),
    el('span', { className: 'muted', textContent: [o.scenes.join('、'), seasons.join('')].filter(Boolean).join(' · ') || ' ' }),
    img,
    missing ? el('span', { className: 'outfit-missing', textContent: missing }) : '');
  card.dataset.id = o.id;
  return card;
}

async function renderOutfits() {
  const [outfits, all] = await Promise.all([store.listOutfits(), store.list({ includeArchived: true })]);
  const byId = new Map(all.map((i) => [i.id, i]));
  $('outfitList').replaceChildren(...outfits.map((o) => outfitCard(o, byId, () => openOutfit(o))));
  $('outfitsEmpty').hidden = outfits.length > 0;
  images.sweep();
}
$('newOutfit').addEventListener('click', () => openOutfit(null));

// 搭配编辑：名称、场景、7 个槽位。点槽位后在同一个弹窗里换成选择器（不叠两层弹窗）
async function openOutfit(saved) {
  const dialog = $('editDialog');
  const [all, rows] = await Promise.all([store.list({ includeArchived: true }), store.listCategoryRows()]);
  catRows = rows;
  const byId = new Map(all.map((i) => [i.id, i]));
  const taxonomy = visibleTaxonomy(rows);
  const draft = saved ? { ...saved, slots: { ...saved.slots }, layout: saved.layout ? structuredClone(saved.layout) : undefined }
    : { name: '', scenes: [], slots: emptySlots() };
  const name = el('input', { type: 'text', value: draft.name, placeholder: '可不填，如 周一通勤' });
  const scenes = chips('scenes', SCENES, draft.scenes, true);
  const msg = el('p', { className: 'error' });
  // 手动调整排版（4e）：adjusting = 调整模式；selected = 选中的槽位；session = 预览（缩略图只解码一次）
  let adjusting = false, selected = null, session = null;
  const endSession = () => { session?.close(); session = null; };
  const close = () => { endSession(); dialog.close(); images.sweep(); };
  // 换了槽位里的衣物或清空：这个槽位恢复自动排版（新衣物宽高比不同）
  const setSlot = (slotId, itemId) => {
    draft.slots[slotId] = itemId;
    draft.layout = resetSlot(draft.layout, slotId);
    if (selected === slotId) selected = null;
  };

  // 调整模式的工具栏：大小、角度滑块，层次、恢复自动按钮
  function adjustPanel(canvas) {
    const size = el('input', { type: 'range', min: '8', max: '100', step: '1' });
    const angle = el('input', { type: 'range', min: '-180', max: '180', step: '1' });
    const btn = (label, fn) => el('button', { type: 'button', className: 'small', textContent: label, onclick: fn });
    const set = (fn) => { // fn(当前位置) → 新位置，写进 draft.layout 并重画
      const placed = session?.placed(draft);
      if (!placed?.[selected]) return;
      draft.layout = { ...draft.layout, [selected]: fn(placed[selected]) };
      redraw();
    };
    const layer = (dir) => {
      const placed = session?.placed(draft);
      if (!placed?.[selected]) return;
      draft.layout = { ...draft.layout, ...shiftLayer(placed, selected, dir) };
      redraw();
    };
    const fwd = btn('往前一层', () => layer(1)), back = btn('往后一层', () => layer(-1));
    const reset = btn('这件恢复自动', () => { draft.layout = resetSlot(draft.layout, selected); redraw(); });
    const resetAll = btn('全部恢复自动', () => { draft.layout = undefined; redraw(); });
    size.oninput = () => set((p) => setSize(p, Number(size.value) / 100));
    angle.oninput = () => set((p) => setRotation(p, Number(angle.value)));
    const hint = el('p', { className: 'muted' });
    const sync = () => { // 选中项变化后：滑块显示当前值，没选中时禁用
      const p = selected && session?.placed(draft)[selected];
      for (const c of [size, angle, fwd, back, reset]) c.disabled = !p;
      if (p) { size.value = String(Math.round(p.w * 100)); angle.value = String(Math.round(p.rotation)); }
      hint.textContent = p ? `已选中：${getSlot(selected).zh}。拖动移位，或用下面的滑块` : '点一件衣物选中它，然后拖动移位';
      canvas.dataset.selected = selected ?? '';
    };
    function redraw() { session?.redraw(draft, selected); sync(); }
    const panel = el('div', { className: 'adjust' }, hint,
      el('label', { className: 'field' }, el('span', { textContent: '大小' }), size),
      el('label', { className: 'field' }, el('span', { textContent: '角度' }), angle),
      el('div', { className: 'actions' }, fwd, back, reset, resetAll));
    return { panel, redraw, sync };
  }

  // 画布上的指针：按下选中（点空白取消选中），拖动移位
  function bindPointer(canvas, ctl) {
    let drag = null;
    const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
    canvas.addEventListener('pointerdown', (e) => {
      if (!adjusting || !session) return;
      const p = at(e);
      selected = hitTest(session.placed(draft), p.x, p.y);
      drag = selected ? p : null;
      if (drag) canvas.setPointerCapture(e.pointerId);
      ctl.redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || !selected) return;
      const p = at(e);
      const cur = session.placed(draft)[selected];
      draft.layout = { ...draft.layout, [selected]: moveBy(cur, p.x - drag.x, p.y - drag.y) };
      drag = p;
      session.redraw(draft, selected);
    });
    const end = () => { if (drag) { drag = null; ctl.sync(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function editor() {
    const slotRows = SLOTS.map((slot) => {
      const id = draft.slots[slot.id];
      const state = slotState(id, byId);
      const hint = slot.id === 'onepiece' ? '可空；选了它，上衣和下装可空' : slot.optional ? '可空' : '';
      const row = el('div', { className: 'slot-row' },
        el('button', { type: 'button', className: 'slot-pick', onclick: () => pickFor(slot) },
          el('span', { className: 'slot-img' }, slotThumb(id, byId)),
          el('span', { className: 'slot-text' },
            el('strong', { textContent: slot.zh }),
            el('span', { className: state === 'ok' || !state ? 'muted' : 'error', textContent: state === 'ok' ? itemName(byId.get(id)) : STATE_TEXT[state] ?? (hint || '未选') }))),
        id ? el('button', { type: 'button', className: 'small', textContent: '清空', onclick: () => { setSlot(slot.id, null); editor(); } }) : '');
      row.dataset.slot = slot.id;
      return row;
    });
    // 实时预览：每次改槽位都会重建编辑视图，预览跟着重画（不写缓存）。调整模式下可以拖动、缩放、旋转
    endSession();
    const preview = el('canvas', { className: `outfit-preview${adjusting ? ' adjusting' : ''}` });
    const ctl = adjustPanel(preview);
    bindPointer(preview, ctl);
    const toggle = el('button', { type: 'button', className: 'small adjust-toggle', textContent: adjusting ? '完成调整' : '调整排版',
      onclick: () => { adjusting = !adjusting; if (!adjusting) selected = null; draft.name = name.value; draft.scenes = picked(scenes); editor(); } });
    $('editForm').replaceChildren(
      el('h2', { textContent: saved ? '编辑搭配' : '新建搭配' }),
      el('label', { className: 'field' }, el('span', { textContent: '名称' }), name),
      el('div', { className: 'field' }, el('span', { textContent: '场景' }), scenes),
      preview, toggle, adjusting ? ctl.panel : '',
      el('div', { className: 'slots' }, ...slotRows),
      msg,
      el('div', { className: 'actions' },
        el('button', { type: 'button', className: 'primary', textContent: '保存', onclick: save }),
        saved ? el('button', { type: 'button', className: 'danger', textContent: '删除搭配', onclick: remove }) : '',
        el('button', { type: 'button', textContent: '取消', onclick: close })));
    images.sweep();
    images.editor(preview, draft, byId)
      .then((sess) => {
        if (!preview.isConnected) { sess.close(); return; } // 已经又重建了
        session = sess;
        ctl.redraw();
        preview.dataset.drawn = String(sess.count);
      })
      .catch((err) => console.warn('预览失败', err));
  }

  function pickFor(slot) {
    endSession();
    draft.name = name.value; draft.scenes = picked(scenes);
    const tax = taxonomyForSlot(slot, taxonomy);
    const choices = itemsForSlot(slot, all, catRows);
    const box = el('div');
    $('editForm').replaceChildren(
      el('div', { className: 'pick-head' },
        el('button', { type: 'button', className: 'small', textContent: '← 返回', onclick: () => { slotPicker.destroy(); editor(); } }),
        el('h2', { textContent: `选择${slot.zh}` })),
      choices.length ? box : el('p', { className: 'muted', textContent: '衣橱里还没有能放进这个槽位的衣物' }));
    const slotPicker = createPicker(box, {
      initialCategory: tax.length === 1 ? tax[0].id : null, canSwitchCategory: tax.length > 1, mode: 'single',
      selectedId: draft.slots[slot.id], images,
      onSelect: (item) => { setSlot(slot.id, item.id); slotPicker.destroy(); editor(); },
    });
    slotPicker.setData(choices, tax);
  }

  async function save() {
    draft.name = name.value.trim(); draft.scenes = picked(scenes);
    const err = outfitError(draft, byId);
    if (err) { msg.textContent = err; return; }
    const { layout, ...rest } = draft; // 没有手动排版时不存 layout 字段
    try { await store.putOutfit(layout ? { ...rest, layout } : rest); close(); renderOutfits(); } catch (e) { msg.textContent = e.message; }
  }
  async function remove() {
    const used = upcomingPlansUsing(saved.id, await store.listPlans(), ymd(new Date()));
    const planText = used.length ? `这套搭配排在 ${used.length} 天的计划里（${used.map((p) => dayLabel(p.date).md).join('、')}），删除后那几天显示"搭配已删除"。` : '';
    if (!confirm(`${planText}删除这套搭配吗？衣物不受影响。`)) return;
    await store.removeOutfit(saved.id); close(); renderOutfits();
  }

  editor();
  dialog.showModal();
  dialog.focus();
}

// ---------- 下周穿搭（阶段 5） ----------
// 每天一行：日期、天气（Open-Meteo，week.js）、当天搭配。点某天在弹窗里选搭配（按天气季节排序）。过去的日子只能看
const fakeWeather = new URLSearchParams(location.search).get('fakeWeather'); // 测试用：1 = 假数据，fail = 请求失败
let weekOffset = 1; // 0 本周，1 下周
let weather = null; // { days, fetchedAt, stale }，null = 还没取
let weatherLoading = null;
let weatherTriedAt = 0; // 上次请求的时间。失败后不马上重试（否则每次重画都请求），过 maxAgeMs 或刷新页面再试
const fmtTime = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// 先用缓存画，缓存过期就后台请求，回来后重画
function refreshWeather() {
  weatherTriedAt = Date.now();
  weatherLoading ??= loadWeather(store, { fake: fakeWeather })
    .then((w) => { weather = w; if (view === 'week') renderWeek(); })
    .finally(() => { weatherLoading = null; });
}

function weatherLine(day) {
  if (!day) return [el('span', { className: 'muted', textContent: '暂无预报' })];
  const w = weatherIcon(day.code);
  return [el('span', { textContent: `${w.icon} ${Math.round(day.min)}–${Math.round(day.max)}°` }),
    day.rain == null ? '' : el('span', { className: day.rain >= 50 ? 'rain' : 'muted', textContent: `${day.rain >= 50 ? '☔ ' : ''}降水 ${day.rain}%` })];
}

async function renderWeek() {
  const now = new Date(), today = ymd(now);
  const dates = weekDates(now, weekOffset);
  for (const b of document.querySelectorAll('#weekNav button')) b.setAttribute('aria-pressed', String(Number(b.dataset.w) === weekOffset));
  const [plans, outfits, all] = await Promise.all([store.plansBetween(dates[0], dates[6]), store.listOutfits(), store.list({ includeArchived: true })]);
  const byId = new Map(all.map((i) => [i.id, i]));
  const outfitById = new Map(outfits.map((o) => [o.id, o]));
  const planOf = new Map(plans.map((p) => [p.date, p]));
  const days = weather?.days ?? {};
  $('weatherMsg').textContent = !weather ? '正在获取天气…'
    : !weather.days ? '天气获取失败，计划照常可用'
    : weather.stale ? `天气更新于 ${fmtTime(weather.fetchedAt)}（获取最新预报失败）` : '';
  const rows = dates.map((date) => {
    const { weekday, md } = dayLabel(date);
    const past = date < today;
    const plan = planOf.get(date);
    const outfit = plan && outfitById.get(plan.outfitId);
    let right, name = '';
    if (outfit) {
      const img = el('img', { alt: outfit.name || '搭配' });
      images.observeOutfit(img, outfit, byId);
      right = el('span', { className: 'day-outfit' }, img);
      name = outfit.name ? el('span', { className: 'day-name', textContent: outfit.name }) : '';
    } else if (plan) right = el('span', { className: 'day-outfit' }, el('span', { className: 'day-empty missing', textContent: '搭配已删除' }));
    else right = el('span', { className: 'day-outfit' }, el('span', { className: 'day-empty', textContent: past ? '' : '选搭配' }));
    const row = el('button', { type: 'button', className: `day${past ? ' past' : ''}${date === today ? ' today' : ''}`, disabled: past,
      onclick: () => openDay(date) },
      el('span', { className: 'day-date' }, el('b', { textContent: date === today ? '今天' : weekday }), el('span', { className: 'muted', textContent: md })),
      el('span', { className: 'day-weather' }, ...(past ? [] : weatherLine(days[date])), name),
      right);
    row.dataset.date = date;
    return row;
  });
  $('weekList').replaceChildren(...rows);
  images.sweep();
  if (!weatherLoading && Date.now() - weatherTriedAt >= WEATHER.maxAgeMs) refreshWeather();
}
for (const b of document.querySelectorAll('#weekNav button')) b.addEventListener('click', () => { weekOffset = Number(b.dataset.w); renderWeek(); });

// 给某天选搭配：适合当天天气的排前面（标"适合"），不合适的排后面变淡，不隐藏
async function openDay(date) {
  const dialog = $('editDialog');
  const [outfits, all, [plan]] = await Promise.all([store.listOutfits(), store.list({ includeArchived: true }), store.plansBetween(date, date)]);
  const byId = new Map(all.map((i) => [i.id, i]));
  const day = weather?.days?.[date];
  const seasons = day ? seasonsForTemp(day.max) : null;
  const ranked = seasons ? rankOutfits(outfits, seasons, byId) : outfits.map((outfit) => ({ outfit, fit: 'unknown' }));
  const { weekday, md } = dayLabel(date);
  const close = () => { dialog.close(); images.sweep(); renderWeek(); };
  const choose = async (outfitId) => { await store.setPlan(date, outfitId); close(); };
  const cards = ranked.map(({ outfit, fit }) => {
    const card = outfitCard(outfit, byId, () => choose(outfit.id), fit === 'yes' ? '适合' : '');
    if (fit === 'no') card.classList.add('unfit');
    card.setAttribute('aria-pressed', String(plan?.outfitId === outfit.id));
    return card;
  });
  const w = day && weatherIcon(day.code);
  $('editForm').replaceChildren(
    el('h2', { textContent: `${weekday} ${md}${day ? ` · ${w.icon} ${Math.round(day.min)}–${Math.round(day.max)}°` : ''}` }),
    el('p', { className: 'muted', textContent: seasons ? `按天气适合${seasons.join('、')}季的搭配排在前面。` : '没有这天的天气预报。' }),
    cards.length ? el('div', { className: 'outfit-list' }, ...cards) : el('p', { className: 'muted', textContent: '还没有搭配。先到"搭配"页新建。' }),
    el('div', { className: 'actions' },
      plan ? el('button', { type: 'button', className: 'danger', textContent: '清空这天', onclick: () => choose(null) }) : '',
      el('button', { type: 'button', textContent: '取消', onclick: close })));
  dialog.showModal();
  dialog.focus();
}

// ---------- 抠图队列 ----------
const fake = new URLSearchParams(location.search).get('fakeMatting'); // 测试用，见 model-worker.js
const fakeEmptyMask = new URLSearchParams(location.search).has('fakeEmptyMask'); // 测试用：模拟 WebGPU 遮罩全空
const fakeHostFail = new URLSearchParams(location.search).get('fakeHostFail') ?? ''; // 测试用：模拟这个模型地址网络失败
const qurls = new Set();
const duration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)} 分 ${s % 60} 秒`; };
// 处理中给用户看的进度（阶段 6 起只留张数）；完整数字（失败、自动刷新、崩溃恢复、用时）在"详细记录"里
const progressText = (p) => (p.phase === 'classify' ? `分类 ${p.classifyProcessed} / ${p.total}` : `抠图 ${p.processed} / ${p.total}`);
const progressStats = (p) => `${p.phase === 'classify' ? `分类 ${p.classifyProcessed} / ${p.total}（失败 ${p.classifyFailed}）` : `抠图 ${p.processed} / ${p.total}（失败 ${p.failed}）`} · 自动刷新 ${p.reloads} 次 · 崩溃恢复 ${p.recoveries} 次 · 用时 ${duration(p.elapsedMs)}`;
const lastJobStats = (p) => `上次抠图：成功 ${p.done}，失败 ${p.failed}，未抠图 ${p.skipped} · 自动刷新 ${p.reloads} 次 · 崩溃恢复 ${p.recoveries} 次 · 用时 ${duration(p.elapsedMs)}${p.backend ? ` · ${p.backend}` : ''}${p.classifyHost ? ` · 分类模型 ${p.classifyHost}` : ''} · 分类 ${p.classified} 张，失败 ${p.classifyFailed}`;

// 可展开的"详细记录"（诊断用，出问题时让用户截图）：第一行完整统计（#jobStats），下面是事件时间线
const timeline = (job, stats) => (job?.events?.length
  ? el('details', { className: 'timeline' }, el('summary', { textContent: '详细记录' }),
    el('p', { className: 'muted', id: 'jobStats', textContent: stats }), el('pre', { textContent: eventLines(job).join('\n') }))
  : '');

// 抠图模型下载不了（中国大陆打不开 huggingface.co）时，待确认列表顶部的说明：怎样用 iPhone 系统抠图
const noMattingCard = () => el('div', { className: 'hint', id: 'noMatting' },
  el('p', {}, el('b', { textContent: '这次没有抠图：' }), '抠图模型下载不了（中国大陆网络常见）。照片按原图保存，可以照常录入。'),
  el('p', { textContent: '想要透明背景，可以用 iPhone 自带的抠图：' }),
  el('ol', {}, el('li', { textContent: '在"照片"里打开这张衣服照片，长按衣服，等它浮起来' }),
    el('li', { textContent: '点"共享" → "保存图像"' }),
    el('li', { textContent: '回到这里点"录入衣物"，选新保存的那张（会自动识别为已抠图）' })),
  el('p', { textContent: '安卓手机可以用别的抠图 App 存成透明 PNG 再录入。' }));

function queueButton(label, fn, cls = '') {
  return el('button', { type: 'button', className: cls, textContent: label, onclick: fn });
}

async function renderQueue() {
  for (const u of qurls) URL.revokeObjectURL(u);
  qurls.clear();
  const [job, queue] = await Promise.all([store.getJob(), store.listQueue()]);
  const running = !!job?.running;
  document.body.classList.toggle('processing', running);
  wakeLock(running && !job.paused);
  const box = $('queue');
  if (running) {
    const p = summarize(job, queue);
    box.replaceChildren(el('div', { className: 'card' },
      el('h2', { textContent: job.paused ? '处理已暂停' : job.phase === 'classify' ? '正在分类' : '正在抠图' }),
      el('p', { id: 'progress', textContent: `${progressText(p)}${job.paused ? '' : ` · 剩余${remainingMs(job, p) < 60000 ? '' : '约 '}${minutesText(remainingMs(job, p))}`}` }),
      job.paused ? '' : el('p', { className: 'hint', textContent: '处理中请保持页面在前台，屏幕不要锁定。页面会自动刷新，不用操作。如果出现"重复出现问题"，向左划回来即可继续。' }),
      !job.paused && job.events?.at(-1)?.e === 'loadWait' ? el('p', { className: 'muted', textContent: '正在释放内存，稍后继续…' }) : '',
      el('p', { className: 'error', textContent: job.error ?? '' }),
      job.paused ? timeline(job, progressStats(p)) : '',
      el('div', { className: 'actions' },
        job.paused
          ? queueButton('继续', async () => { await continueJob(store); location.reload(); }, 'primary')
          : queueButton('暂停', async () => { await pauseJob(store); renderQueue(); }),
        queueButton('取消', async () => { await cancelJob(store); renderQueue(); render(); }, 'danger'))));
    return;
  }
  const waiting = queue.filter((r) => r.status === 'pending' || r.classify?.status === 'pending').length;
  const p = job?.endedAt ? summarize(job, queue) : null;
  // 开始前按本设备后端估算用时；只在 WASM（慢）时提示
  const backend = waiting ? await guessBackend(store) : null;
  const noMatting = !!p && job.events?.some((v) => v.e === 'mattingUnavailable');
  const cards = queue.map((r) => reviewCard(r, noMatting));
  const ready = () => cards.filter((c) => c.choice());
  // 全部确认：只确认已有分类的；没有分类建议、又没手动选的留在列表里
  const confirmAll = queueButton('全部确认', async () => {
    let n = 0;
    for (const c of ready()) { try { await c.confirm(); n++; } catch (err) { c.showError(err.message); } }
    const left = (await store.listQueue()).length;
    await renderQueue();
    render();
    // 写在列表外面：全部录入后列表会消失
    $('queueMsg').textContent = `已录入 ${n} 件${left ? `，还有 ${left} 张需要先选分类` : ''}`;
  }, 'primary');
  box.replaceChildren(...(queue.length ? [el('section', { className: 'card' },
    el('h2', { textContent: `待确认 · ${queue.length}` }),
    p ? el('p', { className: 'muted', id: 'lastJob', textContent: `上次处理：抠图 ${p.done} 张${p.skipped ? `，未抠图 ${p.skipped} 张` : ''}${p.failed ? `，抠图失败 ${p.failed} 张` : ''}，用时 ${duration(p.elapsedMs)}` }) : '',
    noMatting ? noMattingCard() : '',
    p ? timeline(job, lastJobStats(p)) : '',
    backend === 'wasm' ? el('p', { className: 'hint', id: 'slowHint',
      textContent: `这台设备处理较慢，${waiting} 张约需 ${minutesText(Math.max(60000, estimateMs(waiting, backend)))}，处理中请保持本页面打开` }) : '',
    waiting ? el('div', { className: 'actions' },
      queueButton(`开始处理（${waiting} 张）`, async () => { await startJob(store, backend); location.reload(); }, 'primary')) : '',
    queue.some((r) => r.classify?.status === 'done') ? el('div', { className: 'actions' }, confirmAll) : '',
    el('div', { className: 'reviews' }, ...cards.map((c) => c.node)))] : []));
}

// 待确认卡片：缩略图（可看原图）、建议分类 + 另外 2 个候选、其他分类、季节、"用原图"、确认 / 删除。
// 返回 { node, choice()（当前选的分类，没选为 null）, confirm(), showError() }
// noMatting：本次抠图模型下载不了，列表顶部已有系统抠图说明，卡片里只写一句
function reviewCard(r, noMatting = false) {
  const thumbUrl = URL.createObjectURL(r.thumb ?? r.cutout ?? r.original); qurls.add(thumbUrl);
  const cut = r.status === 'cutout_done';
  const node = el('article', { className: 'review' });
  node.dataset.id = r.id;
  if (r.status === 'pending' || r.status === 'processing') {
    node.append(el('img', { src: thumbUrl, alt: '' }), el('p', { className: 'status', textContent: '待处理' }),
      queueButton('删除', async () => { await store.removeQueued(r.id); renderQueue(); }));
    return { node, choice: () => null, confirm: async () => {}, showError: () => {} };
  }

  // 当前选择：默认是分类建议的第一名。已隐藏的分类不出现在建议里（4c）
  const top3 = (r.classify?.status === 'done' ? r.classify.top3 : []).filter((t) => isVisible(t.id));
  let choice = top3[0] ? split(top3[0].id) : null;
  let useOriginal = false;
  const msg = el('p', { className: 'error' });

  // 图片：缩略图；"看原图"时临时显示原图（只在点开时解码）
  const img = el('img', { src: thumbUrl, alt: '', className: cut ? 'alpha' : '' });
  let origUrl = null;
  const flip = cut && !r.hasAlpha ? queueButton('看原图', () => {
    const showOrig = flip.textContent === '看原图';
    if (showOrig && !origUrl) { origUrl = URL.createObjectURL(r.original); qurls.add(origUrl); }
    img.src = showOrig ? origUrl : thumbUrl;
    img.className = showOrig ? '' : 'alpha';
    flip.textContent = showOrig ? '看抠图' : '看原图';
  }, 'small') : '';

  // 分类：候选（最多 3 个）+ "其他分类"展开两级选择
  const seasons = chips('seasons', SEASONS, choice ? seasonsFor(choice.categoryId, choice.subcategoryId) : [], true);
  const pick = (c) => {
    choice = c;
    setPicked(seasons, seasonsFor(c.categoryId, c.subcategoryId)); // 换分类时季节回到默认值
    renderChoice();
  };
  const candidates = el('div', { className: 'chips' });
  const other = el('div', { className: 'other', hidden: true });
  const label = el('p', { className: 'choice' });
  const renderChoice = () => {
    label.textContent = choice ? labelOf(choice.subcategoryId ?? choice.categoryId, catRows) : '请选择分类';
    candidates.replaceChildren(...top3.map((t) => {
      const b = el('button', { type: 'button', className: 'chip', textContent: `${labelOf(t.id, catRows)} ${Math.round(t.score * 100)}%` });
      b.setAttribute('aria-pressed', String((choice?.subcategoryId ?? choice?.categoryId) === t.id));
      b.addEventListener('click', () => pick(split(t.id)));
      return b;
    }));
  };
  const otherBtn = queueButton('其他分类', () => {
    other.hidden = !other.hidden;
    if (other.hidden) return;
    // 一级 → 细分；没有细分的一级直接选中
    const options = tax();
    const cats = chips('category', options.map((c) => ({ value: c.id, label: c.zh })), [], false);
    const subs = el('div');
    cats.addEventListener('change', () => {
      const c = options.find((x) => x.id === picked(cats)[0]);
      if (!c.subs.length) { pick({ categoryId: c.id, subcategoryId: null }); subs.replaceChildren(); return; }
      const box = chips('subcategory', c.subs.map((x) => ({ value: x.id, label: x.zh })), [], false);
      box.addEventListener('change', () => pick({ categoryId: c.id, subcategoryId: picked(box)[0] }));
      subs.replaceChildren(box);
    });
    other.replaceChildren(cats, subs);
  }, 'small');
  renderChoice();

  // 抠图成功时可以选"用原图"（确认后只存原图）；抠图失败时提示用照片 App 抠图
  const orig = cut && !r.hasAlpha ? el('label', { className: 'toggle-inline' },
    Object.assign(el('input', { type: 'checkbox' }), { onchange: (e) => { useOriginal = e.target.checked; } }), ' 用原图') : '';
  const hint = r.status === 'cutout_failed' || r.status === 'skipped'
    ? el('p', { className: 'hint', textContent: `${r.status === 'skipped' ? '没有抠图' : '抠图失败'}，将保存原图${noMatting && r.status === 'skipped' ? '' : '。也可以用照片 App 抠图（长按衣服 → 共享 → 保存图像）后重新上传。'}` })
    : '';
  const noGuess = !top3.length ? el('p', { className: 'muted', textContent: '没有分类建议，请点"其他分类"手动选择' }) : '';

  async function confirm() {
    if (!choice) throw new Error('请先选择分类');
    await store.confirmQueued(r.id, { ...choice, seasons: picked(seasons), useOriginal });
  }
  node.append(
    el('div', { className: 'review-img' }, img, flip),
    el('div', { className: 'review-body' },
      label, candidates, noGuess, otherBtn, other,
      el('div', { className: 'field' }, el('span', { textContent: '季节' }), seasons),
      orig, hint, msg,
      el('div', { className: 'actions' },
        queueButton('确认', async () => {
          try { await confirm(); renderQueue(); render(); } catch (err) { msg.textContent = err.message; }
        }, 'primary'),
        queueButton('删除', async () => { await store.removeQueued(r.id); renderQueue(); }))));
  return { node, choice: () => choice, confirm, showError: (m) => { msg.textContent = m; } };
}

// 处理中保持屏幕常亮；切到后台会自动释放，回到前台再申请
let lock = null, wantLock = false;
async function wakeLock(want) {
  wantLock = want;
  if (!want) { await lock?.release().catch(() => {}); lock = null; return; }
  if (lock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
  catch { /* 不支持或被拒绝：只靠提示 */ }
}
document.addEventListener('visibilitychange', () => { if (wantLock) wakeLock(true); });

// ---------- 存储状态、诊断 ----------
// 申请"空间不足时不自动清除"（persist），只在启动时做一次
const persisted = (async () => {
  if (!navigator.storage?.persist) return null;
  return (await navigator.storage.persisted()) || (await navigator.storage.persist());
})();

// 照片占用自己加总：Safari 的 storage.estimate() 不计 IndexedDB 里的图片（Mac Safari 实测存 1.27 MB 只多报约 3 KB）
async function showStorage(items) {
  const mb = (items.reduce((n, i) => n + i.image.size, 0) / 1024 / 1024).toFixed(1);
  const kept = await persisted;
  $('storage').textContent = kept
    ? `数据不会被自动清除 · 照片占用 ${mb} MB`
    : `空间不足时浏览器可能清除数据，请定期备份 · 照片占用 ${mb} MB`;
}

// ---------- 备份 ----------
// 页头：上次备份时间。超过 7 天、或有衣物却从未备份时用提醒色
async function showBackupAge(itemCount) {
  const at = await store.getBackupAt();
  const days = at === null ? null : Math.floor((Date.now() - at) / 86400000);
  const box = $('backupAge');
  box.textContent = days === null ? '还没有备份' : `上次备份：${days === 0 ? '今天' : `${days} 天前`}`;
  box.classList.toggle('warn', days === null ? itemCount > 0 : days > 7);
}

const backupMsg = (text, ...extra) => $('backupMsg').replaceChildren(text, ...extra);

// 存好文件后记录备份时间
async function exported(count, file) {
  await store.setBackupAt(Date.now());
  backupMsg(`已导出 ${count} 件（${file.name}，${(file.size / 1024 / 1024).toFixed(1)} MB）`);
  render();
}

// 手机用分享菜单（iPhone 可"存储到文件"），其他用下载。
// 生成 ZIP 要一些时间，iPhone 可能认为已经不是用户点击触发的分享（NotAllowedError），这时让用户再点一次
async function saveBackup(file, count) {
  const share = matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] });
  if (!share) {
    const a = el('a', { href: URL.createObjectURL(file), download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return exported(count, file);
  }
  try {
    await navigator.share({ files: [file] });
    return exported(count, file);
  } catch (err) {
    if (err.name === 'AbortError') return backupMsg('已取消，没有保存备份');
    if (err.name !== 'NotAllowedError') throw err;
    backupMsg('备份已生成。', el('button', { type: 'button', className: 'primary', textContent: '保存备份文件',
      onclick: () => saveBackup(file, count).catch((e) => backupMsg(`导出失败：${e.message}`)) }));
  }
}

$('exportBtn').addEventListener('click', async () => {
  backupMsg('正在生成备份…');
  try {
    const appVersion = (await globalThis.caches?.keys().catch(() => []) ?? []).find((k) => /^closet-v\d+$/.test(k)) ?? '';
    const { blob, filename, count } = await buildBackup(store, { appVersion });
    await saveBackup(new File([blob], filename, { type: 'application/zip' }), count);
  } catch (err) { backupMsg(`导出失败：${err.message}`); }
});

// 先完整校验（版本、分类、每张图片），再一个事务写入；任何一步失败数据库不变
$('importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  backupMsg('正在导入…');
  try {
    const { added, skipped, outfitsAdded } = await store.importData(await parseBackup(file));
    backupMsg(`新增 ${added} 件，跳过 ${skipped} 件；搭配新增 ${outfitsAdded} 套`);
    render();
  } catch (err) { backupMsg(`导入失败：${err.message}`); } finally { e.target.value = ''; }
});

// "关于"区显示当前版本（Service Worker 缓存名），验收和排查问题时看
async function showVersion() {
  const version = (await globalThis.caches?.keys().catch(() => []) ?? []).find((k) => /^closet-v\d+$/.test(k));
  $('version').textContent = `版本 ${version ?? '未知（还没有离线缓存）'}`;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker 注册失败', err));

// 抠图任务进行中时不渲染衣橱，少占内存
const job = await store.getJob();
if (job && !job.running && await noteResultsLoad(store)) {
  $('queueMsg').textContent = '抠图完成，正在准备结果…';
  await new Promise((ok) => setTimeout(ok, RESULTS_DELAY_MS));
  await noteWait(store, RESULTS_DELAY_MS);
  $('queueMsg').textContent = '';
}
if (!job?.running) { await render(); showView(view); }
else $('storage').textContent = '正在抠图';
await renderQueue();
if (!job?.running) {
  // 结果图都解码完，记一笔"结果已显示"（只在抠完后的那次刷新记）
  Promise.all([...document.querySelectorAll('#queue img')].map((i) => i.decode().catch(() => {})))
    .then(() => noteResultsShown(store));
}
document.documentElement.dataset.ready = '1'; // 事件已绑定、衣橱已渲染（测试等这个标记）
showVersion();
if (job?.running) {
  const result = await resumeQueue(store, { fake: fake === null ? null : Number(fake), fakeEmptyMask, fakeHostFail, onChange: renderQueue });
  if (result !== 'reloading') { await renderQueue(); if (result !== 'paused') await render(); }
}
