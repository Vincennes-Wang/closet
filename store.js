// 唯一访问 IndexedDB 的模块。其他代码只调用 openStore() 返回的方法。
import { CATEGORIES, SEASONS, SCENES } from './options.js';

const DB_NAME = 'closet';
const DB_VERSION = 1;
const STORE = 'items';

// 可编辑字段；id、createdAt、image、hasAlpha 录入时确定，之后不经 update 修改
const EDITABLE = ['name', 'category', 'subcategory', 'seasons', 'scenes', 'color', 'archived'];

export function validate(item) {
  const errors = [];
  if (!CATEGORIES.includes(item.category)) errors.push(`category 无效：${item.category}`);
  for (const [key, allowed] of [['seasons', SEASONS], ['scenes', SCENES]]) {
    if (!Array.isArray(item[key])) errors.push(`${key} 必须是数组`);
    else for (const v of item[key]) if (!allowed.includes(v)) errors.push(`${key} 含无效值：${v}`);
  }
  for (const key of ['name', 'subcategory', 'color']) {
    if (typeof item[key] !== 'string') errors.push(`${key} 必须是字符串`);
  }
  if (typeof item.hasAlpha !== 'boolean') errors.push('hasAlpha 必须是布尔值');
  if (typeof item.archived !== 'boolean') errors.push('archived 必须是布尔值');
  if (!item.image) errors.push('缺少 image');
  if (errors.length) throw new Error(errors.join('；'));
  return item;
}

const copyList = (v) => (Array.isArray(v) ? [...v] : v ?? []);

// 新记录：补默认值，只保留规定字段（不记录价格、材质）
export function newItem(input, { id = crypto.randomUUID(), now = Date.now() } = {}) {
  return validate({
    id,
    createdAt: now,
    image: input.image,
    hasAlpha: input.hasAlpha,
    name: (input.name ?? '').trim(),
    category: input.category,
    subcategory: (input.subcategory ?? '').trim(),
    seasons: copyList(input.seasons),
    scenes: copyList(input.scenes),
    color: (input.color ?? '').trim(),
    archived: false,
  });
}

export function applyPatch(item, patch) {
  const next = { ...item };
  for (const key of EDITABLE) {
    if (!(key in patch)) continue;
    const v = patch[key];
    next[key] = typeof v === 'string' ? v.trim() : Array.isArray(v) ? [...v] : v;
  }
  return validate(next);
}

// 按一级分类分组，组按 CATEGORIES 顺序，组内新的在前；空组不返回
export function groupByCategory(items) {
  return CATEGORIES
    .map((category) => ({ category, items: items.filter((i) => i.category === category).sort((a, b) => b.createdAt - a.createdAt) }))
    .filter((g) => g.items.length);
}

const req = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

export async function openStore(idbFactory = globalThis.indexedDB) {
  const open = idbFactory.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const os = open.result.createObjectStore(STORE, { keyPath: 'id' });
    os.createIndex('category', 'category');
  };
  const db = await req(open);

  // 每个操作一个事务；等事务 complete 才返回，确保已写入
  async function tx(mode, fn) {
    const t = db.transaction(STORE, mode);
    const done = new Promise((ok, fail) => { t.oncomplete = ok; t.onerror = () => fail(t.error); t.onabort = () => fail(t.error); });
    const result = await fn(t.objectStore(STORE));
    await done;
    return result;
  }

  // Safari：把从 IndexedDB 读出的 Blob 原样 put 回去，本次会话里这件衣物的图片就读不出来
  // （"The object can not be found here"，刷新后恢复）。所以先在事务外复制成新 Blob 再写入
  async function update(id, patch) {
    const current = await tx('readonly', (os) => req(os.get(id)));
    if (!current) throw new Error(`找不到衣物 ${id}`);
    const image = new Blob([await current.image.arrayBuffer()], { type: current.image.type });
    return tx('readwrite', async (os) => {
      const item = await req(os.get(id));
      if (!item) throw new Error(`找不到衣物 ${id}`);
      const next = applyPatch({ ...item, image }, patch);
      os.put(next);
      return next;
    });
  }

  return {
    async add(input) { const item = newItem(input); await tx('readwrite', (os) => req(os.add(item))); return item; },
    get: (id) => tx('readonly', (os) => req(os.get(id))),
    update,
    async list({ includeArchived = false } = {}) {
      const all = await tx('readonly', (os) => req(os.getAll()));
      return includeArchived ? all : all.filter((i) => !i.archived);
    },
    archive: (id) => update(id, { archived: true }),
    unarchive: (id) => update(id, { archived: false }),
    remove: (id) => tx('readwrite', (os) => req(os.delete(id))),
    close: () => db.close(),
  };
}
