// store.js 纯函数的单元测试（不需要 IndexedDB）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newItem, applyPatch, validate, groupByCategory } from '../store.js';

const base = { image: new Blob(['x']), hasAlpha: true, categoryId: 'top', subcategoryId: 'top.shirt', seasons: ['夏'], scenes: ['通勤'] };

test('newItem 补默认值、去空格，只保留规定字段', () => {
  const item = newItem({ ...base, name: ' 白T ', price: 99, material: '棉' }, { id: 'a', now: 1 });
  assert.deepEqual(Object.keys(item).sort(),
    ['archived', 'categoryId', 'color', 'createdAt', 'hasAlpha', 'id', 'image', 'name', 'scenes', 'seasons', 'subcategoryId']);
  assert.equal(item.name, '白T');
  assert.equal(item.subcategoryId, 'top.shirt');
  assert.equal(item.archived, false);
  assert.equal(item.createdAt, 1);
});

test('newItem 默认生成 UUID', () => {
  assert.match(newItem(base).id, /^[0-9a-f-]{36}$/);
});

test('validate 拒绝无效分类、季节、场景和缺图', () => {
  assert.throws(() => newItem({ ...base, categoryId: '泳衣' }), /分类无效/);
  assert.throws(() => newItem({ ...base, subcategoryId: 'bottom.jeans' }), /分类无效/);
  assert.throws(() => newItem({ ...base, subcategoryId: null }), /分类无效/);
  assert.equal(newItem({ ...base, categoryId: 'bag', subcategoryId: null }).subcategoryId, null);
  assert.throws(() => newItem({ ...base, seasons: ['雨季'] }), /seasons 含无效值/);
  assert.throws(() => newItem({ ...base, scenes: '通勤' }), /scenes 必须是数组/);
  assert.throws(() => newItem({ ...base, image: null }), /缺少 image/);
  assert.throws(() => newItem({ ...base, hasAlpha: undefined }), /hasAlpha/);
});

test('applyPatch 只改可编辑字段，不改 id、createdAt、image', () => {
  const item = newItem(base, { id: 'a', now: 1 });
  const next = applyPatch(item, { id: 'b', createdAt: 2, image: null, hasAlpha: false, color: ' 藏青 ', seasons: ['春', '秋'], archived: true });
  assert.equal(next.id, 'a');
  assert.equal(next.createdAt, 1);
  assert.equal(next.image, item.image);
  assert.equal(next.hasAlpha, true);
  assert.equal(next.color, '藏青');
  assert.deepEqual(next.seasons, ['春', '秋']);
  assert.equal(next.archived, true);
  assert.equal(item.archived, false, '原对象不变');
  assert.throws(() => applyPatch(item, { categoryId: '' }), /分类无效/);
  assert.equal(applyPatch(item, { categoryId: 'bottom', subcategoryId: 'bottom.jeans' }).subcategoryId, 'bottom.jeans');
});

test('groupByCategory 按分类顺序分组，组内新的在前，空组省略', () => {
  const mk = (categoryId, subcategoryId, now) => newItem({ ...base, categoryId, subcategoryId }, { id: `${categoryId}${now}`, now });
  const groups = groupByCategory([mk('shoes', 'shoes.boots', 1), mk('top', 'top.shirt', 1), mk('top', 'top.tank', 3), mk('top', 'top.shirt', 2)]);
  assert.deepEqual(groups.map((g) => g.categoryId), ['top', 'shoes']);
  assert.deepEqual(groups[0].items.map((i) => i.createdAt), [3, 2, 1]);
});

test('validate 原样返回合法记录', () => {
  const item = newItem(base);
  assert.equal(validate(item), item);
});
