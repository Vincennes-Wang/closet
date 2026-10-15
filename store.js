// 唯一访问 IndexedDB 的模块。其他代码只调用 openStore() 返回的方法。
import { SEASONS, SCENES } from './options.js';
import { CATEGORIES, categoryError } from './taxonomy.js';
import { validateOutfit, validatePlan } from './outfit.js';

const DB_NAME = 'closet';
export const DB_VERSION = 4;
const STORE = 'items';
const QUEUE = 'queue'; // 选进来、还没确认录入的照片（抠图、分类都在这里做）
const META = 'meta'; // 键值：job = 处理任务状态，device = 本设备设置
const CATS = 'categories'; // 用户自建分类，以及对内置分类的改名、隐藏（界面在阶段 4c）
const OUTFITS = 'outfits'; // 搭配（v4），规则见 outfit.js
const PLANS = 'plans'; // 下周穿搭计划（v4，界面在阶段 5）
const THUMBS = 'thumbs'; // 衣物缩略图（v4），{ itemId, blob }，不进备份，缺了就重新生成

// 队列记录的抠图状态。processing 只在处理那一张时出现；页面加载时还看到它，说明上次处理到这张时页面崩溃了
export const QUEUE_STATUS = ['pending', 'processing', 'cutout_done', 'cutout_failed', 'skipped'];
// 队列记录的分类状态（classify.status），含义同上
export const CLASSIFY_STATUS = ['pending', 'processing', 'done', 'failed', 'skipped'];

// 可编辑字段；id、createdAt、image、hasAlpha 录入时确定，之后不经 update 修改
const EDITABLE = ['name', 'categoryId', 'subcategoryId', 'seasons', 'scenes', 'color', 'archived'];

