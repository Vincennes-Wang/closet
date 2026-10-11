// 分类准确率（Mac 上运行：node tools/eval.mjs）。
// 样本：private/samples/*.jpg；标注：private/labels.json（{ "IMG_4015.jpg": "top.casual_tee", ... }，不提交）。
// 标注文件不存在时生成模板和 id 对照表，只输出预测结果。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { startServer, launchChrome } from '../tests/cdp.mjs';
import { CATEGORIES, leaves, labelOf } from '../taxonomy.js';

const ROOT = resolve(import.meta.dirname, '..');
const SAMPLES = join(ROOT, 'private/samples');
const LABELS = join(ROOT, 'private/labels.json');
const IDS = join(ROOT, 'private/分类id对照.txt');
const name = (id) => `${labelOf(id)}(${id})`;

const files = (await readdir(SAMPLES)).filter((f) => /\.(jpe?g|png|heic)$/i.test(f)).sort();
const valid = new Set(leaves().map((l) => l.id));

let labels = null;
if (existsSync(LABELS)) {
  labels = JSON.parse(await readFile(LABELS, 'utf8'));
  const bad = Object.entries(labels).filter(([, id]) => id && !valid.has(id));
  if (bad.length) throw new Error(`labels.json 里有无效 id：${bad.map(([f, id]) => `${f}=${id}`).join('，')}。见 ${IDS}`);
} else {
  await writeFile(LABELS, JSON.stringify(Object.fromEntries(files.map((f) => [f, ''])), null, 2) + '\n');
  console.log(`已生成标注模板 ${LABELS}（值为空，请填 id）`);
}
await writeFile(IDS, CATEGORIES.map((c) => (c.subs.length
  ? `${c.zh}\n${c.subs.map((s) => `  ${s.id}  ${s.zh}`).join('\n')}`
  : `${c.zh}\n  ${c.id}  ${c.zh}（无二级分类）`)).join('\n') + '\n');

const server = await startServer();
const chrome = await launchChrome();
let out;
try {
  await chrome.goto(`${server.origin}/tools/eval.html`);
  await chrome.waitFor(`document.documentElement.dataset.ready === '1'`);
  const { root } = await chrome.send('DOM.getDocument');
  const { nodeId } = await chrome.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#files' });
  await chrome.send('DOM.setFileInputFiles', { nodeId, files: files.map((f) => join(SAMPLES, f)) });
  await chrome.waitFor('window.__result', 600000);
  out = await chrome.evaluate('window.__result');
} finally { await chrome.close(); server.close(); }
if (out.error) throw new Error(out.error);

console.log(`后端 ${out.backend}，${out.results.length} 张\n`);
let top1 = 0, top3 = 0, n = 0;
const confusion = new Map();
const LAYER = ['top.cardigan_layer', 'outer.jacket', 'outer.trench_coat', 'top.long_sleeve', 'top.light_sweater'];
const layerRows = [];
for (const r of out.results) {
  const truth = labels?.[r.name] || '';
  const top = r.ranked.slice(0, 3);
  const mark = !truth ? ' ' : top[0].id === truth ? '✓' : top.some((t) => t.id === truth) ? '3' : '✗';
  console.log(`${mark} ${r.name}  ${top.map((t) => `${name(t.id)} ${(t.score * 100).toFixed(0)}%`).join(' | ')}${truth && mark !== '✓' ? `  ← 标注 ${name(truth)}` : ''}`);
  if (!truth) continue;
  n++;
  if (top[0].id === truth) top1++;
  if (top.some((t) => t.id === truth)) top3++;
  if (top[0].id !== truth) { const k = `${name(truth)} → ${name(top[0].id)}`; confusion.set(k, (confusion.get(k) ?? 0) + 1); }
  if (LAYER.includes(truth) || LAYER.includes(top[0].id)) layerRows.push(`${r.name}：标注 ${name(truth)}，预测 ${name(top[0].id)}`);
}
if (n) {
  console.log(`\n已标注 ${n} 张：top-1 ${top1}/${n}（${Math.round(top1 / n * 100)}%），top-3 ${top3}/${n}（${Math.round(top3 / n * 100)}%）`);
  console.log('\n混淆（标注 → 预测）：');
  for (const [k, v] of [...confusion].sort((a, b) => b[1] - a[1])) console.log(`  ${v} × ${k}`);
  console.log('\n外搭 vs 夹克 / 风衣 / 长袖线衣 / 薄毛衣：');
  for (const line of layerRows) console.log(`  ${line}`);
  if (!layerRows.length) console.log('  （样本里没有这几类）');
} else console.log(`\n还没有标注。按 ${IDS} 填 ${LABELS} 后重新运行。`);
