// 处理队列：先抠图（phase = matting），全部抠完刷新一次，再分类（phase = classify）。
// 每次页面加载最多处理 perLoad 张，然后刷新页面续传。
// 原因：iPhone 上模型内存在页面生命周期内累积，终止 Worker 也不释放，只有刷新页面才能回到起点（阶段 0、2a 结论）。
// 任务状态存在 IndexedDB 的 job 里，刷新或崩溃后从这里接着做。
import {
  MATTING_MODEL, MATTING_PER_LOAD, CLASSIFY_MODEL, CLASSIFY_PER_LOAD, MAX_ATTEMPTS, THUMB_SIDE, LOAD_DELAY_MS, EMPTY_MASK_ERROR,
  ESTIMATE_MS, pickBackend, MODEL_HOSTS,
} from './config.js';

// 两段的差别都在这里：用哪个模型、每次加载几张、怎么判断"待处理 / 处理中"、怎么记成功和失败
const PHASES = {
  matting: {
    task: 'matting', model: MATTING_MODEL, perLoad: MATTING_PER_LOAD, name: '抠图',
    todo: (r) => r.status === 'pending',
    inProgress: (r) => r.status === 'processing',
    mark: (store, id) => store.markProcessing(id),
    // 用 markProcessing 返回的新 Blob：Safari 上记录被改写后，之前读出的 Blob 读不出来
    // （"An error occured reading the Blob argument to createImageBitmap"）
    input: (r) => r.original,
    msg: () => ({ thumbSide: THUMB_SIDE }),
    save: (store, id, out) => store.saveCutout(id, out.cutout, out.ms, out.thumb),
    fail: (store, id, error) => store.failAttempt(id, error, MAX_ATTEMPTS).then((r) => r.attempts),
  },
  classify: {
    task: 'classify', model: CLASSIFY_MODEL, perLoad: CLASSIFY_PER_LOAD, name: '分类',
    todo: (r) => r.classify?.status === 'pending' && r.status !== 'pending' && r.status !== 'processing',
    inProgress: (r) => r.classify?.status === 'processing',
    mark: (store, id) => store.patchQueued(id, (r) => ({ ...r, classify: { ...r.classify, status: 'processing' } })),
    // 抠图成功用抠图结果，失败或跳过用原图
    input: (r) => (r.status === 'cutout_done' ? r.cutout : r.original),
    msg: () => ({}),
    save: (store, id, out) => store.patchQueued(id,
      (r) => ({ ...r, classify: { ...r.classify, status: 'done', error: '', top3: out.ranked.slice(0, 3), ms: out.ms } }),
      (latest) => latest.classify?.status === 'processing'),
    fail: (store, id, error) => store.patchQueued(id, (r) => {
      const attempts = r.classify.attempts + 1;
      return { ...r, classify: { ...r.classify, attempts, error, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' } };
    }).then((r) => r.classify.attempts),
  },
};

// 开始前猜本设备抠图用哪个后端（'webgpu' | 'wasm'），只用来估算用时。判断方法和 model-worker.js 一致
export async function guessBackend(store) {
  const device = await store.getDevice();
  if (device.noWebgpu || device.mattingNoWebgpu) return 'wasm';
  const gpu = { webgpu: false, shaderF16: false };
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) { gpu.webgpu = true; gpu.shaderF16 = adapter.features.has('shader-f16'); }
  } catch { /* 无 */ }
  return pickBackend(gpu, MATTING_MODEL).device;
}

// 用时估算。开始前：张数 × 经验值。处理中：本段已完成的照片用实际平均（job.timing，刷新后仍在），还没有时用经验值；
// 抠图段再加上分类段的估算
export const estimateMs = (n, backend) => n * (ESTIMATE_MS[backend].matting + ESTIMATE_MS[backend].classify);
export function remainingMs(job, p) {
  const est = ESTIMATE_MS[job.estBackend ?? 'webgpu'];
  const avg = (k) => (job.timing?.[k]?.n ? job.timing[k].ms / job.timing[k].n : est[k]);
  const classifyLeft = (p.total - p.classifyProcessed) * avg('classify');
  return p.phase === 'classify' ? classifyLeft : (p.total - p.processed) * avg('matting') + classifyLeft;
}
export const minutesText = (ms) => (ms < 60000 ? '不到 1 分钟' : `${Math.ceil(ms / 60000)} 分钟`);