// 衣物只存分类 id，不存中文名（显示名从 taxonomy.js 和分类表取）。
// categoryRows：分类表记录，用来放行自建分类（导入备份时传备份里的分类表）；不传时只认内置分类
export function validate(item, categoryRows = []) {
  const errors = [];
  const ce = categoryError(item, categoryRows);
  if (ce) errors.push(ce);
  for (const [key, allowed] of [['seasons', SEASONS], ['scenes', SCENES]]) {
    if (!Array.isArray(item[key])) errors.push(`${key} 必须是数组`);
    else for (const v of item[key]) if (!allowed.includes(v)) errors.push(`${key} 含无效值：${v}`);
  }
  for (const key of ['name', 'color']) {
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
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId ?? null,
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

// 按一级分类分组，组按 taxonomy.js 顺序，组内新的在前；空组不返回
export function groupByCategory(items) {
  return CATEGORIES
    .map((c) => ({ categoryId: c.id, items: items.filter((i) => i.categoryId === c.id).sort((a, b) => b.createdAt - a.createdAt) }))
    .filter((g) => g.items.length);
}

const req = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

// 打开时被别的标签页（旧版本还连着数据库）挡住升级。app.js 据此提示关闭其他页面
export class BlockedError extends Error { constructor() { super('请关闭其他打开的衣橱页面后刷新'); this.name = 'BlockedError'; } }

// version 只给测试用（模拟旧代码请求低版本时的 VersionError）
export async function openStore(idbFactory = globalThis.indexedDB, { version = DB_VERSION } = {}) {
  const open = idbFactory.open(DB_NAME, version);
  // 每个分支只做"从上一版到这一版"的变化；新装（oldVersion 0）依次执行全部分支，每张表只建一次。
  open.onupgradeneeded = (e) => {
    const db = open.result;
    // v2、v3：用户确认旧的测试数据可以丢弃（2026-10-11 两次），直接删表重建，不写迁移
    if (e.oldVersion < 3) {
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('categoryId', 'categoryId');
      db.createObjectStore(QUEUE, { keyPath: 'id' }).createIndex('status', 'status');
      db.createObjectStore(META);
      db.createObjectStore(CATS, { keyPath: 'id' });
    }
    // v4：只新建表，v3 的数据原样保留
    if (e.oldVersion < 4) {
      db.createObjectStore(OUTFITS, { keyPath: 'id' });
      db.createObjectStore(PLANS, { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore(THUMBS, { keyPath: 'itemId' });
    }
  };
  let blocked = false;
  const db = await new Promise((ok, fail) => {
    open.onsuccess = () => ok(open.result);
    open.onerror = () => fail(open.error);
    open.onblocked = () => { blocked = true; fail(new BlockedError()); };
  }).catch((err) => {
    // 被挡住后如果之后又打开成功，关掉这个连接，避免占着数据库
    if (blocked) open.onsuccess = () => open.result.close();
    throw err;
  });
  // 新版本要升级时，本页面让出连接（否则会挡住新版本）
  db.onversionchange = () => db.close();

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
    // 删除衣物，同一个事务里删掉它的缩略图。搭配里保留它的 id（显示"已删除"）
    async remove(id) {
      const t = db.transaction([STORE, THUMBS], 'readwrite');
      const done = new Promise((ok, fail) => { t.oncomplete = ok; t.onerror = () => fail(t.error); t.onabort = () => fail(t.error); });
      t.objectStore(STORE).delete(id);
      t.objectStore(THUMBS).delete(id);
      await done;
    },

    // ---------- 缩略图（thumbs.js 用） ----------
    getThumb: async (itemId) => (await tx('readonly', (os) => req(os.get(itemId)), THUMBS))?.blob ?? null,
    putThumb: (itemId, blob) => tx('readwrite', (os) => req(os.put({ itemId, blob })), THUMBS),

    // ---------- 搭配、计划 ----------
    listOutfits: async () => (await tx('readonly', (os) => req(os.getAll()), OUTFITS)).sort((a, b) => b.updatedAt - a.updatedAt),
    // 新建或保存搭配。只查结构；必填规则由界面用 outfitError 检查（已删除的衣物要允许留在旧搭配里）
    async putOutfit(input, { now = Date.now() } = {}) {
      const o = validateOutfit({ id: crypto.randomUUID(), createdAt: now, ...input, updatedAt: now });
      await tx('readwrite', (os) => req(os.put(o)), OUTFITS);
      return o;
    },
    removeOutfit: (id) => tx('readwrite', (os) => req(os.delete(id)), OUTFITS),
    listPlans: () => tx('readonly', (os) => req(os.getAll()), PLANS),

    // ---------- 抠图队列 ----------
    // 透明图（别处已抠好）直接算抠图完成，不再进模型
    // thumb：队列里显示用的缩略图（抠图后换成抠图结果的缩略图）
    async enqueue({ original, hasAlpha, thumb = null }, { id = crypto.randomUUID(), now = Date.now() } = {}) {
      const rec = { id, createdAt: now, original, hasAlpha, thumb, cutout: hasAlpha ? original : null,
        status: hasAlpha ? 'cutout_done' : 'pending', attempts: 0, error: '', ms: null,
        classify: { status: 'pending', attempts: 0, error: '', top3: [], ms: null } };
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
    patchQueued,
    // 确认录入：用抠图结果（或用户选的原图）新建衣物，同一个事务里删掉队列记录。图片只存一份。
    // 和 update() 一样先在事务外复制 Blob（Safari 坑）
    async confirmQueued(id, { categoryId, subcategoryId, seasons, useOriginal = false }) {
      const rec = await tx('readonly', (os) => req(os.get(id)), QUEUE);
      if (!rec) throw new Error(`找不到队列记录 ${id}`);
      const cut = rec.status === 'cutout_done' && !useOriginal;
      const image = await copyBlob(cut ? rec.cutout : rec.original);
      const item = newItem({ image, hasAlpha: cut || rec.hasAlpha, categoryId, subcategoryId, seasons, scenes: [] });
      const t = db.transaction([STORE, QUEUE], 'readwrite');
      const done = new Promise((ok, fail) => { t.oncomplete = ok; t.onerror = () => fail(t.error); t.onabort = () => fail(t.error); });
      t.objectStore(STORE).add(item);
      t.objectStore(QUEUE).delete(id);
      await done;
      return item;
    },
    removeQueued: (id) => tx('readwrite', (os) => req(os.delete(id)), QUEUE),

    // ---------- 任务状态 ----------
    // 本设备的设置（meta 的 device 键），例如 { noWebgpu: true }。不随任务清空
    getDevice: async () => (await tx('readonly', (os) => req(os.get('device')), META)) ?? {},
    setDevice: (patch) => tx('readwrite', async (os) => {
      const next = { ...((await req(os.get('device'))) ?? {}), ...patch };
      os.put(next, 'device');
      return next;
    }, META),
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

    // ---------- 分类表（自建分类、改名、隐藏）。规则见 CLAUDE.md"分类规则"，界面在阶段 4 ----------
    listCategoryRows: () => tx('readonly', (os) => req(os.getAll()), CATS),
    putCategoryRow: (row) => tx('readwrite', (os) => req(os.put(row)), CATS),
    // 只能删自建分类，且分类下没有衣物
    async removeCategoryRow(id) {
      const row = await tx('readonly', (os) => req(os.get(id)), CATS);
      if (!row || row.builtin !== false) throw new Error('内置分类不能删除，只能隐藏');
      const used = (await tx('readonly', (os) => req(os.getAll()))).some((i) => i.categoryId === id || i.subcategoryId === id);
      if (used) throw new Error('这个分类下还有衣物，先把衣物移到别的分类');
      await tx('readwrite', (os) => req(os.delete(id)), CATS);
    },

    // ---------- 备份（backup.js） ----------
    dbVersion: DB_VERSION,
    // 全部衣物（含已归档）、分类表、搭配、计划。不含缩略图
    async exportData() {
      const all = (name) => tx('readonly', (os) => req(os.getAll()), name);
      return { items: await all(STORE), categories: await all(CATS), outfits: await all(OUTFITS), plans: await all(PLANS) };
    },
    // 导入（合并）：id 已存在的衣物和分类记录跳过（不覆盖本机的修改），其余新增。
    // 一个事务：任何一步失败整个事务中止，数据库不变。图片 Blob 由调用方事先复制好（backup.js parseBackup）
    async importData({ items, categories, outfits = [], plans = [] }) {
      const t = db.transaction([STORE, CATS, OUTFITS, PLANS], 'readwrite');
      const done = new Promise((ok, fail) => { t.oncomplete = ok; t.onerror = () => fail(t.error); t.onabort = () => fail(t.error ?? new Error('导入已中止')); });
      const its = t.objectStore(STORE), cats = t.objectStore(CATS);
      let added = 0, skipped = 0, outfitsAdded = 0;
      try {
        for (const item of items) {
          if (await req(its.getKey(item.id)) !== undefined) { skipped++; continue; }
          its.add(item); added++;
        }
        for (const row of categories) if (await req(cats.getKey(row.id)) === undefined) cats.add(row);
        const os = t.objectStore(OUTFITS), ps = t.objectStore(PLANS);
        for (const o of outfits) if (await req(os.getKey(o.id)) === undefined) { os.add(o); outfitsAdded++; }
        for (const p of plans) if (await req(ps.getKey(p.id)) === undefined) ps.add(p);
      } catch (err) { try { t.abort(); } catch { /* 已中止 */ } throw err; }
      await done;
      return { added, skipped, outfitsAdded };
    },
    // 上次备份时间（毫秒），本机记录，不导出
    getBackupAt: async () => (await tx('readonly', (os) => req(os.get('backup')), META))?.at ?? null,
    setBackupAt: (at) => tx('readwrite', (os) => req(os.put({ at }, 'backup')), META),
    close: () => db.close(),
  };
}
