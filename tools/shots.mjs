// 布局截图（Mac 上运行：node tools/shots.mjs <输出目录>）。
// 用假衣物（彩色方块）填衣橱和搭配，按 390 px（iPhone）和 1280 px（电脑）宽度截图，供人工检查。
// 有 private/cutouts（本机抠好的样本，不提交）时，再用真实抠图组 3 套典型搭配截图（4d 自动排版）。
// 样本里没有鞋、半身裙、包，这几件用画出来的透明轮廓代替。
import { writeFile, mkdir, readFile, access } from 'node:fs/promises';
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
  // 搭配：每套 上衣 + 下装 + 鞋（+ 外套、包），第 1 套用连衣裙
  const all = await s.list();
  const of = (c) => all.filter((i) => i.categoryId === c);
  const pick = (list, k) => list[k % list.length].id;
  for (let k = 0; k < 6; k++) {
    const dress = k === 0 ? all.find((i) => i.subcategoryId === 'skirt.dress').id : null;
    await s.putOutfit({ name: ['周一通勤', '周末', '', '见朋友', '旅行', '雨天'][k], scenes: k % 2 ? ['休闲'] : ['通勤'],
      slots: { onepiece: dress, top: dress ? null : pick(of('top'), k), bottom: dress ? null : pick(of('bottom'), k), shoes: pick(of('shoes'), k),
        outer: k % 2 ? pick(of('outer'), k) : null, bag: k % 3 ? pick(of('bag'), k) : null } });
  }
  s.close();
})()`;

const server = await startServer();
const chrome = await launchChrome();
try {
  await chrome.goto(`${server.origin}/tests/blank.html`);
  await chrome.evaluate(SEED);
  const openFirst = `document.querySelector('#outfitList .outfit-card').click()`;
  for (const [name, w, h, mobile, hash, action] of [
    ['390-all', 390, 844, true, ''], ['390-top', 390, 844, true, '#c=top&season=夏'], ['1280-top', 1280, 800, false, '#c=top'],
    ['390-outfits', 390, 844, true, '#v=outfits'], ['1280-outfits', 1280, 800, false, '#v=outfits'],
    ['390-outfit-edit', 390, 844, true, '#v=outfits', openFirst],
    ['390-outfit-pick', 390, 844, true, '#v=outfits', `(async () => { ${openFirst};
      while (!document.querySelector('.slot-row')) await new Promise((ok) => setTimeout(ok, 50));
      document.querySelector('.slot-row[data-slot="bottom"] .slot-pick').click(); })()`],
  ]) {
    await chrome.screenshot(w, h, { mobile }); // 先设视口再加载
    // 只改 hash 的导航不触发 load 事件，先回空白页
    await chrome.goto(`${server.origin}/tests/blank.html`);
    await chrome.goto(`${server.origin}/${hash}`);
    await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
    // 滚到衣橱或搭配列表，看左边栏和网格；action：打开弹窗等
    await chrome.evaluate(`document.getElementById('${hash.includes('outfits') ? 'views' : 'closet'}').scrollIntoView()`);
    if (hash.includes('outfits')) await chrome.waitFor(`document.querySelector('#outfitList .outfit-card')`);
    if (action) await chrome.evaluate(action);
    // 图片按需加载：等视口内的图片都有 src 且解码完
    await chrome.waitFor(`[...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width; }).every((i) => i.src && i.complete)`, 15000);
    await writeFile(join(out, `${name}.png`), await chrome.screenshot(w, h, { mobile }));
    console.log(join(out, `${name}.png`));
  }

  // ---------- 真实抠图的搭配（4d） ----------
  const CUT = join(import.meta.dirname, '..', 'private', 'cutouts');
  if (await access(CUT).then(() => true, () => false)) {
    const b64 = async (f) => (await readFile(join(CUT, f))).toString('base64');
    const real = { shirt: await b64('IMG_4033.png'), pants: await b64('IMG_4021.png'), dress: await b64('IMG_4023.png'),
      jacket: await b64('IMG_4025.png'), tank: await b64('IMG_4019.png') };
    await chrome.goto(`${server.origin}/tests/blank.html`);
    await chrome.evaluate(`(async () => {
      await new Promise((ok) => { const d = indexedDB.deleteDatabase('closet'); d.onsuccess = d.onerror = ok; });
      const { openStore } = await import('/store.js');
      const s = await openStore();
      const real = ${JSON.stringify(real)};
      const fromB64 = (b) => new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type: 'image/png' });
      // 画出来的透明轮廓：鞋（一双）、半身裙、包
      const draw = async (w, h, fn) => { const c = new OffscreenCanvas(w, h); fn(c.getContext('2d')); return c.convertToBlob({ type: 'image/png' }); };
      const shoes = await draw(600, 260, (x) => { x.fillStyle = '#3b3b3b';
        for (const dx of [40, 320]) { x.beginPath(); x.moveTo(dx, 200); x.lineTo(dx, 120); x.quadraticCurveTo(dx + 40, 60, dx + 110, 90); x.lineTo(dx + 240, 170); x.quadraticCurveTo(dx + 250, 200, dx + 230, 210); x.closePath(); x.fill(); } });
      const skirt = await draw(500, 600, (x) => { x.fillStyle = '#8a6d3b'; x.beginPath(); x.moveTo(170, 60); x.lineTo(330, 60); x.lineTo(440, 540); x.lineTo(60, 540); x.closePath(); x.fill(); });
      const bag = await draw(400, 400, (x) => { x.fillStyle = '#a0522d'; x.beginPath(); x.roundRect(60, 150, 280, 200, 30); x.fill();
        x.strokeStyle = '#a0522d'; x.lineWidth = 18; x.beginPath(); x.arc(200, 150, 80, Math.PI, 0); x.stroke(); });
      const add = async (image, categoryId, subcategoryId) => (await s.add({ image, hasAlpha: true, categoryId, subcategoryId, seasons: ['春', '秋'], scenes: [] })).id;
      const id = {
        shirt: await add(fromB64(real.shirt), 'top', 'top.shirt'), pants: await add(fromB64(real.pants), 'bottom', 'bottom.dress_pants'),
        dress: await add(fromB64(real.dress), 'skirt', 'skirt.dress'), jacket: await add(fromB64(real.jacket), 'outer', 'outer.track_jacket'),
        tank: await add(fromB64(real.tank), 'top', 'top.tank'), shoes: await add(shoes, 'shoes', 'shoes.sneakers'),
        skirt: await add(skirt, 'skirt', 'skirt.skirt'), bag: await add(bag, 'bag', null),
      };
      await s.putOutfit({ name: '上衣 + 裤子 + 鞋', scenes: ['通勤'], slots: { top: id.shirt, bottom: id.pants, shoes: id.shoes } });
      await s.putOutfit({ name: '外套 + 上衣 + 半身裙 + 鞋 + 包', scenes: ['休闲'], slots: { outer: id.jacket, top: id.tank, bottom: id.skirt, shoes: id.shoes, bag: id.bag } });
      await s.putOutfit({ name: '连衣裙 + 鞋', scenes: ['出行'], slots: { onepiece: id.dress, shoes: id.shoes } });
      s.close();
    })()`);
    for (const [name, w, h, mobile, edit] of [['390-real-outfits', 390, 844, true], ['1280-real-outfits', 1280, 800, false], ['390-real-edit', 390, 844, true, true]]) {
      await chrome.screenshot(w, h, { mobile });
      await chrome.goto(`${server.origin}/tests/blank.html`);
      await chrome.goto(`${server.origin}/#v=outfits`);
      await chrome.waitFor(`[...document.querySelectorAll('#outfitList .outfit-img')].length === 3 && [...document.querySelectorAll('#outfitList .outfit-img')].every((i) => i.complete && i.naturalWidth)`, 30000);
      await chrome.evaluate(`document.getElementById('views').scrollIntoView()`);
      if (edit) {
        await chrome.evaluate(`[...document.querySelectorAll('#outfitList .outfit-card')].find((c) => c.textContent.startsWith('外套')).click()`);
        await chrome.waitFor(`document.querySelector('#editForm canvas.outfit-preview')?.dataset.drawn === '5'`, 15000);
      }
      await writeFile(join(out, `${name}.png`), await chrome.screenshot(w, h, { mobile }));
      console.log(join(out, `${name}.png`));
    }
  }
} finally { await chrome.close(); server.close(); }
