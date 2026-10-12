// 模型 Worker：模型只在这里加载（做法来自 spike/rmbg-worker.js）。页面每批处理完就刷新，Worker 随页面销毁。
// 一个 Worker 只做一种任务（task）：matting = 抠图（RMBG），classify = 分类（fashionSigLIP 图像模型）。
// 消息：init（加载模型）/ run（处理一张，ImageBitmap 以 transfer 方式传入）/ dispose（释放 ONNX session）
// 测试用：init 时 fake 为数字，则不加载模型，每张等待 fake 毫秒后返回假结果；fakeEmptyMask 为 true 时，非 WASM 后端输出全空遮罩
import { pickBackend, EMPTY_MASK_RATIO, EMPTY_MASK_ERROR, VENDOR } from './config.js';
const LOCAL = new URL(VENDOR, import.meta.url).href;
let task = null, model = null, processor = null, spec = null, RawImage = null, fake = null, labels = null;
let device = null, fakeEmptyMask = false;

// labels：分类用的预计算标签向量 [{ id, embedding }]（label-embeddings.json）
// 按顺序试模型地址：网络错误（fetch 的 TypeError，Safari "Load failed"、Chrome "Failed to fetch"）换下一个，其他错误直接报。
// load(host) 成功时返回结果，加上实际用的 host
async function loadFromHosts(hosts, load) {
  let lastErr;
  for (const host of hosts) {
    try { return { host, ...(await load(host)) }; } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

// noWebgpu：本设备 WebGPU 抠图结果不可用，只用 WASM（见 queue.js）
// hosts：模型地址，按顺序尝试（config.js 各模型的 hosts）
// 测试用：fakeHostFail 为域名时，假模型在这个地址上模拟网络错误
async function init({ task: initTask = 'matting', modelId, dtype, wasmDtype, input, output, config, labels: l, fake: f, noWebgpu = false, fakeEmptyMask: fe = false, hosts, fakeHostFail = '' }) {
  task = initTask; spec = { input, output }; labels = l ?? null;
  if (typeof f === 'number') {
    fake = f; fakeEmptyMask = fe; device = noWebgpu ? 'wasm' : 'fake';
    return loadFromHosts(hosts, async (host) => {
      if (fakeHostFail && host.includes(fakeHostFail)) throw new TypeError('Failed to fetch');
      return { device, dtype: 'fake', loadMs: 0 };
    });
  }
  const t = await import(`${LOCAL}transformers.min.js`);
  t.env.allowLocalModels = false;
  // transformers.js 导入时按浏览器选好 ONNX Runtime 文件（.asyncify 版；Safari 26 以下且没有 WebGPU 时选普通版，本站没有，放弃这类设备，2026-10-12），
  // 地址指向 jsDelivr。保留它选的文件名，改从本站下载
  const wasm = t.env.backends.onnx.wasm;
  wasm.wasmPaths = Object.fromEntries(Object.entries(wasm.wasmPaths).map(([k, u]) => [k, LOCAL + String(u).split('/').pop()]));
  RawImage = t.RawImage;
  // Worker 里没有 WebGPU、或显卡不支持 fp16 时回退 WASM（见 config.js pickBackend），并把实际后端报告给主线程
  const gpu = { webgpu: false, shaderF16: false };
  if (!noWebgpu) try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) { gpu.webgpu = true; gpu.shaderF16 = adapter.features.has('shader-f16'); }
  } catch { /* 无 */ }
  const picked = pickBackend(gpu, { dtype, wasmDtype });
  device = picked.device;
  const realDtype = picked.dtype;
  const opts = { device, dtype: realDtype, ...(config ? { config } : {}) };
  return loadFromHosts(hosts, async (host) => {
    t.env.remoteHost = host;
    const t0 = performance.now();
    try {
      model = task === 'classify' ? await t.SiglipVisionModel.from_pretrained(modelId, opts) : await t.AutoModel.from_pretrained(modelId, opts);
      processor = await t.AutoProcessor.from_pretrained(modelId);
    } catch (err) {
      await model?.dispose().catch(() => {});
      model = null;
      throw err;
    }
    return { device, dtype: realDtype, loadMs: Math.round(performance.now() - t0) };
  });
}

// ImageBitmap → OffscreenCanvas；位图用完立即 close
function bitmapToCanvas(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function runFake(canvas) {
  await new Promise((ok) => setTimeout(ok, fake));
  const empty = fakeEmptyMask && device !== 'wasm';
  canvas.getContext('2d').clearRect(0, 0, empty ? canvas.width : canvas.width / 2, empty ? canvas.height : canvas.height / 2);
}

// 不透明像素太少：遮罩为空（小米手机 WebGPU），报错让队列处理
function checkNotEmpty(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) n++;
  if (n < w * h * EMPTY_MASK_RATIO) throw new Error(EMPTY_MASK_ERROR);
}

