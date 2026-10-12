// 备份 ZIP 的纯函数：CRC32、写 ZIP（用 macOS unzip -t 校验）、读 ZIP、分类校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, makeZip, readZip, backupFilename } from '../backup.js';
import { categoryError } from '../taxonomy.js';

const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

test('CRC32：标准测试值 "123456789" → cbf43926', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('makeZip：unzip -t 校验通过；readZip 读回的字节一致', async () => {
  const files = [
    { name: 'manifest.json', blob: new Blob([JSON.stringify({ formatVersion: 1, 中文: '衣橱' })], { type: 'application/json' }) },
    { name: 'images/a.webp', blob: new Blob([bytes(70000, 1)], { type: 'image/webp' }) },
    { name: 'images/b.jpg', blob: new Blob([bytes(1, 7)], { type: 'image/jpeg' }) },
  ];
  const zip = await makeZip(files, new Date(2026, 9, 12, 13, 45, 30));
  const dir = await mkdtemp(join(tmpdir(), 'closet-zip-'));
  try {
    const path = join(dir, 'b.zip');
    await writeFile(path, Buffer.from(await zip.arrayBuffer()));
    const out = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
    assert.match(execFileSync('unzip', ['-l', path], { encoding: 'utf8' }), /10-12-2026 13:45/);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const read = await readZip(zip);
  assert.deepEqual([...read.keys()], files.map((f) => f.name));
  for (const f of files) assert.deepEqual(new Uint8Array(await read.get(f.name).arrayBuffer()), new Uint8Array(await f.blob.arrayBuffer()));
});

test('readZip：内容被改（CRC 不一致）或不是 ZIP 时报错', async () => {
  const zip = await makeZip([{ name: 'x.bin', blob: new Blob([bytes(100, 3)]) }]);
  const buf = new Uint8Array(await zip.arrayBuffer());
  buf[30 + 'x.bin'.length + 10] ^= 1; // 本地文件头 30 字节 + 文件名之后是数据
  await assert.rejects(readZip(new Blob([buf])), /校验失败/);
  await assert.rejects(readZip(new Blob(['not a zip'])), /不是有效的备份文件/);
});

test('分类校验：内置合法、自建合法，不存在的 id 报错', () => {
  const rows = [{ id: 'u1', parentId: 'top', zh: 'polo', builtin: false }, { id: 'u2', parentId: null, zh: '泳衣', builtin: false },
    { id: 'u3', parentId: 'u2', zh: '比基尼', builtin: false }, { id: 'top.vest', zh: '吊带' }];
  assert.equal(categoryError({ categoryId: 'top', subcategoryId: 'top.casual_tee' }, rows), null);
  assert.equal(categoryError({ categoryId: 'bag', subcategoryId: null }, rows), null);
  assert.equal(categoryError({ categoryId: 'top', subcategoryId: 'u1' }, rows), null);
  assert.equal(categoryError({ categoryId: 'u2', subcategoryId: null }, rows), null);
  assert.equal(categoryError({ categoryId: 'u2', subcategoryId: 'u3' }, rows), null);
  assert.match(categoryError({ categoryId: 'top', subcategoryId: 'top.nope' }, rows), /top\.nope/);
  assert.match(categoryError({ categoryId: 'bottom', subcategoryId: 'u1' }, rows), /u1/); // 自建二级不属于这个一级
  assert.match(categoryError({ categoryId: 'nope', subcategoryId: null }, []), /nope/);
});

test('文件名：closet-backup-YYYYMMDD.zip', () => {
  assert.equal(backupFilename(new Date(2026, 0, 5)), 'closet-backup-20260105.zip');
});
