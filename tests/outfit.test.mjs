// outfit.js：槽位范围、必填规则、已删除 / 已归档、季节推算、结构校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS, getSlot, itemsForSlot, taxonomyForSlot, outfitError, outfitSeasons, outfitsUsing, validateOutfit, validatePlan, emptySlots } from '../outfit.js';
import { visibleTaxonomy } from '../taxonomy.js';

const it = (id, categoryId, subcategoryId, seasons = [], archived = false) => ({ id, categoryId, subcategoryId, seasons, archived });
const ITEMS = [
  it('coat', 'outer', 'outer.trench_coat', ['春', '秋']),
  it('shirt', 'top', 'top.shirt', ['春', '秋']),
  it('dress', 'skirt', 'skirt.dress', ['春', '夏', '秋']),
  it('skirt', 'skirt', 'skirt.skirt', ['春', '夏', '秋']),
  it('jeans', 'bottom', 'bottom.jeans', ['春', '秋', '冬']),
  it('set', 'set', null, ['春', '夏', '秋', '冬']),
  it('shoes', 'shoes', 'shoes.sneakers', ['春', '秋']),
  it('bag', 'bag', null),
  it('hat', 'hat', null, ['春', '夏', '秋', '冬']),
  it('ring', 'accessory', null),
  it('oldshoes', 'shoes', 'shoes.boots', ['冬'], true),
];
const byId = new Map(ITEMS.map((i) => [i.id, i]));
const outfit = (slots) => ({ slots: { ...emptySlots(), ...slots } });
const ids = (slot) => itemsForSlot(getSlot(slot), ITEMS).map((i) => i.id);

test('槽位可选范围：下装 = 裤子 + 半身裙；连衣裙 / 套装；配饰含帽子；不含已归档', () => {
  assert.deepEqual(SLOTS.map((s) => s.id), ['outer', 'top', 'onepiece', 'bottom', 'shoes', 'bag', 'accessory']);
  assert.deepEqual(ids('bottom'), ['skirt', 'jeans']);
  assert.deepEqual(ids('onepiece'), ['dress', 'set']);
  assert.deepEqual(ids('accessory'), ['hat', 'ring']);
  assert.deepEqual(ids('shoes'), ['shoes']);
});

test('选择器分类：下装只有裤子和裙子（裙子下只有半身裙）', () => {
  const t = taxonomyForSlot(getSlot('bottom'), visibleTaxonomy());
  assert.deepEqual(t.map((c) => c.id), ['bottom', 'skirt']);
  assert.deepEqual(t[1].subs.map((s) => s.id), ['skirt.skirt']);
  assert.equal(t[0].subs.length, 7);
});

test('必填：上衣 + 下装（鞋等其余槽位可空）；有连衣裙 / 套装时上衣和下装可空', () => {
  assert.equal(outfitError(outfit({ top: 'shirt', bottom: 'jeans', shoes: 'shoes' }), byId), null);
  assert.equal(outfitError(outfit({ top: 'shirt', shoes: 'shoes' }), byId), '请选择下装');
  assert.equal(outfitError(outfit({ bottom: 'jeans', shoes: 'shoes' }), byId), '请选择上衣');
  assert.equal(outfitError(outfit({ top: 'shirt', bottom: 'jeans' }), byId), null); // 鞋选填（2026-10-16）
  assert.equal(outfitError(outfit({ onepiece: 'dress', shoes: 'shoes' }), byId), null);
  assert.equal(outfitError(outfit({ onepiece: 'set', shoes: 'shoes', outer: 'coat', bag: 'bag', accessory: 'hat' }), byId), null);
  assert.equal(outfitError(outfit({ onepiece: 'dress' }), byId), null);
  assert.equal(outfitError(outfit({ shoes: 'shoes' }), byId), '请选择上衣');
});

test('已删除 / 已归档的衣物：报错，要求重新选择', () => {
  assert.equal(outfitError(outfit({ top: 'shirt', bottom: 'jeans', shoes: 'gone' }), byId), '鞋已删除，请重新选择');
  assert.equal(outfitError(outfit({ top: 'shirt', bottom: 'jeans', shoes: 'oldshoes' }), byId), '鞋已归档，请重新选择');
  assert.equal(outfitError(outfit({ onepiece: 'dress', shoes: 'shoes', bag: 'gone' }), byId), '包已删除，请重新选择');
});

