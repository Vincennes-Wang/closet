// 备份：导出 / 导入一个 ZIP（只存储、不压缩，自己写，不加依赖）。格式见 CLAUDE.md"备份"。
// ZIP 内：manifest.json（衣物记录、分类表，图片字段写成 ZIP 内文件名）+ images/<id>.<扩展名>（图片原始字节）
import { validate } from './store.js';

export const FORMAT_VERSION = 1;
const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));
// 衣物记录导出的字段（store.js newItem 的全部字段）。改了衣物字段要同时改这里，并把 FORMAT_VERSION 加 1
const FIELDS = ['id', 'createdAt', 'hasAlpha', 'name', 'categoryId', 'subcategoryId', 'seasons', 'scenes', 'color', 'archived'];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// DOS 格式的时间和日期（ZIP 文件头用），本地时间
const dosTime = (d) => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = (d) => ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

function header(size, fill) {
  const buf = new ArrayBuffer(size);
  fill(new DataView(buf));
  return buf;
}

// entries：[{ name, blob }]。每个文件读一次算 CRC，拼接时放原始 Blob（不转 base64、不拼大字符串），
// 同一时间只有一个文件的字节在内存里
export async function makeZip(entries, date = new Date()) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, blob } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;
    // 通用位 11：文件名是 UTF-8
    const common = (v, at) => {
      v.setUint16(at, 20, true); v.setUint16(at + 2, 0x0800, true); v.setUint16(at + 4, 0, true); // 需要的版本、标志、method 0（存储）
      v.setUint16(at + 6, dosTime(date), true); v.setUint16(at + 8, dosDate(date), true);
      v.setUint32(at + 10, crc, true); v.setUint32(at + 14, size, true); v.setUint32(at + 18, size, true);
      v.setUint16(at + 22, nameBytes.length, true); v.setUint16(at + 24, 0, true); // 文件名长度、扩展字段长度
    };
    parts.push(header(30, (v) => { v.setUint32(0, 0x04034b50, true); common(v, 4); }), nameBytes, blob);
    central.push(header(46, (v) => {
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); common(v, 6);
      v.setUint16(32, 0, true); v.setUint16(34, 0, true); v.setUint16(36, 0, true); // 注释长度、磁盘号、内部属性
      v.setUint32(38, 0, true); v.setUint32(42, offset, true); // 外部属性、本地文件头位置
    }), nameBytes);
    offset += 30 + nameBytes.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true); v.setUint16(4, 0, true); v.setUint16(6, 0, true);
    v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true);
    v.setUint32(12, cdSize, true); v.setUint32(16, offset, true); v.setUint16(20, 0, true);
  });
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

const BAD = '不是有效的备份文件';
const view = async (blob, start, len) => {
  if (start < 0 || start + len > blob.size) throw new Error(BAD);
  return new DataView(await blob.slice(start, start + len).arrayBuffer());
};

// 读 ZIP：从结尾记录找中央目录，用 slice 取每个文件（不把整个 ZIP 读进内存），每个文件都校验 CRC32。
// 返回 Map（文件名 → Blob），顺序同 ZIP 内
export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 22 + 65535);
  const tail = await view(blob, blob.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(BAD);
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOffset = tail.getUint32(eocd + 16, true);
  const cd = await view(blob, cdOffset, cdSize);
  const dec = new TextDecoder();
  const files = new Map();
  for (let i = 0, p = 0; i < count; i++) {
    if (p + 46 > cdSize || cd.getUint32(p, true) !== 0x02014b50) throw new Error(BAD);
    const method = cd.getUint16(p + 10, true), crc = cd.getUint32(p + 16, true), size = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
    const local = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    if (method !== 0) throw new Error(`备份文件被压缩过（${name}），请用应用导出的原文件`);
    const lh = await view(blob, local, 30);
    if (lh.getUint32(0, true) !== 0x04034b50) throw new Error(BAD);
    const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + size > blob.size) throw new Error(BAD);
    const data = blob.slice(start, start + size);
    if (crc32(new Uint8Array(await data.arrayBuffer())) !== crc) throw new Error(`备份文件损坏：${name} 校验失败`);
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const pad = (n) => String(n).padStart(2, '0');
export const backupFilename = (d = new Date()) => `closet-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`;

// 导出：全部衣物（含已归档）+ 分类表。不导出待确认照片（queue）和本设备设置（meta）
export async function buildBackup(store, { now = new Date(), appVersion = '' } = {}) {
  const { items, categories } = await store.exportData();
  items.sort((a, b) => a.createdAt - b.createdAt);
  const images = items.map((it) => ({ name: `images/${it.id}.${EXT[it.image.type] ?? 'bin'}`, blob: it.image }));
  const manifest = {
    formatVersion: FORMAT_VERSION, exportedAt: now.toISOString(), appVersion, dbVersion: store.dbVersion,
    itemCount: items.length,
    items: items.map((it, i) => ({ ...Object.fromEntries(FIELDS.map((k) => [k, it[k]])), image: images[i].name })),
    categories,
  };
  const blob = await makeZip([{ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 1)], { type: 'application/json' }) }, ...images], now);
  return { blob, filename: backupFilename(now), count: items.length };
}

// 导入前的全部校验：版本、每件衣物的字段和分类、每张图片（存在、CRC 正确）。
// 有任何问题就抛出中文错误，调用方不写数据库。图片复制成新 Blob（Safari：写入的 Blob 不能来自别的存储）
export async function parseBackup(file) {
  const files = await readZip(file);
  const mf = files.get('manifest.json');
  if (!mf) throw new Error('备份里没有 manifest.json');
  let manifest;
  try { manifest = JSON.parse(await mf.text()); } catch { throw new Error('manifest.json 读不出来'); }
  if (manifest.formatVersion !== FORMAT_VERSION) throw new Error(`不认识的备份版本：${manifest.formatVersion}`);
  const categories = manifest.categories;
  if (!Array.isArray(manifest.items) || !Array.isArray(categories)) throw new Error('manifest.json 缺少衣物或分类');
  if (manifest.itemCount !== manifest.items.length) throw new Error(`衣物数量不一致：${manifest.itemCount} / ${manifest.items.length}`);
  const items = [];
  for (const [i, m] of manifest.items.entries()) {
    const where = `第 ${i + 1} 件衣物`;
    const data = files.get(m.image);
    if (!data) throw new Error(`${where}缺少图片 ${m.image}`);
    const type = TYPE[String(m.image).split('.').pop()];
    if (!type) throw new Error(`${where}图片格式不认识：${m.image}`);
    if (typeof m.id !== 'string' || !m.id || typeof m.createdAt !== 'number') throw new Error(`${where}缺少 id 或录入时间`);
    const item = { ...Object.fromEntries(FIELDS.map((k) => [k, m[k]])), image: new Blob([await data.arrayBuffer()], { type }) };
    try { validate(item, categories); } catch (err) { throw new Error(`${where}（${m.id}）：${err.message}`); }
    items.push(item);
  }
  return { items, categories };
}
