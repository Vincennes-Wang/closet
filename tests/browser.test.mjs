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
    const a = await s.add({ image, hasAlpha: true, categoryId: 'top', subcategoryId: 'top.casual_tee', seasons: ['夏'], scenes: ['通勤'], name: '白T' });
    const b = await s.add({ image, hasAlpha: false, categoryId: 'bottom', subcategoryId: 'bottom.jeans', seasons: [], scenes: [] });
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
    try { await s.add({ image, hasAlpha: true, categoryId: '泳衣', seasons: [], scenes: [] }); out.invalid = 'no error'; } catch (e) { out.invalid = e.message; }
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
  assert.match(r.invalid, /分类无效/);
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
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === 2`);
  assert.equal(await chrome.evaluate(statuses), '待处理'); // 透明 PNG 已算抠图完成，只有 JPEG 待处理
  // 2 张都要分类，1 张要抠图
  await chrome.evaluate(clickButton('#queue', '开始处理（2 张）'));
  await chrome.waitFor(`document.getElementById('lastJob')?.textContent.startsWith('上次抠图：成功 2，失败 0')`, 20000); // 透明 PNG 也算在本次任务里（要分类），算抠图成功
  assert.match(await chrome.evaluate(`document.getElementById('lastJob').textContent`), /分类 2 张，失败 0$/);

  // 待确认卡片。假分类按标签顺序打分：休闲短袖、运动短袖、长袖线衣
  const card = (i) => `document.querySelectorAll('#queue .review')[${i}]`;
  const inCard = (i, text) => `[...${card(i)}.querySelectorAll('button')].find((b) => b.textContent.startsWith('${text}')).click()`;
  const cardState = (i) => `(() => { const c = ${card(i)}; return {
    choice: c.querySelector('.choice').textContent,
    candidates: [...c.querySelectorAll('.review-body > .chips .chip')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')),
    seasons: [...c.querySelectorAll('[data-name="seasons"] .chip[aria-pressed="true"]')].map((b) => b.textContent),
    flip: [...c.querySelectorAll('button')].some((b) => b.textContent === '看原图'),
    useOriginal: !!c.querySelector('.toggle-inline'),
  }; })()`;
  // 透明 PNG：没有原图可看，也没有"用原图"
  assert.deepEqual(await chrome.evaluate(cardState(0)), { choice: '休闲短袖', candidates: ['休闲短袖 50%*', '运动短袖 25%', '长袖线衣 17%'], seasons: ['夏'], flip: false, useOriginal: false });
  assert.deepEqual(await chrome.evaluate(cardState(1)), { choice: '休闲短袖', candidates: ['休闲短袖 50%*', '运动短袖 25%', '长袖线衣 17%'], seasons: ['夏'], flip: true, useOriginal: true });

  // 第 1 张：点候选"运动短袖"，再加"秋"
  await chrome.evaluate(inCard(0, '运动短袖'));
  await chrome.evaluate(`[...${card(0)}.querySelectorAll('[data-name="seasons"] .chip')].find((b) => b.textContent === '秋').click()`);
  assert.deepEqual(await chrome.evaluate(cardState(0)), { choice: '运动短袖', candidates: ['休闲短袖 50%', '运动短袖 25%*', '长袖线衣 17%'], seasons: ['夏', '秋'], flip: false, useOriginal: false });

  // 第 2 张：其他分类 → 裤子 → 牛仔裤，季节回到默认（春秋冬）；选"用原图"；看原图是 1024 的原图
  await chrome.evaluate(inCard(1, '其他分类'));
  await chrome.evaluate(inCard(1, '裤子'));
  await chrome.evaluate(inCard(1, '牛仔裤'));
  assert.deepEqual(await chrome.evaluate(cardState(1)), { choice: '牛仔裤', candidates: ['休闲短袖 50%', '运动短袖 25%', '长袖线衣 17%'], seasons: ['春', '秋', '冬'], flip: true, useOriginal: true });
  await chrome.evaluate(`${card(1)}.querySelector('.toggle-inline input').click()`);
  await chrome.evaluate(inCard(1, '看原图'));
  await chrome.waitFor(`${card(1)}.querySelector('.review-img img').naturalWidth === 1024`);

  // 全部确认：2 件进衣橱，队列清空
  await chrome.evaluate(clickButton('#queue', '全部确认'));
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 2`);
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === 0`);
  assert.equal(await chrome.evaluate(`document.getElementById('queueMsg').textContent`), '已录入 2 件');

  await chrome.reload();
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 2`);
  const saved = await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore();
    const items = await s.list();
    s.close();
    return items.map((i) => ({ categoryId: i.categoryId, subcategoryId: i.subcategoryId, seasons: i.seasons, scenes: i.scenes, hasAlpha: i.hasAlpha, type: i.image.type }))
      .sort((a, b) => a.categoryId.localeCompare(b.categoryId));
  })()`);
  assert.deepEqual(saved, [
    { categoryId: 'bottom', subcategoryId: 'bottom.jeans', seasons: ['春', '秋', '冬'], scenes: [], hasAlpha: false, type: 'image/jpeg' },
    { categoryId: 'top', subcategoryId: 'top.sport_tee', seasons: ['夏', '秋'], scenes: [], hasAlpha: true, type: 'image/webp' },
  ]);
  const groups = await chrome.evaluate(`[...document.querySelectorAll('#closet h2')].map((h) => h.textContent)`);
  assert.deepEqual(groups, ['上衣 · 1', '裤子 · 1']);
  assert.deepEqual(await chrome.evaluate(`[...document.querySelectorAll('#closet .tile span')].map((s) => s.textContent)`), ['运动短袖', '牛仔裤']);

  // 编辑：改颜色；归档后衣橱只剩 1 件，已归档区可见
  await chrome.evaluate(`document.querySelector('#closet .tile').click()`);
  // 打开编辑时焦点在弹窗本身，不在"上衣"按钮上（iOS 会画焦点圈）
  assert.equal(await chrome.evaluate(`document.activeElement.id`), 'editDialog');
  await chrome.evaluate(`(() => { const i = document.querySelectorAll('#editForm input')[1]; i.value = '藏青'; })()`);
  await chrome.evaluate(`[...document.querySelectorAll('#editForm button')].find((b) => b.textContent === '保存').click()`);
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  // 保存后图片仍能显示（Safari 曾在这里显示不出图；Chrome 不复现，Safari 验证见 PROGRESS.md）
  await chrome.waitFor(`[...document.querySelectorAll('#closet .tile img')].every((i) => i.complete && i.naturalWidth > 0)`);
  await chrome.evaluate(`document.querySelector('#closet .tile').click()`);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#editForm input')[1].value`), '藏青');
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
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === ${n}`);
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
  await chrome.evaluate(clickButton('#queue', '开始处理（5 张）'));
  await crashWhileProcessing(url); // 第 1 张第 1 次崩溃
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.job.recoveries === 1 && s.attempts[0] === 1)`);
  let st;
  await crashWhileProcessing(url); // 第 1 张第 2 次崩溃
  await chrome.waitFor(`document.getElementById('lastJob')`, 40000);
  await chrome.waitFor(`[...document.querySelectorAll('#queue .review-img img')].every((i) => i.naturalWidth)`);
  st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_failed', 'cutout_done', 'cutout_done', 'cutout_done', 'cutout_done']);
  assert.equal(st.attempts[0], 2);
  assert.equal(st.job.recoveries, 2);
  assert.equal(st.job.reloads, 1); // 崩溃后的加载：第 2、3 张 → 刷新 → 第 4、5 张 → 结束
  assert.equal(st.job.running, false);
  assert.match(await chrome.evaluate(`document.getElementById('lastJob').textContent`), /成功 4，失败 1，取消 0 · 自动刷新 1 次 · 崩溃恢复 2 次/);
  // 抠图失败的那张：提示用照片 App 抠图，没有"用原图"开关
  assert.match(await chrome.evaluate(`document.querySelector('#queue .review .hint').textContent`), /^抠图失败，将保存原图。也可以用照片 App 抠图/);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#queue .review .toggle-inline').length`), 4);
  // 时间线：两次崩溃都记在第 1 张；抠完后刷新到新页面再显示结果
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.job.events.at(-1).e === 'resultsShown')`);
  st = await chrome.evaluate(QUEUE_STATE);
  const ev = st.job.events;
  assert.deepEqual(ev.filter((v) => v.e === 'crash').map((v) => [v.i, v.attempts]), [[1, 1], [1, 2]]);
  // 抠图 4 次加载（2 次崩溃），分类 1 次加载
  assert.deepEqual(ev.filter((v) => v.e === 'load').map((v) => v.unexpected), [false, true, true, false, false]);
  assert.deepEqual(ev.filter((v) => v.e === 'done' && v.k === 'matting').map((v) => v.i), [2, 3, 4, 5]);
  // 抠图失败的第 1 张也用原图分类
  assert.deepEqual(ev.filter((v) => v.e === 'done' && v.k === 'classify').map((v) => v.i), [1, 2, 3, 4, 5]);
  assert.ok(ev.findIndex((v) => v.e === 'phase') < ev.findIndex((v) => v.k === 'classify'));
  assert.deepEqual(ev.slice(-4).map((v) => v.e), ['finishReload', 'resultsLoad', 'wait', 'resultsShown']);
  // 第一次加载不等；之后 4 次加载（2 次崩溃后、1 次自动刷新后、进入分类后）都先等再加载模型
  assert.equal(ev.filter((v) => v.e === 'loadWait').length, 4);
  assert.equal(ev.findIndex((v) => v.e === 'loadWait') > ev.findIndex((v) => v.e === 'model'), true);
  // 每批结束都先释放模型再刷新：抠图 4 次加载（2 次中途崩溃没有释放）+ 分类 1 次 → 3 次释放
  assert.equal(ev.filter((v) => v.e === 'dispose').length, 3);
  // 队列里显示缩略图（长边 256），不是 1024 的原图
  const sizes = await chrome.evaluate(`[...document.querySelectorAll('#queue .review-img img')].map((i) => Math.max(i.naturalWidth, i.naturalHeight))`);
  assert.deepEqual(sizes, [256, 256, 256, 256, 256]);
  const lines = await chrome.evaluate(`document.querySelector('#queue .timeline pre').textContent`);
  assert.match(lines, /发现第 1 张处理时页面崩溃（第 2 次）/);
  assert.match(lines, /全部完成，刷新后显示结果/);
});

test('抠图队列：暂停后不再刷新，继续后做完；取消后剩下的标为未抠图', async () => {
  await openWithQueue(3, 600);
  await chrome.evaluate(clickButton('#queue', '开始处理（3 张）'));
  await chrome.waitFor(`document.getElementById('progress')`);
  // 处理中：衣橱和录入按钮隐藏
  assert.equal(await chrome.evaluate(`getComputedStyle(document.getElementById('addLabel')).display`), 'none');
  // 第 1 张处理中时暂停：这张做完，之后不再处理、不刷新页面
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.statuses[0] === 'processing')`);
  await chrome.evaluate(clickButton('#queue', '暂停'));
  await chrome.waitFor(`document.querySelector('#queue h2')?.textContent === '处理已暂停'`);
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => !s.statuses.includes('processing'))`);
  await new Promise((ok) => setTimeout(ok, 1000));
  let st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_done', 'pending', 'pending']);
  assert.equal(st.job.reloads, 0);
  await chrome.evaluate(clickButton('#queue', '继续'));
  await chrome.waitFor(`document.getElementById('lastJob')`, 30000);
  st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_done', 'cutout_done', 'cutout_done']);

  await openWithQueue(3, 600);
  await chrome.evaluate(clickButton('#queue', '开始处理（3 张）'));
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
