// 应用配置的唯一来源。换抠图模型、改每批张数只改这里。

// transformers.js 和 ONNX Runtime 的 wasm 放在本站（jsDelivr 在中国打不开，2026-10-12 用户实测）。来源和许可证见 vendor/README.md
export const VENDOR = './vendor/transformers-4.3.1/';

// 模型下载地址（transformers.js 的 env.remoteHost）。huggingface.co 在中国能打开（2026-10-12 用户实测）。
// 打不开时可换成镜像，例如 'https://hf-mirror.com/'（末尾要有 /）
export const MODEL_HOST = 'https://huggingface.co/';
// 模型参数取自 spike/index.html MATTING_MODELS.rmbg（2026-10-10 在 Hugging Face 核实）
export const MATTING_MODEL = {
  id: 'briaai/RMBG-1.4', // Bria 非商用许可，商用前必须替换
  dtype: 'fp16', // WebGPU
  wasmDtype: 'quantized', // 没有 WebGPU 时
  input: 'input', output: 'output', config: { model_type: 'custom' },
};

// 分类模型：手机端只加载图像模型（q4f16，54 MB）；标签文字向量在 Mac 上预先算好（label-embeddings.json）
export const CLASSIFY_MODEL = { id: 'Marqo/marqo-fashionSigLIP', dtype: 'q4f16', wasmDtype: 'int8' };

// 选后端：有 WebGPU 用 dtype，否则 WASM + wasmDtype。
// fp16 类 dtype 还要显卡支持 shader-f16，否则 transformers.js 报 "The device (webgpu) does not support fp16"
// （2026-10-12 电脑 360 浏览器）。这时改用 WASM，不用 WebGPU fp32：小米手机上 WebGPU fp32 也抠不出图
export function pickBackend({ webgpu, shaderF16 }, { dtype, wasmDtype }) {
  const needsF16 = ['fp16', 'q4f16'].includes(dtype);
  return webgpu && (shaderF16 || !needsF16) ? { device: 'webgpu', dtype } : { device: 'wasm', dtype: wasmDtype };
}

// 每次页面加载最多分类几张。2026-10-11 由 10 改为 6：iPhone 两次在"分类 10 张的页面"之后的下一页崩溃。
// 12 张仍是两页（6 + 6），每页负担小一些
export const CLASSIFY_PER_LOAD = 6;

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

// 抠图结果里不透明像素（alpha ≥ 128）少于这个比例，算遮罩为空。
// 小米手机 WebGPU 抠图不报错但遮罩全空（2026-10-12），遇到时本设备改用 WASM（见 queue.js）
export const EMPTY_MASK_RATIO = 0.01;
export const EMPTY_MASK_ERROR = '遮罩为空，没有抠出衣服';

// 同一张图失败（页面崩溃或模型报错）达到这个次数，标为抠图失败，保留原图
export const MAX_ATTEMPTS = 2;
