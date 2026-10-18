// 在 headless Chrome 里测 store.js（真实 IndexedDB）和应用录入流程
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  // 左边栏件数：全部 2、上衣 1、裤子 1
  const counts = await chrome.evaluate(`Object.fromEntries([...document.querySelectorAll('#closet .side-item')].map((b) => [b.dataset.id || 'all', b.querySelector('.side-count').textContent]))`);
  assert.deepEqual([counts.all, counts.top, counts.bottom, counts.skirt], ['2', '1', '1', '0']);
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
  assert.equal(await chrome.evaluate(`document.getElementById('archivedBtn').textContent`), '已归档（1 件） ▾');
  await chrome.evaluate(`document.getElementById('archivedBtn').click()`);
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
  // "关于"区显示当前缓存版本（和 sw.js 一致）
  const cache = (await readFile(new URL('../sw.js', import.meta.url), 'utf8')).match(/closet-v\d+/)[0];
  await chrome.waitFor(`document.getElementById('version').textContent === '版本 ${cache}'`);
  // 本站的 transformers.js 和 ONNX Runtime 也在离线缓存里（国内打不开 jsDelivr）
  const vendor = await chrome.evaluate(`Promise.all(['transformers.min.js', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
    .map((f) => fetch('vendor/transformers-4.3.1/' + f).then(async (r) => r.ok && (await r.arrayBuffer()).byteLength)))`);
  assert.deepEqual(vendor, [586230, 53057, 26861777]);
  await chrome.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

// 衣橱筛选：存 6 件（1 件已归档），通过界面点选，网格数量和 URL hash 对得上；刷新后筛选还在
const SEED_CLOSET = `(async () => {
  const { openStore } = await import('/store.js');
  const s = await openStore();
  const c = new OffscreenCanvas(40, 40); c.getContext('2d').fillRect(5, 5, 20, 20);
  const image = await c.convertToBlob({ type: 'image/png' });
  const add = (categoryId, subcategoryId, seasons, scenes) => s.add({ image, hasAlpha: true, categoryId, subcategoryId, seasons, scenes });
  await add('top', 'top.shirt', ['春', '秋'], ['通勤']);
  await add('top', 'top.casual_tee', ['夏'], ['休闲']);
  await add('top', 'top.heavy_sweater', ['冬'], ['通勤', '休闲']);
  await add('top', 'top.casual_tee', ['春', '夏'], ['运动']);
  await add('bottom', 'bottom.jeans', ['春', '秋', '冬'], ['休闲']);
  await s.archive((await add('top', 'top.casual_tee', ['夏'], ['休闲'])).id);
  s.close();
})()`;
const tiles = `document.querySelectorAll('#closet .tile').length`;
const clickIn = (row, text) => `[...document.querySelectorAll('#closet .chips[data-name="${row}"] .chip')].find((b) => b.textContent === '${text}').click()`;
const clickSide = (id) => `document.querySelector('#closet .side-item[data-id="${id}"]').click()`;

test('衣橱筛选：左边栏、二级分类、季节多选后网格数量正确；件数不计已归档；刷新后筛选保留', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED_CLOSET);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  assert.equal(await chrome.evaluate(tiles), 5);
  // 件数：上衣 4（不计已归档），件数 0 的裙子灰色；"全部"时没有二级分类行
  assert.equal(await chrome.evaluate(`document.querySelector('.side-item[data-id="top"] .side-count').textContent`), '4');
  assert.equal(await chrome.evaluate(`document.querySelector('.side-item[data-id="skirt"]').classList.contains('none')`), true);
  assert.equal(await chrome.evaluate(`document.querySelector('#closet .chips[data-name="sub"]')`), null);

  await chrome.evaluate(clickSide('top'));
  assert.equal(await chrome.evaluate(tiles), 4);
  assert.equal(await chrome.evaluate(`document.querySelector('.picker-count span').textContent`), '共 4 件');
  await chrome.evaluate(clickIn('sub', '休闲短袖'));
  assert.equal(await chrome.evaluate(tiles), 2);
  // 季节多选：同组"或"
  await chrome.evaluate(clickIn('sub', '全部'));
  await chrome.evaluate(clickIn('seasons', '夏'));
  await chrome.evaluate(clickIn('seasons', '冬'));
  assert.equal(await chrome.evaluate(tiles), 3);
  // 加场景：组间"且"
  await chrome.evaluate(clickIn('scenes', '通勤'));
  assert.equal(await chrome.evaluate(tiles), 1);
  assert.equal(await chrome.evaluate('decodeURIComponent(location.hash)'), '#c=top&season=夏,冬&scene=通勤');

  // 刷新（抠图队列自动刷新也是 location.reload）后筛选和网格不变
  await chrome.reload();
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  assert.equal(await chrome.evaluate(tiles), 1);
  const pressed = await chrome.evaluate(`[...document.querySelectorAll('#closet [aria-pressed="true"]')].map((b) => b.dataset.id ?? b.textContent)`);
  assert.deepEqual(pressed, ['top', '全部', '夏', '冬', '通勤']);

  // 清除筛选：保留一级分类
  await chrome.evaluate(`[...document.querySelectorAll('#closet button')].find((b) => b.textContent === '清除筛选').click()`);
  assert.equal(await chrome.evaluate(tiles), 4);
  assert.equal(await chrome.evaluate('location.hash'), '#c=top');
  await chrome.evaluate(clickSide(''));
  assert.equal(await chrome.evaluate(tiles), 5);
  assert.equal(await chrome.evaluate('location.hash'), '');
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
  await chrome.waitFor(`document.getElementById('lastJob')`, 60000);
  await chrome.waitFor(`[...document.querySelectorAll('#queue .review-img img')].every((i) => i.naturalWidth)`);
  st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_failed', 'cutout_done', 'cutout_done', 'cutout_done', 'cutout_done']);
  assert.equal(st.attempts[0], 2);
  assert.equal(st.job.recoveries, 2);
  assert.equal(st.job.reloads, 3); // 每次加载 1 张：崩溃后第 2 张 → 刷新 → 第 3 张 → 刷新 → 第 4 张 → 刷新 → 第 5 张 → 进入分类
  assert.equal(st.job.running, false);
  assert.match(await chrome.evaluate(`document.getElementById('lastJob').textContent`), /成功 4，失败 1，未抠图 0 · 自动刷新 3 次 · 崩溃恢复 2 次/);
  // 抠图失败的那张：提示用照片 App 抠图，没有"用原图"开关
  assert.match(await chrome.evaluate(`document.querySelector('#queue .review .hint').textContent`), /^抠图失败，将保存原图。也可以用照片 App 抠图/);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#queue .review .toggle-inline').length`), 4);
  // 时间线：两次崩溃都记在第 1 张；抠完后刷新到新页面再显示结果
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.job.events.at(-1).e === 'resultsShown')`);
  st = await chrome.evaluate(QUEUE_STATE);
  const ev = st.job.events;
  assert.deepEqual(ev.filter((v) => v.e === 'crash').map((v) => [v.i, v.attempts]), [[1, 1], [1, 2]]);
  // 抠图 6 次加载（2 次崩溃），分类 1 次加载
  assert.deepEqual(ev.filter((v) => v.e === 'load').map((v) => v.unexpected), [false, true, true, false, false, false, false]);
  assert.equal(ev.filter((v) => v.e === 'crashIdle').length, 0); // 处理中崩溃不重复计数
  assert.deepEqual(ev.filter((v) => v.e === 'done' && v.k === 'matting').map((v) => v.i), [2, 3, 4, 5]);
  // 抠图失败的第 1 张也用原图分类
  assert.deepEqual(ev.filter((v) => v.e === 'done' && v.k === 'classify').map((v) => v.i), [1, 2, 3, 4, 5]);
  assert.ok(ev.findIndex((v) => v.e === 'phase') < ev.findIndex((v) => v.k === 'classify'));
  assert.deepEqual(ev.slice(-4).map((v) => v.e), ['finishReload', 'resultsLoad', 'wait', 'resultsShown']);
  // 第一次加载不等；之后 6 次加载（2 次崩溃后、3 次自动刷新后、进入分类后）都先等再加载模型
  assert.equal(ev.filter((v) => v.e === 'loadWait').length, 6);
  assert.equal(ev.findIndex((v) => v.e === 'loadWait') > ev.findIndex((v) => v.e === 'model'), true);
  // 每批结束都先释放模型再刷新：抠图 6 次加载（2 次中途崩溃没有释放）+ 分类 1 次 → 5 次释放
  assert.equal(ev.filter((v) => v.e === 'dispose').length, 5);
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

test('抠图队列：模型就绪后、开始处理前崩溃，也算一次崩溃恢复', async () => {
  await openWithQueue(1, 50);
  // 构造"上个页面刚加载完模型就崩溃"的状态：任务进行中，最后一条事件是模型就绪，没有处理中的照片
  await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore();
    const ids = (await s.listQueue()).map((r) => r.id);
    await s.setJob({ phase: 'matting', running: true, paused: false, ids, startedAt: Date.now(), endedAt: null, reloads: 0, recoveries: 0,
      loading: false, loadCrashes: 0, error: '', events: [{ t: Date.now(), e: 'start', n: 1 }, { t: Date.now(), e: 'load' }, { t: Date.now(), e: 'model', k: 'matting', ms: 1 }] });
    s.close();
  })()`);
  await chrome.goto(`${server.origin}/?fakeMatting=50`);
  await chrome.waitFor(`document.getElementById('lastJob')`, 20000);
  const st = await chrome.evaluate(QUEUE_STATE);
  assert.equal(st.job.recoveries, 1);
  assert.deepEqual(st.job.events.filter((v) => v.e === 'crashIdle').length, 1);
  assert.deepEqual(st.statuses, ['cutout_done']);
});

