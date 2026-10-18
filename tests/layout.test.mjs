// layout.js：自动排版（越界、遮挡、上下顺序、层次）、手动排版优先、透明轮廓
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout, resolveLayout, boxOf, alphaBBox, REGIONS } from '../layout.js';

// 典型宽高比：上衣、外套偏宽，裤子、连衣裙偏高，鞋很扁
const A = { outer: 0.9, top: 1.1, onepiece: 0.55, bottom: 0.5, shoes: 2.2, bag: 1, accessory: 1 };
const pick = (...slots) => Object.fromEntries(slots.map((s) => [s, A[s]]));
const COMBOS = {
  '上衣 + 下装 + 鞋': pick('top', 'bottom', 'shoes'),
  '外套 + 上衣 + 下装 + 鞋 + 包': pick('outer', 'top', 'bottom', 'shoes', 'bag'),
  '连衣裙 + 鞋': pick('onepiece', 'shoes'),
  '连衣裙 + 上衣 + 打底': pick('onepiece', 'top', 'bottom'),
  '全部 7 件': pick(...Object.keys(REGIONS)),
};
const boxes = (aspects) => Object.fromEntries(Object.entries(autoLayout(aspects)).map(([s, p]) => [s, { ...boxOf(p, aspects[s]), z: p.z, p }]));
const EPS = 1e-9;
const inside = (a, b) => a.x0 >= b.x0 - EPS && a.x1 <= b.x1 + EPS && a.y0 >= b.y0 - EPS && a.y1 <= b.y1 + EPS;

test('每种组合：每件都在画板内，且在自己的区域内', () => {
  for (const [name, aspects] of Object.entries(COMBOS)) {
    for (const [slot, b] of Object.entries(boxes(aspects))) {
      assert.ok(inside(b, { x0: 0, x1: 1, y0: 0, y1: 1 }), `${name}：${slot} 越出画板`);
      const [x0, x1, y0, y1] = REGIONS[slot].box;
      const region = slot === 'top' && !aspects.outer ? { x0: 0.2, x1: 0.74, y0, y1 } : { x0, x1, y0, y1 };
      assert.ok(inside(b, region), `${name}：${slot} 越出区域`);
    }
  }
});

test('主要衣物（外套、上衣、连衣裙、下装、鞋）互相不完全遮挡：前面的不会整个盖住后面的', () => {
  const main = ['outer', 'top', 'onepiece', 'bottom', 'shoes'];
  for (const [name, aspects] of Object.entries(COMBOS)) {
    const b = boxes(aspects);
    for (const s of main) for (const t of main) {
      if (s === t || !b[s] || !b[t] || b[t].z <= b[s].z) continue;
      assert.ok(!inside(b[s], b[t]), `${name}：${s} 被 ${t} 完全挡住`);
    }
  }
});

test('上下顺序：上衣在下装上方，下装在鞋上方，连衣裙在鞋上方', () => {
  for (const [name, aspects] of Object.entries(COMBOS)) {
    const b = boxes(aspects);
    if (b.top && b.bottom) assert.ok(b.top.p.y < b.bottom.p.y, name);
    if (b.bottom && b.shoes) assert.ok(b.bottom.p.y < b.shoes.p.y, name);
    if (b.onepiece && b.shoes) assert.ok(b.onepiece.p.y < b.shoes.p.y, name);
    if (b.top && b.shoes) assert.ok(b.bottom ? true : b.top.p.y < b.shoes.p.y, name);
  }
});

test('层次：外套在上衣后面且偏左；上衣盖住裤腰；连衣裙上的上衣在前、打底在后', () => {
  const b = boxes(COMBOS['外套 + 上衣 + 下装 + 鞋 + 包']);
  assert.ok(b.outer.z < b.top.z);
  assert.ok(b.outer.p.x < b.top.p.x);
  assert.ok(b.top.z > b.bottom.z);
  const d = boxes(COMBOS['连衣裙 + 上衣 + 打底']);
  assert.ok(d.top.z > d.onepiece.z && d.bottom.z < d.onepiece.z);
});

test('没有外套时上衣居中；保持宽高比', () => {
  const b = boxes(COMBOS['上衣 + 下装 + 鞋']);
  assert.ok(Math.abs(b.top.p.x - 0.47) < 1e-9);
  const t = b.top;
  assert.ok(Math.abs(((t.x1 - t.x0) * 3) / ((t.y1 - t.y0) * 4) - A.top) < 1e-9);
});

