// taxonomy.js 的规则，以及 label-embeddings.json 是否与它一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, leaves, split, seasonsFor, isValidPair, visibleTaxonomy, labelOf } from '../taxonomy.js';
import { SEASONS } from '../options.js';

test('id 唯一，二级 id 以一级 id 开头，季节取值合法', () => {
  const ids = CATEGORIES.flatMap((c) => [c.id, ...c.subs.map((s) => s.id)]);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CATEGORIES) {
    for (const s of c.subs) assert.ok(s.id.startsWith(c.id + '.'), s.id);
    for (const n of [c, ...c.subs]) for (const v of n.seasons ?? []) assert.ok(SEASONS.includes(v), `${n.id} ${v}`);
  }
});

test('打分项：全部内置二级 + 没有二级的一级；每项都有英文 prompt', () => {
  const l = leaves();
  assert.equal(l.length, 32); // 2026-10-16 加卫衣、运动短裤
  assert.ok(l.every((x) => x.en));
  assert.deepEqual(l.filter((x) => !x.subcategoryId).map((x) => x.id), ['set', 'bag', 'accessory', 'hat']);
  assert.deepEqual(split('top.cardigan_layer'), { categoryId: 'top', subcategoryId: 'top.cardigan_layer' });
  assert.deepEqual(split('bag'), { categoryId: 'bag', subcategoryId: null });
});

test('季节规则按用户给的表', () => {
  assert.deepEqual(seasonsFor('top', 'top.casual_tee'), ['夏']);
  assert.deepEqual(seasonsFor('top', 'top.sport_tee'), ['夏']);
  assert.deepEqual(seasonsFor('top', 'top.cardigan_layer'), ['春', '秋']);
  assert.deepEqual(seasonsFor('bottom', 'bottom.jeans'), ['春', '秋', '冬']);
  assert.deepEqual(seasonsFor('outer', 'outer.wool_coat'), ['冬']);
  assert.deepEqual(seasonsFor('skirt', 'skirt.dress'), ['春', '夏', '秋']);
  assert.deepEqual(seasonsFor('shoes', 'shoes.sandals'), ['夏']);
  // 2026-10-16：卫衣；短裤拆成休闲短裤（沿用 bottom.shorts）和运动短裤
  assert.deepEqual(seasonsFor('top', 'top.hoodie'), ['春', '秋']);
  assert.deepEqual(seasonsFor('bottom', 'bottom.shorts'), ['夏']);
  assert.deepEqual(seasonsFor('bottom', 'bottom.sport_shorts'), ['夏']);
  assert.equal(labelOf('bottom.shorts'), '休闲短裤');
  assert.equal(labelOf('bottom.sport_shorts'), '运动短裤');
  assert.equal(labelOf('top.hoodie'), '卫衣');
});

test('isValidPair：有二级的必须选它下面的二级，没有二级的必须为 null', () => {
  assert.equal(isValidPair('top', 'top.shirt'), true);
  assert.equal(isValidPair('top', null), false);
  assert.equal(isValidPair('top', 'bottom.jeans'), false);
  assert.equal(isValidPair('bag', null), true);
  assert.equal(isValidPair('bag', 'top.shirt'), false);
  assert.equal(isValidPair('top.shirt', null), false);
  assert.equal(isValidPair('nope', null), false);
});

test('visibleTaxonomy：内置 + 自建 − 隐藏，改名只改显示名', () => {
  const rows = [
    { id: 'top.tank', hidden: true },
    { id: 'top.shirt', zh: '衬衣' },
    { id: 'u1', parentId: 'top', zh: 'polo', builtin: false },
    { id: 'u2', parentId: null, zh: '泳衣', builtin: false },
  ];
  const v = visibleTaxonomy(rows);
  const top = v.find((c) => c.id === 'top');
  assert.ok(!top.subs.some((s) => s.id === 'top.tank'));
  assert.equal(top.subs.find((s) => s.id === 'top.shirt').zh, '衬衣');
  assert.equal(top.subs.at(-1).id, 'u1');
  assert.equal(v.at(-1).zh, '泳衣');
  assert.equal(top.icon, '👕');
  assert.equal(v.at(-1).icon, '🏷️'); // 自建一级分类用默认图标
  assert.equal(labelOf('top.shirt', rows), '衬衣');
  assert.equal(labelOf('top.shirt'), '衬衫');
});

