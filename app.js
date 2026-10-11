import { CATEGORIES, SEASONS, SCENES } from './options.js';
import { openStore, groupByCategory } from './store.js';
import { prepareImage, probeWebpAlpha, makeThumb } from './image.js';
import { THUMB_SIDE, RESULTS_DELAY_MS } from './config.js';
import { startJob, pauseJob, continueJob, cancelJob, summarize, resumeQueue, eventLines, noteResultsLoad, noteWait, noteResultsShown } from './queue.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

const store = await openStore();
const urls = new Set(); // 当前显示中的 object URL，重新渲染时统一释放

function objectUrl(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; }

// ---------- 表单：分类单选，季节、场景多选，其余文字 ----------
function chips(name, options, selected, multiple) {
  const box = el('div', { className: 'chips', role: multiple ? 'group' : 'radiogroup' });
  for (const value of options) {
    const b = el('button', { type: 'button', className: 'chip', textContent: value });
    b.setAttribute('aria-pressed', String(selected.includes(value)));
    b.addEventListener('click', () => {
      if (!multiple) for (const o of box.children) o.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', String(!(multiple && b.getAttribute('aria-pressed') === 'true')));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    box.append(b);
  }
  box.dataset.name = name;
  return box;
}
const picked = (box) => [...box.children].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

function itemFields(v = {}) {
  const category = chips('category', CATEGORIES, v.category ? [v.category] : [], false);
  const seasons = chips('seasons', SEASONS, v.seasons ?? [], true);
  const scenes = chips('scenes', SCENES, v.scenes ?? [], true);
  const text = (label, value, placeholder) => {
    const input = el('input', { type: 'text', value: value ?? '', placeholder });
    return { input, row: el('label', { className: 'field' }, el('span', { textContent: label }), input) };
  };
  const name = text('名称', v.name, '可不填');
  const sub = text('细分', v.subcategory, '如 T恤、牛仔裤');
  const color = text('颜色', v.color, '如 藏青');
  const block = (label, node) => el('div', { className: 'field' }, el('span', { textContent: label }), node);
  const node = el('div', { className: 'fields' },
    block('分类', category), block('季节', seasons), block('场景', scenes), name.row, sub.row, color.row);
  return {
    node,
    values: () => ({
      category: picked(category)[0],
      seasons: picked(seasons),
      scenes: picked(scenes),
      name: name.input.value,
      subcategory: sub.input.value,
      color: color.input.value,
    }),
  };
}

// ---------- 录入：选图只缩图、存进抠图队列，不加载模型 ----------
$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const errors = [];
  for (const [i, file] of files.entries()) {
    $('queueMsg').textContent = `正在读取照片 ${i + 1} / ${files.length}`;
    try {
      const img = await prepareImage(file);
      const thumb = await makeThumb(img.blob, img.hasAlpha, THUMB_SIDE);
      await store.enqueue({ original: img.blob, hasAlpha: img.hasAlpha, thumb });
    } catch (err) { errors.push(`${file.name} 读取失败：${err.message}`); }
  }
  $('queueMsg').textContent = errors.join('；');
  renderQueue();
});

// 录入表单。onSaved 在保存成功后调用（从队列录入时删除队列记录）
function renderPending(card, img, onSaved = () => {}) {
  const url = URL.createObjectURL(img.blob);
  const fields = itemFields();
  const msg = el('p', { className: 'error' });
  const done = () => { URL.revokeObjectURL(url); card.remove(); };
  const save = el('button', { type: 'button', className: 'primary', textContent: '保存' });
  save.addEventListener('click', async () => {
    const v = fields.values();
    if (!v.category) { msg.textContent = '请选择分类'; return; }
    try {
      await store.add({ ...v, image: img.blob, hasAlpha: img.hasAlpha });
      await onSaved();
      done();
      render();
    } catch (err) { msg.textContent = `保存失败：${err.message}`; }
  });
  const hint = img.hasAlpha ? el('p', { className: 'muted', textContent: '已抠图（透明背景）' }) : '';
  card.replaceChildren(
    el('img', { src: url, alt: '', className: img.hasAlpha ? 'thumb alpha' : 'thumb' }),
    hint, fields.node, msg,
    el('div', { className: 'actions' }, save, el('button', { type: 'button', textContent: '放弃', onclick: done })),
  );
}

// ---------- 衣橱 ----------
function tile(item) {
  const b = el('button', { type: 'button', className: 'tile' },
    el('img', { src: objectUrl(item.image), alt: '', className: item.hasAlpha ? 'alpha' : '' }),
    el('span', { textContent: item.name || item.subcategory || item.category }));
  b.addEventListener('click', () => openEdit(item));
  return b;
}

