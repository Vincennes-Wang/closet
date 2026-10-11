// 抠图队列：每次页面加载最多抠 MATTING_PER_LOAD 张，然后刷新页面续传。
// 原因：iPhone 上 RMBG 的内存在页面生命周期内累积，终止 Worker 也不释放，只有刷新页面才能回到起点（阶段 0 结论）。
// 任务状态存在 IndexedDB 的 job 里，刷新或崩溃后从这里接着做。
import { MATTING_MODEL, MATTING_PER_LOAD, MAX_ATTEMPTS } from './config.js';

// 本次任务包含的记录：开始时所有待处理的照片
export async function startJob(store) {
  const ids = (await store.listQueue()).filter((r) => r.status === 'pending').map((r) => r.id);
  return store.setJob({
    running: true, paused: false, ids, startedAt: Date.now(), endedAt: null,
    reloads: 0, recoveries: 0, loading: false, loadCrashes: 0, error: '', events: [{ t: Date.now(), e: 'start', n: ids.length }],
  });
}

// 事件时间线：用来确认 iPhone 上崩在第几张、是加载模型时还是抠图时
const log = (store, event) => store.setJob((j) => ({ events: [...(j.events ?? []), { t: Date.now(), ...event }] }));
const indexOf = (job, id) => (job.ids ?? []).indexOf(id) + 1; // 第几张，从 1 开始

// 抠完后刷新到干净页面才显示结果图。显示前记"结果页面加载"，图片都解码完记"结果已显示"。
// 显示结果图时崩溃的话，时间线就停在"结果页面加载"
export async function noteResultsLoad(store) {
  const job = await store.getJob();
  if (job && !job.running && job.events?.at(-1)?.e === 'finishReload') await log(store, { e: 'resultsLoad' });
}
export async function noteResultsShown(store) {
  const job = await store.getJob();
  if (job && !job.running && job.events?.at(-1)?.e === 'resultsLoad') await log(store, { e: 'resultsShown' });
}

export const pauseJob = async (store) => { await store.setJob({ paused: true }); await log(store, { e: 'pause' }); };
export const continueJob = async (store) => {
  await store.setJob({ paused: false, loadCrashes: 0, error: '' });
  await log(store, { e: 'continue' });
};

// 取消：停止任务，未处理的照片标为"未抠图"，保留原图，可以按原图录入
export async function cancelJob(store) {
  const left = (await store.listQueue()).filter((r) => r.status === 'pending' || r.status === 'processing');
  await store.setStatus(left.map((r) => r.id), 'skipped');
  await store.setJob({ running: false, paused: false, loading: false, endedAt: Date.now() });
  await log(store, { e: 'cancel' });
}

// 时间线文字，每条一行。时间从任务开始算
const EVENT_TEXT = {
  start: (v) => `开始，共 ${v.n} 张`,
  load: (v) => (v.unexpected ? '页面加载（上个页面意外结束）' : '页面加载'),
  model: (v) => `模型就绪 ${v.ms} ms`,
  begin: (v) => `开始第 ${v.i} 张`,
  done: (v) => `第 ${v.i} 张抠完 ${v.ms} ms`,
  error: (v) => (v.i ? `第 ${v.i} 张出错：${v.msg}` : `出错：${v.msg}`),
  crash: (v) => `发现第 ${v.i} 张处理时页面崩溃（第 ${v.attempts} 次）`,
  loadCrash: () => '发现加载模型时页面崩溃',
  reload: () => '自动刷新',
  finish: () => '全部完成',
  finishReload: () => '全部完成，刷新后显示结果',
  resultsLoad: () => '结果页面加载',
  resultsShown: () => '结果图已显示',
  pause: () => '暂停', continue: () => '继续', cancel: () => '取消',
};
export function eventLines(job) {
  const t0 = job?.startedAt ?? 0;
  return (job?.events ?? []).map((v) => `${((v.t - t0) / 1000).toFixed(1).padStart(6)} s  ${EVENT_TEXT[v.e]?.(v) ?? v.e}`);
}

// 进度：只算本次任务的记录
export function summarize(job, queue) {
  const ids = new Set(job?.ids ?? []);
  const mine = queue.filter((r) => ids.has(r.id));
  const count = (s) => mine.filter((r) => r.status === s).length;
  const done = count('cutout_done'), failed = count('cutout_failed'), skipped = count('skipped');
  return {
    total: ids.size, done, failed, skipped, processed: done + failed,
    reloads: job?.reloads ?? 0, recoveries: job?.recoveries ?? 0, backend: job?.backend ?? '',
    elapsedMs: job?.startedAt ? (job.endedAt ?? Date.now()) - job.startedAt : 0,
  };
}

