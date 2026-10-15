// 图片内存对照（Mac 上运行）：node tools/memory.mjs [旧版本目录]
// 用 tests/seed.html 放 40 件 1024×1024 衣物 + 20 套搭配，打开页面、滚到底再回顶部、等 3 秒，
// 统计页面上已加载图片的解码大小（宽 × 高 × 4 字节）之和——图片内存的主要部分，结果稳定。
// （试过读 Chrome 进程 RSS：macOS 内存压缩让读数比空白页还低，噪声比图片本身大，不可用。）
// 给了旧版本目录（例如 git archive 3ae5dc9 解出来的）时，同样量一次旧版衣橱做对照。
// Safari 的真实标签页内存要手动量：node tools/memory.mjs --serve，按提示操作。
import { startServer, launchChrome } from '../tests/cdp.mjs';

const arg = process.argv[2];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

if (arg === '--serve') {
  const server = await startServer();
  console.log(`1. Safari 打开 ${server.origin}/tests/seed.html?items=40&outfits=20，等显示"完成"`);
  console.log(`2. 打开 ${server.origin}/ ，滚到底再回顶部，等 3 秒；在"活动监视器" → 内存里找 Safari 这个网址的网页进程，记下"内存"`);
  console.log(`3. 打开 ${server.origin}/#v=outfits ，同样操作再记一次`);
  console.log('按 Ctrl+C 结束');
  await new Promise(() => {});
}

const DECODED = `(() => { const imgs = [...document.querySelectorAll('img')].filter((i) => i.src && i.naturalWidth);
  return { count: imgs.length, mb: Math.round(imgs.reduce((n, i) => n + i.naturalWidth * i.naturalHeight * 4, 0) / 1048576 * 10) / 10 }; })()`;

async function measure(root, label, pages) {
  const server = await startServer(root);
  const chrome = await launchChrome();
  try {
    await chrome.screenshot(390, 844, { mobile: true });
    await chrome.goto(`${server.origin}/tests/seed.html?items=40&outfits=20`);
    await chrome.waitFor(`document.documentElement.dataset.done === '1'`, 120000);
    for (const hash of pages) {
      await chrome.goto(`${server.origin}/tests/blank.html`);
      await chrome.goto(`${server.origin}/${hash}`);
      await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
      let peak = { count: 0, mb: 0 };
      for (let y = 0; y < 30; y++) {
        await chrome.evaluate(`scrollBy(0, innerHeight)`); await sleep(200);
        const d = await chrome.evaluate(DECODED); if (d.mb > peak.mb) peak = d;
      }
      await chrome.evaluate(`scrollTo(0, 0)`);
      await sleep(3000);
      const end = await chrome.evaluate(DECODED);
      console.log(`${label} ${hash || '#衣橱'}：滚动中最多 ${peak.count} 张 ${peak.mb} MB；回到顶部后 ${end.count} 张 ${end.mb} MB`);
    }
  } finally { await chrome.close(); server.close(); }
}

if (arg) await measure(arg, '旧版（4a）', ['']);
await measure(undefined, '新版（4b）', ['', '#v=outfits']);
