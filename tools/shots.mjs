// 布局截图（Mac 上运行：node tools/shots.mjs <输出目录>）。
// 用假衣物（彩色方块）填衣橱，按 390 px（iPhone）和 1280 px（电脑）宽度各截一张，供人工检查。
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, launchChrome } from '../tests/cdp.mjs';

const out = process.argv[2];
if (!out) { console.error('用法：node tools/shots.mjs <输出目录>'); process.exit(1); }
await mkdir(out, { recursive: true });

const SEED = `(async () => {
  await new Promise((ok) => { const d = indexedDB.deleteDatabase('closet'); d.onsuccess = d.onerror = ok; });
  const { openStore } = await import('/store.js');
  const { leaves, seasonsFor } = await import('/taxonomy.js');
  const s = await openStore();
  const colors = ['#1f5a8e', '#b3261e', '#2e7d32', '#6d4c41', '#f6b40e', '#455a64', '#8e24aa'];
  let n = 0;
  for (const leaf of leaves().filter((l) => l.categoryId !== 'hat')) {
    for (let k = 0; k < (leaf.categoryId === 'top' ? 3 : 1); k++) {
      const c = new OffscreenCanvas(300, 300); const x = c.getContext('2d');
      x.fillStyle = colors[n++ % colors.length]; x.beginPath(); x.roundRect(60, 40, 180, 220, 24); x.fill();
      await s.add({ image: await c.convertToBlob({ type: 'image/png' }), hasAlpha: true, categoryId: leaf.categoryId,
        subcategoryId: leaf.subcategoryId, seasons: seasonsFor(leaf.categoryId, leaf.subcategoryId), scenes: n % 2 ? ['通勤'] : ['休闲'] });
    }
  }
  s.close();
})()`;

const server = await startServer();
const chrome = await launchChrome();
try {
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  for (const [name, w, h, mobile, hash] of [
    ['390-all', 390, 844, true, ''], ['390-top', 390, 844, true, '#c=top&season=夏'], ['1280-top', 1280, 800, false, '#c=top'],
  ]) {
    await chrome.screenshot(w, h, { mobile }); // 先设视口再加载
    // 只改 hash 的导航不触发 load 事件，先回空白页
    await chrome.goto(`${server.origin}/tests/blank.html`);
    await chrome.goto(`${server.origin}/${hash}`);
    await chrome.waitFor(`document.documentElement.dataset.ready === '1' && [...document.querySelectorAll('#closet img')].every((i) => i.complete)`);
    // 滚到衣橱，看左边栏和网格
    await chrome.evaluate(`document.getElementById('closet').scrollIntoView()`);
    await writeFile(join(out, `${name}.png`), await chrome.screenshot(w, h, { mobile }));
    console.log(join(out, `${name}.png`));
  }
} finally { await chrome.close(); server.close(); }
