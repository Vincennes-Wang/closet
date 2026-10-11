// 在 headless Chrome 里测 store.js（真实 IndexedDB）和应用录入流程
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchChrome } from './cdp.mjs';

let server, chrome;
before(async () => { server = await startServer(); chrome = await launchChrome(); });
after(async () => { await chrome?.close(); server?.close(); });

test('store.js：增、查、改、归档、恢复、删除，重开数据库后数据仍在', async () => {
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const r = await chrome.evaluate(`(async () => {
    await new Promise((ok) => { const d = indexedDB.deleteDatabase('closet'); d.onsuccess = d.onerror = ok; });
    const { openStore } = await import('/store.js');
    let s = await openStore();
    const out = {};
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const a = await s.add({ image, hasAlpha: true, category: '上衣', seasons: ['夏'], scenes: ['通勤'], name: '白T' });
    const b = await s.add({ image, hasAlpha: false, category: '裤子', seasons: [], scenes: [] });
    out.count = (await s.list()).length;
    await s.update(a.id, { color: '白', seasons: ['春', '夏'] });
    await s.archive(b.id);
    out.activeAfterArchive = (await s.list()).map((i) => i.id);
    out.allAfterArchive = (await s.list({ includeArchived: true })).length;
    s.close();
    s = await openStore();
    const got = await s.get(a.id);
    out.reopened = { color: got.color, seasons: got.seasons, name: got.name, imageSize: got.image.size, imageType: got.image.type };
    await s.unarchive(b.id);
    out.afterUnarchive = (await s.list()).length;
    await s.remove(b.id);
    out.afterRemove = (await s.list({ includeArchived: true })).length;
    try { await s.update('nope', { color: 'x' }); out.missing = 'no error'; } catch (e) { out.missing = e.message; }
    try { await s.add({ image, hasAlpha: true, category: '泳衣', seasons: [], scenes: [] }); out.invalid = 'no error'; } catch (e) { out.invalid = e.message; }
    out.afterInvalid = (await s.list({ includeArchived: true })).length;
    out.aId = a.id;
    s.close();
    return out;
  })()`);
  assert.equal(r.count, 2);
  assert.deepEqual(r.activeAfterArchive, [r.aId]);
  assert.equal(r.allAfterArchive, 2);
  assert.deepEqual(r.reopened, { color: '白', seasons: ['春', '夏'], name: '白T', imageSize: 3, imageType: 'image/png' });
  assert.equal(r.afterUnarchive, 2);
  assert.equal(r.afterRemove, 1);
  assert.match(r.missing, /找不到衣物/);
  assert.match(r.invalid, /category 无效/);
  assert.equal(r.afterInvalid, 1);
});

// 在页面里生成测试图片并模拟选择文件（不用照片）
const PICK_FILES = `(async () => {
  const make = async (alpha, type, name) => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    const ctx = c.getContext('2d');
    if (!alpha) { ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.fillStyle = '#336'; ctx.fillRect(500, 300, 1000, 900);
    const blob = await new Promise((ok) => c.toBlob(ok, type, 0.9));
    return new File([blob], name, { type });
  };
  const dt = new DataTransfer();
  dt.items.add(await make(true, 'image/png', 'cutout.png'));
  dt.items.add(await make(false, 'image/jpeg', 'photo.jpg'));
  const input = document.getElementById('fileInput');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
})()`;

const clickChip = (cardIndex, text) => `(() => {
  const card = document.querySelectorAll('#pending .card')[${cardIndex}];
  [...card.querySelectorAll('.chip')].find((b) => b.textContent === '${text}').click();
})()`;

const resetDb = async () => {
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(`new Promise((ok) => { const d = indexedDB.deleteDatabase('closet'); d.onsuccess = d.onerror = ok; })`);
};
const statuses = `[...document.querySelectorAll('#queue .status')].map((s) => s.textContent).join(',')`;
const clickButton = (scope, text) => `[...document.querySelectorAll('${scope} button')].find((b) => b.textContent.startsWith('${text}')).click()`;

