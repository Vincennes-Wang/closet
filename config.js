// 应用配置的唯一来源。换抠图模型、改每批张数只改这里。
// 模型参数取自 spike/index.html MATTING_MODELS.rmbg（2026-10-10 在 Hugging Face 核实）
export const MATTING_MODEL = {
  id: 'briaai/RMBG-1.4', // Bria 非商用许可，商用前必须替换
  dtype: 'fp16', // WebGPU
  wasmDtype: 'quantized', // 没有 WebGPU 时
  input: 'input', output: 'output', config: { model_type: 'custom' },
};

// 分类模型：手机端只加载图像模型（q4f16，54 MB）；标签文字向量在 Mac 上预先算好（label-embeddings.json）
export const CLASSIFY_MODEL = { id: 'Marqo/marqo-fashionSigLIP', dtype: 'q4f16', wasmDtype: 'int8' };

// 每次页面加载最多分类几张。阶段 0 iPhone 实测分类约 210 ms/张、3/3 稳定；按 2b 真机结果调整
export const CLASSIFY_PER_LOAD = 10;

// 每次页面加载最多抠几张，之后自动刷新页面释放内存。iPhone 只抠图时第 3 张崩溃（阶段 0 第四次实测）。
// 2026-10-11 由 2 改为 1：2b 验收时每页第 2 张处理中崩溃过（用户选择试 1 张）
export const MATTING_PER_LOAD = 1;

// 队列里显示的缩略图长边（像素）。12 张 1024 px 结果图解码后约 50 MB，iPhone 上显示时崩溃过
export const THUMB_SIDE = 256;

// 全部抠完、刷新到新页面后，等这么久再显示结果图，给上一个页面的内存回收时间
export const RESULTS_DELAY_MS = 2000;

// 刷新后（非任务第一次加载）等这么久再加载模型，给上一个页面的内存回收时间。
// iPhone 三次验收共 4 次崩溃发生在"刷新后马上加载模型"时
export const LOAD_DELAY_MS = 3000;

// 同一张图失败（页面崩溃或模型报错）达到这个次数，标为抠图失败，保留原图
export const MAX_ATTEMPTS = 2;