test('有手动排版（outfit.layout）的槽位优先用它，其余自动', () => {
  const manual = { x: 0.3, y: 0.3, w: 0.2, rotation: 15, z: 9 };
  const l = resolveLayout({ layout: { top: manual } }, pick('top', 'bottom'));
  assert.deepEqual(l.top, manual);
  assert.deepEqual(l.bottom, autoLayout(pick('top', 'bottom')).bottom);
});

// 构造 w×h 的 RGBA 像素：rect 范围内 alpha = 255，其余 alpha = a0
function pixels(w, h, rect, a0 = 0) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const on = rect && x >= rect[0] && x < rect[1] && y >= rect[2] && y < rect[3];
    data[(y * w + x) * 4 + 3] = on ? 255 : a0;
  }
  return { width: w, height: h, data };
}

test('alphaBBox：裁掉透明边；阈值以下的半透明不算；全透明或不透明返回整张图', () => {
  assert.deepEqual(alphaBBox(pixels(100, 50, [20, 60, 10, 40])), { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.8 });
  assert.deepEqual(alphaBBox(pixels(100, 50, [20, 60, 10, 40], 10)), { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.8 });
  assert.deepEqual(alphaBBox(pixels(10, 10, null)), { x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.deepEqual(alphaBBox(pixels(10, 10, null, 255)), { x0: 0, y0: 0, x1: 1, y1: 1 });
});

// ---------- 手动调整（4e） ----------
import { hitTest, clampPlacement, moveBy, setSize, setRotation, shiftLayer, resetSlot } from '../layout.js';
const P = (x, y, w, z, aspect = 1, rotation = 0) => ({ x, y, w, z, aspect, rotation });

test('hitTest：重叠时取上层；空白处返回 null；考虑旋转', () => {
  const placed = { top: P(0.5, 0.3, 0.4, 4), outer: P(0.4, 0.3, 0.4, 1), shoes: P(0.5, 0.9, 0.3, 5, 3) };
  assert.equal(hitTest(placed, 0.5, 0.3), 'top');
  assert.equal(hitTest(placed, 0.24, 0.3), 'outer'); // 只在外套范围内
  assert.equal(hitTest(placed, 0.05, 0.6), null);
  // 细长条（宽 0.4、高很小）转 90° 后，竖直方向能点中、水平方向点不中
  const bar = { bar: P(0.5, 0.5, 0.4, 1, 8, 90) };
  assert.equal(hitTest(bar, 0.5, 0.62), 'bar');
  assert.equal(hitTest(bar, 0.65, 0.5), null);
});

test('clampPlacement：中心点在画板内，宽 0.08–1，角度 −180–180', () => {
  assert.deepEqual(clampPlacement({ x: 1.4, y: -0.2, w: 2, rotation: 200, z: 3 }), { x: 1, y: 0, w: 1, rotation: -160, z: 3 });
  assert.deepEqual(clampPlacement({ x: 0.5, y: 0.5, w: 0.01, rotation: -190, z: 1 }), { x: 0.5, y: 0.5, w: 0.08, rotation: 170, z: 1 });
  assert.deepEqual(moveBy(P(0.9, 0.5, 0.3, 2), 0.5, 0), { x: 1, y: 0.5, w: 0.3, rotation: 0, z: 2 });
  assert.equal(setSize(P(0.5, 0.5, 0.3, 2), 0.6).w, 0.6);
  assert.equal(setRotation(P(0.5, 0.5, 0.3, 2), 30).rotation, 30);
});

test('shiftLayer：和相邻的一件交换 z；已在最前 / 最后不变；z 相同时也能分开', () => {
  const placed = { outer: P(0.4, 0.3, 0.4, 1), bottom: P(0.5, 0.6, 0.4, 2), top: P(0.5, 0.3, 0.4, 4) };
  const r = shiftLayer(placed, 'outer', 1);
  assert.deepEqual([r.outer.z, r.bottom.z], [2, 1]);
  assert.deepEqual(shiftLayer(placed, 'top', 1), {});
  assert.deepEqual(shiftLayer(placed, 'outer', -1), {});
  const same = shiftLayer({ a: P(0.5, 0.5, 0.3, 2), b: P(0.5, 0.5, 0.3, 2) }, 'a', 1);
  assert.ok(same.a.z !== same.b.z);
});

test('resetSlot：去掉一个槽位；全去掉返回 undefined', () => {
  const l = { top: { x: 0.5, y: 0.3, w: 0.4, rotation: 0, z: 4 }, bottom: { x: 0.5, y: 0.6, w: 0.4, rotation: 0, z: 2 } };
  assert.deepEqual(Object.keys(resetSlot(l, 'top')), ['bottom']);
  assert.equal(resetSlot({ top: l.top }, 'top'), undefined);
  assert.equal(resetSlot(undefined, 'top'), undefined);
});