// 抠图结果的缩略图（透明 PNG，长边 side）
async function thumbOf(canvas, side) {
  const s = Math.min(1, side / Math.max(canvas.width, canvas.height));
  const t = new OffscreenCanvas(Math.round(canvas.width * s), Math.round(canvas.height * s));
  const ctx = t.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, t.width, t.height);
  try { return await t.convertToBlob({ type: 'image/png' }); } finally { t.width = 0; }
}

async function runMatting(bitmap, thumbSide) {
  const canvas = bitmapToCanvas(bitmap);
  const w = canvas.width, h = canvas.height;
  const t0 = performance.now();
  const temps = []; // 本张产生的所有张量，结束时统一 dispose
  try {
    if (fake !== null) {
      await runFake(canvas);
      checkNotEmpty(canvas.getContext('2d'), w, h);
      const cutout = await canvas.convertToBlob({ type: 'image/png' });
      return { cutout, thumb: await thumbOf(canvas, thumbSide), ms: Math.round(performance.now() - t0) };
    }
    const { pixel_values } = await processor(RawImage.fromCanvas(canvas).rgb());
    temps.push(pixel_values);
    const out = await model({ [spec.input]: pixel_values });
    temps.push(...Object.values(out));
    const raw = (out[spec.output] ?? Object.values(out)[0])[0]; temps.push(raw);
    const scaled = raw.mul(255); temps.push(scaled);
    const u8 = scaled.to('uint8'); temps.push(u8);
    const mask = await RawImage.fromTensor(u8).resize(w, h);
    // 合成透明图：RGB 来自原图，alpha 来自遮罩
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const ch = mask.channels;
    for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = mask.data[i * ch];
    ctx.putImageData(img, 0, 0);
    checkNotEmpty(ctx, w, h);
    const cutout = await canvas.convertToBlob({ type: 'image/png' });
    return { cutout, thumb: await thumbOf(canvas, thumbSide), ms: Math.round(performance.now() - t0) };
  } finally {
    for (const t of temps) { try { t.dispose(); } catch { /* 已释放 */ } }
    canvas.width = 0; // iOS 要显式释放 canvas 内存
  }
}

// 打分沿用 Marqo 模型卡和 spike：softmax(100 × 余弦相似度)，返回全部打分项，按分数从高到低
function rank(vec) {
  const logits = labels.map((l) => 100 * l.embedding.reduce((acc, v, i) => acc + v * vec[i], 0));
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return labels.map((l, i) => ({ id: l.id, score: +(exps[i] / sum).toFixed(4) })).sort((a, b) => b.score - a.score);
}

// 分类：先合成到白底（抠图结果是透明的，模型要看到白底上的衣物；原图不受影响）
async function runClassify(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const t0 = performance.now();
  const temps = [];
  try {
    if (fake !== null) {
      await new Promise((ok) => setTimeout(ok, fake));
      // 假结果：按标签顺序，第一项分数最高
      return { ranked: labels.map((l, i) => ({ id: l.id, score: +(0.5 / (i + 1)).toFixed(4) })), ms: Math.round(performance.now() - t0) };
    }
    const inputs = await processor(RawImage.fromCanvas(canvas).rgb());
    temps.push(...Object.values(inputs));
    const out = await model(inputs);
    temps.push(...Object.values(out));
    const normed = out.image_embeds.normalize(); temps.push(normed);
    return { ranked: rank(normed.tolist()[0]), ms: Math.round(performance.now() - t0) };
  } finally {
    for (const t of temps) { try { t.dispose(); } catch { /* 已释放 */ } }
    canvas.width = 0;
  }
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') self.postMessage({ id, ok: true, ...(await init(data)) });
    else if (type === 'run') {
      const r = task === 'classify' ? await runClassify(data.bitmap) : await runMatting(data.bitmap, data.thumbSide);
      self.postMessage({ id, ok: true, ...r });
    }
    else if (type === 'dispose') {
      await model?.dispose();
      model = null; processor = null;
      self.postMessage({ id, ok: true });
    }
  } catch (err) {
    data.bitmap?.close?.();
    // network：所有地址都是网络错误（模型下载不了），主线程据此跳过抠图
    self.postMessage({ id, ok: false, error: String(err?.message ?? err), network: err instanceof TypeError });
  }
};