function renderGroups(container, items) {
  container.replaceChildren(...groupByCategory(items).map((g) =>
    el('section', { className: 'group' },
      el('h2', { textContent: `${g.category} · ${g.items.length}` }),
      el('div', { className: 'grid' }, ...g.items.map(tile)))));
}

async function render() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
  const all = await store.list({ includeArchived: true });
  showStorage(all);
  const active = all.filter((i) => !i.archived);
  renderGroups($('closet'), active);
  $('empty').hidden = active.length > 0;
  const showArchived = $('showArchived').checked;
  $('archived').hidden = !showArchived;
  if (showArchived) renderGroups($('archived'), all.filter((i) => i.archived));
  else $('archived').replaceChildren();
}
$('showArchived').addEventListener('change', render);

// ---------- 编辑 ----------
function openEdit(item) {
  const dialog = $('editDialog');
  const fields = itemFields(item);
  const msg = el('p', { className: 'error' });
  const act = (label, fn, cls = '') => el('button', { type: 'button', className: cls, textContent: label, onclick: async () => {
    try { if (await fn() !== false) { dialog.close(); render(); } } catch (err) { msg.textContent = err.message; }
  } });
  const buttons = item.archived
    ? [act('恢复', () => store.unarchive(item.id), 'primary'),
       act('彻底删除', () => confirm('彻底删除后无法恢复，确定吗？') ? store.remove(item.id) : false, 'danger')]
    : [act('保存', () => {
        const v = fields.values();
        if (!v.category) { msg.textContent = '请选择分类'; return false; }
        return store.update(item.id, v);
      }, 'primary'),
       act('归档', () => store.archive(item.id))];
  $('editForm').replaceChildren(
    el('img', { src: objectUrl(item.image), alt: '', className: item.hasAlpha ? 'thumb alpha' : 'thumb' }),
    fields.node, msg,
    el('div', { className: 'actions' }, ...buttons, el('button', { type: 'button', textContent: '取消', onclick: () => dialog.close() })),
  );
  dialog.showModal();
  dialog.focus(); // showModal 默认聚焦第一个按钮（"上衣"），iOS 会在它外面画焦点圈
}

