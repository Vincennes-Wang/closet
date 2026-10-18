// 衣物选择器：左边栏一级分类 + 右侧二级分类、季节、场景筛选 + 衣物网格。
// 衣橱页用 browse 模式；阶段 4b 选衣服时用 single 模式（可固定一级分类）。
// 上半部分是纯函数（node 可测），createPicker 才碰 DOM。
import { SEASONS, SCENES } from './options.js';

// 筛选条件：categoryId / subcategoryId 为 null 表示"全部"；seasons、scenes 组内"或"，组间"且"
export const emptyFilter = () => ({ categoryId: null, subcategoryId: null, seasons: [], scenes: [] });

const anyOf = (wanted, values) => !wanted.length || wanted.some((v) => values.includes(v));

// 筛选并排序：排除已归档；按 taxonomy 顺序，同类内新的在前（不在 taxonomy 里的排最后）
export function filterItems(items, f, taxonomy = []) {
  const order = new Map(taxonomy.map((c, i) => [c.id, i]));
  const rank = (i) => order.get(i.categoryId) ?? taxonomy.length;
  return items
    .filter((i) => !i.archived
      && (!f.categoryId || i.categoryId === f.categoryId)
      && (!f.subcategoryId || i.subcategoryId === f.subcategoryId)
      && anyOf(f.seasons, i.seasons ?? [])
      && anyOf(f.scenes, i.scenes ?? []))
    .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
}

// 左边栏件数：一级分类 id → 件数，all = 总数。不计已归档，不受季节、场景筛选影响
export function countByCategory(items) {
  const counts = { all: 0 };
  for (const i of items) {
    if (i.archived) continue;
    counts.all++;
    counts[i.categoryId] = (counts[i.categoryId] ?? 0) + 1;
  }
  return counts;
}

export const hasFilter = (f) => !!(f.subcategoryId || f.seasons.length || f.scenes.length);

// URL hash ↔ 筛选条件。例：#c=top&sub=top.shirt&season=春,夏&scene=通勤
// 解析时丢掉不存在的分类（例如已隐藏）、不合法的季节和场景
export function parseFilter(hash, taxonomy) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const list = (key, allowed) => (p.get(key) ?? '').split(',').filter((v) => allowed.includes(v));
  const cat = taxonomy.find((c) => c.id === p.get('c'));
  const sub = cat?.subs.find((s) => s.id === p.get('sub'));
  return { categoryId: cat?.id ?? null, subcategoryId: sub?.id ?? null, seasons: list('season', SEASONS), scenes: list('scene', SCENES) };
}

export const filterToHash = (f) => { const s = filterParams(f).toString(); return s ? `#${s}` : ''; };

// 筛选条件 → URL 参数（app.js 还会加上别的参数，例如当前页面 v）
export function filterParams(f) {
  const p = new URLSearchParams();
  if (f.categoryId) p.set('c', f.categoryId);
  if (f.subcategoryId) p.set('sub', f.subcategoryId);
  if (f.seasons.length) p.set('season', f.seasons.join(','));
  if (f.scenes.length) p.set('scene', f.scenes.join(','));
  return p;
}

// ---------- DOM ----------
const ALL_ICON = '🗂️';

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

const chip = (label, pressed, onclick) => {
  const b = el('button', { type: 'button', className: 'chip', textContent: label, onclick });
  b.setAttribute('aria-pressed', String(pressed));
  return b;
};

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