// 小米手机（2026-10-12）：WebGPU 抠图不报错，但遮罩全空，结果全透明。
// fakeEmptyMask=1：假模型在非 WASM 后端输出全空遮罩，模拟这种设备
test('抠图队列：WebGPU 遮罩全空时，这台设备改用 WASM 重抠，分类和以后的任务也用 WASM', async () => {
  await resetDb();
  const url = `${server.origin}/?fakeMatting=50&fakeEmptyMask=1`;
  await chrome.goto(url);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(pickJpegs(2));
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === 2`);
  await chrome.evaluate(clickButton('#queue', '开始处理（2 张）'));
  await chrome.waitFor(`document.getElementById('lastJob')`, 60000);
  let st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_done', 'cutout_done']);
  assert.equal(st.attempts[0], 1); // 第 1 张在 WebGPU 上失败一次，换 WASM 后成功
  assert.equal(st.job.backend, 'wasm/fake');
  assert.equal(st.job.classifyBackend, 'wasm/fake'); // 分类也不用 WebGPU（小米 WebGPU 分类结果离谱）
  assert.equal(st.job.events.filter((v) => v.e === 'noWebgpu').length, 1);
  assert.equal(st.job.recoveries, 0);
  assert.match(await chrome.evaluate(`document.querySelector('#queue .timeline pre').textContent`), /第 1 张遮罩为空，本设备以后抠图和分类都改用 WASM/);
  // 抠图结果不是全透明
  const opaque = await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore(); const q = await s.listQueue(); s.close();
    const b = await createImageBitmap(q[0].cutout); const c = new OffscreenCanvas(b.width, b.height);
    const x = c.getContext('2d'); x.drawImage(b, 0, 0);
    const d = x.getImageData(0, 0, b.width, b.height).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) n++;
    return n / (d.length / 4);
  })()`);
  assert.ok(opaque > 0.5, `不透明比例 ${opaque}`);

  // 全部确认后再录 1 张：直接用 WASM，不再失败
  await chrome.evaluate(clickButton('#queue', '全部确认'));
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === 0`);
  await chrome.evaluate(pickJpegs(1));
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === 1`);
  await chrome.evaluate(clickButton('#queue', '开始处理（1 张）'));
  // 上一个任务的 #lastJob 还在，等新任务结束
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.job.events[0].n === 1 && !s.job.running)`, 60000);
  st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_done']);
  assert.equal(st.attempts[0], 0);
  assert.equal(st.job.backend, 'wasm/fake');
  assert.equal(st.job.classifyBackend, 'wasm/fake');
  assert.equal(st.job.events.filter((v) => v.e === 'noWebgpu').length, 0);
});

// 慢速提示：WASM 设备开始前提示估算用时；处理中显示剩余时间，刷新后仍能算（存在 meta.job.timing）
test('慢速提示：WASM 设备开始前显示估算；处理中显示剩余时间；WebGPU 设备不显示估算', async () => {
  await openWithQueue(3, 1500);
  // 无头 Chrome 有 WebGPU（支持 shader-f16）：不显示慢速提示
  assert.equal(await chrome.evaluate(`document.getElementById('slowHint')`), null);

  await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore(); await s.setDevice({ noWebgpu: true }); s.close();
  })()`);
  await chrome.reload();
  await chrome.waitFor(`document.getElementById('slowHint')`);
  const { ESTIMATE_MS } = await import('../config.js');
  const min = Math.ceil(3 * (ESTIMATE_MS.wasm.matting + ESTIMATE_MS.wasm.classify) / 60000);
  assert.equal(await chrome.evaluate(`document.getElementById('slowHint').textContent`),
    `这台设备处理较慢，3 张约需 ${min} 分钟，处理中请保持本页面打开`);

  await chrome.evaluate(clickButton('#queue', '开始处理（3 张）'));
  // 第 1 张抠完、自动刷新后：剩余时间来自本次任务的实际耗时
  await chrome.waitFor(`(${QUEUE_STATE}).then((s) => s.job.reloads >= 1 && s.job.timing?.matting?.n >= 1)`, 30000);
  await chrome.waitFor(`/剩余(约 \\d+ 分钟|不到 1 分钟)/.test(document.getElementById('progress')?.textContent)`, 10000);
  const st = await chrome.evaluate(QUEUE_STATE);
  assert.equal(st.job.estBackend, 'wasm');
  assert.ok(st.job.timing.matting.ms > 0);
  await chrome.waitFor(`document.getElementById('lastJob')`, 60000);
  assert.ok((await chrome.evaluate(QUEUE_STATE)).job.timing.classify.n >= 1);
});

// 国内（2026-10-12）：huggingface.co、hf-mirror.com 都打不开（"Load failed"），GitHub Pages 能打开。
// 抠图模型（只在 HF）下载不了时跳过抠图、保留原图，照常分类；分类模型先从 closet-models（GitHub Pages）下载。
// fakeHostFail=域名：假模型在这个地址上模拟网络错误
test('模型地址：抠图模型下载不了时跳过抠图、保留原图，分类照常（来自 closet-models）', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/?fakeMatting=50&fakeHostFail=huggingface.co`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(pickJpegs(2));
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === 2`);
  await chrome.evaluate(clickButton('#queue', '开始处理（2 张）'));
  await chrome.waitFor(`document.getElementById('lastJob')`, 30000);
  const st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['skipped', 'skipped']);
  assert.equal(st.job.paused, false);
  assert.equal(st.job.classifyHost, 'vincennes-wang.github.io');
  assert.equal(st.job.events.filter((v) => v.e === 'mattingUnavailable').length, 1);
  const classified = await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore(); const q = await s.listQueue(); s.close();
    return q.map((r) => r.classify.status);
  })()`);
  assert.deepEqual(classified, ['done', 'done']);
  const last = await chrome.evaluate(`document.getElementById('lastJob').textContent`);
  assert.match(last, /成功 0，失败 0，未抠图 2/);
  assert.match(last, / · 分类模型 vincennes-wang\.github\.io/);
  assert.match(await chrome.evaluate(`document.querySelector('#queue .timeline pre').textContent`), /抠图模型下载不了，跳过抠图，保留原图/);
  assert.match(await chrome.evaluate(`document.querySelector('#queue .review .hint').textContent`), /^没有抠图，将保存原图/);
});

test('模型地址：closet-models 下载不了时，分类改用 huggingface.co', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/?fakeMatting=50&fakeHostFail=vincennes-wang.github.io`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(pickJpegs(1));
  await chrome.waitFor(`document.querySelectorAll('#queue .review').length === 1`);
  await chrome.evaluate(clickButton('#queue', '开始处理（1 张）'));
  await chrome.waitFor(`document.getElementById('lastJob')`, 30000);
  const st = await chrome.evaluate(QUEUE_STATE);
  assert.deepEqual(st.statuses, ['cutout_done']);
  assert.equal(st.job.classifyHost, 'huggingface.co');
});

// ---------- 备份（阶段 3） ----------
// 数据库快照：衣物（含图片字节）+ 分类表，按 id 排序
const SNAPSHOT = `(async () => {
  const { openStore } = await import('/store.js');
  const s = await openStore(); const d = await s.exportData(); s.close();
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  const items = await Promise.all(d.items.sort(byId).map(async (it) => ({ ...it, image: { type: it.image.type, bytes: Array.from(new Uint8Array(await it.image.arrayBuffer())) } })));
  return { items, categories: d.categories.sort(byId), outfits: d.outfits.sort(byId), plans: d.plans.sort(byId) };
})()`;