// 本段开始计时（since）；每张处理完（成功或失败）记一次：n 张，从开始到现在 ms（含刷新、等待、加载模型）
const startTiming = (store, k) => store.setJob((j) => ({ timing: { ...j.timing, [k]: { since: Date.now(), n: 0, ms: 0 } } }));
const tick = (store, k) => store.setJob((j) => {
  const t = j.timing?.[k] ?? { since: j.startedAt, n: 0 };
  return { timing: { ...j.timing, [k]: { ...t, n: t.n + 1, ms: Date.now() - t.since } } };
});

// 本次任务包含的记录：开始时所有还要抠图或分类的照片。estBackend：开始前猜的后端，估算用时用
export async function startJob(store, estBackend = 'webgpu') {
  const ids = (await store.listQueue()).filter((r) => r.status === 'pending' || r.classify?.status === 'pending').map((r) => r.id);
  return store.setJob({
    phase: 'matting', running: true, paused: false, ids, startedAt: Date.now(), endedAt: null,
    estBackend, timing: { matting: { since: Date.now(), n: 0, ms: 0 } },
    reloads: 0, recoveries: 0, loading: false, loadCrashes: 0, error: '', events: [{ t: Date.now(), e: 'start', n: ids.length }],
  });
}

// 事件时间线：用来确认 iPhone 上崩在第几张、是加载模型时还是抠图时
const log = (store, event) => store.setJob((j) => ({ events: [...(j.events ?? []), { t: Date.now(), ...event }] }));
const indexOf = (job, id) => (job.ids ?? []).indexOf(id) + 1; // 第几张，从 1 开始

// 抠完后刷新到干净页面才显示结果图。显示前记"结果页面加载"，图片都解码完记"结果已显示"。
// 显示结果图时崩溃的话，时间线就停在"结果页面加载"
// 返回 true 表示这是抠完后的那次刷新，调用方要先等 RESULTS_DELAY_MS 再显示结果
export async function noteResultsLoad(store) {
  const job = await store.getJob();
  if (!(job && !job.running && job.events?.at(-1)?.e === 'finishReload')) return false;
  await log(store, { e: 'resultsLoad' });
  return true;
}
export const noteWait = (store, ms) => log(store, { e: 'wait', ms });
export async function noteResultsShown(store) {
  const job = await store.getJob();
  if (job && !job.running && job.events?.at(-1)?.e === 'wait') await log(store, { e: 'resultsShown' });
}

export const pauseJob = async (store) => { await store.setJob({ paused: true }); await log(store, { e: 'pause' }); };
export const continueJob = async (store) => {
  await store.setJob({ paused: false, loadCrashes: 0, error: '' });
  await log(store, { e: 'continue' });
};

// 取消：停止任务，未抠图的照片标为"未抠图"（保留原图），未分类的标为"未分类"（录入时手动选）
export async function cancelJob(store) {
  for (const r of await store.listQueue()) {
    const matting = r.status === 'pending' || r.status === 'processing';
    const classify = r.classify?.status === 'pending' || r.classify?.status === 'processing';
    if (matting || classify) {
      await store.patchQueued(r.id, (x) => ({ ...x, ...(matting ? { status: 'skipped' } : {}),
        ...(classify ? { classify: { ...x.classify, status: 'skipped' } } : {}) }));
    }
  }
  await store.setJob({ running: false, paused: false, loading: false, endedAt: Date.now() });
  await log(store, { e: 'cancel' });
}

