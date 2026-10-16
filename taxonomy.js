// 分类的唯一来源：界面、分类器、季节规则都从这里读。
// id 固定不变（衣物记录只存 id）；改中文名不影响已存数据。
// 改了英文 prompt（en）后必须重新生成标签向量：node tools/embed.mjs
// 有二级分类的一级分类不参与打分；没有二级分类的一级分类（箱包等）自己作为一个打分项。
const SPRING_AUTUMN = ['春', '秋'];

export const CATEGORIES = [
  { id: 'top', icon: '👕', zh: '上衣', subs: [
    // 短袖分两类（用户 2026-10-11 决定）：休闲（T 恤、Polo 衫）和运动（速干面料）。Polo 衫写进休闲短袖的 prompt，否则会被判成衬衫
    { id: 'top.casual_tee', zh: '休闲短袖', en: 'a casual short-sleeve t-shirt or polo shirt', seasons: ['夏'] },
    { id: 'top.sport_tee', zh: '运动短袖', en: 'a short-sleeve athletic sports t-shirt made of technical fabric', seasons: ['夏'] },
    { id: 'top.long_sleeve', zh: '长袖线衣', en: 'a long-sleeve cotton jersey t-shirt', seasons: SPRING_AUTUMN },
    { id: 'top.tank', zh: '背心', en: 'a sleeveless tank top', seasons: ['夏'] },
    { id: 'top.shirt', zh: '衬衫', en: 'a dress shirt or blouse with buttons all the way down the front', seasons: SPRING_AUTUMN },
    { id: 'top.light_sweater', zh: '薄毛衣', en: 'a thin lightweight knit pullover sweater', seasons: SPRING_AUTUMN },
    { id: 'top.heavy_sweater', zh: '厚毛衣', en: 'a thick chunky wool pullover sweater', seasons: ['冬'] },
    // 卫衣（用户 2026-10-16 加）：只算套头款（连帽或圆领，没有拉链）。拉链连帽抓绒衫用户定为"运动服"（样本 IMG_4025、4026），
    // 所以 prompt 强调"套头、无拉链"，运动服的 prompt 写明含拉链连帽款
    { id: 'top.hoodie', zh: '卫衣', en: 'a pullover hoodie or crewneck sweatshirt with no zipper, pulled on over the head', seasons: SPRING_AUTUMN },
    // 外搭：叠穿在外面的针织开衫、罩衫。prompt 强调"针织、开襟、叠穿"，和外套里的夹克、风衣区分
    { id: 'top.cardigan_layer', zh: '外搭', en: 'an open-front knit cardigan or light cover-up worn over a top', seasons: SPRING_AUTUMN },
  ] },
  { id: 'outer', icon: '🧥', zh: '外套', subs: [
    { id: 'outer.trench_coat', zh: '风衣', en: 'a long belted trench coat', seasons: SPRING_AUTUMN },
    { id: 'outer.track_jacket', zh: '运动服', en: 'a full-zip athletic track jacket or zip-up hooded sweatshirt jacket', seasons: SPRING_AUTUMN },
    { id: 'outer.wool_coat', zh: '呢子大衣', en: 'a long wool overcoat', seasons: ['冬'] },
    { id: 'outer.jacket', zh: '夹克', en: 'a short outerwear jacket such as a bomber, denim or leather jacket', seasons: SPRING_AUTUMN },
  ] },
  { id: 'bottom', icon: '👖', zh: '裤子', subs: [
    // 短裤分两类（用户 2026-10-16）：原"短裤"的 id 保留给休闲短裤，已录入的衣物不用迁移
    { id: 'bottom.shorts', zh: '休闲短裤', en: 'a pair of casual shorts such as chino or denim shorts', seasons: ['夏'] },
    { id: 'bottom.sport_shorts', zh: '运动短裤', en: 'a pair of athletic running shorts made of lightweight technical fabric', seasons: ['夏'] },
    { id: 'bottom.jeans', zh: '牛仔裤', en: 'a pair of denim jeans', seasons: ['春', '秋', '冬'] },
    { id: 'bottom.casual', zh: '休闲裤', en: 'a pair of casual chino trousers', seasons: SPRING_AUTUMN },
    { id: 'bottom.dress_pants', zh: '西裤', en: 'a pair of tailored suit trousers', seasons: SPRING_AUTUMN },
    { id: 'bottom.sweatpants', zh: '运动裤', en: 'a pair of jogger sweatpants', seasons: SPRING_AUTUMN },
    { id: 'bottom.leggings', zh: '打底裤', en: 'a pair of tight leggings', seasons: ['春', '秋', '冬'] },
  ] },
  { id: 'skirt', icon: '👗', zh: '裙子', subs: [
    { id: 'skirt.dress', zh: '连衣裙', en: 'a dress', seasons: ['春', '夏', '秋'] },
    { id: 'skirt.skirt', zh: '半身裙', en: 'a skirt', seasons: ['春', '夏', '秋'] },
  ] },
  { id: 'shoes', icon: '👟', zh: '鞋', subs: [
    { id: 'shoes.leather', zh: '皮鞋', en: 'a pair of leather dress shoes', seasons: SPRING_AUTUMN },
    { id: 'shoes.sneakers', zh: '运动鞋', en: 'a pair of athletic running sneakers', seasons: SPRING_AUTUMN },
    { id: 'shoes.skate', zh: '板鞋', en: 'a pair of flat low-top canvas skate shoes', seasons: SPRING_AUTUMN },
    { id: 'shoes.chunky', zh: '老爹鞋', en: 'a pair of chunky dad sneakers', seasons: SPRING_AUTUMN },
    { id: 'shoes.boots', zh: '靴子', en: 'a pair of boots', seasons: ['冬'] },
    { id: 'shoes.sandals', zh: '凉鞋', en: 'a pair of sandals', seasons: ['夏'] },
  ] },
  // 以下暂不设二级分类（用户 2026-10-11 确认）。季节规则没有给出，默认四季，用户可改
  { id: 'set', icon: '🎽', zh: '套装', en: 'a matching two-piece outfit set', seasons: ['春', '夏', '秋', '冬'], subs: [] },
  { id: 'bag', icon: '👜', zh: '箱包', en: 'a bag or handbag', seasons: ['春', '夏', '秋', '冬'], subs: [] },
  { id: 'accessory', icon: '💍', zh: '配饰', en: 'a fashion accessory such as a scarf, belt or jewelry', seasons: ['春', '夏', '秋', '冬'], subs: [] },
  { id: 'hat', icon: '🧢', zh: '帽子', en: 'a hat or cap', seasons: ['春', '夏', '秋', '冬'], subs: [] },
].map((c) => ({ ...c, builtin: true, subs: c.subs.map((s) => ({ ...s, builtin: true, categoryId: c.id })) }));

