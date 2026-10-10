@~/vibe-playbook/00_教练规则.md
@~/vibe-playbook/02_默认技术栈与免费方案.md
@~/vibe-playbook/05_本地AI模型方案.md

## 协作规则
- 先给计划（Plan mode），用户确认后再写代码。
- 开工前读 `~/vibe-playbook/03_经验日志.md`，避免重复踩坑。
- 实际检查网页、API、文件、模型输出，不凭猜测写代码。
- 每个阶段结束时运行验证，报告结果。
- 小步提交。不提交密钥、`.env`、`legacy/`、`private/`、模型文件和个人数据。
- 每次工作结束前：按下面的格式更新 `PROGRESS.md`，提交并推送，然后运行 `git status -sb` 确认没有未推送的提交。

## 交接清单
以下情况，回复末尾必须输出交接清单：
- 每次工作结束，推送完成后。
- 需要用户在 GitHub 网页、手机、账号或系统设置里操作时（例如开启 Pages、添加 Secrets、真机测试、授权）。
- 遇到无法自己解决的报错，或需要用户做决策时。
- 同一个问题修了两次仍未解决时，建议用户回 Claude.ai。

格式：

### 交接清单
- 推送状态：<已推送，最新提交 xxxxxxx / 未推送，原因>
- 需要你做：
  1. <具体操作，写明在哪里点什么；没有就写“无”>
- 发给 Claude.ai（可选，只在需要第二意见时填写；否则写“无”）：
  > 看看进度：<仓库地址>。<需要诊断的问题或待做的决策>

## PROGRESS.md 固定格式
```markdown
# PROGRESS
- 状态：<进行中 / 已完成 / 暂停>
- 当前阶段：<阶段编号和名称>
- 累计用时：<小时>
- 线上地址：<GitHub Pages 链接，没有就留空>

## 最近一次工作（<日期>）
- 完成：
- 验证结果：<运行了什么检查，结果如何>

## 下次从这里继续
1.

## 未解决问题
-
```

## 项目决策（穿搭 PWA）
- 用途：给家人用的衣橱 + 搭配网页。
- 当前定位：个人和家人朋友免费使用，非商用。
- 平台：PWA，托管在 GitHub Pages。无构建步骤，无后端。第三方库只用 CDN 引入，并固定版本号。
- 个人数据（衣物照片、搭配）只存在用户浏览器的 IndexedDB 中，绝不进仓库。
- 应用内抠图：RMBG-1.4（`briaai/RMBG-1.4`，Bria 非商用许可，允许个人非商用使用）。模型 ID 只在一个配置常量里定义（spike 中为 `MATTING_MODELS.rmbg.id`），换模型只改这一处。
- 保底方案：iOS 系统抠图（"文件"App 多选后批量"移除背景"，或在照片里长按"拷贝主体"）。应用接收透明 PNG（文件导入或粘贴）。
- 商用前置条件：如果以后收费或商用，必须先替换抠图模型，或购买 Bria 商业许可。替换候选（2026-10-10 核实）：`studioludens/birefnet-lite-512`（MIT，同类 `onnx-community/BiRefNet_512x512-ONNX` 也是 MIT）、`Xenova/slimsam-77-uniform`（SlimSAM，Apache-2.0，需要点选提示，不是全自动）。
- 其他模型（分类等）仍优先选 MIT / Apache-2.0。
- 页面"关于"区域注明使用了 RMBG-1.4 及其许可。
- 分类在浏览器内运行：Transformers.js + WebGPU，WASM 兜底。手机端只加载 fashionSigLIP 图像模型；标签文字向量在 Mac 上预先算好，存为 `spike/label-embeddings.json`（不是个人数据，可以提交）。

### 阶段 0 结论（2026-10-11）
- iPhone 上 RMBG-1.4 的内存在整个页面生命周期内累积。终止 Worker 不能释放这部分内存。
- 阶段 5 接入 AI 抠图：每批 3 张，结果存 IndexedDB，然后自动刷新页面续传下一批。验收标准：连续 3 批共 9 张不崩溃。
- iOS 系统抠图（透明 PNG）始终作为批量录入和兜底方案。
- 分类模型：fashionSigLIP q4f16，只加载图像模型，在 Worker 中运行（阶段 5 接入）。

