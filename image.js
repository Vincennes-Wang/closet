// 图片处理：缩图、透明检测、编码。只在主线程运行。
export const MAX_SIDE = 1024;

// 不解码全尺寸原图：先用 <img> 读尺寸（onload 不触发全图解码），再让 createImageBitmap 直接输出长边 1024 的位图
// （做法来自 spike/index.html downscaleBitmap）
export async function downscaleBitmap(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('读取图片失败')); img.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, MAX_SIDE / Math.max(w, h));
    return await createImageBitmap(blob, { resizeWidth: Math.round(w * s), resizeHeight: Math.round(h * s), resizeQuality: 'high', imageOrientation: 'from-image' });
  } finally { URL.revokeObjectURL(url); }
}

// 有任一像素 alpha < 255 即视为有透明区域
export function hasTransparency(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

const toBlob = (canvas, type, quality) => new Promise((ok) => canvas.toBlob(ok, type, quality));

// 检测浏览器能否输出带透明的 WebP：编码半透明小图，确认类型是 WebP 且解码后 alpha 还在
let webpProbe;
export function probeWebpAlpha() {
  webpProbe ??= (async () => {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(255,0,0,0.5)'; ctx.fillRect(0, 0, 1, 2);
    const blob = await toBlob(c, 'image/webp', 0.9);
    const result = { outputType: blob?.type ?? null, alphaKept: false };
    if (blob?.type === 'image/webp') {
      const bmp = await createImageBitmap(blob);
      const d = document.createElement('canvas'); d.width = d.height = 2;
      const dctx = d.getContext('2d'); dctx.drawImage(bmp, 0, 0); bmp.close();
      const [, , , a0] = dctx.getImageData(0, 0, 1, 1).data;
      const [, , , a1] = dctx.getImageData(1, 0, 1, 1).data;
      result.alphaKept = a0 > 0 && a0 < 255 && a1 === 0;
    }
    result.ok = result.alphaKept;
    return result;
  })();
  return webpProbe;
}

// 文件 → { blob, hasAlpha, width, height }。透明图存 WebP（不支持时 PNG），不透明图存 JPEG
export async function prepareImage(file) {
  const bmp = await downscaleBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  try {
    const hasAlpha = hasTransparency(ctx, canvas.width, canvas.height);
    const type = hasAlpha ? ((await probeWebpAlpha()).ok ? 'image/webp' : 'image/png') : 'image/jpeg';
    const blob = await toBlob(canvas, type, 0.9);
    if (!blob) throw new Error('图片编码失败');
    return { blob, hasAlpha, width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = 0; // iOS 要显式释放 canvas 内存
  }
}
