// 抠图 Worker：模型只在这里加载（做法来自 spike/rmbg-worker.js）。页面每批处理完就刷新，Worker 随页面销毁。
// 消息：init（加载模型）/ run（抠一张，ImageBitmap 以 transfer 方式传入，返回透明 PNG）/ dispose（释放 ONNX session）
// 测试用：init 时 fake 为数字，则不加载模型，每张等待 fake 毫秒后把左上角挖空当作抠图结果
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
let model = null, processor = null, spec = null, RawImage = null, fake = null;

async function init({ modelId, dtype, wasmDtype, input, output, config, fake: f }) {
  spec = { input, output };
  if (typeof f === 'number') { fake = f; return { device: 'fake', dtype: 'fake', loadMs: 0 }; }
  const t = await import(TRANSFORMERS);
  t.env.allowLocalModels = false;
  RawImage = t.RawImage;
  // Worker 里没有 WebGPU 时回退 WASM，并把实际后端报告给主线程
  let device = 'wasm';
  try { if (await navigator.gpu?.requestAdapter()) device = 'webgpu'; } catch { /* 无 */ }
  const realDtype = device === 'webgpu' ? dtype : wasmDtype;
  const t0 = performance.now();
  model = await t.AutoModel.from_pretrained(modelId, { device, dtype: realDtype, ...(config ? { config } : {}) });
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

async function runMatting(bitmap) {
  const canvas = bitmapToCanvas(bitmap);
  const w = canvas.width, h = canvas.height;
  const t0 = performance.now();
  const temps = []; // 本张产生的所有张量，结束时统一 dispose
  try {
    if (fake !== null) return { cutout: await runFake(canvas), ms: Math.round(performance.now() - t0) };
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
    return { cutout, ms: Math.round(performance.now() - t0) };
  } finally {
    for (const t of temps) { try { t.dispose(); } catch { /* 已释放 */ } }
    canvas.width = 0; // iOS 要显式释放 canvas 内存
  }
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') self.postMessage({ id, ok: true, ...(await init(data)) });
    else if (type === 'run') self.postMessage({ id, ok: true, ...(await runMatting(data.bitmap)) });
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
