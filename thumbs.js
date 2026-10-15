// 衣物图片按需加载：进入视口（提前 300 px）才设 src，离开视口就释放 object URL。
// 网格和搭配卡片显示缩略图（长边 THUMB_SIDE，存在 thumbs 表）；没有缩略图时用原图生成并保存。
// 只省内存，不改衣物记录（Safari 坑：不把读出的 Blob 写回衣物记录）。
import { makeThumb } from './image.js';
import { THUMB_SIDE } from './config.js';

export function createImageLoader(store) {
  const pending = new Map(); // itemId → 生成中的 Promise，同一件不重复生成
  const shown = new Map(); // img → object URL
  const watched = new Set(); // 正在观察的 img（重新渲染后要停止观察，否则留在内存里）

  async function thumbFor(item) {
    const saved = await store.getThumb(item.id);
    if (saved) return saved;
    if (!pending.has(item.id)) {
      pending.set(item.id, (async () => {
        const blob = await makeThumb(item.image, item.hasAlpha, THUMB_SIDE);
        await store.putThumb(item.id, blob);
        return blob;
      })().finally(() => pending.delete(item.id)));
    }
    return pending.get(item.id);
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
      thumbFor(img._item)
        .catch(() => img._item.image) // 生成失败（例如图片读不出）时退回原图
        .then((blob) => {
          delete img.dataset.loading;
          if (!img.isConnected || shown.has(img)) return;
          const url = URL.createObjectURL(blob);
          shown.set(img, url);
          img.src = url;
        });
    }
  }, { rootMargin: '300px' });

  return {
    // 给 img 绑定衣物，进入视口时加载
    observe(img, item) { img._item = item; watched.add(img); io.observe(img); },
    // 重新渲染后调用：已不在页面上的图片停止观察并释放
    sweep() {
      for (const img of [...watched]) if (!img.isConnected) { io.unobserve(img); watched.delete(img); release(img); }
    },
  };
}