// options：
//   filter：初始筛选（例如从 URL hash 读出）；initialCategory：初始一级分类（filter 优先）
//   canSwitchCategory：false 时不显示左边栏，一级分类固定
//   mode：'browse'（点衣物 = 打开）或 'single'（点衣物 = 选中，高亮 selectedId）
//   onFilterChange(filter)、onSelect(item)
//   labelFor(item)：衣物显示名（含已隐藏分类的改名）；不传时从 taxonomy 找
//   images：thumbs.js createImageLoader() 的结果（按需加载缩略图）；不传时直接显示原图（测试用）
// 返回 { setData(items, taxonomy), getFilter(), destroy() }。taxonomy 是 visibleTaxonomy() 的结果
export function createPicker(container, {
  filter = null, initialCategory = null, canSwitchCategory = true, mode = 'browse', selectedId = null,
  onFilterChange = () => {}, onSelect = () => {}, images = null, labelFor = null,
} = {}) {
  let f = filter ? { ...filter } : { ...emptyFilter(), categoryId: initialCategory };
  let items = [], taxonomy = [];
  // object URL 按衣物缓存；同一个 Blob 才复用（Safari：记录改写后旧 Blob 读不出来，见 CLAUDE.md）
  const urls = new Map();
  const urlFor = (item) => {
    const c = urls.get(item.id);
    if (c?.blob === item.image) return c.url;
    if (c) URL.revokeObjectURL(c.url);
    const url = URL.createObjectURL(item.image);
    urls.set(item.id, { blob: item.image, url });
    return url;
  };

  const set = (patch) => { f = { ...f, ...patch }; onFilterChange({ ...f }); render(); };
  const nameOf = (item) => {
    if (labelFor) return labelFor(item);
    const c = taxonomy.find((x) => x.id === item.categoryId);
    return item.name || c?.subs.find((s) => s.id === item.subcategoryId)?.zh || c?.zh || item.categoryId;
  };

  function side() {
    const counts = countByCategory(items);
    const entry = (id, icon, zh) => {
      const n = id ? counts[id] ?? 0 : counts.all;
      const b = el('button', { type: 'button', className: `side-item${n ? '' : ' none'}`,
        onclick: () => set({ categoryId: id, subcategoryId: null }) },
      el('span', { className: 'side-icon', textContent: icon, ariaHidden: 'true' }),
      el('span', { className: 'side-name', textContent: zh }),
      el('span', { className: 'side-count', textContent: String(n) }));
      b.dataset.id = id ?? '';
      b.setAttribute('aria-pressed', String(f.categoryId === id));
      return b;
    };
    return el('nav', { className: 'picker-side', ariaLabel: '分类' },
      entry(null, ALL_ICON, '全部'), ...taxonomy.map((c) => entry(c.id, c.icon, c.zh)));
  }

  function filters(shown) {
    const cat = taxonomy.find((c) => c.id === f.categoryId);
    const row = (name, cls, ...chips) => { const d = el('div', { className: `chips ${cls}` }, ...chips); d.dataset.name = name; return d; };
    return el('div', { className: 'picker-filters' },
      cat?.subs.length ? row('sub', 'scroll',
        chip('全部', !f.subcategoryId, () => set({ subcategoryId: null })),
        ...cat.subs.map((s) => chip(s.zh, f.subcategoryId === s.id, () => set({ subcategoryId: s.id })))) : '',
      row('seasons', '', ...SEASONS.map((v) => chip(v, f.seasons.includes(v), () => set({ seasons: toggle(f.seasons, v) })))),
      row('scenes', 'scroll', ...SCENES.map((v) => chip(v, f.scenes.includes(v), () => set({ scenes: toggle(f.scenes, v) })))),
      el('p', { className: 'picker-count' },
        el('span', { className: 'muted', textContent: `共 ${shown} 件` }),
        hasFilter(f) ? el('button', { type: 'button', className: 'small', textContent: '清除筛选',
          onclick: () => set({ subcategoryId: null, seasons: [], scenes: [] }) }) : ''));
  }

  function tile(item) {
    const img = el('img', { alt: '', className: item.hasAlpha ? 'alpha' : '' });
    if (images) images.observe(img, item); else img.src = urlFor(item);
    const b = el('button', { type: 'button', className: 'tile', onclick: () => onSelect(item) },
      img, el('span', { textContent: nameOf(item) }));
    b.dataset.id = item.id;
    if (mode === 'single') b.setAttribute('aria-pressed', String(item.id === selectedId));
    return b;
  }

  function render() {
    const shown = filterItems(items, f, taxonomy);
    // 重绘后保持左边栏和横向滚动行的位置，否则点下面的分类会跳回顶部
    const scrolled = [...container.querySelectorAll('.picker-side, .chips.scroll')]
      .map((e) => [e.dataset.name ?? 'side', e.scrollTop, e.scrollLeft]);
    container.replaceChildren(el('div', { className: `picker${canSwitchCategory ? '' : ' fixed'}` },
      canSwitchCategory ? side() : '',
      el('div', { className: 'picker-main' }, filters(shown.length),
        shown.length ? el('div', { className: 'grid picker-grid' }, ...shown.map(tile))
          : el('p', { className: 'muted', textContent: '没有符合条件的衣物' }))));
    images?.sweep();
    for (const [name, top, left] of scrolled) {
      const e = name === 'side' ? container.querySelector('.picker-side') : container.querySelector(`.chips[data-name="${name}"]`);
      if (e) { e.scrollTop = top; e.scrollLeft = left; }
    }
  }

  return {
    setData(nextItems, nextTaxonomy) {
      items = nextItems; taxonomy = nextTaxonomy;
      const ids = new Set(items.map((i) => i.id));
      for (const [id, c] of urls) if (!ids.has(id)) { URL.revokeObjectURL(c.url); urls.delete(id); }
      render();
    },
    getFilter: () => ({ ...f }),
    select(id) { selectedId = id; render(); },
    destroy() { for (const c of urls.values()) URL.revokeObjectURL(c.url); urls.clear(); container.replaceChildren(); images?.sweep(); },
  };
}