// ---------- 抠图队列 ----------
const fake = new URLSearchParams(location.search).get('fakeMatting'); // 测试用，见 model-worker.js
const qurls = new Set();
const STATUS_TEXT = { pending: '待抠图', processing: '抠图中', cutout_done: '已抠图', cutout_failed: '抠图失败，用原图', skipped: '未抠图，用原图' };
const duration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)} 分 ${s % 60} 秒`; };
const progressText = (p) => `已处理 ${p.processed} / ${p.total}（失败 ${p.failed}）· 自动刷新 ${p.reloads} 次 · 崩溃恢复 ${p.recoveries} 次 · 用时 ${duration(p.elapsedMs)}`;

// 可展开的事件时间线（诊断用）
const timeline = (job) => (job?.events?.length
  ? el('details', { className: 'timeline' }, el('summary', { textContent: '详细记录' }), el('pre', { textContent: eventLines(job).join('\n') }))
  : '');

function queueButton(label, fn, cls = '') {
  return el('button', { type: 'button', className: cls, textContent: label, onclick: fn });
}

async function renderQueue() {
  for (const u of qurls) URL.revokeObjectURL(u);
  qurls.clear();
  const [job, queue] = await Promise.all([store.getJob(), store.listQueue()]);
  const running = !!job?.running;
  document.body.classList.toggle('processing', running);
  wakeLock(running && !job.paused);
  const box = $('queue');
  if (running) {
    const p = summarize(job, queue);
    box.replaceChildren(el('div', { className: 'card' },
      el('h2', { textContent: job.paused ? '抠图已暂停' : '正在抠图' }),
      el('p', { id: 'progress', textContent: progressText(p) }),
      job.paused ? '' : el('p', { className: 'hint', textContent: '处理中请保持页面在前台，屏幕不要锁定。页面会自动刷新，不用操作。如果出现"重复出现问题"，向左划回来即可继续。' }),
      !job.paused && job.events?.at(-1)?.e === 'loadWait' ? el('p', { className: 'muted', textContent: '正在释放内存，稍后继续…' }) : '',
      el('p', { className: 'error', textContent: job.error ?? '' }),
      job.paused ? timeline(job) : '',
      el('div', { className: 'actions' },
        job.paused
          ? queueButton('继续', async () => { await continueJob(store); location.reload(); }, 'primary')
          : queueButton('暂停', async () => { await pauseJob(store); renderQueue(); }),
        queueButton('取消', async () => { await cancelJob(store); renderQueue(); render(); }, 'danger'))));
    return;
  }
  const waiting = queue.filter((r) => r.status === 'pending').length;
  const p = job?.endedAt ? summarize(job, queue) : null;
  box.replaceChildren(...(queue.length ? [el('section', { className: 'card' },
    el('h2', { textContent: `待录入 · ${queue.length}` }),
    p ? el('p', { className: 'muted', id: 'lastJob', textContent: `上次抠图：成功 ${p.done}，失败 ${p.failed}，取消 ${p.skipped} · 自动刷新 ${p.reloads} 次 · 崩溃恢复 ${p.recoveries} 次 · 用时 ${duration(p.elapsedMs)}${p.backend ? ` · ${p.backend}` : ''}` }) : '',
    p ? timeline(job) : '',
    waiting ? el('div', { className: 'actions' },
      queueButton(`开始抠图（${waiting} 张）`, async () => { await startJob(store); location.reload(); }, 'primary')) : '',
    el('div', { className: 'grid' }, ...queue.map(queueTile)))] : []));
}

function queueTile(r) {
  const blob = r.cutout ?? r.original; // 录入用原尺寸
  const u = URL.createObjectURL(r.thumb ?? blob); qurls.add(u); // 显示用缩略图

  const alpha = r.status === 'cutout_done';
  const actions = [];
  if (r.status !== 'pending') {
    actions.push(queueButton('录入', () => {
      const card = el('article', { className: 'pending card' });
      $('pending').append(card);
      renderPending(card, { blob, hasAlpha: alpha }, async () => { await store.removeQueued(r.id); renderQueue(); });
      card.scrollIntoView({ behavior: 'smooth' });
    }, 'primary'));
  }
  actions.push(queueButton('删除', async () => { await store.removeQueued(r.id); renderQueue(); }));
  return el('div', { className: 'tile queued' },
    el('img', { src: u, alt: '', className: alpha ? 'alpha' : '' }),
    el('span', { className: `status ${r.status}`, textContent: STATUS_TEXT[r.status] }),
    el('div', { className: 'actions' }, ...actions));
}

// 处理中保持屏幕常亮；切到后台会自动释放，回到前台再申请
let lock = null, wantLock = false;
async function wakeLock(want) {
  wantLock = want;
  if (!want) { await lock?.release().catch(() => {}); lock = null; return; }
  if (lock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
  catch { /* 不支持或被拒绝：只靠提示 */ }
}
document.addEventListener('visibilitychange', () => { if (wantLock) wakeLock(true); });

// ---------- 存储状态、诊断 ----------
// 申请"空间不足时不自动清除"（persist），只在启动时做一次
const persisted = (async () => {
  if (!navigator.storage?.persist) return null;
  return (await navigator.storage.persisted()) || (await navigator.storage.persist());
})();

// 照片占用自己加总：Safari 的 storage.estimate() 不计 IndexedDB 里的图片（Mac Safari 实测存 1.27 MB 只多报约 3 KB）
async function showStorage(items) {
  const mb = (items.reduce((n, i) => n + i.image.size, 0) / 1024 / 1024).toFixed(1);
  const kept = await persisted;
  $('storage').textContent = kept
    ? `数据不会被自动清除 · 照片占用 ${mb} MB`
    : `空间不足时浏览器可能清除数据，请定期备份 · 照片占用 ${mb} MB`;
}

// 测试辅助，交付前视情况删除
async function showDiag() {
  const w = await probeWebpAlpha();
  $('diag').textContent = w.ok ? '透明图保存为 WebP' : '透明图保存为 PNG（这台设备的浏览器不能保存带透明的 WebP）';
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker 注册失败', err));

// 抠图任务进行中时不渲染衣橱，少占内存
const job = await store.getJob();
if (job && !job.running && await noteResultsLoad(store)) {
  $('queueMsg').textContent = '抠图完成，正在准备结果…';
  await new Promise((ok) => setTimeout(ok, RESULTS_DELAY_MS));
  await noteWait(store, RESULTS_DELAY_MS);
  $('queueMsg').textContent = '';
}
if (!job?.running) await render();
else $('storage').textContent = '正在抠图';
await renderQueue();
if (!job?.running) {
  // 结果图都解码完，记一笔"结果已显示"（只在抠完后的那次刷新记）
  Promise.all([...document.querySelectorAll('#queue img')].map((i) => i.decode().catch(() => {})))
    .then(() => noteResultsShown(store));
}
document.documentElement.dataset.ready = '1'; // 事件已绑定、衣橱已渲染（测试等这个标记）
showDiag();
if (job?.running) {
  const result = await resumeQueue(store, { fake: fake === null ? null : Number(fake), onChange: renderQueue });
  if (result !== 'reloading') { await renderQueue(); if (result !== 'paused') await render(); }
}