test('季节 = 在场衣物季节的交集，已删除、已归档的不参与', () => {
  assert.deepEqual(outfitSeasons(outfit({ top: 'shirt', bottom: 'jeans', shoes: 'shoes' }), byId), ['春', '秋']);
  assert.deepEqual(outfitSeasons(outfit({ onepiece: 'dress', accessory: 'hat' }), byId), ['春', '夏', '秋']);
  assert.deepEqual(outfitSeasons(outfit({ onepiece: 'dress', shoes: 'oldshoes', bag: 'gone' }), byId), ['春', '夏', '秋']);
  assert.deepEqual(outfitSeasons(outfit({ shoes: 'gone' }), byId), []);
  assert.deepEqual(outfitSeasons(outfit({ top: 'shirt', bag: 'bag' }), byId), []); // 包没填季节 → 交集为空
});

test('outfitsUsing：包含这件衣物的搭配', () => {
  const list = [{ id: 'a', ...outfit({ top: 'shirt', shoes: 'shoes' }) }, { id: 'b', ...outfit({ onepiece: 'dress', shoes: 'shoes' }) }];
  assert.deepEqual(outfitsUsing('shoes', list).map((o) => o.id), ['a', 'b']);
  assert.deepEqual(outfitsUsing('shirt', list).map((o) => o.id), ['a']);
  assert.deepEqual(outfitsUsing('jeans', list), []);
});

test('validateOutfit：缺 scenes 补 []、缺槽位补 null；无效值报错', () => {
  const o = validateOutfit({ id: 'o1', createdAt: 1, slots: { top: 'x' } });
  assert.deepEqual(o.scenes, []);
  assert.equal(o.name, '');
  assert.deepEqual(o.slots, { ...emptySlots(), top: 'x' });
  assert.throws(() => validateOutfit({ id: 'o1', createdAt: 1, slots: { hat: 'x' } }), /未知槽位/);
  assert.throws(() => validateOutfit({ id: 'o1', createdAt: 1, scenes: ['上班'], slots: {} }), /scenes 含无效值/);
  assert.throws(() => validateOutfit({ createdAt: 1, slots: {} }), /缺少 id/);
});

test('validatePlan：日期 YYYY-MM-DD，outfitId 可为 null', () => {
  assert.equal(validatePlan({ id: 'p', createdAt: 1, date: '2026-10-19' }).outfitId, null);
  assert.throws(() => validatePlan({ id: 'p', createdAt: 1, date: '19/10' }), /日期格式/);
});

test('validateOutfit：可选的 layout（4e 手动排版）检查槽位名和数值范围', () => {
  const ok = { x: 0.5, y: 0.3, w: 0.4, rotation: 0, z: 4 };
  assert.deepEqual(validateOutfit({ id: 'o', createdAt: 1, slots: {}, layout: { top: ok } }).layout, { top: ok });
  assert.equal(validateOutfit({ id: 'o', createdAt: 1, slots: {} }).layout, undefined);
  assert.throws(() => validateOutfit({ id: 'o', createdAt: 1, slots: {}, layout: { hat: ok } }), /layout 含未知槽位：hat/);
  assert.throws(() => validateOutfit({ id: 'o', createdAt: 1, slots: {}, layout: { top: { ...ok, x: 1.5 } } }), /layout\.top 数值无效/);
  assert.throws(() => validateOutfit({ id: 'o', createdAt: 1, slots: {}, layout: { top: { ...ok, z: 'a' } } }), /layout\.top 数值无效/);
});

test('自建一级分类按它的搭配位置放进槽位，它下面的自建二级跟着；没选位置的不进任何槽位', () => {
  const rows = [
    { id: 'u-swim', parentId: null, zh: '泳衣', builtin: false, hidden: false, slot: 'onepiece' },
    { id: 'u-bikini', parentId: 'u-swim', zh: '比基尼', builtin: false, hidden: false },
    { id: 'u-misc', parentId: null, zh: '杂物', builtin: false, hidden: false, slot: null },
  ];
  const items = [it('s1', 'u-swim', null), it('s2', 'u-swim', 'u-bikini'), it('m1', 'u-misc', null), ...ITEMS];
  assert.deepEqual(itemsForSlot(getSlot('onepiece'), items, rows).map((i) => i.id), ['s1', 's2', 'dress', 'set']);
  for (const s of SLOTS) assert.ok(!itemsForSlot(s, items, rows).some((i) => i.id === 'm1'), s.id);
  assert.ok(!itemsForSlot(getSlot('onepiece'), items).some((i) => i.id === 's1')); // 不传分类表时不认
  const t = taxonomyForSlot(getSlot('onepiece'), visibleTaxonomy(rows));
  assert.deepEqual(t.map((c) => c.id), ['skirt', 'set', 'u-swim']);
});
