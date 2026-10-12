// 慢速提示的纯函数：开始前估算、处理中剩余时间
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateMs, remainingMs, minutesText } from '../queue.js';
import { ESTIMATE_MS } from '../config.js';

const W = ESTIMATE_MS.wasm, G = ESTIMATE_MS.webgpu;

test('开始前估算：张数 × （抠图 + 分类）经验值，按后端', () => {
  assert.equal(estimateMs(3, 'wasm'), 3 * (W.matting + W.classify));
  assert.equal(estimateMs(3, 'webgpu'), 3 * (G.matting + G.classify));
});

test('剩余时间：本段还没完成一张时用经验值；完成后用实际平均', () => {
  const p = { phase: 'matting', total: 4, processed: 0, classifyProcessed: 0 };
  const job = { estBackend: 'wasm', timing: { matting: { since: 0, n: 0, ms: 0 } } };
  assert.equal(remainingMs(job, p), 4 * W.matting + 4 * W.classify);
  // 抠完 1 张，用时 10 s：剩 3 张按 10 s，分类仍按经验值
  const job1 = { ...job, timing: { matting: { since: 0, n: 1, ms: 10000 } } };
  assert.equal(remainingMs(job1, { ...p, processed: 1 }), 3 * 10000 + 4 * W.classify);
  // 分类段：分完 2 张用 6 s，剩 2 张按 3 s
  const job2 = { ...job, timing: { matting: { since: 0, n: 4, ms: 40000 }, classify: { since: 50000, n: 2, ms: 6000 } } };
  assert.equal(remainingMs(job2, { ...p, phase: 'classify', processed: 4, classifyProcessed: 2 }), 2 * 3000);
});

test('分钟文字：不到 1 分钟；其余向上取整', () => {
  assert.equal(minutesText(30000), '不到 1 分钟');
  assert.equal(minutesText(60000), '1 分钟');
  assert.equal(minutesText(61000), '2 分钟');
});
