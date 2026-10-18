import { SEASONS, SCENES } from './options.js';
import { CATEGORIES, getNode, split, seasonsFor, labelOf, visibleTaxonomy } from './taxonomy.js';
import { createPicker, parseFilter, filterParams } from './picker.js';
import { openStore, groupByCategory } from './store.js';
import { SLOTS, getSlot, itemsForSlot, taxonomyForSlot, slotState, outfitError, outfitSeasons, outfitsUsing, emptySlots } from './outfit.js';
import { createImageLoader } from './thumbs.js';
import { prepareImage, probeWebpAlpha, makeThumb } from './image.js';
import { THUMB_SIDE, RESULTS_DELAY_MS } from './config.js';
import { buildBackup, parseBackup } from './backup.js';
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

// 编辑表单（新录入走待确认列表）。换分类不改用户已选的季节
function itemFields(v = {}) {
  const opts = (nodes) => nodes.map((n) => ({ value: n.id, label: n.zh }));
  const category = chips('category', opts(CATEGORIES), v.categoryId ? [v.categoryId] : [], false);
  const subBox = el('div');
  let sub = null;
  const seasons = chips('seasons', SEASONS, v.seasons ?? [], true);
  // 二级分类随一级分类变化；没有二级分类的一级不显示这一行
  const renderSubs = (selected) => {
    const c = getNode(picked(category)[0]);
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

// 分类没选全时的提示；选全了返回 ''
function categoryError(v) {
  if (!v.categoryId) return '请选择分类';
  if (getNode(v.categoryId).subs.length && !v.subcategoryId) return '请选择细分';
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
    el('span', { textContent: item.name || labelOf(item.subcategoryId ?? item.categoryId) }));
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
      el('h2', { textContent: `${labelOf(g.categoryId)} · ${g.items.length}` }),
      el('div', { className: 'grid' }, ...g.items.map(tile)))));
}

