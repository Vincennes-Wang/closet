import { CATEGORIES, SEASONS, SCENES } from './options.js';
import { openStore, groupByCategory } from './store.js';
import { prepareImage, probeWebpAlpha } from './image.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

const store = await openStore();
const urls = new Set(); // 当前显示中的 object URL，重新渲染时统一释放

function objectUrl(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; }

// ---------- 表单：分类单选，季节、场景多选，其余文字 ----------
function chips(name, options, selected, multiple) {
  const box = el('div', { className: 'chips', role: multiple ? 'group' : 'radiogroup' });
  for (const value of options) {
    const b = el('button', { type: 'button', className: 'chip', textContent: value });
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
const picked = (box) => [...box.children].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

function itemFields(v = {}) {
  const category = chips('category', CATEGORIES, v.category ? [v.category] : [], false);
  const seasons = chips('seasons', SEASONS, v.seasons ?? [], true);
  const scenes = chips('scenes', SCENES, v.scenes ?? [], true);
  const text = (label, value, placeholder) => {
    const input = el('input', { type: 'text', value: value ?? '', placeholder });
    return { input, row: el('label', { className: 'field' }, el('span', { textContent: label }), input) };
  };
  const name = text('名称', v.name, '可不填');
  const sub = text('细分', v.subcategory, '如 T恤、牛仔裤');
  const color = text('颜色', v.color, '如 藏青');
  const block = (label, node) => el('div', { className: 'field' }, el('span', { textContent: label }), node);
  const node = el('div', { className: 'fields' },
    block('分类', category), block('季节', seasons), block('场景', scenes), name.row, sub.row, color.row);
  return {
    node,
    values: () => ({
      category: picked(category)[0],
      seasons: picked(seasons),
      scenes: picked(scenes),
      name: name.input.value,
      subcategory: sub.input.value,
      color: color.input.value,
    }),
  };
}

// ---------- 录入 ----------
$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) {
    const card = el('article', { className: 'pending card' }, el('p', { className: 'muted', textContent: `处理中：${file.name}` }));
    $('pending').append(card);
    try {
      const img = await prepareImage(file);
      renderPending(card, img);
    } catch (err) {
      card.replaceChildren(el('p', { className: 'error', textContent: `${file.name} 读取失败：${err.message}` }),
        el('button', { type: 'button', textContent: '关闭', onclick: () => card.remove() }));
    }
  }
});

function renderPending(card, img) {
  const url = URL.createObjectURL(img.blob);
  const fields = itemFields();
  const msg = el('p', { className: 'error' });
  const done = () => { URL.revokeObjectURL(url); card.remove(); };
  const save = el('button', { type: 'button', className: 'primary', textContent: '保存' });
  save.addEventListener('click', async () => {
    const v = fields.values();
    if (!v.category) { msg.textContent = '请选择分类'; return; }
    try {
      await store.add({ ...v, image: img.blob, hasAlpha: img.hasAlpha });
      done();
      render();
    } catch (err) { msg.textContent = `保存失败：${err.message}`; }
  });
  const hint = img.hasAlpha ? el('p', { className: 'muted', textContent: '已抠图（透明背景）' }) : '';
  card.replaceChildren(
    el('img', { src: url, alt: '', className: img.hasAlpha ? 'thumb alpha' : 'thumb' }),
    hint, fields.node, msg,
    el('div', { className: 'actions' }, save, el('button', { type: 'button', textContent: '放弃', onclick: done })),
  );
}

// ---------- 衣橱 ----------
function tile(item) {
  const b = el('button', { type: 'button', className: 'tile' },
    el('img', { src: objectUrl(item.image), alt: '', className: item.hasAlpha ? 'alpha' : '' }),
    el('span', { textContent: item.name || item.subcategory || item.category }));
  b.addEventListener('click', () => openEdit(item));
  return b;
}

function renderGroups(container, items) {
  container.replaceChildren(...groupByCategory(items).map((g) =>
    el('section', { className: 'group' },
      el('h2', { textContent: `${g.category} · ${g.items.length}` }),
      el('div', { className: 'grid' }, ...g.items.map(tile)))));
}

async function render() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
  const all = await store.list({ includeArchived: true });
  const active = all.filter((i) => !i.archived);
  renderGroups($('closet'), active);
  $('empty').hidden = active.length > 0;
  const showArchived = $('showArchived').checked;
  $('archived').hidden = !showArchived;
  if (showArchived) renderGroups($('archived'), all.filter((i) => i.archived));
  else $('archived').replaceChildren();
}
$('showArchived').addEventListener('change', render);

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
       act('彻底删除', () => confirm('彻底删除后无法恢复，确定吗？') ? store.remove(item.id) : false, 'danger')]
    : [act('保存', () => {
        const v = fields.values();
        if (!v.category) { msg.textContent = '请选择分类'; return false; }
        return store.update(item.id, v);
      }, 'primary'),
       act('归档', () => store.archive(item.id))];
  $('editForm').replaceChildren(
    el('img', { src: objectUrl(item.image), alt: '', className: item.hasAlpha ? 'thumb alpha' : 'thumb' }),
    fields.node, msg,
    el('div', { className: 'actions' }, ...buttons, el('button', { type: 'button', textContent: '取消', onclick: () => dialog.close() })),
  );
  dialog.showModal();
}

// ---------- 存储状态、诊断 ----------
async function showStorage() {
  const parts = [];
  if (navigator.storage?.persist) {
    const granted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    parts.push(`持久化：${granted ? '已授予' : '未授予'}`);
  } else parts.push('持久化：不支持');
  if (navigator.storage?.estimate) {
    const { usage } = await navigator.storage.estimate();
    parts.push(`已用 ${(usage / 1024 / 1024).toFixed(1)} MB`);
  }
  $('storage').textContent = parts.join(' · ');
}

async function showDiag() {
  const w = await probeWebpAlpha();
  $('diag').textContent = `透明图保存格式：${w.ok ? 'WebP' : 'PNG'}（toBlob('image/webp') 输出 ${w.outputType ?? '空'}，透明${w.alphaKept ? '保留' : '未保留'}）`;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker 注册失败', err));

await render();
document.documentElement.dataset.ready = '1'; // 事件已绑定、衣橱已渲染（测试等这个标记）
showStorage();
showDiag();
