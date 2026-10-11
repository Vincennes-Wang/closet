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

test('应用：录入 2 件（透明 PNG、无透明 JPEG），刷新后仍在，离线可打开', async () => {
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(`new Promise((ok) => { const d = indexedDB.deleteDatabase('closet'); d.onsuccess = d.onerror = ok; })`);
  await chrome.goto(`${server.origin}/`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  await chrome.evaluate(PICK_FILES);
  await chrome.waitFor(`document.querySelectorAll('#pending .card .thumb').length === 2`);

  const cards = await chrome.evaluate(`[...document.querySelectorAll('#pending .card')].map((c) => ({
    hint: !!c.querySelector('.hint'), alpha: c.querySelector('.thumb').classList.contains('alpha'),
    w: c.querySelector('.thumb').naturalWidth, h: c.querySelector('.thumb').naturalHeight }))`);
  assert.deepEqual(cards, [{ hint: false, alpha: true, w: 1024, h: 768 }, { hint: false, alpha: false, w: 1024, h: 768 }]);

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
    { category: '裤子', seasons: [], scenes: [], hasAlpha: false, type: 'image/jpeg' },
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
