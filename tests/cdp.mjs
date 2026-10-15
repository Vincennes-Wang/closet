// 测试工具：本地静态服务器 + headless Chrome（CDP，用 Node 自带 WebSocket），不引入依赖
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.wasm': 'application/wasm' };

export async function startServer() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || file.includes('/private/')) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

export async function launchChrome() {
  const dir = await mkdtemp(join(tmpdir(), 'closet-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    port = (await readFile(join(dir, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  }
  if (!port) throw new Error('Chrome 没有启动');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++seq; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((ok) => { const l = (m) => { if (m.method === method) { listeners.delete(l); ok(m.params); } }; listeners.add(l); });

  await send('Page.enable');
  await send('Runtime.enable');

  // 在页面里执行表达式（可 await），返回值需可 JSON 序列化
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async function goto(url) { const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url }); await loaded; }
  async function reload() { const loaded = once('Page.loadEventFired'); await send('Page.reload'); await loaded; }
  async function waitFor(expression, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression).catch(() => false)) return; await sleep(100); }
    throw new Error(`等待超时：${expression}`);
  }
  // 按给定视口宽高截图（整页），返回 PNG Buffer。mobile 时按手机渲染（触屏、3 倍像素）
  async function screenshot(width, height, { mobile = false } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  }
  async function close() { ws.close(); proc.kill(); await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  return { send, evaluate, goto, reload, waitFor, screenshot, close };
}