// 时间线文字，每条一行。时间从任务开始算
const EVENT_TEXT = {
  start: (v) => `开始，共 ${v.n} 张`,
  load: (v) => (v.unexpected ? '页面加载（上个页面意外结束）' : '页面加载'),
  model: (v) => `${v.k === 'classify' ? '分类' : '抠图'}模型就绪 ${v.ms} ms`,
  begin: (v) => `开始${v.k === 'classify' ? '分类' : ''}第 ${v.i} 张`,
  done: (v) => (v.k === 'classify' ? `第 ${v.i} 张分类完 ${v.ms} ms` : `第 ${v.i} 张抠完 ${v.ms} ms`),
  phase: () => '抠图全部完成，刷新后开始分类',
  error: (v) => (v.i ? `第 ${v.i} 张出错：${v.msg}` : `出错：${v.msg}`),
  crash: (v) => `发现第 ${v.i} 张${v.k === 'classify' ? '分类' : '处理'}时页面崩溃（第 ${v.attempts} 次）`,
  loadCrash: () => '发现加载模型时页面崩溃',
  crashIdle: () => '发现上个页面在两步之间崩溃',
  noWebgpu: (v) => `第 ${v.i} 张遮罩为空，本设备以后抠图和分类都改用 WASM`,
  reload: () => '自动刷新',
  dispose: (v) => `释放模型 ${v.ms} ms`,
  loadWait: (v) => `等待 ${v.ms} ms 再加载模型`,
  wait: (v) => `等待 ${v.ms} ms 再显示结果`,
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
  const cCount = (s) => mine.filter((r) => r.classify?.status === s).length;
  const done = count('cutout_done'), failed = count('cutout_failed'), skipped = count('skipped');
  return {
    phase: job?.phase ?? 'matting',
    total: ids.size, done, failed, skipped, processed: done + failed,
    classified: cCount('done'), classifyFailed: cCount('failed'), classifyProcessed: cCount('done') + cCount('failed'),
    reloads: job?.reloads ?? 0, recoveries: job?.recoveries ?? 0, backend: job?.backend ?? '', modelHost: job?.modelHost ?? '',
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
export async function resumeQueue(store, { fake = null, fakeEmptyMask = false, fakeHostFail = '', onChange = () => {}, reload = () => location.reload() } = {}) {
  let job = await store.getJob();
  if (!job?.running) return 'idle';
  // 上一条不是"自动刷新"或"开始"，说明上个页面意外结束（崩溃或被关掉）
  const last = job.events?.at(-1)?.e;
  const unexpected = !['start', 'reload', 'continue', 'phase'].includes(last);
  await log(store, { e: 'load', unexpected });
  let recovered = false; // 下面是否已按"加载中 / 处理中"算过一次崩溃恢复
  const P = PHASES[job.phase ?? 'matting'];

  // 上次在加载模型时崩溃（loading 标记没清掉）。连续 MAX_ATTEMPTS 次就暂停，避免无限刷新
  if (job.loading) {
    const loadCrashes = (job.loadCrashes ?? 0) + 1;
    job = await store.setJob({ loading: false, loadCrashes, recoveries: job.recoveries + 1 });
    await log(store, { e: 'loadCrash' });
    recovered = true;
    if (loadCrashes >= MAX_ATTEMPTS) {
      await store.setJob({ paused: true, error: `加载${P.name}模型时页面连续崩溃，已暂停。点"继续"重试。` });
      onChange();
      return 'paused';
    }
  }
  if (job.paused) return 'paused';

  // 上次处理到一半页面崩溃：这张算失败一次，次数到上限标为失败
  for (const r of (await store.listQueue()).filter(P.inProgress)) {
    const attempts = await P.fail(store, r.id, '处理时页面崩溃');
    job = await store.setJob({ recoveries: job.recoveries + 1 });
    await log(store, { e: 'crash', k: P.task, i: indexOf(job, r.id), attempts });
    recovered = true;
  }
  // 意外结束、但既不在加载模型也不在处理某张（例如模型刚就绪、两张之间）：也算一次崩溃恢复
  if (unexpected && !recovered && last !== 'pause') {
    job = await store.setJob({ recoveries: job.recoveries + 1 });
    await log(store, { e: 'crashIdle' });
  }

  const pending = () => store.listQueue().then((q) => q.filter((r) => (job.ids ?? []).includes(r.id) && P.todo(r)));
  const batch = (await pending()).slice(0, P.perLoad);
  if (!batch.length) return nextPhase(store, P, { onChange, reload });

  // 任务第一次加载不等；之后每次（自动刷新、崩溃后、继续）都先等一会儿再加载模型
  if (last !== 'start') {
    await log(store, { e: 'loadWait', ms: LOAD_DELAY_MS });
    onChange();
    await new Promise((ok) => setTimeout(ok, LOAD_DELAY_MS));
  }
  onChange();

  const w = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
  try {
    // 分类要用 Mac 上预先算好的标签向量
    const labels = P.task === 'classify' ? (await (await fetch(new URL('./label-embeddings.json', import.meta.url))).json()).labels : null;
    await store.setJob({ loading: true });
    // 本设备 WebGPU 抠出过空遮罩（小米手机）：抠图和分类都只用 WASM（小米 WebGPU 分类结果也离谱，2026-10-12 验证页实测）。
    // mattingNoWebgpu 是 closet-v16 写的旧键名，照样认
    const device = await store.getDevice();
    const noWebgpu = !!(device.noWebgpu || device.mattingNoWebgpu);
    // 模型地址：本设备成功过的排第一，其余按 MODEL_HOSTS 顺序
    const hosts = [...new Set([device.modelHost, ...MODEL_HOSTS].filter(Boolean))];
    const ready = await workerCall(w, { type: 'init', task: P.task, ...P.model, modelId: P.model.id, labels, fake, fakeEmptyMask, noWebgpu, hosts, fakeHostFail });
    if (ready.host !== device.modelHost) await store.setDevice({ modelHost: ready.host });
    await store.setJob({ loading: false, loadCrashes: 0, modelHost: new URL(ready.host).host,
      [P.task === 'classify' ? 'classifyBackend' : 'backend']: `${ready.device}/${ready.dtype}` });
    await log(store, { e: 'model', k: P.task, ms: ready.loadMs });

    for (const r of batch) {
      if ((await store.getJob()).paused || !(await store.getJob()).running) break;
      // 用 mark 返回的新记录读图（Safari 坑，见 PHASES.matting）
      const current = await P.mark(store, r.id);
      await log(store, { e: 'begin', k: P.task, i: indexOf(job, r.id) });
      onChange();
      try {
        const bitmap = await createImageBitmap(P.input(current));
        const out = await workerCall(w, { type: 'run', bitmap, ...P.msg() }, [bitmap]);
        await P.save(store, r.id, out);
        await log(store, { e: 'done', k: P.task, i: indexOf(job, r.id), ms: out.ms });
      } catch (err) {
        await P.fail(store, r.id, err.message);
        // WebGPU 抠出空遮罩：记住本设备改用 WASM，刷新后重抠这张（这次算失败一次）
        if (err.message === EMPTY_MASK_ERROR && ready.device !== 'wasm') {
          await store.setDevice({ noWebgpu: true });
          await log(store, { e: 'noWebgpu', i: indexOf(job, r.id) });
          onChange();
          break;
        }
        await log(store, { e: 'error', k: P.task, i: indexOf(job, r.id), msg: err.message });
      }
      await tick(store, P.task);
      onChange();
    }
  } catch (err) {
    // 模型加载失败（不是崩溃，例如断网）：暂停，让用户决定
    await store.setJob({ loading: false, paused: true, error: `加载${P.name}模型失败：${err.message}` });
    await log(store, { e: 'error', msg: err.message });
    onChange();
    return 'paused';
  } finally {
    // 先在 Worker 里释放模型（WebGPU 显存等），再结束 Worker。阶段 0 Mac Safari 实测能释放大部分内存
    const t0 = performance.now();
    await Promise.race([workerCall(w, { type: 'dispose' }).catch(() => {}), new Promise((ok) => setTimeout(ok, 3000))]);
    await log(store, { e: 'dispose', ms: Math.round(performance.now() - t0) });
    w.terminate();
  }

  job = await store.getJob();
  if (!job.running) return 'idle';
  if (job.paused) return 'paused';
  if (!(await pending()).length) return nextPhase(store, P, { onChange, reload, ranModel: true });
  await store.setJob({ reloads: job.reloads + 1 });
  await log(store, { e: 'reload' });
  reload();
  return 'reloading';
}

// 这一段做完了：抠图 → 刷新后分类；分类 → 结束。
// 这个页面跑过模型时，不在这里显示结果图，刷新到干净页面再显示（iPhone 2a 曾在这一步崩溃）
async function nextPhase(store, P, { onChange, reload, ranModel = false }) {
  if (P.task === 'matting') {
    await store.setJob({ phase: 'classify' });
    await startTiming(store, 'classify');
    await log(store, { e: 'phase' });
    reload();
    return 'reloading';
  }
  await finish(store);
  if (!ranModel) { await log(store, { e: 'finish' }); onChange(); return 'finished'; }
  await log(store, { e: 'finishReload' });
  reload();
  return 'reloading';
}