// 页面里准备数据：3 件衣物（1 张透明 PNG，1 件已归档）+ 分类表 2 条（自建 1 条、内置改名 + 隐藏 1 条）+ 搭配 1 套 + 计划 1 条
const SEED = `(async () => {
  const { openStore } = await import('/store.js');
  const s = await openStore();
  const img = async (type, alpha, w) => {
    const c = new OffscreenCanvas(w, 40); const x = c.getContext('2d');
    if (!alpha) { x.fillStyle = '#ddd'; x.fillRect(0, 0, w, 40); }
    x.fillStyle = '#336'; x.fillRect(5, 5, 20, 20);
    return c.convertToBlob({ type, quality: 0.9 });
  };
  const a = await s.add({ image: await img('image/png', true, 50), hasAlpha: true, categoryId: 'top', subcategoryId: 'top.casual_tee', seasons: ['夏'], scenes: ['休闲'], name: '白T', color: '白' });
  const b = await s.add({ image: await img('image/jpeg', false, 60), hasAlpha: false, categoryId: 'bottom', subcategoryId: 'bottom.jeans', seasons: [], scenes: [] });
  const c = await s.add({ image: await img('image/webp', true, 70), hasAlpha: true, categoryId: 'bag', subcategoryId: null, seasons: ['冬'], scenes: [] });
  await s.archive(c.id);
  await s.putCategoryRow({ id: 'u1', parentId: 'top', zh: 'polo', hidden: false, builtin: false });
  await s.putCategoryRow({ id: 'top.vest', zh: '吊带', hidden: true });
  await s.putCategoryRow({ id: 'u-swim', parentId: null, zh: '泳衣', hidden: false, builtin: false, slot: 'onepiece' }); // 4c：自建一级带搭配位置
  const o = await s.putOutfit({ id: 'outfit-1', name: '周末', scenes: ['休闲'], slots: { top: a.id, bottom: b.id, shoes: 'gone' }, layout: { top: { x: 0.5, y: 0.3, w: 0.4, rotation: 10, z: 4 } } });
  await s.importData({ items: [], categories: [], plans: [{ id: 'plan-1', createdAt: 1, date: '2026-10-19', outfitId: o.id }] });
  s.close();
})()`;

// 在页面里生成备份 ZIP（和"导出备份"按钮用同一个函数），存在 window.__zip；edit(manifest, files) 可篡改
const MAKE_BACKUP = (edit = '') => `(async () => {
  const { openStore } = await import('/store.js');
  const { buildBackup, readZip, makeZip } = await import('/backup.js');
  const s = await openStore(); const { blob } = await buildBackup(s); s.close();
  let zip = blob;
  ${edit ? `{
    const files = await readZip(blob);
    const manifest = JSON.parse(await files.get('manifest.json').text());
    (${edit})(manifest, files);
    zip = await makeZip([{ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest)]) }, ...[...files].filter(([n]) => n !== 'manifest.json').map(([name, blob]) => ({ name, blob }))]);
  }` : ''}
  window.__zip = zip;
  return zip.size;
})()`;

// 通过界面导入 window.__zip，返回提示文字
const IMPORT_VIA_UI = `(async () => {
  const dt = new DataTransfer();
  dt.items.add(new File([window.__zip], 'closet-backup.zip', { type: 'application/zip' }));
  const input = document.getElementById('importInput');
  input.files = dt.files;
  document.getElementById('backupMsg').textContent = '';
  input.dispatchEvent(new Event('change'));
  for (let i = 0; i < 100 && /^(正在|$)/.test(document.getElementById('backupMsg').textContent); i++) await new Promise((ok) => setTimeout(ok, 100));
  return document.getElementById('backupMsg').textContent;
})()`;

const deleteDb = `new Promise((ok) => { const d = indexedDB.deleteDatabase('closet'); d.onsuccess = d.onerror = ok; })`;

test('备份：导出 → 清空 → 导入，衣物、分类表、图片字节完全一致；再导入一次全部跳过', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  const before = await chrome.evaluate(SNAPSHOT);
  assert.equal(before.items.length, 3);
  assert.equal(before.items.filter((i) => i.archived).length, 1);
  assert.equal(before.outfits.length, 1);
  assert.equal(before.plans.length, 1);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(MAKE_BACKUP());
  // 清空：删数据库后重新打开应用。ZIP 先转成 base64 带到新页面
  const zipB64 = await chrome.evaluate(`(async () => { const b = new Uint8Array(await window.__zip.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); })()`);
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(deleteDb);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#closet .tile').length`), 0);
  await chrome.evaluate(`window.__zip = new Blob([Uint8Array.from(atob('${zipB64}'), (c) => c.charCodeAt(0))])`);
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 3 件，跳过 0 件；搭配新增 1 套');
  assert.deepEqual(await chrome.evaluate(SNAPSHOT), before);
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 2`); // 已归档的不显示
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 0 件，跳过 3 件；搭配新增 0 套');
  assert.deepEqual(await chrome.evaluate(SNAPSHOT), before);
});

test('备份：版本不对、缺图片、分类不存在，都整体失败，数据库不变', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  // 备份里的衣物换成新 id（否则已存在会被跳过，看不出是否整体失败）；坏的放在最后一件
  const renew = `(m, files) => { for (const it of m.items) { const f = files.get(it.image); files.delete(it.image); it.id = 'new-' + it.id; it.image = it.image.replace('images/', 'images/new-'); files.set(it.image, f); } }`;
  const cases = [
    [`(m, files) => { (${renew})(m, files); m.formatVersion = 4; }`, /^导入失败：不认识的备份版本：4$/],
    [`(m, files) => { (${renew})(m, files); m.outfits[0].id = 'new-o'; m.outfits[0].scenes = ['上班']; }`, /^导入失败：第 1 个搭配：搭配无效：scenes 含无效值：上班$/],
    [`(m, files) => { (${renew})(m, files); files.delete(m.items.at(-1).image); }`, /^导入失败：第 3 件衣物缺少图片/],
    [`(m, files) => { (${renew})(m, files); m.items.at(-1).categoryId = 'top'; m.items.at(-1).subcategoryId = 'top.nope'; }`, /^导入失败：第 3 件衣物.*top\.nope/],
  ];
  const before = await chrome.evaluate(SNAPSHOT);
  for (const [edit, msg] of cases) {
    await chrome.evaluate(MAKE_BACKUP(edit));
    assert.match(await chrome.evaluate(IMPORT_VIA_UI), msg);
    assert.deepEqual(await chrome.evaluate(SNAPSHOT), before);
  }
  // 对照：同样换新 id、不篡改时能导入（证明上面的失败不是因为换 id）
  await chrome.evaluate(MAKE_BACKUP(renew));
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 3 件，跳过 0 件；搭配新增 0 套');
});

test('备份：v2 备份（搭配没有 layout）仍能导入', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  const before = await chrome.evaluate(SNAPSHOT);
  await chrome.evaluate(MAKE_BACKUP(`(m) => { m.formatVersion = 2; for (const o of m.outfits) delete o.layout; }`));
  const zipB64 = await chrome.evaluate(`(async () => { const b = new Uint8Array(await window.__zip.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); })()`);
  await chrome.evaluate(deleteDb);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(`window.__zip = new Blob([Uint8Array.from(atob('${zipB64}'), (c) => c.charCodeAt(0))])`);
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 3 件，跳过 0 件；搭配新增 1 套');
  const after = await chrome.evaluate(SNAPSHOT);
  const { layout, ...outfit } = before.outfits[0];
  assert.ok(layout); // 原数据有 layout，v2 备份里去掉了
  assert.deepEqual(after, { ...before, outfits: [outfit] });
});

test('备份：旧版 v1 备份（没有搭配）仍能导入', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  const before = await chrome.evaluate(SNAPSHOT);
  await chrome.evaluate(MAKE_BACKUP(`(m) => { m.formatVersion = 1; delete m.outfits; delete m.plans; delete m.outfitCount; }`));
  const zipB64 = await chrome.evaluate(`(async () => { const b = new Uint8Array(await window.__zip.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); })()`);
  await chrome.evaluate(deleteDb);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(`window.__zip = new Blob([Uint8Array.from(atob('${zipB64}'), (c) => c.charCodeAt(0))])`);
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 3 件，跳过 0 件；搭配新增 0 套');
  const after = await chrome.evaluate(SNAPSHOT);
  assert.deepEqual(after, { ...before, outfits: [], plans: [] });
});

test('备份：页头显示上次备份时间，超过 7 天用提醒样式', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  assert.equal(await chrome.evaluate(`document.getElementById('backupAge').textContent`), '还没有备份');
  assert.equal(await chrome.evaluate(`document.getElementById('backupAge').classList.contains('warn')`), false); // 没有衣物时不提醒
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  assert.equal(await chrome.evaluate(`document.getElementById('backupAge').classList.contains('warn')`), true); // 有衣物、从未备份
  await chrome.evaluate(`document.getElementById('exportBtn').click()`);
  await chrome.waitFor(`document.getElementById('backupAge').textContent === '上次备份：今天'`);
  assert.equal(await chrome.evaluate(`document.getElementById('backupAge').classList.contains('warn')`), false);
  assert.match(await chrome.evaluate(`document.getElementById('backupMsg').textContent`), /^已导出 3 件/);
  await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore(); await s.setBackupAt(Date.now() - 8 * 86400000); s.close();
  })()`);
  await chrome.reload();
  await chrome.waitFor(`document.getElementById('backupAge').textContent === '上次备份：8 天前'`);
  assert.equal(await chrome.evaluate(`document.getElementById('backupAge').classList.contains('warn')`), true);
});

