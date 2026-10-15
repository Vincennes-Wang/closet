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
  return { items, categories: d.categories.sort(byId) };
})()`;

// 页面里准备数据：3 件衣物（1 张透明 PNG，1 件已归档）+ 分类表 2 条（自建 1 条、内置改名 + 隐藏 1 条）
const SEED = `(async () => {
  const { openStore } = await import('/store.js');
  const s = await openStore();
  const img = async (type, alpha, w) => {
    const c = new OffscreenCanvas(w, 40); const x = c.getContext('2d');
    if (!alpha) { x.fillStyle = '#ddd'; x.fillRect(0, 0, w, 40); }
    x.fillStyle = '#336'; x.fillRect(5, 5, 20, 20);
    return c.convertToBlob({ type, quality: 0.9 });
  };
  await s.add({ image: await img('image/png', true, 50), hasAlpha: true, categoryId: 'top', subcategoryId: 'top.casual_tee', seasons: ['夏'], scenes: ['休闲'], name: '白T', color: '白' });
  await s.add({ image: await img('image/jpeg', false, 60), hasAlpha: false, categoryId: 'bottom', subcategoryId: 'bottom.jeans', seasons: [], scenes: [] });
  const c = await s.add({ image: await img('image/webp', true, 70), hasAlpha: true, categoryId: 'bag', subcategoryId: null, seasons: ['冬'], scenes: [] });
  await s.archive(c.id);
  await s.putCategoryRow({ id: 'u1', parentId: 'top', zh: 'polo', hidden: false, builtin: false });
  await s.putCategoryRow({ id: 'top.vest', zh: '吊带', hidden: true });
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
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 3 件，跳过 0 件');
  assert.deepEqual(await chrome.evaluate(SNAPSHOT), before);
  await chrome.waitFor(`document.querySelectorAll('#closet .tile').length === 2`); // 已归档的不显示
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 0 件，跳过 3 件');
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
    [`(m, files) => { (${renew})(m, files); m.formatVersion = 2; }`, /^导入失败：不认识的备份版本：2$/],
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
  assert.equal(await chrome.evaluate(IMPORT_VIA_UI), '新增 3 件，跳过 0 件');
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
