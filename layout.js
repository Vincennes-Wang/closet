// 搭配自动排版（纯函数，node 可测）。画板宽 : 高 = 3 : 4，坐标都是 0–1（x 相对宽，y 相对高）。
// 每件衣物的位置 { x, y, w, rotation, z }：x、y 是中心点，w 是宽（相对画板宽），高度按衣物轮廓的宽高比算；
// rotation 4d 一律 0（给 4e 手动调整留着）；z 越大越靠前。
// 改了下面的区域表，把 LAYOUT_VERSION 加 1：所有搭配的合成图会重新生成。

export const LAYOUT_VERSION = 1;
export const CANVAS_RATIO = 3 / 4; // 宽 / 高

// 槽位区域 [x0, x1, y0, y1] 和层次 z。外套偏左、在上衣后面；上衣下摆盖住裤腰；包和配饰在右侧
export const REGIONS = {
  accessory: { box: [0.74, 0.98, 0.04, 0.28], z: 7 },
  outer: { box: [0.06, 0.60, 0.03, 0.48], z: 1 },
  top: { box: [0.24, 0.76, 0.05, 0.44], z: 4 },
  onepiece: { box: [0.20, 0.74, 0.05, 0.80], z: 3 },
  bottom: { box: [0.24, 0.72, 0.40, 0.82], z: 2 },
  bag: { box: [0.72, 0.98, 0.38, 0.66], z: 6 },
  shoes: { box: [0.26, 0.70, 0.83, 0.98], z: 5 },
};
// 没有外套时上衣居中
const TOP_ALONE = [0.20, 0.74, 0.05, 0.44];

// 把宽高比为 aspect（像素宽 / 像素高）的衣物放进区域：保持宽高比、尽量大、居中
function fit([x0, x1, y0, y1], aspect, z) {
  const rw = (x1 - x0) * CANVAS_RATIO, rh = y1 - y0; // 换成同一单位（画板高 = 1）
  const wUnits = Math.min(rw, rh * aspect);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: wUnits / CANVAS_RATIO, rotation: 0, z };
}

// aspects：{ 槽位: 宽高比 }，只含有衣物（且要画出来）的槽位。
// 连衣裙 / 套装和上衣、下装同时存在时：上衣当披在外面的一层（z 在连衣裙前），下装当打底（z 在连衣裙后），区域不变
export function autoLayout(aspects) {
  const out = {};
  for (const [slot, aspect] of Object.entries(aspects)) {
    const r = REGIONS[slot];
    if (!r || !(aspect > 0)) continue;
    const box = slot === 'top' && !('outer' in aspects) ? TOP_ALONE : r.box;
    out[slot] = fit(box, aspect, r.z);
  }
  return out;
}

// 有手动排版（outfit.layout，4e 写入）的槽位用它，其余自动
export function resolveLayout(outfit, aspects) {
  const auto = autoLayout(aspects);
  for (const slot of Object.keys(auto)) if (outfit.layout?.[slot]) auto[slot] = { ...outfit.layout[slot] };
  return auto;
}

// 位置 → 外接框（0–1），用来画图和测试越界、遮挡。旋转 4d 不考虑
export function boxOf(p, aspect) {
  const h = (p.w * CANVAS_RATIO) / aspect;
  return { x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y - h / 2, y1: p.y + h / 2 };
}

// 透明轮廓：alpha 大于 threshold 的像素范围，返回 0–1 的 { x0, y0, x1, y1 }。
// image：{ width, height, data }（ImageData 或同结构）。全透明时返回整张图
export function alphaBBox({ width, height, data }, threshold = 16) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height };
}
