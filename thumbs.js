// 衣物图片按需加载：进入视口（提前 300 px）才设 src，离开视口就释放 object URL。
// 网格和搭配卡片显示缩略图（长边 THUMB_SIDE，存在 thumbs 表）；没有缩略图时用原图生成并保存。
// 搭配卡片显示合成图（4d）：按 layout.js 把各件缩略图摆进 3:4 画板，缓存为 outfit:<搭配 id>。
// 只省内存，不改衣物记录（Safari 坑：不把读出的 Blob 写回衣物记录）。
import { makeThumb } from './image.js';
import { THUMB_SIDE } from './config.js';
import { SLOTS, slotState } from './outfit.js';
import { LAYOUT_VERSION, resolveLayout, alphaBBox } from './layout.js';

export const OUTFIT_W = 450, OUTFIT_H = 600; // 合成图尺寸（长边约 600）
const BG = '#ffffff';

// 衣物图片指纹：图片换了（以后可能有"换图"功能）缓存就失效
const fingerprint = (item) => `${item.image.size}|${item.image.type}|${item.hasAlpha}`;

// 合成图的 sig：排版规则版本、手动排版、每个槽位的衣物 id、状态和图片指纹。任何一项变了就重新生成
export function outfitSig(outfit, itemsById) {
  return JSON.stringify([LAYOUT_VERSION, outfit.layout ?? null, SLOTS.map((s) => {
    const id = outfit.slots[s.id];
    if (!id) return null;
    const state = slotState(id, itemsById);
    return [id, state, state === 'ok' ? fingerprint(itemsById.get(id)) : null];
  })]);
}

const toBlob = (canvas, type, q) => new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('合成图生成失败'))), type, q));

