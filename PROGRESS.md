# PROGRESS
- 状态：进行中
- 当前阶段：A（文档瘦身 + 国内可用 + 慢速提示）已完成，待 iPhone 确认；下一步 B = 阶段 3 备份（导出 / 导入）
- 累计用时：约 24（本次约 2 小时，估计）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/spike/（阶段 0 验证页）

## 最近一次工作（2026-10-12，A：文档瘦身 + 国内可用 + 慢速提示）
- 完成：
  - 文档：旧记录移到 `docs/HISTORY.md`；删除已关闭问题和过时的"厚度 q4f16"；CLAUDE.md 合并阶段 0 结论和项目决策的重复，加 PROGRESS 不超过 60 行的规则。
  - 国内可用：transformers.js 和 ONNX Runtime 文件放进 `vendor/transformers-4.3.1/`（来源、许可证、sha256 见 `vendor/README.md`）。Worker 从本站加载，`wasmPaths` 保留 transformers.js 选的文件名、改成本站地址。模型地址提取为 `config.js` `MODEL_HOST`（默认 huggingface.co）。SW 预缓存 `.asyncify` 那套（27 MB），缓存名 `closet-v18`。用户要求另外放了 Safari 26 以下无 WebGPU 用的普通版（14 MB，不预缓存）。
  - 慢速提示：WASM 设备开始前显示"这台设备处理较慢，N 张约需 X 分钟，处理中请保持本页面打开"；处理中进度行显示"剩余约 X 分钟"，按本次任务实际平均（`job.timing`），刷新后仍在。
- 验证结果：
  - `node --test tests/*.test.mjs` 27/27 通过。新增：离线时 vendor 3 个文件从 SW 缓存读到；`tests/queue.test.mjs` 估算纯函数 3 个；浏览器测试（`noWebgpu` + `?fakeMatting=1500`）断言估算文字、剩余时间、刷新后仍显示、WebGPU 设备不显示估算。纯函数测试先确认失败再实现。
  - Network 检查（Mac Chrome 155 headless，真模型，抠图 + 分类全流程 2 张，Chrome 参数把 `cdn.jsdelivr.net` 设为解析失败模拟国内，CDP 记录页面和 Worker 的全部请求）：
    - WebGPU：成功 2、分类 2，`webgpu/fp16`。发往 jsDelivr 的请求 0 个，失败请求 0 个。
    - WASM（`noWebgpu`）：成功 2、分类 2，`wasm/quantized`，用时 25 秒。发往 jsDelivr 的请求 0 个，失败请求 0 个。
    - Worker 实际请求的 vendor 文件：`transformers.min.js`、`ort-wasm-simd-threaded.asyncify.mjs`、`ort-wasm-simd-threaded.asyncify.wasm`，和计划一致。其他外部请求只有 huggingface.co 和它的下载 CDN `us.aws.cdn.hf.co`。
  - 没在真机验证：iPhone、360 浏览器、旧 Safari 的普通版 ORT 文件。

## 下次从这里继续
1. 用户 iPhone 确认 A 后，做 B（阶段 3 备份）：Plan mode 给计划，用户确认后写代码。
2. 中国境内测试：360 浏览器打开应用录入，看"上次抠图"一行是否 `wasm/quantized`、图里是否有衣服。模型大文件实际从 `us.aws.cdn.hf.co` 下载，国内打不开时把 `MODEL_HOST` 换成镜像。
3. 下次 iPhone 录入时顺便看分类每页 6 张后是否还崩溃（看"详细记录"）。
4. iPhone 看一眼页头文字和照片占用是否合理。

## 未解决问题
- 中国网络：360 浏览器第一次报 "Failed to fetch dynamically imported module"，当时更可能是 jsDelivr 打不开，现已改为本站加载，待国内真机确认。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）来自 iPhone 和小米各一次实测，未在其他设备核对。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
- iPhone 第一轮失败原因未确认（没有 JSON）。第一轮页面默认加载 BiRefNet + SigLIP fp16（共约 520 MB），第二轮默认什么都不加载；要确认是不是这个原因，可以在 iPhone 上用第一轮的组合再跑一次，但现在已不需要。