// ---------- 页面切换（衣橱 / 搭配）和 URL hash ----------
// hash = 当前页面（v=outfits）+ 衣橱筛选（picker.js filterParams）。抠图队列自动刷新后仍在
let view = new URLSearchParams(location.hash.slice(1)).get('v') === 'outfits' ? 'outfits' : 'closet';
function writeHash() {
  const p = picker ? filterParams(picker.getFilter()) : new URLSearchParams(location.hash.slice(1));
  if (view === 'outfits') p.set('v', 'outfits'); else p.delete('v');
  const h = p.toString();
  history.replaceState(null, '', location.pathname + location.search + (h ? `#${h}` : ''));
}
function showView(v) {
  view = v;
  document.body.classList.toggle('view-outfits', v === 'outfits');
  for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  writeHash();
  if (v === 'outfits') renderOutfits();
  else $('outfitList').replaceChildren();
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
  const taxonomy = visibleTaxonomy(rows);
  showStorage(all);
  showBackupAge(all.length);
  const active = all.filter((i) => !i.archived);
  picker ??= createPicker($('closet'), {
    filter: parseFilter(location.hash, taxonomy),
    onFilterChange: writeHash,
    onSelect: openEdit,
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

// ---------- 搭配 ----------
const STATE_TEXT = { deleted: '已删除', archived: '已归档' };
const itemName = (item) => item.name || labelOf(item.subcategoryId ?? item.categoryId);

// 一个槽位的小图：有衣物显示缩略图，已删除 / 已归档显示文字
function slotThumb(id, byId) {
  const state = slotState(id, byId);
  if (state === 'ok') return lazyImg(byId.get(id));
  return el('span', { className: `slot-missing ${state ?? 'empty'}`, textContent: STATE_TEXT[state] ?? '' });
}

async function renderOutfits() {
  const [outfits, all] = await Promise.all([store.listOutfits(), store.list({ includeArchived: true })]);
  const byId = new Map(all.map((i) => [i.id, i]));
  // 每套一张合成图（thumbs.js，按需生成并缓存）；已删除、已归档的衣物不画，另起一行写明
  const cards = outfits.map((o) => {
    const seasons = outfitSeasons(o, byId);
    const counts = {};
    for (const s of SLOTS) { const st = slotState(o.slots[s.id], byId); if (STATE_TEXT[st]) counts[st] = (counts[st] ?? 0) + 1; }
    const missing = Object.entries(counts).map(([st, n]) => `${n} 件${STATE_TEXT[st]}`).join('，');
    const img = el('img', { className: 'outfit-img', alt: o.name || '搭配' });
    images.observeOutfit(img, o, byId);
    const card = el('button', { type: 'button', className: 'outfit-card', onclick: () => openOutfit(o) },
      el('span', { className: 'outfit-name', textContent: o.name || '未命名搭配' }),
      el('span', { className: 'muted', textContent: [o.scenes.join('、'), seasons.join('')].filter(Boolean).join(' · ') || ' ' }),
      img,
      missing ? el('span', { className: 'outfit-missing', textContent: missing }) : '');
    card.dataset.id = o.id;
    return card;
  });
  $('outfitList').replaceChildren(...cards);
  $('outfitsEmpty').hidden = outfits.length > 0;
  images.sweep();
}
$('newOutfit').addEventListener('click', () => openOutfit(null));

// 搭配编辑：名称、场景、7 个槽位。点槽位后在同一个弹窗里换成选择器（不叠两层弹窗）
async function openOutfit(saved) {
  const dialog = $('editDialog');
  const [all, rows] = await Promise.all([store.list({ includeArchived: true }), store.listCategoryRows()]);
  const byId = new Map(all.map((i) => [i.id, i]));
  const taxonomy = visibleTaxonomy(rows);
  const draft = saved ? { ...saved, slots: { ...saved.slots } } : { name: '', scenes: [], slots: emptySlots() };
  const name = el('input', { type: 'text', value: draft.name, placeholder: '可不填，如 周一通勤' });
  const scenes = chips('scenes', SCENES, draft.scenes, true);
  const msg = el('p', { className: 'error' });
  const close = () => { dialog.close(); images.sweep(); };

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
        id ? el('button', { type: 'button', className: 'small', textContent: '清空', onclick: () => { draft.slots[slot.id] = null; editor(); } }) : '');
      row.dataset.slot = slot.id;
      return row;
    });
    // 实时预览：每次改槽位都会重建编辑视图，预览跟着重画（不写缓存）
    const preview = el('canvas', { className: 'outfit-preview' });
    $('editForm').replaceChildren(
      el('h2', { textContent: saved ? '编辑搭配' : '新建搭配' }),
      el('label', { className: 'field' }, el('span', { textContent: '名称' }), name),
      el('div', { className: 'field' }, el('span', { textContent: '场景' }), scenes),
      preview,
      el('div', { className: 'slots' }, ...slotRows),
      msg,
      el('div', { className: 'actions' },
        el('button', { type: 'button', className: 'primary', textContent: '保存', onclick: save }),
        saved ? el('button', { type: 'button', className: 'danger', textContent: '删除搭配', onclick: remove }) : '',
        el('button', { type: 'button', textContent: '取消', onclick: close })));
    images.sweep();
    images.preview(preview, draft, byId)
      .then((n) => { preview.dataset.drawn = String(n); })
      .catch((err) => console.warn('预览失败', err));
  }

  function pickFor(slot) {
    draft.name = name.value; draft.scenes = picked(scenes);
    const tax = taxonomyForSlot(slot, taxonomy);
    const choices = itemsForSlot(slot, all);
    const box = el('div');
    $('editForm').replaceChildren(
      el('div', { className: 'pick-head' },
        el('button', { type: 'button', className: 'small', textContent: '← 返回', onclick: () => { slotPicker.destroy(); editor(); } }),
        el('h2', { textContent: `选择${slot.zh}` })),
      choices.length ? box : el('p', { className: 'muted', textContent: '衣橱里还没有能放进这个槽位的衣物' }));
    const slotPicker = createPicker(box, {
      initialCategory: tax.length === 1 ? tax[0].id : null, canSwitchCategory: tax.length > 1, mode: 'single',
      selectedId: draft.slots[slot.id], images,
      onSelect: (item) => { draft.slots[slot.id] = item.id; slotPicker.destroy(); editor(); },
    });
    slotPicker.setData(choices, tax);
  }

  async function save() {
    draft.name = name.value.trim(); draft.scenes = picked(scenes);
    const err = outfitError(draft, byId);
    if (err) { msg.textContent = err; return; }
    try { await store.putOutfit(draft); close(); renderOutfits(); } catch (e) { msg.textContent = e.message; }
  }
  async function remove() {
    if (!confirm('删除这套搭配吗？衣物不受影响。')) return;
    await store.removeOutfit(saved.id); close(); renderOutfits();
  }

  editor();
  dialog.showModal();
  dialog.focus();
}