const byId = new Map();
for (const c of CATEGORIES) { byId.set(c.id, c); for (const s of c.subs) byId.set(s.id, s); }

export const getNode = (id) => byId.get(id) ?? null;

// 分类器打分项：所有内置二级分类 + 没有二级分类的内置一级分类。
// 返回 { id, categoryId, subcategoryId, en }
export function leaves() {
  return CATEGORIES.filter((c) => c.builtin).flatMap((c) => (c.subs.length
    ? c.subs.filter((s) => s.builtin).map((s) => ({ id: s.id, categoryId: c.id, subcategoryId: s.id, en: s.en }))
    : [{ id: c.id, categoryId: c.id, subcategoryId: null, en: c.en }]));
}

// 打分项 id（二级 id 或一级 id）→ { categoryId, subcategoryId }
export function split(id) {
  const node = getNode(id);
  if (!node) return null;
  return node.categoryId ? { categoryId: node.categoryId, subcategoryId: node.id } : { categoryId: node.id, subcategoryId: null };
}

// 默认季节：二级分类优先，没有二级时用一级的
export function seasonsFor(categoryId, subcategoryId = null) {
  return [...((subcategoryId && getNode(subcategoryId)?.seasons) ?? getNode(categoryId)?.seasons ?? [])];
}

// 合法性：一级存在；有二级分类的一级必须选它下面的二级，没有二级的一级二级必须为 null。
// 用户自建分类（阶段 4）由调用方另外放行
export function isValidPair(categoryId, subcategoryId) {
  const c = getNode(categoryId);
  if (!c || c.categoryId) return false;
  if (!c.subs.length) return subcategoryId === null;
  return c.subs.some((s) => s.id === subcategoryId);
}

// 分类校验（含自建分类）。rows：分类表记录（见 visibleTaxonomy）。合法返回 null，否则返回中文错误。
// 内置组合按 isValidPair；自建一级（parentId 为 null）可以不选二级；自建二级的 parentId 必须是所选一级
export function categoryError({ categoryId, subcategoryId }, rows = []) {
  if (isValidPair(categoryId, subcategoryId)) return null;
  const custom = new Map(rows.filter((r) => r.builtin === false).map((r) => [r.id, r]));
  const builtinTop = getNode(categoryId) && !getNode(categoryId).categoryId;
  const customTop = custom.get(categoryId) && !custom.get(categoryId).parentId;
  if (!builtinTop && !customTop) return `分类无效：一级分类 ${categoryId} 不存在`;
  if (subcategoryId === null || subcategoryId === undefined) return customTop ? null : `分类无效：${categoryId} 需要选二级分类`;
  if (custom.get(subcategoryId)?.parentId === categoryId) return null;
  return `分类无效：二级分类 ${subcategoryId} 不存在或不属于 ${categoryId}`;
}

// 自建一级分类的图标（阶段 4c 可能允许自选）
export const CUSTOM_ICON = '🏷️';

// 界面显示的分类 = 内置 + 用户自建 − 隐藏，并应用改名。
// rows：IndexedDB categories 仓库的记录 { id, parentId|null, zh, hidden, builtin: false } 或对内置的 { id, zh?, hidden? }
export function visibleTaxonomy(rows = []) {
  const over = new Map(rows.map((r) => [r.id, r]));
  const name = (n) => over.get(n.id)?.zh ?? n.zh;
  const shown = (n) => !over.get(n.id)?.hidden;
  const custom = rows.filter((r) => r.builtin === false && !r.hidden);
  return [
    ...CATEGORIES.filter(shown).map((c) => ({
      id: c.id, icon: c.icon, zh: name(c), builtin: true,
      subs: [...c.subs.filter(shown).map((s) => ({ id: s.id, zh: name(s), builtin: true })),
        ...custom.filter((r) => r.parentId === c.id).map((r) => ({ id: r.id, zh: r.zh, builtin: false }))],
    })),
    ...custom.filter((r) => !r.parentId).map((r) => ({
      id: r.id, icon: CUSTOM_ICON, zh: r.zh, builtin: false,
      subs: custom.filter((s) => s.parentId === r.id).map((s) => ({ id: s.id, zh: s.zh, builtin: false })),
    })),
  ];
}

// 显示名（含用户改名）。找不到时返回 id，方便发现问题
export function labelOf(id, rows = []) {
  return rows.find((r) => r.id === id)?.zh ?? getNode(id)?.zh ?? id;
}
