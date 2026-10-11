// 生成 label-embeddings.json（Mac 上运行：node tools/embed.mjs）。
// 用 headless Chrome 打开 tools/embed.html，从 taxonomy.js 读英文 prompt，用 fashionSigLIP fp32 文本模型算向量。
// 改了 taxonomy.js 的英文 prompt 后必须重新运行；tests/store.test.mjs 会检查两者是否一致。
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchChrome } from '../tests/cdp.mjs';

const OUT = resolve(import.meta.dirname, '..', 'label-embeddings.json');
const server = await startServer();
const chrome = await launchChrome();
try {
  await chrome.goto(`${server.origin}/tools/embed.html`);
  await chrome.waitFor('window.__result', 600000);
  const r = await chrome.evaluate('window.__result');
  if (r.error) throw new Error(r.error);
  await writeFile(OUT, JSON.stringify(r) + '\n');
  console.log(`已写入 ${OUT}：${r.labels.length} 项，${r.device}，${r.createdAt}`);
} finally {
  await chrome.close();
  server.close();
}
