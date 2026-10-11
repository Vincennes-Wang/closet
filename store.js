// 唯一访问 IndexedDB 的模块。其他代码只调用 openStore() 返回的方法。
import { CATEGORIES, SEASONS, SCENES } from './options.js';

const DB_NAME = 'closet';
const DB_VERSION = 2;
const STORE = 'items';
const QUEUE = 'queue'; // 待抠图 / 已抠图、还没录入的照片
const META = 'meta'; // 键值：job = 抠图任务状态

// 队列记录状态。processing 只在处理那一张时出现；页面加载时还看到它，说明上次处理到这张时页面崩溃了
export const QUEUE_STATUS = ['pending', 'processing', 'cutout_done', 'cutout_failed', 'skipped'];

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
  // v2：用户确认 v1 的测试数据可以丢弃，直接删表重建，不写迁移
  open.onupgradeneeded = (e) => {
    const db = open.result;
    if (e.oldVersion < 2) for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
    db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('category', 'category');
    db.createObjectStore(QUEUE, { keyPath: 'id' }).createIndex('status', 'status');
    db.createObjectStore(META);
  };
  const db = await req(open);

  // 每个操作一个事务；等事务 complete 才返回，确保已写入
  async function tx(mode, fn, name = STORE) {
    const t = db.transaction(name, mode);
    const done = new Promise((ok, fail) => { t.oncomplete = ok; t.onerror = () => fail(t.error); t.onabort = () => fail(t.error); });
    const result = await fn(t.objectStore(name));
    await done;
    return result;
  }

  const copyBlob = async (b) => (b ? new Blob([await b.arrayBuffer()], { type: b.type }) : b);

  // 改一条队列记录。和 update() 一样先在事务外复制 Blob（Safari 坑）。
  // onlyIf：写入事务里对最新记录再判断一次，不满足就不写（复制 Blob 期间记录可能已被别的页面改了）
  async function patchQueued(id, fn, onlyIf = null) {
    const current = await tx('readonly', (os) => req(os.get(id)), QUEUE);
    if (!current) throw new Error(`找不到队列记录 ${id}`);
    const next = fn({ ...current, original: await copyBlob(current.original),
      cutout: await copyBlob(current.cutout), thumb: await copyBlob(current.thumb) });
    return tx('readwrite', async (os) => {
      if (onlyIf && !onlyIf(await req(os.get(id)) ?? {})) return null;
      os.put(next);
      return next;
    }, QUEUE);
  }

  // 多条记录只改状态（取消时用）
  async function setStatus(ids, status) {
    for (const id of ids) await patchQueued(id, (r) => ({ ...r, status }));
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

    // ---------- 抠图队列 ----------
    // 透明图（别处已抠好）直接算抠图完成，不再进模型
    // thumb：队列里显示用的缩略图（抠图后换成抠图结果的缩略图）
    async enqueue({ original, hasAlpha, thumb = null }, { id = crypto.randomUUID(), now = Date.now() } = {}) {
      const rec = { id, createdAt: now, original, hasAlpha, thumb, cutout: hasAlpha ? original : null,
        status: hasAlpha ? 'cutout_done' : 'pending', attempts: 0, error: '', ms: null };
      await tx('readwrite', (os) => req(os.add(rec)), QUEUE);
      return rec;
    },
    // 按加入顺序
    listQueue: async () => (await tx('readonly', (os) => req(os.getAll()), QUEUE)).sort((a, b) => a.createdAt - b.createdAt),
    getQueued: (id) => tx('readonly', (os) => req(os.get(id)), QUEUE),
    markProcessing: (id) => patchQueued(id, (r) => ({ ...r, status: 'processing' })),
    // 只在记录仍是 processing 时保存：已被取消、或已被新页面判为崩溃的，不覆盖
    saveCutout: (id, cutout, ms, thumb = null) => patchQueued(id,
      (r) => ({ ...r, cutout, thumb: thumb ?? r.thumb, status: 'cutout_done', error: '', ms }),
      (latest) => latest.status === 'processing'),
    // 失败一次（崩溃或报错）：次数到上限标失败、保留原图，否则回到待处理
    failAttempt: (id, error, maxAttempts) => patchQueued(id, (r) => {
      const attempts = r.attempts + 1;
      return { ...r, attempts, error, status: attempts >= maxAttempts ? 'cutout_failed' : 'pending' };
    }),
    setStatus,
    removeQueued: (id) => tx('readwrite', (os) => req(os.delete(id)), QUEUE),

    // ---------- 任务状态 ----------
    getJob: async () => (await tx('readonly', (os) => req(os.get('job')), META)) ?? null,
    // patch 可以是对象，也可以是 (当前 job) => 对象（读改写在同一个事务里，例如追加事件）
    async setJob(patch) {
      return tx('readwrite', async (os) => {
        const current = (await req(os.get('job'))) ?? {};
        const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
        os.put(next, 'job');
        return next;
      }, META);
    },
    close: () => db.close(),
  };
}
