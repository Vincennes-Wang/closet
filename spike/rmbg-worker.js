// 模型 Worker：只在这里加载模型。主线程每处理 N 张就 dispose + terminate，再新建 Worker，强制释放全部内存。
// 消息：init（加载模型）/ run（处理一张，ImageBitmap 以 transfer 方式传入）/ dispose（释放 ONNX session）
import {
  env, AutoModel, AutoProcessor, SiglipVisionModel, RawImage,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;
const CACHE_NAME = 'transformers-cache';
let task = null, model = null, processor = null, spec = null;

async function cachedUrls() {
  try { return new Set((await (await caches.open(CACHE_NAME)).keys()).map((r) => r.url)); }
  catch { return new Set(); }
}

async function init({ task: t, modelId, device: wanted, dtype, wasmDtype, input, output, config }) {
  task = t; spec = { input, output };
  // Worker 里没有 WebGPU 时回退 WASM，并把实际后端报告给主线程
  let device = 'wasm';
  if (wanted === 'webgpu') { try { if (await navigator.gpu?.requestAdapter()) device = 'webgpu'; } catch { /* 无 */ } }
  const realDtype = device === 'webgpu' ? dtype : wasmDtype;
  const before = await cachedUrls();
  const files = new Map();
  const progress_callback = (p) => { if (p.file && p.total) files.set(p.file, p.total); };
  const t0 = performance.now();
  const opts = { device, dtype: realDtype, progress_callback, ...(config ? { config } : {}) };
  model = t === 'matting' ? await AutoModel.from_pretrained(modelId, opts) : await SiglipVisionModel.from_pretrained(modelId, opts);
  processor = await AutoProcessor.from_pretrained(modelId, { progress_callback });
  let bytes = 0, downloadedBytes = 0;
  for (const [file, size] of files) {
    bytes += size;
    if (![...before].some((u) => u.includes(modelId) && u.endsWith('/' + file))) downloadedBytes += size;
  }
  return { device, dtype: realDtype, bytes, downloadedBytes, fromCache: downloadedBytes === 0, loadMs: Math.round(performance.now() - t0) };
}

// ImageBitmap → OffscreenCanvas → RawImage；位图用完立即 close
function bitmapToCanvas(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function runMatting(bitmap) {
  const canvas = bitmapToCanvas(bitmap);
  const w = canvas.width, h = canvas.height;
  const t0 = performance.now();
  const temps = []; // 本张产生的所有张量，结束时统一 dispose
  try {
    const { pixel_values } = await processor(RawImage.fromCanvas(canvas).rgb());
    temps.push(pixel_values);
    const out = await model({ [spec.input]: pixel_values });
    temps.push(...Object.values(out));
    const raw = (out[spec.output] ?? Object.values(out)[0])[0]; temps.push(raw);
    const scaled = raw.mul(255); temps.push(scaled);
    const u8 = scaled.to('uint8'); temps.push(u8);
    const mask = await RawImage.fromTensor(u8).resize(w, h);
    const ms = performance.now() - t0;
    // 合成透明图：RGB 来自原图，alpha 来自遮罩
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const ch = mask.channels;
    let sum = 0;
    for (let i = 0; i < w * h; i++) { const a = mask.data[i * ch]; img.data[i * 4 + 3] = a; sum += a; }
    ctx.putImageData(img, 0, 0);
    const cut = await canvas.convertToBlob({ type: 'image/png' });
    const white = new OffscreenCanvas(w, h);
    const wctx = white.getContext('2d');
    wctx.fillStyle = '#fff'; wctx.fillRect(0, 0, w, h); wctx.drawImage(canvas, 0, 0);
    const whiteBlob = await white.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    white.width = 0;
    return { cut, white: whiteBlob, foregroundRatio: +(sum / (255 * w * h)).toFixed(3), ms: Math.round(ms) };
  } finally {
    for (const t of temps) { try { t.dispose(); } catch { /* 已释放 */ } }
    canvas.width = 0;
  }
}

async function runClassify(bitmap) {
  const canvas = bitmapToCanvas(bitmap);
  const t0 = performance.now();
  const temps = [];
  try {
    const inputs = await processor(RawImage.fromCanvas(canvas).rgb());
    temps.push(...Object.values(inputs));
    const out = await model(inputs);
    temps.push(...Object.values(out));
    const normed = out.image_embeds.normalize(); temps.push(normed);
    const embedding = normed.tolist()[0];
    return { embedding, ms: Math.round(performance.now() - t0) };
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
      const r = task === 'matting' ? await runMatting(data.bitmap) : await runClassify(data.bitmap);
      self.postMessage({ id, ok: true, ...r });
    } else if (type === 'dispose') {
      const t0 = performance.now();
      await model?.dispose();
      model = null; processor = null;
      self.postMessage({ id, ok: true, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    data.bitmap?.close?.();
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