export function createImageLoader(store) {
  const pending = new Map(); // 键 → 生成中的 Promise，同一项不重复生成
  const shown = new Map(); // img → object URL
  const watched = new Set(); // 正在观察的 img（重新渲染后要停止观察，否则留在内存里）

  const once = (key, fn) => {
    if (!pending.has(key)) pending.set(key, fn().finally(() => pending.delete(key)));
    return pending.get(key);
  };

  async function thumbFor(item) {
    const saved = await store.getThumb(item.id);
    if (saved) return saved;
    return once(item.id, async () => {
      const blob = await makeThumb(item.image, item.hasAlpha, THUMB_SIDE);
      await store.putThumb(item.id, blob);
      return blob;
    });
  }

  // 透明轮廓（0–1）。用缩略图算，结果存 bbox:<id>；不透明图直接是整张图
  async function bboxFor(item, bmp) {
    if (!item.hasAlpha) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    const key = `bbox:${item.id}`, sig = fingerprint(item);
    const saved = await store.getCache(key);
    if (saved?.sig === sig) return saved.bbox;
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const bbox = alphaBBox(ctx.getImageData(0, 0, c.width, c.height));
    c.width = 0;
    await store.putCache(key, { bbox, sig });
    return bbox;
  }

  // 解码搭配里各件的缩略图、取轮廓（已删除、已归档的不画）。用完要 closeParts 释放
  async function loadParts(outfit, itemsById) {
    const parts = [];
    for (const s of SLOTS) {
      const id = outfit.slots[s.id];
      if (slotState(id, itemsById) !== 'ok') continue;
      const item = itemsById.get(id);
      const bmp = await createImageBitmap(await thumbFor(item).catch(() => item.image));
      const bb = await bboxFor(item, bmp);
      const sw = (bb.x1 - bb.x0) * bmp.width, sh = (bb.y1 - bb.y0) * bmp.height;
      parts.push({ slot: s.id, item, bmp, bb, sw, sh, aspect: sw / sh });
    }
    return parts;
  }
  const closeParts = (parts) => { for (const p of parts) p.bmp.close(); };

  // 各件的位置（手动优先，其余自动），带宽高比：{ 槽位: { x, y, w, rotation, z, aspect } }
  const placedOf = (outfit, parts) => {
    const layout = resolveLayout(outfit, Object.fromEntries(parts.map((p) => [p.slot, p.aspect])));
    return Object.fromEntries(parts.map((p) => [p.slot, { ...layout[p.slot], aspect: p.aspect }]));
  };

  // 同步画（拖动时每帧调用）。selected：选中槽位画虚线框
  function paint(ctx, W, H, outfit, parts, selected = null) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const placed = placedOf(outfit, parts);
    for (const p of [...parts].sort((a, b) => placed[a.slot].z - placed[b.slot].z)) {
      const l = placed[p.slot];
      const w = l.w * W, h = w / p.aspect;
      ctx.save();
      ctx.translate(l.x * W, l.y * H);
      if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
      // 没抠图的衣物画成圆角矩形
      if (!p.item.hasAlpha) { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.08); ctx.clip(); }
      ctx.drawImage(p.bmp, p.bb.x0 * p.bmp.width, p.bb.y0 * p.bmp.height, p.sw, p.sh, -w / 2, -h / 2, w, h);
      ctx.restore();
      if (p.slot === selected) {
        ctx.save();
        ctx.translate(l.x * W, l.y * H);
        if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
        ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = '#1f5a8e';
        ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
        ctx.restore();
      }
    }
    return placed;
  }

  // 一次性画完（合成图用）。返回画了几件
  async function drawOutfit(ctx, W, H, outfit, itemsById) {
    const parts = await loadParts(outfit, itemsById);
    try { paint(ctx, W, H, outfit, parts); return parts.length; } finally { closeParts(parts); }
  }

  // 合成图：sig 对得上就用缓存，否则重新画并保存
  async function compositeFor(outfit, itemsById) {
    const key = `outfit:${outfit.id}`, sig = outfitSig(outfit, itemsById);
    const saved = await store.getCache(key);
    if (saved?.sig === sig) return saved.blob;
    return once(`${key}|${sig}`, async () => {
      const c = document.createElement('canvas');
      c.width = OUTFIT_W; c.height = OUTFIT_H;
      try {
        await drawOutfit(c.getContext('2d'), OUTFIT_W, OUTFIT_H, outfit, itemsById);
        const blob = await toBlob(c, 'image/jpeg', 0.85);
        await store.putCache(key, { blob, sig });
        return blob;
      } finally { c.width = 0; }
    });
  }

  const release = (img) => {
    const url = shown.get(img);
    if (url) { URL.revokeObjectURL(url); shown.delete(img); img.removeAttribute('src'); }
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const img = e.target;
      if (!e.isIntersecting) { release(img); continue; }
      if (shown.has(img) || img.dataset.loading) continue;
      img.dataset.loading = '1';
      img._load()
        .then((blob) => {
          delete img.dataset.loading;
          if (!img.isConnected || shown.has(img)) return;
          const url = URL.createObjectURL(blob);
          shown.set(img, url);
          img.src = url;
        }, (err) => { delete img.dataset.loading; console.warn('图片加载失败', err); });
    }
  }, { rootMargin: '300px' });

  const watch = (img, load) => { img._load = load; watched.add(img); io.observe(img); };

  return {
    // 给 img 绑定衣物，进入视口时加载缩略图（生成失败时退回原图）
    observe(img, item) { watch(img, () => thumbFor(item).catch(() => item.image)); },
    // 给 img 绑定搭配，进入视口时加载合成图
    observeOutfit(img, outfit, itemsById) { watch(img, () => compositeFor(outfit, itemsById)); },
    // 编辑弹窗的预览和手动调整（4e）：各件缩略图只解码一次，之后 redraw 同步重画（拖动不卡）。不写缓存。
    // 返回 { count, placed(outfit), redraw(outfit, selected), close() }；换槽位后要 close 再重新创建
    async editor(canvas, outfit, itemsById) {
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth || 240, H = Math.round((W * OUTFIT_H) / OUTFIT_W);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      let parts = await loadParts(outfit, itemsById);
      const redraw = (o, selected = null) => (parts ? paint(ctx, W, H, o, parts, selected) : {});
      redraw(outfit);
      return { count: parts.length, placed: (o) => (parts ? placedOf(o, parts) : {}), redraw, close() { if (parts) closeParts(parts); parts = null; } };
    },
    // 重新渲染后调用：已不在页面上的图片停止观察并释放
    sweep() {
      for (const img of [...watched]) if (!img.isConnected) { io.unobserve(img); watched.delete(img); release(img); }
    },
  };
}