test('备份：importData 写入中途出错时整个事务回滚', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  const before = await chrome.evaluate(SNAPSHOT);
  const err = await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore();
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const ok = { id: 'new-1', createdAt: 1, image, hasAlpha: true, name: '', categoryId: 'bag', subcategoryId: null, seasons: [], scenes: [], color: '', archived: false };
    try { await s.importData({ items: [ok, { ...ok, id: undefined }], categories: [{ id: 'u9', parentId: null, zh: 'x', builtin: false }] }); return 'no error'; }
    catch (e) { return e.name; } finally { s.close(); }
  })()`);
  assert.equal(err, 'DataError');
  assert.deepEqual(await chrome.evaluate(SNAPSHOT), before);
});

// ---------- 阶段 4b：数据库 v4、搭配、缩略图 ----------
const rawStores = `new Promise((ok) => { const r = indexedDB.open('closet'); r.onsuccess = () => { const db = r.result;
  const out = { version: db.version, names: [...db.objectStoreNames].sort(), planIndexes: db.objectStoreNames.contains('plans') ? [...db.transaction('plans').objectStore('plans').indexNames] : [] };
  db.close(); ok(out); }; })`;

test('数据库：用 v3 时期的 store.js（d585793）建库写数据，新版打开后全部还在，图片字节一致，新表已建', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const r = await chrome.evaluate(`(async () => {
    const bytes = (b) => b.arrayBuffer().then((x) => Array.from(new Uint8Array(x)));
    const c = new OffscreenCanvas(60, 40); c.getContext('2d').fillRect(5, 5, 20, 20);
    const image = await c.convertToBlob({ type: 'image/png' });
    const old = await import('/tests/fixtures/store-v3.js');
    let s = await old.openStore();
    const item = await s.add({ image, hasAlpha: true, categoryId: 'top', subcategoryId: 'top.shirt', seasons: ['春'], scenes: ['通勤'], name: '衬衫' });
    await s.archive((await s.add({ image, hasAlpha: true, categoryId: 'bag', subcategoryId: null, seasons: [], scenes: [] })).id);
    const q = await s.enqueue({ original: image, hasAlpha: false, thumb: image });
    await s.setJob({ running: false, phase: 'classify', events: [{ e: 'start' }] });
    await s.setDevice({ noWebgpu: true });
    await s.setBackupAt(123);
    await s.putCategoryRow({ id: 'u1', parentId: 'top', zh: 'polo', hidden: false, builtin: false });
    const v3 = await ${rawStores.replace(/`/g, '\\`')};
    s.close();
    const { openStore } = await import('/store.js');
    s = await openStore();
    const items = await s.list({ includeArchived: true });
    const got = items.find((i) => i.id === item.id);
    const queue = await s.listQueue();
    const out = {
      v3, v4: null, itemCount: items.length, name: got.name, archived: items.filter((i) => i.archived).length,
      sameImage: JSON.stringify(await bytes(got.image)) === JSON.stringify(await bytes(image)),
      queueIds: queue.map((x) => x.id), queueImage: JSON.stringify(await bytes(queue[0].original)) === JSON.stringify(await bytes(image)),
      job: (await s.getJob()).phase, device: await s.getDevice(), backupAt: await s.getBackupAt(),
      categories: (await s.listCategoryRows()).map((x) => x.id), outfits: (await s.listOutfits()).length, qid: q.id,
    };
    s.close();
    out.v4 = await ${rawStores.replace(/`/g, '\\`')};
    return out;
  })()`);
  assert.deepEqual(r.v3.names, ['categories', 'items', 'meta', 'queue']);
  assert.equal(r.v3.version, 3);
  assert.deepEqual(r.v4, { version: 4, names: ['categories', 'items', 'meta', 'outfits', 'plans', 'queue', 'thumbs'], planIndexes: ['date'] });
  assert.equal(r.itemCount, 2);
  assert.equal(r.archived, 1);
  assert.equal(r.name, '衬衫');
  assert.equal(r.sameImage, true);
  assert.deepEqual(r.queueIds, [r.qid]);
  assert.equal(r.queueImage, true);
  assert.equal(r.job, 'classify');
  assert.deepEqual(r.device, { noWebgpu: true });
  assert.equal(r.backupAt, 123);
  assert.deepEqual(r.categories, ['u1']);
  assert.equal(r.outfits, 0);
});

test('数据库：新装（从 0 建库）每张表只建一次，共 7 张', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const r = await chrome.evaluate(`(async () => { const { openStore } = await import('/store.js'); const s = await openStore(); s.close(); return ${rawStores}; })()`);
  assert.deepEqual(r, { version: 4, names: ['categories', 'items', 'meta', 'outfits', 'plans', 'queue', 'thumbs'], planIndexes: ['date'] });
});

test('数据库：旧代码请求低版本（VersionError）时显示"有新版本，请刷新"，没有未捕获的错误', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(`import('/store.js').then(async (m) => (await m.openStore()).close())`);
  const { identifier } = await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errors = [];
    addEventListener('error', (e) => __errors.push(String(e.message))); addEventListener('unhandledrejection', (e) => __errors.push(String(e.reason)));` });
  try {
    await chrome.goto(`${server.origin}/?fakeDbVersion=3`);
    await chrome.waitFor(`document.documentElement.dataset.ready === 'fatal'`);
    assert.equal(await chrome.evaluate(`document.querySelector('#fatal p').textContent`), '有新版本，请刷新');
    assert.equal(await chrome.evaluate(`document.querySelector('#fatal button').textContent`), '刷新');
    assert.equal(await chrome.evaluate(`getComputedStyle(document.getElementById('views')).display`), 'none');
    await new Promise((ok) => setTimeout(ok, 300));
    assert.deepEqual(await chrome.evaluate('window.__errors'), []);
  } finally { await chrome.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
});

// 4 件衣物：衬衫、牛仔裤、运动鞋、连衣裙（600×400，缩略图长边 256）
const SEED_OUTFIT = `(async () => {
  const { openStore } = await import('/store.js');
  const s = await openStore();
  const add = async (categoryId, subcategoryId, seasons, name) => {
    const c = new OffscreenCanvas(600, 400); c.getContext('2d').fillRect(100, 100, 300, 200);
    return (await s.add({ image: await c.convertToBlob({ type: 'image/png' }), hasAlpha: true, categoryId, subcategoryId, seasons, scenes: [], name })).id;
  };
  const ids = { shirt: await add('top', 'top.shirt', ['春', '秋'], '衬衫'), jeans: await add('bottom', 'bottom.jeans', ['春', '秋', '冬'], '牛仔裤'),
    shoes: await add('shoes', 'shoes.sneakers', ['春', '秋'], '运动鞋'), dress: await add('skirt', 'skirt.dress', ['春', '夏', '秋'], '连衣裙') };
  s.close();
  return ids;
})()`;
const clickText = (scope, text) => `[...document.querySelectorAll('${scope} button')].find((b) => b.textContent === '${text}').click()`;
const pickSlot = (slot, name) => `(async () => {
  document.querySelector('.slot-row[data-slot="${slot}"] .slot-pick').click();
  const tile = [...document.querySelectorAll('#editForm .tile')].find((t) => t.textContent === '${name}');
  const count = document.querySelectorAll('#editForm .tile').length;
  tile.click();
  return count;
})()`;
const outfitCards = `[...document.querySelectorAll('#outfitList .outfit-card')].map((c) => ({ name: c.querySelector('.outfit-name').textContent, meta: c.querySelector('.muted').textContent, missing: c.querySelector('.outfit-missing')?.textContent ?? '' }))`;
const storeCall = (expr) => `(async () => { const { openStore } = await import('/store.js'); const s = await openStore(); try { return await (${expr}); } finally { s.close(); } })()`;

test('搭配：界面新建（上衣 + 下装 + 鞋；连衣裙 + 鞋），缺下装时提示，刷新后还在；归档 / 删除在搭配里的衣物先提示，搭配显示"已归档"/"已删除"', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const ids = await chrome.evaluate(SEED_OUTFIT);
  await chrome.goto(`${server.origin}/#v=outfits`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  assert.equal(await chrome.evaluate(`document.getElementById('outfitsEmpty').hidden`), false);

  // 第一套：名称、场景、上衣 + 下装 + 鞋。上衣槽位只列出上衣
  await chrome.evaluate(`document.getElementById('newOutfit').click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open`);
  await chrome.evaluate(`document.querySelector('#editForm input').value = '周一通勤'`);
  await chrome.evaluate(clickText('#editForm .chips', '通勤'));
  assert.equal(await chrome.evaluate(pickSlot('top', '衬衫')), 1);
  await chrome.evaluate(clickText('#editForm', '保存'));
  assert.equal(await chrome.evaluate(`document.querySelector('#editForm p.error').textContent`), '请选择下装');
  assert.equal(await chrome.evaluate(pickSlot('bottom', '牛仔裤')), 1);
  assert.equal(await chrome.evaluate(pickSlot('shoes', '运动鞋')), 1);
  // 选择器切回编辑视图后，名称和场景还在
  assert.equal(await chrome.evaluate(`document.querySelector('#editForm input').value`), '周一通勤');
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);

  // 第二套：连衣裙 + 鞋，上衣和下装可空
  await chrome.evaluate(`document.getElementById('newOutfit').click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open`);
  assert.equal(await chrome.evaluate(pickSlot('onepiece', '连衣裙')), 1);
  assert.equal(await chrome.evaluate(pickSlot('shoes', '运动鞋')), 1);
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  await chrome.waitFor(`document.querySelectorAll('#outfitList .outfit-card').length === 2`);

  // 刷新后仍在搭配页，两套都在；季节 = 交集
  await chrome.reload();
  await chrome.waitFor(`document.documentElement.dataset.ready === '1' && document.querySelectorAll('#outfitList .outfit-card').length === 2`);
  const cards = await chrome.evaluate(outfitCards);
  assert.deepEqual(cards.map((c) => c.name).sort(), ['周一通勤', '未命名搭配']);
  assert.equal(cards.find((c) => c.name === '周一通勤').meta, '通勤 · 春秋');
  const saved = await chrome.evaluate(storeCall(`s.listOutfits()`));
  assert.deepEqual(saved.find((o) => o.name === '周一通勤').slots, { outer: null, top: ids.shirt, onepiece: null, bottom: ids.jeans, shoes: ids.shoes, bag: null, accessory: null });
  assert.deepEqual(saved.find((o) => o.name === '周一通勤').scenes, ['通勤']);

  // 归档运动鞋：先提示在 2 套搭配里
  await chrome.evaluate(`window.confirm = (m) => { window.__confirm = m; return true; }`);
  await chrome.evaluate(clickText('#views', '衣橱'));
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 4`);
  // 网格缩略图已生成（来自 thumbs 表）
  await chrome.waitFor(storeCall(`s.getThumb('${ids.shoes}')`) + `.then((b) => b !== null)`);
  await chrome.evaluate(`[...document.querySelectorAll('#closet .tile')].find((t) => t.textContent === '运动鞋').click()`);
  await chrome.evaluate(clickText('#editForm', '归档'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  assert.equal(await chrome.evaluate('window.__confirm'), '这件衣服在 2 套搭配里，归档后这些搭配里显示"已归档"。确定吗？');
  await chrome.evaluate(clickText('#views', '搭配'));
  await chrome.waitFor(`document.querySelectorAll('#outfitList .outfit-missing').length === 2`);
  assert.deepEqual((await chrome.evaluate(outfitCards)).map((c) => c.missing), ['1 件已归档', '1 件已归档']);
  // 搭配里有已归档的衣物，保存时要求重新选择；鞋槽位的选择器不显示已归档的鞋
  await chrome.evaluate(`document.querySelector('#outfitList .outfit-card').click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open`);
  await chrome.evaluate(clickText('#editForm', '保存'));
  assert.equal(await chrome.evaluate(`document.querySelector('#editForm p.error').textContent`), '鞋已归档，请重新选择');
  await chrome.evaluate(`document.querySelector('.slot-row[data-slot="shoes"] .slot-pick').click()`);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#editForm .tile').length`), 0);
  await chrome.evaluate(clickText('#editForm', '← 返回'));
  await chrome.evaluate(clickText('#editForm', '取消'));

  // 彻底删除：先提示，删除后搭配显示"已删除"，缩略图也删掉
  await chrome.evaluate(clickText('#views', '衣橱'));
  await chrome.evaluate(`document.getElementById('archivedBtn').click()`);
  await chrome.waitFor(`document.querySelectorAll('#archived .tile').length === 1`);
  await chrome.evaluate(`document.querySelector('#archived .tile').click()`);
  await chrome.evaluate(clickText('#editForm', '彻底删除'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  assert.equal(await chrome.evaluate('window.__confirm'), '这件衣服在 2 套搭配里，删除后这些搭配里显示"已删除"，彻底删除后无法恢复，确定吗？');
  assert.equal(await chrome.evaluate(storeCall(`s.getThumb('${ids.shoes}')`)), null);
  await chrome.evaluate(clickText('#views', '搭配'));
  await chrome.waitFor(`[...document.querySelectorAll('#outfitList .outfit-missing')].map((m) => m.textContent).join() === '1 件已删除,1 件已删除'`);
  // 提示时点"取消"：不归档，弹窗不关
  await chrome.evaluate(clickText('#views', '衣橱'));
  await chrome.evaluate(`[...document.querySelectorAll('#closet .tile')].find((t) => t.textContent === '连衣裙').click()`);
  await chrome.evaluate(`window.confirm = (m) => { window.__confirm = m; return false; }`);
  await chrome.evaluate(clickText('#editForm', '归档'));
  await chrome.waitFor(`window.__confirm.startsWith('这件衣服在 1 套搭配里')`);
  assert.equal(await chrome.evaluate(`document.getElementById('editDialog').open`), true);
  assert.equal(await chrome.evaluate(storeCall(`s.get('${ids.dress}').then((i) => i.archived)`)), false);
});