// ---------- 抠图队列 ----------
const fake = new URLSearchParams(location.search).get('fakeMatting'); // 测试用，见 model-worker.js
const fakeEmptyMask = new URLSearchParams(location.search).has('fakeEmptyMask'); // 测试用：模拟 WebGPU 遮罩全空
const fakeHostFail = new URLSearchParams(location.search).get('fakeHostFail') ?? ''; // 测试用：模拟这个模型地址网络失败
const qurls = new Set();
const duration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)} 分 ${s % 60} 秒`; };
const progressText = (p) => `${p.phase === 'classify' ? `分类 ${p.classifyProcessed} / ${p.total}（失败 ${p.classifyFailed}）` : `抠图 ${p.processed} / ${p.total}（失败 ${p.failed}）`} · 自动刷新 ${p.reloads} 次 · 崩溃恢复 ${p.recoveries} 次 · 用时 ${duration(p.elapsedMs)}`;

// 可展开的事件时间线（诊断用）
const timeline = (job) => (job?.events?.length
  ? el('details', { className: 'timeline' }, el('summary', { textContent: '详细记录' }), el('pre', { textContent: eventLines(job).join('\n') }))
  : '');

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
      job.paused ? timeline(job) : '',
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
  const cards = queue.map(reviewCard);
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
    p ? el('p', { className: 'muted', id: 'lastJob', textContent: `上次抠图：成功 ${p.done}，失败 ${p.failed}，未抠图 ${p.skipped} · 自动刷新 ${p.reloads} 次 · 崩溃恢复 ${p.recoveries} 次 · 用时 ${duration(p.elapsedMs)}${p.backend ? ` · ${p.backend}` : ''}${p.classifyHost ? ` · 分类模型 ${p.classifyHost}` : ''} · 分类 ${p.classified} 张，失败 ${p.classifyFailed}` }) : '',
    p ? timeline(job) : '',
    backend === 'wasm' ? el('p', { className: 'hint', id: 'slowHint',
      textContent: `这台设备处理较慢，${waiting} 张约需 ${minutesText(Math.max(60000, estimateMs(waiting, backend)))}，处理中请保持本页面打开` }) : '',
    waiting ? el('div', { className: 'actions' },
      queueButton(`开始处理（${waiting} 张）`, async () => { await startJob(store, backend); location.reload(); }, 'primary')) : '',
    queue.some((r) => r.classify?.status === 'done') ? el('div', { className: 'actions' }, confirmAll) : '',
    el('div', { className: 'reviews' }, ...cards.map((c) => c.node)))] : []));
}

// 待确认卡片：缩略图（可看原图）、建议分类 + 另外 2 个候选、其他分类、季节、"用原图"、确认 / 删除。
// 返回 { node, choice()（当前选的分类，没选为 null）, confirm(), showError() }
function reviewCard(r) {
  const thumbUrl = URL.createObjectURL(r.thumb ?? r.cutout ?? r.original); qurls.add(thumbUrl);
  const cut = r.status === 'cutout_done';
  const node = el('article', { className: 'review' });
  node.dataset.id = r.id;
  if (r.status === 'pending' || r.status === 'processing') {
    node.append(el('img', { src: thumbUrl, alt: '' }), el('p', { className: 'status', textContent: '待处理' }),
      queueButton('删除', async () => { await store.removeQueued(r.id); renderQueue(); }));
    return { node, choice: () => null, confirm: async () => {}, showError: () => {} };
  }

  // 当前选择：默认是分类建议的第一名
  const top3 = r.classify?.status === 'done' ? r.classify.top3 : [];
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
    label.textContent = choice ? labelOf(choice.subcategoryId ?? choice.categoryId) : '请选择分类';
    candidates.replaceChildren(...top3.map((t) => {
      const b = el('button', { type: 'button', className: 'chip', textContent: `${labelOf(t.id)} ${Math.round(t.score * 100)}%` });
      b.setAttribute('aria-pressed', String((choice?.subcategoryId ?? choice?.categoryId) === t.id));
      b.addEventListener('click', () => pick(split(t.id)));
      return b;
    }));
  };
  const otherBtn = queueButton('其他分类', () => {
    other.hidden = !other.hidden;
    if (other.hidden) return;
    // 一级 → 细分；没有细分的一级直接选中
    const cats = chips('category', CATEGORIES.map((c) => ({ value: c.id, label: c.zh })), [], false);
    const subs = el('div');
    cats.addEventListener('change', () => {
      const c = getNode(picked(cats)[0]);
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
    ? el('p', { className: 'hint', textContent: `${r.status === 'skipped' ? '没有抠图' : '抠图失败'}，将保存原图。也可以用照片 App 抠图（长按衣服 → 共享 → 保存图像）后重新上传。` })
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

// 测试辅助，交付前视情况删除
async function showDiag() {
  const version = (await globalThis.caches?.keys().catch(() => []) ?? []).find((k) => /^closet-v\d+$/.test(k));
  $('version').textContent = `版本 ${version ?? '未知（还没有离线缓存）'}`;
  const w = await probeWebpAlpha();
  $('diag').textContent = w.ok ? '透明图保存为 WebP' : '透明图保存为 PNG（这台设备的浏览器不能保存带透明的 WebP）';
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
showDiag();
if (job?.running) {
  const result = await resumeQueue(store, { fake: fake === null ? null : Number(fake), fakeEmptyMask, fakeHostFail, onChange: renderQueue });
  if (result !== 'reloading') { await renderQueue(); if (result !== 'paused') await render(); }
}