test('应用：选图进队列（透明 PNG 直接算已抠图），抠图后录入 2 件，刷新后仍在，离线可打开', async () => {
  await resetDb();
  // 假抠图：每张 50 ms，不加载模型
  await chrome.goto(`${server.origin}/?fakeMatting=50`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(PICK_FILES);
  await chrome.waitFor(`${statuses} === '已抠图,待抠图'`);
  await chrome.evaluate(clickButton('#queue', '开始抠图（1 张）'));
  await chrome.waitFor(`document.getElementById('lastJob')?.textContent.startsWith('上次抠图：成功 1，失败 0')`);
  assert.equal(await chrome.evaluate(statuses), '已抠图,已抠图');
  await chrome.evaluate(`document.querySelectorAll('#queue .queued')[0].querySelector('button').click()`);
  await chrome.evaluate(`document.querySelectorAll('#queue .queued')[1].querySelector('button').click()`);
  await chrome.waitFor(`document.querySelectorAll('#pending .card .thumb').length === 2 && [...document.querySelectorAll('#pending .thumb')].every((i) => i.naturalWidth)`);

  const cards = await chrome.evaluate(`[...document.querySelectorAll('#pending .card')].map((c) => ({
    alpha: c.querySelector('.thumb').classList.contains('alpha'),
    w: c.querySelector('.thumb').naturalWidth, h: c.querySelector('.thumb').naturalHeight }))`);
  assert.deepEqual(cards, [{ alpha: true, w: 1024, h: 768 }, { alpha: true, w: 1024, h: 768 }]);

  // 未选分类不能保存
  await chrome.evaluate(`document.querySelector('#pending .card .actions .primary').click()`);
  assert.equal(await chrome.evaluate(`document.querySelector('#pending .card .error').textContent`), '请选择分类');

  await chrome.evaluate(clickChip(0, '上衣'));
  await chrome.evaluate(clickChip(0, '夏'));
  await chrome.evaluate(clickChip(0, '秋'));
  await chrome.evaluate(clickChip(0, '通勤'));
  await chrome.evaluate(clickChip(1, '裤子'));
  await chrome.evaluate(`document.querySelectorAll('#pending .card')[0].querySelector('.actions .primary').click()`);
  await chrome.waitFor(`document.querySelectorAll('#pending .card').length === 1`);
  await chrome.evaluate(`document.querySelector('#pending .card .actions .primary').click()`);
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 2`);
  // 录入后队列记录删除
  await chrome.waitFor(`document.querySelectorAll('#queue .queued').length === 0`);

  await chrome.reload();
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 2`);
  const saved = await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore();
    const items = await s.list();
    s.close();
    return items.map((i) => ({ category: i.category, seasons: i.seasons, scenes: i.scenes, hasAlpha: i.hasAlpha, type: i.image.type }))
      .sort((a, b) => a.category.localeCompare(b.category));
  })()`);
  assert.deepEqual(saved, [
    { category: '上衣', seasons: ['夏', '秋'], scenes: ['通勤'], hasAlpha: true, type: 'image/webp' },
    { category: '裤子', seasons: [], scenes: [], hasAlpha: true, type: 'image/png' },
  ]);
  const groups = await chrome.evaluate(`[...document.querySelectorAll('#closet h2')].map((h) => h.textContent)`);
  assert.deepEqual(groups, ['上衣 · 1', '裤子 · 1']);

  // 编辑：改颜色；归档后衣橱只剩 1 件，已归档区可见
  await chrome.evaluate(`document.querySelector('#closet .tile').click()`);
  // 打开编辑时焦点在弹窗本身，不在"上衣"按钮上（iOS 会画焦点圈）
  assert.equal(await chrome.evaluate(`document.activeElement.id`), 'editDialog');
  await chrome.evaluate(`(() => { const i = document.querySelectorAll('#editForm input')[2]; i.value = '藏青'; })()`);
  await chrome.evaluate(`[...document.querySelectorAll('#editForm button')].find((b) => b.textContent === '保存').click()`);
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  // 保存后图片仍能显示（Safari 曾在这里显示不出图；Chrome 不复现，Safari 验证见 PROGRESS.md）
  await chrome.waitFor(`[...document.querySelectorAll('#closet .tile img')].every((i) => i.complete && i.naturalWidth > 0)`);
  await chrome.evaluate(`document.querySelector('#closet .tile').click()`);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#editForm input')[2].value`), '藏青');
  await chrome.evaluate(`[...document.querySelectorAll('#editForm button')].find((b) => b.textContent === '归档').click()`);
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 1`);
  await chrome.evaluate(`document.getElementById('showArchived').click()`);
  await chrome.waitFor(`document.querySelectorAll('#archived .tile').length === 1`);

  // 存储状态和 WebP 检测已显示
  // 照片占用按衣物图片大小加总（不用 storage.estimate()）
  const storage = await chrome.evaluate(`document.getElementById('storage').textContent`);
  assert.match(storage, /^(数据不会被自动清除|空间不足时浏览器可能清除数据，请定期备份) · 照片占用 \d+\.\d MB$/);
  const expectedMb = await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js'); const s = await openStore();
    const all = await s.list({ includeArchived: true }); s.close();
    return (all.reduce((n, i) => n + i.image.size, 0) / 1024 / 1024).toFixed(1);
  })()`);
  assert.ok(storage.endsWith(`照片占用 ${expectedMb} MB`), storage);
  assert.equal(await chrome.evaluate(`document.getElementById('diag').textContent`), '透明图保存为 WebP');

  // 离线：Service Worker 接管后断网刷新，页面仍能显示衣橱
  await chrome.waitFor(`navigator.serviceWorker.controller !== null`);
  await chrome.send('Network.enable');
  await chrome.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await chrome.reload();
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 1`);
  await chrome.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

// 页面里读队列和任务状态
const QUEUE_STATE = `(async () => {
  const { openStore } = await import('/store.js');
  const s = await openStore();
  const q = await s.listQueue(); const job = await s.getJob(); s.close();
  return { statuses: q.map((r) => r.status), attempts: q.map((r) => r.attempts), job };
})()`;

// 选 n 张不透明 JPEG（待抠图）
const pickJpegs = (n) => `(async () => {
  const dt = new DataTransfer();
  for (let i = 0; i < ${n}; i++) {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = '#336'; ctx.fillRect(200, 100, 300 + i * 10, 300);
    dt.items.add(new File([await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9))], 'p' + i + '.jpg', { type: 'image/jpeg' }));
  }
  const input = document.getElementById('fileInput');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
})()`;

async function openWithQueue(n, delay) {
  await resetDb();
  await chrome.goto(`${server.origin}/?fakeMatting=${delay}`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(pickJpegs(n));
  await chrome.waitFor(`document.querySelectorAll('#queue .queued').length === ${n}`);
}

// 等到页面正在处理某一张，直接重新打开页面，模拟处理中崩溃（IndexedDB 里留下 processing 记录，与崩溃相同）。
// 不用 CDP Page.crash：装了 Service Worker 后，崩溃后的导航在 headless Chrome 里不返回
async function crashWhileProcessing(url) {
  await chrome.waitFor(`document.getElementById('progress') && (${QUEUE_STATE}).then((s) => s.statuses.includes('processing'))`, 15000);
  await chrome.goto(url);
}

test('抠图队列：每次加载抠 2 张后自动刷新；处理中崩溃重试，同一张崩溃 2 次标为失败', async () => {
  await openWithQueue(5, 1500);
  const url = `${server.origin}/?fakeMatting=1500`;
  await chrome.evaluate(clickButton('#queue', '开始抠图（5 张）'));
  await crashWhileProcessing(url); // 第 1 张第 1 次崩溃
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.job.recoveries === 1 && s.attempts[0] === 1)`);
  let st;
  await crashWhileProcessing(url); // 第 1 张第 2 次崩溃
  await chrome.waitFor(`document.getElementById('lastJob')`, 30000);
  st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_failed', 'cutout_done', 'cutout_done', 'cutout_done', 'cutout_done']);
  assert.equal(st.attempts[0], 2);
  assert.equal(st.job.recoveries, 2);
  assert.equal(st.job.reloads, 1); // 崩溃后的加载：第 2、3 张 → 刷新 → 第 4、5 张 → 结束
  assert.equal(st.job.running, false);
  assert.match(await chrome.evaluate(`document.getElementById('lastJob').textContent`), /成功 4，失败 1，取消 0 · 自动刷新 1 次 · 崩溃恢复 2 次/);
  assert.equal(await chrome.evaluate(statuses), '抠图失败，用原图,已抠图,已抠图,已抠图,已抠图');
});