test('label-embeddings.json 与 taxonomy.js 一致（改了 prompt 要运行 node tools/embed.mjs）', () => {
  const file = JSON.parse(readFileSync(new URL('../label-embeddings.json', import.meta.url)));
  assert.deepEqual(file.labels.map((l) => [l.id, l.en]), leaves().map((l) => [l.id, l.en]));
  assert.equal(file.textDtype, 'fp32');
  for (const l of file.labels) {
    assert.equal(l.embedding.length, 768);
    const norm = Math.hypot(...l.embedding);
    assert.ok(Math.abs(norm - 1) < 1e-3, `${l.id} 范数 ${norm}`);
  }
});

// ---------- 分类管理（4c） ----------
import { allTaxonomy, nameError, newCategoryRow } from '../taxonomy.js';

test('allTaxonomy：含已隐藏的项（hidden 标记）、改名、自建一级的搭配位置', () => {
  const rows = [
    { id: 'top.tank', hidden: true }, { id: 'top', zh: '上装' },
    { id: 'u1', parentId: null, zh: '泳衣', hidden: false, builtin: false, slot: 'onepiece' },
    { id: 'u2', parentId: 'u1', zh: '比基尼', hidden: true, builtin: false },
  ];
  const all = allTaxonomy(rows);
  const top = all.find((c) => c.id === 'top');
  assert.equal(top.zh, '上装');
  assert.equal(top.subs.find((s) => s.id === 'top.tank').hidden, true);
  const swim = all.at(-1);
  assert.deepEqual({ id: swim.id, slot: swim.slot, icon: swim.icon, builtin: swim.builtin }, { id: 'u1', slot: 'onepiece', icon: '🏷️', builtin: false });
  assert.deepEqual(swim.subs.map((s) => [s.id, s.hidden]), [['u2', true]]);
  assert.equal(visibleTaxonomy(rows).at(-1).slot, 'onepiece');
});

test('nameError：同一级下不能和可见分类重名；隐藏的、自己、别的级别不算；空名、过长报错', () => {
  const rows = [{ id: 'top.tank', hidden: true }];
  assert.equal(nameError(rows, 'top', '衬衫'), '已有同名分类');
  assert.equal(nameError(rows, 'top', ' 衬衫 '), '已有同名分类');
  assert.equal(nameError(rows, 'top', '背心'), null); // 背心已隐藏
  assert.equal(nameError(rows, 'top', '衬衫', 'top.shirt'), null); // 改名时排除自己
  assert.equal(nameError(rows, 'bottom', '衬衫'), null);
  assert.equal(nameError(rows, null, '上衣'), '已有同名分类');
  assert.equal(nameError(rows, null, '  '), '请填写名称');
  assert.equal(nameError(rows, null, '一二三四五六七八九十一二三'), '名称最多 12 个字');
});

test('newCategoryRow：一级带搭配位置，二级不带；id 以 u- 开头；放进分类表后 categoryError 认它', () => {
  const t = newCategoryRow({ zh: ' 泳衣 ', slot: 'onepiece' }, 'u-a');
  assert.deepEqual(t, { id: 'u-a', parentId: null, zh: '泳衣', hidden: false, builtin: false, slot: 'onepiece' });
  const s = newCategoryRow({ parentId: 'top', zh: 'Polo' }, 'u-b');
  assert.deepEqual(s, { id: 'u-b', parentId: 'top', zh: 'Polo', hidden: false, builtin: false });
  assert.match(newCategoryRow({ zh: 'x' }).id, /^u-[0-9a-f-]{36}$/);
});