test('缩略图：网格用 thumbs 表里的缩略图；已有的直接用，不重新生成；没有的生成长边 256 并保存', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const ids = await chrome.evaluate(SEED_OUTFIT);
  // 给衬衫预先放一张 10×10 的缩略图：网格显示 10 px 宽就说明用的是已存的，没有重新生成
  await chrome.evaluate(storeCall(`(async () => { const c = new OffscreenCanvas(10, 10); c.getContext('2d').fillRect(0, 0, 10, 10); await s.putThumb('${ids.shirt}', await c.convertToBlob({ type: 'image/png' })); })()`));
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  const widths = `Object.fromEntries([...document.querySelectorAll('#closet .tile')].map((t) => [t.textContent, t.querySelector('img').naturalWidth]))`;
  await chrome.waitFor(`Object.values(${widths}).every((w) => w > 0)`);
  assert.deepEqual(await chrome.evaluate(widths), { 衬衫: 10, 牛仔裤: 256, 运动鞋: 256, 连衣裙: 256 });
  assert.equal(await chrome.evaluate(`[...document.querySelectorAll('#closet .tile img')].every((i) => i.src.startsWith('blob:'))`), true);
  assert.equal(await chrome.evaluate(storeCall(`s.getThumb('${ids.jeans}').then((b) => b.size > 0)`)), true);
});

// ---------- 阶段 4d：自动排版、合成图 ----------
// 200×100 的透明 PNG，不透明部分在 x 40–120、y 20–80（轮廓 0.2–0.6 × 0.2–0.8）；color 不同 → 图片不同
const SEED_LAYOUT = `(async () => {
  const { openStore } = await import('/store.js');
  const s = await openStore();
  const png = async (color, w = 200, h = 100, rect = [40, 20, 80, 60]) => {
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(...rect);
    return c.convertToBlob({ type: 'image/png' });
  };
  const add = async (categoryId, subcategoryId, color) => (await s.add({ image: await png(color), hasAlpha: true, categoryId, subcategoryId, seasons: ['春'], scenes: [] })).id;
  const ids = { top: await add('top', 'top.shirt', '#c00'), jeans: await add('bottom', 'bottom.jeans', '#00c'), pants: await add('bottom', 'bottom.casual', '#0a0') };
  const o = await s.putOutfit({ id: 'o-layout', name: '排版', scenes: [], slots: { top: ids.top, bottom: ids.jeans } });
  s.close();
  return { ...ids, outfit: o.id };
})()`;
const cacheOf = (key) => storeCall(`s.getCache('${key}').then((r) => r && { sig: r.sig, bbox: r.bbox ?? null, size: r.blob?.size ?? null })`);
const compositeShown = `(() => { const i = document.querySelector('#outfitList .outfit-img'); return !!i && i.complete && i.naturalWidth === 450 && i.naturalHeight === 600; })()`;