function workerCall(w, msg, transfer = []) {
  return new Promise((ok, fail) => {
    w.onmessage = ({ data }) => (data.ok ? ok(data) : fail(new Error(data.error)));
    w.onerror = (e) => fail(new Error(e.message || 'Worker 出错'));
    w.postMessage({ id: Date.now(), ...msg }, transfer);
  });
}

const finish = (store) => store.setJob({ running: false, loading: false, endedAt: Date.now() });

// 页面加载时调用。onChange 在每张处理前后调用，用来刷新进度显示。
// 返回 'idle' | 'paused' | 'reloading' | 'finished'
export async function resumeQueue(store, { fake = null, onChange = () => {}, reload = () => location.reload() } = {}) {
  let job = await store.getJob();
  if (!job?.running) return 'idle';
  // 上一条不是"自动刷新"或"开始"，说明上个页面意外结束（崩溃或被关掉）
  const last = job.events?.at(-1)?.e;
  await log(store, { e: 'load', unexpected: !['start', 'reload', 'continue'].includes(last) });

  // 上次在加载模型时崩溃（loading 标记没清掉）。连续 MAX_ATTEMPTS 次就暂停，避免无限刷新
  if (job.loading) {
    const loadCrashes = (job.loadCrashes ?? 0) + 1;
    job = await store.setJob({ loading: false, loadCrashes, recoveries: job.recoveries + 1 });
    await log(store, { e: 'loadCrash' });
    if (loadCrashes >= MAX_ATTEMPTS) {
      await store.setJob({ paused: true, error: '加载抠图模型时页面连续崩溃，已暂停。点"继续"重试。' });
      onChange();
      return 'paused';
    }
  }
  if (job.paused) return 'paused';

  // 上次处理到一半页面崩溃：这张算失败一次，次数到上限标为失败
  for (const r of (await store.listQueue()).filter((x) => x.status === 'processing')) {
    const after = await store.failAttempt(r.id, '处理时页面崩溃', MAX_ATTEMPTS);
    job = await store.setJob({ recoveries: job.recoveries + 1 });
    await log(store, { e: 'crash', i: indexOf(job, r.id), attempts: after.attempts });
  }

  const pending = () => store.listQueue().then((q) => q.filter((r) => r.status === 'pending'));
  const batch = (await pending()).slice(0, MATTING_PER_LOAD);
  if (!batch.length) { await finish(store); await log(store, { e: 'finish' }); onChange(); return 'finished'; }
  onChange();

  const w = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
  try {
    await store.setJob({ loading: true });
    const ready = await workerCall(w, { type: 'init', ...MATTING_MODEL, modelId: MATTING_MODEL.id, fake });
    await store.setJob({ loading: false, loadCrashes: 0, backend: `${ready.device}/${ready.dtype}` });
    await log(store, { e: 'model', ms: ready.loadMs });

    for (const r of batch) {
      if ((await store.getJob()).paused || !(await store.getJob()).running) break;
      // 用 markProcessing 返回的新 Blob：Safari 上记录被改写后，之前读出的 Blob 读不出来
      // （"An error occured reading the Blob argument to createImageBitmap"）
      const current = await store.markProcessing(r.id);
      await log(store, { e: 'begin', i: indexOf(job, r.id) });
      onChange();
      try {
        const bitmap = await createImageBitmap(current.original);
        const { cutout, ms } = await workerCall(w, { type: 'run', bitmap }, [bitmap]);
        await store.saveCutout(r.id, cutout, ms);
        await log(store, { e: 'done', i: indexOf(job, r.id), ms });
      } catch (err) {
        await store.failAttempt(r.id, err.message, MAX_ATTEMPTS);
        await log(store, { e: 'error', i: indexOf(job, r.id), msg: err.message });
      }
      onChange();
    }
  } catch (err) {
    // 模型加载失败（不是崩溃，例如断网）：暂停，让用户决定
    await store.setJob({ loading: false, paused: true, error: `加载抠图模型失败：${err.message}` });
    await log(store, { e: 'error', msg: err.message });
    onChange();
    return 'paused';
  } finally {
    w.terminate();
  }

  job = await store.getJob();
  if (!job.running) return 'idle';
  if (job.paused) return 'paused';
  // 全部抠完：这个页面跑过模型，内存高，不在这里显示 12 张结果图，刷新到干净页面再显示（iPhone 曾在这一步崩溃）
  if (!(await pending()).length) {
    await finish(store);
    await log(store, { e: 'finishReload' });
    reload();
    return 'reloading';
  }
  await store.setJob({ reloads: job.reloads + 1 });
  await log(store, { e: 'reload' });
  reload();
  return 'reloading';
}
