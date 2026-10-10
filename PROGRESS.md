# PROGRESS
- 状态：进行中
- 当前阶段：阶段 0 — 模型可行性验证（Mac Chrome 已完成；Safari、iPhone 待测）
- 累计用时：1.5
- 线上地址：https://vincennes-wang.github.io/closet/spike/

## 最近一次工作（2026-10-10）
- 完成：
  - 仓库初始化（CLAUDE.md、PROGRESS.md、.gitignore）。样本文件夹 `private:samples` 改名为 `private/samples`（原名不会被 `.gitignore` 忽略）。
  - `spike/index.html`：选图 → 抠图（BiRefNet_lite / MODNet / RMBG-1.4）→ fashionSigLIP 零样本分类（品类 / 袖长 / 厚度 top-3）→ 指标面板 → 复制结果 JSON。
- 验证结果（Mac Chrome 155，Apple M5，20 张样本，长边缩到 1024 px）：

| 抠图模型 | 后端 / dtype | 体积 | 首次下载+加载 | 缓存加载 | 单图抠图 | 结果 |
|---|---|---|---|---|---|---|
| BiRefNet_lite | WebGPU fp16 / fp32 | 114.5 / 224 MB | 4.0 s / 5.1 s | 1.6 s | – | ❌ 着色器 storage buffer 超限（需 11，上限 10） |
| BiRefNet_lite | WASM fp32 / fp16 | 224 / 114.5 MB | – | 1.5 s | – | ❌ `std::bad_alloc` 内存不足 |
| MODNet | WebGPU fp16 | 13 MB | 1.2 s | 0.1 s | 75 ms | ⚠️ 能跑，衣物大面积破洞，不可用 |
| MODNet | WASM uint8 | 6.6 MB | 0.8 s | – | 923 ms | ⚠️ 同上 |
| RMBG-1.4（非商用） | WebGPU fp16 | 88 MB | 1.8 s | – | 222 ms | ✅ 边缘干净，20/20 成功 |
| RMBG-1.4（非商用） | WASM quantized | 44 MB | 1.2 s | – | 6.5 s | ✅ 慢 |

| 分类模型 | 后端 / dtype | 体积（图像+文本） | 首次下载+加载 | 缓存加载 | 单图分类 |
|---|---|---|---|---|---|
| fashionSigLIP | WebGPU fp16 | 186 + 221 MB | 2.7 + 3.2 s | 0.2 + 0.3 s | 24 ms |
| fashionSigLIP | WASM int8 | 94 + 111 MB | 1.8 + 1.7 s | – | 650 ms |

  - 分类（RMBG 抠图后）：品类 top-1 主观看 20/20 合理（Polo衫、针织衫、背心、裤子、连衣裙、外套、衬衫）。袖长对上装基本正确；对裤子无意义，需按品类决定是否显示。厚度结果合理但无标注，未核对。
  - 第二次打开走浏览器缓存：加载表显示"缓存"，SigLIP 加载从 ~3 s 降到 ~0.3 s。
  - Safari：未测（safaridriver 未开启，需手动）。iPhone：未测。

## 下次从这里继续
1. 贴回 Mac Safari 和 iPhone 的结果 JSON，补全上表。
2. 决策：找一个可商用（MIT / Apache-2.0）且在浏览器能跑的衣物抠图模型替代 RMBG-1.4。先在 Hugging Face 核实候选的许可证和 ONNX 版本，再加进 spike 对比；同时评估 iOS 系统"拷贝主体"作为主方案。
3. 用 RMBG 抠图结果给 20 张样本人工标注品类 / 袖长 / 厚度，算 fashionSigLIP 准确率。

## 未解决问题
- ~~没有可商用、在浏览器跑得通、效果合格的抠图模型~~ — 已决策（2026-10-10）：iOS 用系统抠图；浏览器内抠图推到阶段 6，只服务安卓。
- ~~同一页面内 BiRefNet 从 WebGPU 回退到 WASM 后仍报 WebGPU 错误~~ — **已放弃**（2026-10-10）：BiRefNet_lite 不再使用，不排查。
- SigLIP fp16 共 407 MB，iPhone 上可能内存不足；页面可切 q4f16（54 + 109 MB）对照。