test('自动排版：搭配列表显示 450×600 合成图并缓存；轮廓按透明边裁出；改搭配、换衣物图片后重新生成；删除时清掉缓存', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const ids = await chrome.evaluate(SEED_LAYOUT);
  await chrome.goto(`${server.origin}/#v=outfits`);
  await chrome.waitFor(compositeShown);
  const first = await chrome.evaluate(cacheOf(`outfit:${ids.outfit}`));
  assert.ok(first.size > 0);
  assert.deepEqual(await chrome.evaluate(cacheOf(`bbox:${ids.top}`).replace('sig: r.sig, ', '')), { bbox: { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.8 }, size: null });
  // 合成图里上衣（红）在下装（蓝）上方：按列统计红、蓝像素的平均 y
  const centers = await chrome.evaluate(`(async () => {
    const i = document.querySelector('#outfitList .outfit-img'); const c = document.createElement('canvas'); c.width = 450; c.height = 600;
    const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, 450, 600).data;
    const acc = { r: [0, 0], b: [0, 0] };
    for (let p = 0; p < d.length; p += 4) { const y = Math.floor(p / 4 / 450);
      if (d[p] > 150 && d[p + 1] < 80 && d[p + 2] < 80) { acc.r[0] += y; acc.r[1]++; }
      if (d[p + 2] > 150 && d[p] < 80 && d[p + 1] < 80) { acc.b[0] += y; acc.b[1]++; } }
    return { red: acc.r[0] / acc.r[1], blue: acc.b[0] / acc.b[1] };
  })()`);
  assert.ok(centers.red < centers.blue, JSON.stringify(centers));

  // 再打开一次：sig 没变，用缓存（大小一样）
  await chrome.reload();
  await chrome.waitFor(compositeShown);
  assert.deepEqual(await chrome.evaluate(cacheOf(`outfit:${ids.outfit}`)), first);

  // 改搭配（下装换成休闲裤）→ sig 变化、重新生成
  await chrome.evaluate(storeCall(`s.listOutfits().then(([o]) => s.putOutfit({ ...o, slots: { ...o.slots, bottom: '${ids.pants}' } }))`));
  await chrome.reload();
  await chrome.waitFor(compositeShown);
  const second = await chrome.evaluate(cacheOf(`outfit:${ids.outfit}`));
  assert.notEqual(second.sig, first.sig);

  // 换衣物图片（应用里还没有换图功能，直接改数据库模拟）→ 轮廓和合成图都重新生成
  await chrome.evaluate(`(async () => {
    const db = await new Promise((ok) => { const r = indexedDB.open('closet'); r.onsuccess = () => ok(r.result); });
    const c = new OffscreenCanvas(200, 100); c.getContext('2d').fillRect(0, 0, 100, 100);
    const image = await c.convertToBlob({ type: 'image/png' });
    const item = await new Promise((ok) => { const r = db.transaction('items').objectStore('items').get('${ids.top}'); r.onsuccess = () => ok(r.result); });
    await new Promise((ok) => { const t = db.transaction(['items', 'thumbs'], 'readwrite'); t.objectStore('items').put({ ...item, image }); t.objectStore('thumbs').delete('${ids.top}'); t.oncomplete = ok; });
    db.close();
  })()`);
  await chrome.reload();
  await chrome.waitFor(compositeShown);
  await chrome.waitFor(`${cacheOf(`bbox:${ids.top}`)}.then((r) => r.bbox.x1 === 0.5)`);
  assert.deepEqual((await chrome.evaluate(cacheOf(`bbox:${ids.top}`))).bbox, { x0: 0, y0: 0, x1: 0.5, y1: 1 });
  assert.notEqual((await chrome.evaluate(cacheOf(`outfit:${ids.outfit}`))).sig, second.sig);

  // 删除衣物：缩略图和轮廓一起删；删除搭配：合成图删掉
  await chrome.evaluate(storeCall(`s.remove('${ids.top}')`));
  assert.equal(await chrome.evaluate(cacheOf(`bbox:${ids.top}`)), null);
  assert.equal(await chrome.evaluate(storeCall(`s.getThumb('${ids.top}')`)), null);
  await chrome.evaluate(storeCall(`s.removeOutfit('${ids.outfit}')`));
  assert.equal(await chrome.evaluate(cacheOf(`outfit:${ids.outfit}`)), null);
});

test('自动排版：编辑弹窗的预览随选择更新', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED_OUTFIT);
  await chrome.goto(`${server.origin}/#v=outfits`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(`document.getElementById('newOutfit').click()`);
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '0'`);
  await chrome.evaluate(pickSlot('top', '衬衫'));
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '1'`);
  await chrome.evaluate(pickSlot('bottom', '牛仔裤'));
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '2'`);
  // 画布上真的有衣物（不是全白）
  const nonWhite = await chrome.evaluate(`(() => { const c = document.querySelector('#editForm canvas.outfit-preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let p = 0; p < d.length; p += 4) if (d[p] < 200) n++; return n; })()`);
  assert.ok(nonWhite > 100, String(nonWhite));
  await chrome.evaluate(`document.querySelector('.slot-row[data-slot="bottom"] button.small').click()`);
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '1'`);
});

// ---------- 阶段 4e：手动调整排版 ----------
// 在预览画布上按相对位置（0–1）拖动：CDP 鼠标事件（会产生 pointerdown / move / up）
async function dragOnPreview(from, to) {
  const r = await chrome.evaluate(`(() => { const c = document.querySelector('#editForm canvas.outfit-preview'); c.scrollIntoView({ block: 'center' }); const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  const pt = ([x, y]) => ({ x: r.x + x * r.w, y: r.y + y * r.h });
  const a = pt(from), b = pt(to);
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
  await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 5; i++) await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 5, y: a.y + ((b.y - a.y) * i) / 5, button: 'left', buttons: 1 });
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, button: 'left', clickCount: 1 });
}
const openLayoutOutfit = async () => {
  await chrome.evaluate(`document.querySelector('#outfitList .outfit-card').click()`);
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '2'`);
};
const savedOutfit = storeCall(`s.listOutfits().then(([o]) => o)`);
const setRange = (label, v) => `(() => { const i = [...document.querySelectorAll('#editForm .adjust label')].find((l) => l.textContent.startsWith('${label}')).querySelector('input'); i.value = '${v}'; i.dispatchEvent(new Event('input')); })()`;

test('手动调整：拖动上衣、调大小和角度、往前一层，保存后写进 layout，合成图重新生成；取消不保存', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const ids = await chrome.evaluate(SEED_LAYOUT);
  await chrome.goto(`${server.origin}/#v=outfits`);
  await chrome.waitFor(compositeShown);
  const sig0 = (await chrome.evaluate(cacheOf(`outfit:${ids.outfit}`))).sig;

  // 取消：拖动后点取消，不保存
  await openLayoutOutfit();
  await chrome.evaluate(clickText('#editForm', '调整排版'));
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '2'`);
  await dragOnPreview([0.47, 0.245], [0.3, 0.2]);
  await chrome.evaluate(clickText('#editForm', '取消'));
  assert.equal((await chrome.evaluate(savedOutfit)).layout, undefined);

  // 拖动上衣（自动排版时中心在 0.47, 0.245）向左上
  await openLayoutOutfit();
  await chrome.evaluate(clickText('#editForm', '调整排版'));
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '2'`);
  await dragOnPreview([0.47, 0.245], [0.3, 0.2]);
  assert.equal(await chrome.evaluate(`document.querySelector('#editForm canvas.outfit-preview').dataset.selected`), 'top');
  await chrome.evaluate(setRange('大小', 30));
  await chrome.evaluate(setRange('角度', 20));
  // 上衣已在最前，往前一层不变；往后一层和下装交换 z
  await chrome.evaluate(clickText('#editForm', '往后一层'));
  await chrome.evaluate(clickText('#editForm', '完成调整'));
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  const o = await chrome.evaluate(savedOutfit);
  assert.ok(Math.abs(o.layout.top.x - 0.3) < 0.02 && Math.abs(o.layout.top.y - 0.2) < 0.02, JSON.stringify(o.layout.top));
  assert.equal(o.layout.top.w, 0.3);
  assert.equal(o.layout.top.rotation, 20);
  assert.ok(o.layout.top.z < o.layout.bottom.z, JSON.stringify(o.layout));
  await chrome.waitFor(`${cacheOf(`outfit:${ids.outfit}`)}.then((r) => r && r.sig !== ${JSON.stringify(JSON.stringify(sig0))})`);

  // 拖出画板：中心点停在边上（0–1），保存不报错
  await openLayoutOutfit();
  await chrome.evaluate(clickText('#editForm', '调整排版'));
  await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '2'`);
  await dragOnPreview([0.47, 0.6], [1.6, 1.4]);
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  const out = (await chrome.evaluate(savedOutfit)).layout.bottom;
  assert.deepEqual([out.x, out.y], [1, 1]);
});

test('手动调整：换衣物后该槽位恢复自动；全部恢复自动后 layout 字段消失', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const ids = await chrome.evaluate(SEED_LAYOUT);
  const manual = { x: 0.3, y: 0.3, w: 0.3, rotation: 10, z: 9 };
  await chrome.evaluate(storeCall(`s.listOutfits().then(([o]) => s.putOutfit({ ...o, layout: { top: ${JSON.stringify(manual)}, bottom: ${JSON.stringify(manual)} } }))`));
  await chrome.goto(`${server.origin}/#v=outfits`);
  await chrome.waitFor(compositeShown);
  // 下装换成休闲裤：下装的手动排版去掉，上衣的保留
  await openLayoutOutfit();
  assert.equal(await chrome.evaluate(pickSlot('bottom', '休闲裤')), 2);
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  let o = await chrome.evaluate(savedOutfit);
  assert.deepEqual(Object.keys(o.layout), ['top']);
  assert.equal(o.slots.bottom, ids.pants);
  // 全部恢复自动
  await openLayoutOutfit();
  await chrome.evaluate(clickText('#editForm', '调整排版'));
  await chrome.evaluate(clickText('#editForm', '全部恢复自动'));
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  o = await chrome.evaluate(savedOutfit);
  assert.equal('layout' in o, false);
});

