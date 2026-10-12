// 模型 Worker：模型只在这里加载（做法来自 spike/rmbg-worker.js）。页面每批处理完就刷新，Worker 随页面销毁。
// 一个 Worker 只做一种任务（task）：matting = 抠图（RMBG），classify = 分类（fashionSigLIP 图像模型）。
// 消息：init（加载模型）/ run（处理一张，ImageBitmap 以 transfer 方式传入）/ dispose（释放 ONNX session）
// 测试用：init 时 fake 为数字，则不加载模型，每张等待 fake 毫秒后返回假结果
import { pickBackend } from './config.js';
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
let task = null, model = null, processor = null, spec = null, RawImage = null, fake = null, labels = null;

// labels：分类用的预计算标签向量 [{ id, embedding }]（label-embeddings.json）
async function init({ task: initTask = 'matting', modelId, dtype, wasmDtype, input, output, config, labels: l, fake: f }) {
  task = initTask; spec = { input, output }; labels = l ?? null;
  if (typeof f === 'number') { fake = f; return { device: 'fake', dtype: 'fake', loadMs: 0 }; }
  const t = await import(TRANSFORMERS);
  t.env.allowLocalModels = false;
  RawImage = t.RawImage;
  // Worker 里没有 WebGPU、或显卡不支持 fp16 时回退 WASM（见 config.js pickBackend），并把实际后端报告给主线程
  const gpu = { webgpu: false, shaderF16: false };
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) { gpu.webgpu = true; gpu.shaderF16 = adapter.features.has('shader-f16'); }
  } catch { /* 无 */ }
  const { device, dtype: realDtype } = pickBackend(gpu, { dtype, wasmDtype });
  const t0 = performance.now();
  const opts = { device, dtype: realDtype, ...(config ? { config } : {}) };
  model = task === 'classify' ? await t.SiglipVisionModel.from_pretrained(modelId, opts) : await t.AutoModel.from_pretrained(modelId, opts);
  processor = await t.AutoProcessor.from_pretrained(modelId);
  return { device, dtype: realDtype, loadMs: Math.round(performance.now() - t0) };
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
  canvas.getContext('2d').clearRect(0, 0, canvas.width / 2, canvas.height / 2);
  return canvas.convertToBlob({ type: 'image/png' });
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
      const cutout = await runFake(canvas);
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
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
