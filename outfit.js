// 搭配：槽位规则和校验（纯函数，node 可测）。存储在 store.js（outfits 表），界面在 app.js。
// 每个槽位放 1 件衣物（存衣物 id）。连衣裙 / 套装填了，上衣和下装可空；没填时必填。其余槽位都可空。
// 衣物删除或归档后，搭配里保留它的 id，界面显示"已删除"/"已归档"，保存前要求重新选择。
import { SCENES } from './options.js';

// accepts：[一级分类, 二级分类（可省略 = 这个一级下全部）]
export const SLOTS = [
  { id: 'outer', zh: '外套', optional: true, accepts: [['outer']] },
  { id: 'top', zh: '上衣', accepts: [['top']] },
  { id: 'onepiece', zh: '连衣裙 / 套装', optional: true, accepts: [['skirt', 'skirt.dress'], ['set']] },
  { id: 'bottom', zh: '下装', accepts: [['bottom'], ['skirt', 'skirt.skirt']] },
  { id: 'shoes', zh: '鞋', optional: true, accepts: [['shoes']] }, // 2026-10-16 用户改为选填
  { id: 'bag', zh: '包', optional: true, accepts: [['bag']] },
  { id: 'accessory', zh: '配饰', optional: true, accepts: [['accessory'], ['hat']] },
];
const SLOT_IDS = SLOTS.map((s) => s.id);
export const getSlot = (id) => SLOTS.find((s) => s.id === id);

// 一级分类 + 二级分类是否能放进这个槽位。自建二级（4c）跟随所属一级：只有不限二级的规则才放行
export function fits(slot, categoryId, subcategoryId) {
  return slot.accepts.some(([c, s]) => c === categoryId && (!s || s === subcategoryId));
}

// 选择器用：这个槽位能选的衣物（不含已归档）
export const itemsForSlot = (slot, items) => items.filter((i) => !i.archived && fits(slot, i.categoryId, i.subcategoryId));

// 选择器左边栏和二级分类行：只留这个槽位能放的一级、二级（taxonomy 是 visibleTaxonomy() 的结果）
export function taxonomyForSlot(slot, taxonomy) {
  return taxonomy.flatMap((c) => {
    const rules = slot.accepts.filter(([cat]) => cat === c.id);
    if (!rules.length) return [];
    if (rules.some(([, s]) => !s)) return [c];
    return [{ ...c, subs: c.subs.filter((s) => rules.some(([, sub]) => sub === s.id)) }];
  });
}

export const emptySlots = () => Object.fromEntries(SLOT_IDS.map((id) => [id, null]));

// 槽位里衣物的状态：null（空）、'ok'、'deleted'、'archived'
export function slotState(id, itemsById) {
  if (!id) return null;
  const item = itemsById.get(id);
  if (!item) return 'deleted';
  return item.archived ? 'archived' : 'ok';
}

// 保存前检查：必填槽位、已删除 / 已归档的衣物。没问题返回 null，否则返回中文提示
export function outfitError(outfit, itemsById) {
  for (const slot of SLOTS) {
    const state = slotState(outfit.slots[slot.id], itemsById);
    if (state === 'deleted') return `${slot.zh}已删除，请重新选择`;
    if (state === 'archived') return `${slot.zh}已归档，请重新选择`;
  }
  const onepiece = !!outfit.slots.onepiece;
  for (const slot of SLOTS) {
    if (slot.optional || outfit.slots[slot.id]) continue;
    if (onepiece && (slot.id === 'top' || slot.id === 'bottom')) continue;
    return `请选择${slot.zh}`;
  }
  return null;
}

// 搭配的季节 = 在场衣物季节的交集；已删除、已归档的不参与。没有在场衣物时返回 []
export function outfitSeasons(outfit, itemsById) {
  const present = Object.values(outfit.slots).filter((id) => slotState(id, itemsById) === 'ok').map((id) => itemsById.get(id));
  if (!present.length) return [];
  return present.map((i) => i.seasons).reduce((acc, s) => acc.filter((x) => s.includes(x)));
}

// 包含这件衣物的搭配
export const outfitsUsing = (itemId, outfits) => outfits.filter((o) => Object.values(o.slots).includes(itemId));

// 结构校验（导入备份、写入数据库前）。缺 scenes 时补 []。返回规范化后的记录，有问题抛出中文错误
export function validateOutfit(o) {
  const errors = [];
  if (typeof o?.id !== 'string' || !o.id) errors.push('缺少 id');
  if (typeof o?.createdAt !== 'number') errors.push('缺少 createdAt');
  if (typeof (o?.name ?? '') !== 'string') errors.push('name 必须是字符串');
  const scenes = o?.scenes ?? [];
  if (!Array.isArray(scenes)) errors.push('scenes 必须是数组');
  else for (const v of scenes) if (!SCENES.includes(v)) errors.push(`scenes 含无效值：${v}`);
  const slots = o?.slots;
  if (!slots || typeof slots !== 'object') errors.push('缺少 slots');
  else {
    for (const k of Object.keys(slots)) if (!SLOT_IDS.includes(k)) errors.push(`未知槽位：${k}`);
    for (const k of SLOT_IDS) if (slots[k] != null && typeof slots[k] !== 'string') errors.push(`槽位 ${k} 必须是衣物 id 或 null`);
  }
  // 手动排版（4e 写入，可选）：{ 槽位: { x, y, w, rotation, z } }，x、y、w 在 0–1
  if (o?.layout != null) {
    if (typeof o.layout !== 'object') errors.push('layout 必须是对象');
    else for (const [k, p] of Object.entries(o.layout)) {
      if (!SLOT_IDS.includes(k)) { errors.push(`layout 含未知槽位：${k}`); continue; }
      const in01 = (v) => typeof v === 'number' && v >= 0 && v <= 1;
      if (!p || !in01(p.x) || !in01(p.y) || !in01(p.w) || !Number.isFinite(p.rotation) || !Number.isFinite(p.z)) errors.push(`layout.${k} 数值无效`);
    }
  }
  if (errors.length) throw new Error(`搭配无效：${errors.join('；')}`);
  return { ...o, name: o.name ?? '', scenes: [...scenes], updatedAt: o.updatedAt ?? o.createdAt, slots: { ...emptySlots(), ...slots } };
}

// 下周穿搭（阶段 5）的计划记录，4b 只做结构校验
export function validatePlan(p) {
  const errors = [];
  if (typeof p?.id !== 'string' || !p.id) errors.push('缺少 id');
  if (typeof p?.createdAt !== 'number') errors.push('缺少 createdAt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p?.date ?? '')) errors.push(`日期格式不对：${p?.date}`);
  if (p?.outfitId != null && typeof p.outfitId !== 'string') errors.push('outfitId 必须是字符串或 null');
  if (errors.length) throw new Error(`计划无效：${errors.join('；')}`);
  return { ...p, outfitId: p.outfitId ?? null };
}