// ---------- 阶段 4c：分类管理 ----------
const openCats = async () => {
  await chrome.evaluate(`document.getElementById('catBtn').click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open && document.querySelector('#editForm h2')?.textContent === '管理分类'`);
};
const closeCats = async () => {
  await chrome.evaluate(clickText('#editForm', '完成'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
};
// 点分类管理里某一行的按钮
const catBtn = (id, text) => `[...document.querySelector('#editForm .cat-row[data-id="${id}"]').querySelectorAll('button')].find((b) => b.textContent === '${text}').click()`;
const waitCat = (cond) => chrome.waitFor(`(() => { const r = document.querySelector('#editForm .cat-row[data-id="${cond.id}"]'); return ${cond.expr}; })()`);
const tileNames = `[...document.querySelectorAll('#closet .tile span')].map((s) => s.textContent).sort()`;
const sideNames = `[...document.querySelectorAll('#closet .side-item .side-name')].map((s) => s.textContent)`;

test('分类管理：内置改名（左边栏、衣物名、刷新后都变）；隐藏有衣物的分类先提示，"全部"里衣物还在；再显示恢复', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED_CLOSET);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(`window.prompt = (q, d) => window.__answers.shift(); window.confirm = (m) => { window.__confirm = m; return true; }`);

  await openCats();
  await chrome.evaluate(`window.__answers = ['上装', '正装衬衫']`);
  await chrome.evaluate(catBtn('top', '改名'));
  await waitCat({ id: 'top', expr: `r && r.querySelector('.cat-name').textContent === '上装'` });
  await chrome.evaluate(catBtn('top.shirt', '改名'));
  await waitCat({ id: 'top.shirt', expr: `r && r.querySelector('.cat-name').textContent === '正装衬衫'` });
  // 重名：改成"背心"（同一级里已有）被拒绝
  await chrome.evaluate(`window.__answers = ['背心']`);
  await chrome.evaluate(catBtn('top.shirt', '改名'));
  await chrome.waitFor(`document.querySelector('#editForm p.error').textContent === '已有同名分类'`);
  // 隐藏"休闲短袖"（2 件 + 1 件已归档）
  await chrome.evaluate(catBtn('top.casual_tee', '隐藏'));
  await waitCat({ id: 'top.casual_tee', expr: `r && r.classList.contains('cat-hidden')` });
  assert.equal(await chrome.evaluate('window.__confirm'), '这个分类下有 3 件衣物，隐藏后它们只在"全部"里显示。确定吗？');
  // 隐藏一级"裤子"
  await chrome.evaluate(catBtn('bottom', '隐藏'));
  await waitCat({ id: 'bottom', expr: `r && r.classList.contains('cat-hidden')` });
  await closeCats();

  await chrome.waitFor(`${sideNames}.includes('上装')`);
  assert.ok(!(await chrome.evaluate(sideNames)).includes('裤子'));
  assert.equal(await chrome.evaluate(tiles), 5); // "全部"里衣物都在
  assert.ok((await chrome.evaluate(tileNames)).includes('正装衬衫'));
  await chrome.evaluate(clickSide('top'));
  assert.ok(!(await chrome.evaluate(`[...document.querySelectorAll('#closet .chips[data-name="sub"] .chip')].map((b) => b.textContent)`)).includes('休闲短袖'));
  await chrome.reload();
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  assert.ok((await chrome.evaluate(sideNames)).includes('上装'));
  assert.ok((await chrome.evaluate(tileNames)).includes('正装衬衫'));

  // 再显示裤子
  await chrome.evaluate(`window.confirm = () => true`);
  await openCats();
  await chrome.evaluate(catBtn('bottom', '显示'));
  await waitCat({ id: 'bottom', expr: `r && !r.classList.contains('cat-hidden')` });
  await closeCats();
  await chrome.waitFor(`${sideNames}.includes('裤子')`);
});

test('分类管理：新建一级（搭配位置 = 上衣）和二级 → 衣物改到新分类 → 搭配上衣槽位能选到；有衣物不能删、内置没有删除；移走后连同二级一起删', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const ids = await chrome.evaluate(SEED_OUTFIT);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(`window.prompt = (q, d) => window.__answers.shift(); window.confirm = (m) => { window.__confirm = m; return true; }`);

  await openCats();
  // 内置分类没有删除按钮；没有二级的内置分类（箱包）不能新建二级
  assert.equal(await chrome.evaluate(`[...document.querySelectorAll('#editForm .cat-row[data-id="top"] button')].some((b) => b.textContent === '删除')`), false);
  assert.equal(await chrome.evaluate(`[...document.querySelector('#editForm .cat-top[data-id="bag"]').querySelectorAll('button')].some((b) => b.textContent === '＋ 新建二级分类')`), false);
  await chrome.evaluate(`(() => { const f = document.querySelector('#editForm .cat-new'); f.querySelector('input').value = '运动上衣'; f.querySelector('select').value = 'top'; })()`);
  await chrome.evaluate(clickText('#editForm .cat-new', '新建一级分类'));
  await chrome.waitFor(`[...document.querySelectorAll('#editForm .cat-top')].some((t) => t.textContent.includes('运动上衣'))`);
  const customId = await chrome.evaluate(`[...document.querySelectorAll('#editForm .cat-top')].find((t) => t.textContent.includes('运动上衣')).dataset.id`);
  assert.match(customId, /^u-/);
  await chrome.evaluate(`window.__answers = ['Polo']`);
  await chrome.evaluate(`[...document.querySelector('#editForm .cat-top[data-id="${customId}"]').querySelectorAll('button')].find((b) => b.textContent === '＋ 新建二级分类').click()`);
  await chrome.waitFor(`document.querySelector('#editForm .cat-top[data-id="${customId}"]').textContent.includes('Polo')`);
  await closeCats();

  // 衬衫改到"运动上衣 / Polo"
  await chrome.waitFor(`${sideNames}.includes('运动上衣')`);
  await chrome.evaluate(`[...document.querySelectorAll('#closet .tile')].find((t) => t.textContent === '衬衫').click()`);
  await chrome.evaluate(clickText('#editForm .chips', '运动上衣'));
  await chrome.evaluate(clickText('#editForm .chips', 'Polo'));
  await chrome.evaluate(`(() => { const i = document.querySelectorAll('#editForm input')[0]; i.value = ''; })()`); // 名称清空，显示分类名
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  const shirt = await chrome.evaluate(storeCall(`s.get('${ids.shirt}')`));
  assert.equal(shirt.categoryId, customId);
  await chrome.waitFor(`${tileNames}.includes('Polo')`);

  // 搭配：上衣槽位能选到它
  await chrome.evaluate(clickText('#views', '搭配'));
  await chrome.evaluate(`document.getElementById('newOutfit').click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open`);
  assert.equal(await chrome.evaluate(pickSlot('top', 'Polo')), 1);
  assert.equal(await chrome.evaluate(pickSlot('bottom', '牛仔裤')), 1);
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  assert.equal((await chrome.evaluate(storeCall(`s.listOutfits()`)))[0].slots.top, ids.shirt);

  // 有衣物：删除按钮不可用
  await chrome.evaluate(clickText('#views', '衣橱'));
  await openCats();
  assert.equal(await chrome.evaluate(`[...document.querySelectorAll('#editForm .cat-row[data-id="${customId}"] button')].find((b) => b.textContent === '删除').disabled`), true);
  assert.ok(await chrome.evaluate(`document.querySelector('#editForm .cat-row[data-id="${customId}"]').textContent.includes('有衣物，不能删除')`));
  await closeCats();
  // 移回 上衣 / 衬衫 后可以删，二级一起删
  await chrome.evaluate(`[...document.querySelectorAll('#closet .tile')].find((t) => t.textContent === 'Polo').click()`);
  await chrome.evaluate(clickText('#editForm .chips', '上衣'));
  await chrome.evaluate(clickText('#editForm .chips', '衬衫'));
  await chrome.evaluate(clickText('#editForm', '保存'));
  await chrome.waitFor(`!document.getElementById('editDialog').open`);
  await openCats();
  await chrome.evaluate(catBtn(customId, '删除'));
  await chrome.waitFor(`!document.querySelector('#editForm .cat-top[data-id="${customId}"]')`);
  assert.equal(await chrome.evaluate('window.__confirm'), '删除"运动上衣"和它下面的 1 个二级分类吗？');
  assert.deepEqual(await chrome.evaluate(storeCall(`s.listCategoryRows()`)), []);
  await closeCats();
});

