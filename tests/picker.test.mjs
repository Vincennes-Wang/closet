// picker.js 的筛选纯函数：一级 + 二级 + 季节 + 场景的组合、件数、归档排除、URL hash
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterItems, countByCategory, parseFilter, filterToHash, hasFilter, emptyFilter } from '../picker.js';
import { visibleTaxonomy } from '../taxonomy.js';

const T = visibleTaxonomy();
const it = (id, categoryId, subcategoryId, seasons, scenes, createdAt, archived = false) =>
  ({ id, categoryId, subcategoryId, seasons, scenes, createdAt, archived });
const ITEMS = [
  it('shirt', 'top', 'top.shirt', ['春', '秋'], ['通勤'], 1),
  it('tee', 'top', 'top.casual_tee', ['夏'], ['休闲'], 2),
  it('sweater', 'top', 'top.heavy_sweater', ['冬'], ['通勤', '休闲'], 3),
  it('jeans', 'bottom', 'bottom.jeans', ['春', '秋', '冬'], ['休闲'], 4),
  it('bag', 'bag', null, [], [], 5),
  it('oldtee', 'top', 'top.casual_tee', ['夏'], ['休闲'], 6, true),
];
const ids = (f) => filterItems(ITEMS, { ...emptyFilter(), ...f }, T).map((i) => i.id);

test('没有筛选：全部未归档衣物，按分类顺序、同类新的在前', () => {
  assert.deepEqual(ids({}), ['sweater', 'tee', 'shirt', 'jeans', 'bag']);
});

test('一级、二级分类', () => {
  assert.deepEqual(ids({ categoryId: 'top' }), ['sweater', 'tee', 'shirt']);
  assert.deepEqual(ids({ categoryId: 'top', subcategoryId: 'top.casual_tee' }), ['tee']); // 已归档的 oldtee 不出现
  assert.deepEqual(ids({ categoryId: 'skirt' }), []);
});

test('季节、场景：组内"或"', () => {
  assert.deepEqual(ids({ seasons: ['夏', '冬'] }), ['sweater', 'tee', 'jeans']);
  assert.deepEqual(ids({ scenes: ['通勤'] }), ['sweater', 'shirt']);
});

test('不同组之间"且"：一级 + 季节 + 场景', () => {
  assert.deepEqual(ids({ seasons: ['冬'], scenes: ['休闲'] }), ['sweater', 'jeans']);
  assert.deepEqual(ids({ categoryId: 'top', seasons: ['春', '冬'], scenes: ['通勤'] }), ['sweater', 'shirt']);
  assert.deepEqual(ids({ categoryId: 'top', subcategoryId: 'top.shirt', seasons: ['夏'] }), []);
  assert.deepEqual(ids({ categoryId: 'bottom', scenes: ['通勤'] }), []);
});

test('没填季节的衣物：选了季节筛选时不显示', () => {
  assert.ok(!ids({ seasons: ['春', '夏', '秋', '冬'] }).includes('bag'));
});

test('件数：不计已归档，只按一级分类', () => {
  assert.deepEqual(countByCategory(ITEMS), { all: 5, top: 3, bottom: 1, bag: 1 });
});

test('URL hash 往返；不存在的分类、二级、季节、场景丢掉', () => {
  const f = { categoryId: 'top', subcategoryId: 'top.shirt', seasons: ['春', '夏'], scenes: ['通勤'] };
  assert.deepEqual(parseFilter(filterToHash(f), T), f);
  assert.equal(filterToHash(emptyFilter()), '');
  assert.deepEqual(parseFilter('', T), emptyFilter());
  assert.deepEqual(parseFilter('#c=swim&sub=top.shirt&season=夏,雨季&scene=x', T), { ...emptyFilter(), seasons: ['夏'] });
  assert.equal(parseFilter('#c=bottom&sub=top.shirt', T).subcategoryId, null); // 二级不属于该一级
  assert.equal(parseFilter('#c=top', visibleTaxonomy([{ id: 'top', hidden: true }])).categoryId, null); // 已隐藏
});

test('hasFilter：只看二级、季节、场景（一级分类是导航，不算筛选）', () => {
  assert.equal(hasFilter({ ...emptyFilter(), categoryId: 'top' }), false);
  assert.equal(hasFilter({ ...emptyFilter(), scenes: ['通勤'] }), true);
});