### 阶段 1 决策（2026-10-11）
- 图片存储格式：长边缩到 1024，不存原图。有透明区域的图存 WebP；浏览器不能输出带透明的 WebP 时存 PNG。没有透明区域的图存 JPEG 0.9。启动时用 `image.js` 的 `probeWebpAlpha()` 检测，结果显示在页面"关于"区。
- WebP 透明实测：Mac Chrome 155 可以；Mac Safari 27.0.1 不可以（`toBlob('image/webp')` 返回 `image/png`），所以 Safari 上透明图存 PNG。iPhone：待真机确认。
- 衣物记录字段见 `store.js` 的 `newItem()`；分类、季节、场景的取值只在 `options.js` 定义。改了取值要考虑已存数据。
- `store.js` 是唯一访问 IndexedDB 的模块（数据库 `closet` v1，仓库 `items`）。改表结构必须升版本号并写迁移。
- Service Worker 缓存名 `closet-vN`（`sw.js`）。改了任何应用文件，发布前把 N 加 1，否则用户手机上一直是旧版本。

## 已核实的模型（2026-10-10，查 Hugging Face API）
| 用途 | 仓库 | 许可证 | 备注 |
|---|---|---|---|
| 运行库 | `@huggingface/transformers@4.3.1`（jsDelivr `dist/transformers.min.js`） | Apache-2.0 | 浏览器缓存默认开启（Cache API `transformers-cache`）。不要用 `transformers.web.min.js`：它含裸模块名 `onnxruntime-web/webgpu`，浏览器无法解析 |
| 抠图（已放弃） | `onnx-community/BiRefNet_lite-ONNX` | MIT | fp16 114.5 MB / fp32 224 MB。模型卡示例里的 `onnx-community/BiRefNet_lite` 不存在。**Mac Chrome 上跑不通**：WebGPU 超出 storage buffer 上限（需 11，上限 10），WASM 内存不足；输入固定 1024² |
| 抠图（对照） | `Xenova/modnet` | Apache-2.0 | fp16 13 MB / uint8 6.6 MB。人像抠图模型，衣物平铺图大量破洞，不可用 |
| 抠图（应用内） | `briaai/RMBG-1.4` | Bria 非商用（模型卡："source-available model for non-commercial use"，Creative Commons 非商用；商用需与 Bria 签协议。卡片上的许可页链接 2026-10-10 返回 404） | fp16 88 MB / quantized 44 MB。Mac Chrome 效果最好，WebGPU 222 ms/张；iPhone（Safari 27）WebGPU fp16 可用，首张 1.6 s |
| 分类 | `Marqo/marqo-fashionSigLIP` | Apache-2.0 | `SiglipTextModel` + `SiglipVisionModel`；vision fp16 186 MB / q4f16 54 MB / int8 94 MB，text fp16 221 MB |
| 标签向量 | `spike/label-embeddings.json` | – | 用 fashionSigLIP fp32 文本模型在 Mac 上生成（spike 页面 `?mode=embed`）。改了 `GROUPS` 里的英文 prompt 后必须重新生成 |

## 目录
- 根目录：应用（`index.html`、`app.js` 界面、`store.js` 存储、`image.js` 图片处理、`options.js` 选项、`sw.js`、`manifest.webmanifest`、`icons/`）。
- `tests/`：`node --test tests/*.test.mjs`。`store.test.mjs` 测纯函数；`browser.test.mjs` 用 headless Chrome（CDP，`tests/cdp.mjs`，无依赖）测真实 IndexedDB、录入流程和离线打开。需要本机装有 Chrome。
- `spike/`：阶段 0 验证页（`index.html` 单文件）和预计算的标签向量 `label-embeddings.json`。
- `private/`：本地测试照片等，不提交（`private/samples/` 放样本照片）。

## 禁止事项
- 不提交照片、模型文件、`.env`、`private/` 下的任何内容。提交前运行 `git status` 确认。
- 不引入构建工具或 npm 依赖。