test('分类管理：隐藏的内置分类不出现在 AI 建议里，第一名被隐藏时用下一个', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(storeCall(`(async () => {
    const c = new OffscreenCanvas(40, 40); c.getContext('2d').fillRect(5, 5, 20, 20);
    const image = await c.convertToBlob({ type: 'image/png' });
    const r = await s.enqueue({ original: image, hasAlpha: true, thumb: image });
    await s.patchQueued(r.id, (x) => ({ ...x, classify: { ...x.classify, status: 'done', top3: [{ id: 'top.shirt', score: 0.8 }, { id: 'top.casual_tee', score: 0.1 }, { id: 'top.tank', score: 0.05 }] } }));
    await s.putCategoryRow({ id: 'top.shirt', hidden: true });
  })()`));
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.querySelectorAll('#queue .review .choice').length === 1`);
  assert.equal(await chrome.evaluate(`document.querySelector('#queue .review .choice').textContent`), '休闲短袖');
  assert.deepEqual(await chrome.evaluate(`[...document.querySelectorAll('#queue .review .chips')[0].querySelectorAll('.chip')].map((b) => b.textContent)`), ['休闲短袖 10%', '背心 5%']);
});

test('下周穿搭：天气（假数据）、按天气排序、给两天排搭配、刷新后还在、改、清空；删除搭配先提示天数，那天显示"搭配已删除"；天气失败时计划照常', async () => {
  await resetDb();
  await chrome.goto(`${server.origin}/tests/blank.html`);
  const ids = await chrome.evaluate(`(async () => {
    const { openStore } = await import('/store.js');
    const s = await openStore();
    const add = async (categoryId, subcategoryId, seasons, name) => {
      const c = new OffscreenCanvas(600, 400); c.getContext('2d').fillRect(100, 100, 300, 200);
      return (await s.add({ image: await c.convertToBlob({ type: 'image/png' }), hasAlpha: true, categoryId, subcategoryId, seasons, scenes: [], name })).id;
    };
    const shirt = await add('top', 'top.shirt', ['春', '秋'], '衬衫'), jeans = await add('bottom', 'bottom.jeans', ['春', '秋', '冬'], '牛仔裤');
    const tee = await add('top', 'top.casual_tee', ['夏'], 'T恤'), shorts = await add('bottom', 'bottom.shorts', ['夏'], '短裤');
    const slots = (top, bottom) => ({ outer: null, top, onepiece: null, bottom, shoes: null, bag: null, accessory: null });
    const autumn = (await s.putOutfit({ name: '秋天', scenes: [], slots: slots(shirt, jeans) }, { now: 1 })).id;
    const summer = (await s.putOutfit({ name: '夏天', scenes: [], slots: slots(tee, shorts) }, { now: 2 })).id;
    s.close();
    return { autumn, summer };
  })()`);
  await chrome.goto(`${server.origin}/?fakeWeather=1#v=week`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1' && document.querySelectorAll('#weekList .day').length === 7`);
  // 默认下周，周一开始；天气到了之后显示温度
  const W = await chrome.evaluate(`(async () => { const w = await import('/week.js'); const now = new Date();
    const hot = w.ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
    return { today: w.ymd(now), thisWeek: w.weekDates(now, 0), next: w.weekDates(now, 1), hot }; })()`);
  assert.deepEqual(await chrome.evaluate(`[...document.querySelectorAll('#weekList .day')].map((d) => d.dataset.date)`), W.next);
  await chrome.waitFor(`document.querySelector('#weekList .day[data-date="${W.next[0]}"] .day-weather').textContent.includes('°')`);
  const dayRow = (date) => `document.querySelector('#weekList .day[data-date="${date}"]')`;
  const cardNames = `[...document.querySelectorAll('#editForm .outfit-card')].map((c) => (c.querySelector('.fit-tag')?.textContent ?? '') + c.querySelector('.outfit-name').textContent + (c.classList.contains('unfit') ? '(淡)' : ''))`;

  // 热的那天（26°）：夏天搭配排前面，秋天变淡
  if (!W.next.includes(W.hot)) { await chrome.evaluate(clickText('#weekNav', '本周')); await chrome.waitFor(`${dayRow(W.hot)}`); }
  await chrome.evaluate(`${dayRow(W.hot)}.click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open && document.querySelectorAll('#editForm .outfit-card').length === 2`);
  assert.deepEqual(await chrome.evaluate(cardNames), ['适合夏天', '秋天(淡)']);
  await chrome.evaluate(clickText('#editForm', '取消'));
  await chrome.evaluate(clickText('#weekNav', '下周'));
  await chrome.waitFor(`${dayRow(W.next[0])}`);

  // 下周一（14°，春秋）：秋天在前
  const chooseFor = async (date, name) => {
    await chrome.waitFor(`${dayRow(date)} && !document.getElementById('editDialog').open`);
    await chrome.evaluate(`${dayRow(date)}.click()`);
    await chrome.waitFor(`document.getElementById('editDialog').open && document.querySelectorAll('#editForm .outfit-card').length === 2`);
    const names = await chrome.evaluate(cardNames);
    await chrome.evaluate(`[...document.querySelectorAll('#editForm .outfit-card')].find((c) => c.querySelector('.outfit-name').textContent === '${name}').click()`);
    await chrome.waitFor(`!document.getElementById('editDialog').open`);
    return names;
  };
  const monNames = await chooseFor(W.next[0], '秋天');
  if (W.next[0] !== W.hot) assert.deepEqual(monNames, ['适合秋天', '夏天(淡)']);
  await chooseFor(W.next[2], '夏天');
  await chrome.waitFor(`${dayRow(W.next[0])}.querySelector('.day-name')?.textContent === '秋天' && ${dayRow(W.next[2])}.querySelector('.day-name')?.textContent === '夏天'`);

  // 刷新后还在（仍是下周）
  await chrome.reload();
  await chrome.waitFor(`document.documentElement.dataset.ready === '1' && ${dayRow(W.next[0])}?.querySelector('.day-outfit img')`);
  assert.equal(await chrome.evaluate(`${dayRow(W.next[2])}.querySelector('.day-name').textContent`), '夏天');
  // 改：周一换成夏天，仍是一条记录；清空周三
  await chooseFor(W.next[0], '夏天');
  await chrome.evaluate(`${dayRow(W.next[2])}.click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open`);
  assert.equal(await chrome.evaluate(`document.querySelector('#editForm .outfit-card[aria-pressed="true"] .outfit-name').textContent`), '夏天');
  await chrome.evaluate(clickText('#editForm', '清空这天'));
  await chrome.waitFor(`!document.getElementById('editDialog').open && ${dayRow(W.next[2])}.querySelector('.day-empty')?.textContent === '选搭配'`);
  const plans = await chrome.evaluate(storeCall(`s.listPlans()`));
  assert.deepEqual(plans.map((p) => [p.date, p.outfitId]), [[W.next[0], ids.summer]]);

  // 过去的日子不能点
  await chrome.evaluate(clickText('#weekNav', '本周'));
  await chrome.waitFor(`${dayRow(W.thisWeek[0])}`);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#weekList .day:disabled').length`), W.thisWeek.filter((d) => d < W.today).length);

  // 删除夏天：提示排在 1 天里；周一显示"搭配已删除"
  await chrome.evaluate(`window.confirm = (m) => { window.__confirm = m; return true; }`);
  await chrome.evaluate(clickText('#views', '搭配'));
  await chrome.waitFor(`document.querySelectorAll('#outfitList .outfit-card').length === 2`);
  await chrome.evaluate(`document.querySelector('#outfitList .outfit-card[data-id="${ids.summer}"]').click()`);
  await chrome.waitFor(`document.getElementById('editDialog').open`);
  await chrome.evaluate(clickText('#editForm', '删除搭配'));
  await chrome.waitFor(`document.querySelectorAll('#outfitList .outfit-card').length === 1`);
  assert.match(await chrome.evaluate(`window.__confirm`), /^这套搭配排在 1 天的计划里（\d+\/\d+），删除后那几天显示"搭配已删除"。删除这套搭配吗？/);
  await chrome.evaluate(clickText('#views', '下周'));
  await chrome.evaluate(clickText('#weekNav', '下周'));
  await chrome.waitFor(`${dayRow(W.next[0])}?.querySelector('.day-empty.missing')?.textContent === '搭配已删除'`);

  // 天气请求失败、没有缓存：提示失败，计划照常显示
  await chrome.evaluate(storeCall(`s.setDevice({ weather: null })`));
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.goto(`${server.origin}/?fakeWeather=fail#v=week`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1' && document.getElementById('weatherMsg').textContent === '天气获取失败，计划照常可用'`);
  assert.equal(await chrome.evaluate(`document.querySelectorAll('#weekList .day').length`), 7);
  assert.equal(await chrome.evaluate(`${dayRow(W.next[0])}.querySelector('.day-weather').textContent`), '暂无预报');
});
