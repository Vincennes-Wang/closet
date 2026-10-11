// 抠图队列：每次页面加载最多抠 MATTING_PER_LOAD 张，然后刷新页面续传。
// 原因：iPhone 上 RMBG 的内存在页面生命周期内累积，终止 Worker 也不释放，只有刷新页面才能回到起点（阶段 0 结论）。
// 任务状态存在 IndexedDB 的 job 里，刷新或崩溃后从这里接着做。
import { MATTING_MODEL, MATTING_PER_LOAD, MAX_ATTEMPTS } from './config.js';

// 本次任务包含的记录：开始时所有待处理的照片
export async function startJob(store) {
  const ids = (await store.listQueue()).filter((r) => r.status === 'pending').map((r) => r.id);
  return store.setJob({
    running: true, paused: false, ids, startedAt: Date.now(), endedAt: null,
    reloads: 0, recoveries: 0, loading: false, loadCrashes: 0, error: '',
  });
}

export const pauseJob = (store) => store.setJob({ paused: true });
export const continueJob = (store) => store.setJob({ paused: false, loadCrashes: 0, error: '' });

// 取消：停止任务，未处理的照片标为"未抠图"，保留原图，可以按原图录入
export async function cancelJob(store) {
  const left = (await store.listQueue()).filter((r) => r.status === 'pending' || r.status === 'processing');
  await store.setStatus(left.map((r) => r.id), 'skipped');
  return store.setJob({ running: false, paused: false, loading: false, endedAt: Date.now() });
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

  // 上次在加载模型时崩溃（loading 标记没清掉）。连续 MAX_ATTEMPTS 次就暂停，避免无限刷新
  if (job.loading) {
    const loadCrashes = (job.loadCrashes ?? 0) + 1;
    job = await store.setJob({ loading: false, loadCrashes, recoveries: job.recoveries + 1 });
    if (loadCrashes >= MAX_ATTEMPTS) {
      await store.setJob({ paused: true, error: '加载抠图模型时页面连续崩溃，已暂停。点"继续"重试。' });
      onChange();
      return 'paused';
    }
  }
  if (job.paused) return 'paused';

  // 上次处理到一半页面崩溃：这张算失败一次，次数到上限标为失败
  for (const r of (await store.listQueue()).filter((x) => x.status === 'processing')) {
    await store.failAttempt(r.id, '处理时页面崩溃', MAX_ATTEMPTS);
    job = await store.setJob({ recoveries: job.recoveries + 1 });
  }

  const pending = () => store.listQueue().then((q) => q.filter((r) => r.status === 'pending'));
  const batch = (await pending()).slice(0, MATTING_PER_LOAD);
  if (!batch.length) { await finish(store); onChange(); return 'finished'; }
  onChange();

  const w = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
  try {
    await store.setJob({ loading: true });
    const ready = await workerCall(w, { type: 'init', ...MATTING_MODEL, modelId: MATTING_MODEL.id, fake });
    await store.setJob({ loading: false, loadCrashes: 0, backend: `${ready.device}/${ready.dtype}` });

    for (const r of batch) {
      if ((await store.getJob()).paused || !(await store.getJob()).running) break;
      // 用 markProcessing 返回的新 Blob：Safari 上记录被改写后，之前读出的 Blob 读不出来
      // （"An error occured reading the Blob argument to createImageBitmap"）
      const current = await store.markProcessing(r.id);
      onChange();
      try {
        const bitmap = await createImageBitmap(current.original);
        const { cutout, ms } = await workerCall(w, { type: 'run', bitmap }, [bitmap]);
        await store.saveCutout(r.id, cutout, ms);
      } catch (err) {
        await store.failAttempt(r.id, err.message, MAX_ATTEMPTS);
      }
      onChange();
    }
  } catch (err) {
    // 模型加载失败（不是崩溃，例如断网）：暂停，让用户决定
    await store.setJob({ loading: false, paused: true, error: `加载抠图模型失败：${err.message}` });
    onChange();
    return 'paused';
  } finally {
    w.terminate();
  }

  job = await store.getJob();
  if (!job.running) return 'idle';
  if (job.paused) return 'paused';
  if (!(await pending()).length) { await finish(store); onChange(); return 'finished'; }
  await store.setJob({ reloads: job.reloads + 1 });
  reload();
  return 'reloading';
}