test('抠图队列：暂停后不再刷新，继续后做完；取消后剩下的标为未抠图', async () => {
  await openWithQueue(3, 600);
  await chrome.evaluate(clickButton('#queue', '开始抠图（3 张）'));
  await chrome.waitFor(`document.getElementById('progress')`);
  // 处理中：衣橱和录入按钮隐藏
  assert.equal(await chrome.evaluate(`getComputedStyle(document.getElementById('addLabel')).display`), 'none');
  // 第 1 张处理中时暂停：这张做完，之后不再处理、不刷新页面
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.statuses[0] === 'processing')`);
  await chrome.evaluate(clickButton('#queue', '暂停'));
  await chrome.waitFor(`document.querySelector('#queue h2')?.textContent === '抠图已暂停'`);
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => !s.statuses.includes('processing'))`);
  await new Promise((ok) => setTimeout(ok, 1000));
  let st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_done', 'pending', 'pending']);
  assert.equal(st.job.reloads, 0);
  await chrome.evaluate(clickButton('#queue', '继续'));
  await chrome.waitFor(`document.getElementById('lastJob')`, 15000);
  st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_done', 'cutout_done', 'cutout_done']);

  await openWithQueue(3, 600);
  await chrome.evaluate(clickButton('#queue', '开始抠图（3 张）'));
  await chrome.waitFor(`document.getElementById('progress')`);
  await chrome.evaluate(clickButton('#queue', '取消'));
  await chrome.waitFor(`document.getElementById('lastJob')`);
  await new Promise((ok) => setTimeout(ok, 1000));
  st = await chrome.evaluate(QUEUE_STATE);
  assert.equal(st.job.running, false);
  assert.ok(st.statuses.filter((x) => x === 'skipped').length >= 2, st.statuses.join());
  assert.equal(await chrome.evaluate(`getComputedStyle(document.getElementById('addLabel')).display`), 'block');
});

test('store.js：v1 数据库升级到 v2 时清空旧数据，新增队列表', async () => {
  await resetDb();
  const r = await chrome.evaluate(`(async () => {
    await new Promise((ok, fail) => {
      const o = indexedDB.open('closet', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('items', { keyPath: 'id' }).put({ id: 'old', category: '上衣' });
      o.onsuccess = () => { o.result.close(); ok(); }; o.onerror = fail;
    });
    const { openStore } = await import('/store.js');
    const s = await openStore();
    const out = { items: (await s.list({ includeArchived: true })).length, queue: (await s.listQueue()).length, job: await s.getJob() };
    s.close();
    return out;
  })()`);
  assert.deepEqual(r, { items: 0, queue: 0, job: null });
});
