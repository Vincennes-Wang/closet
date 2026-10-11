// 应用配置的唯一来源。换抠图模型、改每批张数只改这里。
// 模型参数取自 spike/index.html MATTING_MODELS.rmbg（2026-10-10 在 Hugging Face 核实）
export const MATTING_MODEL = {
  id: 'briaai/RMBG-1.4', // Bria 非商用许可，商用前必须替换
  dtype: 'fp16', // WebGPU
  wasmDtype: 'quantized', // 没有 WebGPU 时
  input: 'input', output: 'output', config: { model_type: 'custom' },
};

// 每次页面加载最多抠几张，之后自动刷新页面释放内存。iPhone 只抠图时第 3 张崩溃（阶段 0 第四次实测）
export const MATTING_PER_LOAD = 2;

// 同一张图失败（页面崩溃或模型报错）达到这个次数，标为抠图失败，保留原图
export const MAX_ATTEMPTS = 2;
