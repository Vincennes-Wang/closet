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
- 抠图是可选功能（2026-10-11 决策）：抠图失败或用户选"用原图"时，原图照常录入，应用完整可用。阶段 2a 在录入时批量抠图（队列），见下方"阶段计划"。仍接收透明 PNG（例如别处抠好的图）。
- 备选方案：iOS 系统抠图（2026-10-11 用户真机验证可行，更正之前的"做不到"）。在"照片"里长按衣服，等系统抠出主体 → 菜单选"共享" → "保存图像"，得到透明 PNG，再在应用里录入。应用显示为棋盘格背景、`hasAlpha: true`。只作备选，主方案仍是应用内 RMBG。之前的"'文件'App 移除背景"说法不对，不要再用。应用内暂不加系统抠图提示。
- 商用前置条件：如果以后收费或商用，必须先替换抠图模型，或购买 Bria 商业许可。替换候选（2026-10-10 核实）：`studioludens/birefnet-lite-512`（MIT，同类 `onnx-community/BiRefNet_512x512-ONNX` 也是 MIT）、`Xenova/slimsam-77-uniform`（SlimSAM，Apache-2.0，需要点选提示，不是全自动）。
- 其他模型（分类等）仍优先选 MIT / Apache-2.0。
- 页面"关于"区域注明使用了 RMBG-1.4 及其许可。
- 分类在浏览器内运行：Transformers.js + WebGPU，WASM 兜底。手机端只加载 fashionSigLIP 图像模型；标签文字向量在 Mac 上预先算好，存为 `spike/label-embeddings.json`（不是个人数据，可以提交）。

### 阶段计划（2026-10-11 调整：先做 AI 录入，备份放后面）
| 阶段 | 内容 | 验收 |
|---|---|---|
| 2a | 批量抠图队列：选图 → 存队列 → 每次页面加载抠 K 张（默认 2）→ 自动刷新续传；崩溃恢复、暂停、取消、屏幕常亮 | iPhone（主屏幕图标打开，普通模式）一次选 12 张，不手动操作，全部处理完；报告成功数、失败数、自动刷新次数、崩溃恢复次数、总耗时 |
| 2b | 二级分类 + 待确认列表：`taxonomy.js`、Mac 端生成标签向量脚本、Worker 分类（每次加载最多 M 张，默认 10）、待确认列表 | iPhone 一次选 12 张，从选图到全部进入待确认列表不手动操作；20 张样本的准确率报告 |
| 3 | 备份（导出 / 导入） | |
| 4 | 衣橱筛选 + 槽位式搭配；分类管理界面 | |
| 5 | 下周穿搭：周日排好下周每天穿什么，参考天气预报 | |
| 6 | 交付 | |

每个阶段（2a、2b 分开）开始前用 Plan mode 给计划，用户确认后再写代码。2a 在 iPhone 验收通过后才开始 2b。

### 分类规则（2b 起生效，2026-10-11 用户确认）
- `taxonomy.js` 是分类的唯一来源。界面、分类器、季节规则都从这里读。
- 衣物记录只存 `categoryId` 和 `subcategoryId`，不存中文名。
- 内置分类每项包含：`id`（固定英文，例如 `top.cardigan_layer`）、中文名、英文 prompt、默认季节、`builtin: true`。
- IndexedDB 分类表存用户自建分类，以及对内置分类的改名和隐藏。界面显示的分类 = 内置分类 + 用户分类 − 隐藏的分类。
- 分类器只对 `builtin` 的二级分类打分。自建分类不参与 AI 识别，只能手动选择。
- 改名只改显示名，`id` 不变。
- 分类下还有衣物时不允许删除，需要先移走衣物。
- 内置分类可以改名、隐藏，不能删除。
- 箱包、配饰、帽子、套装：只有一级分类，不设二级分类。
- 二级分类表和默认季节：
  - 上衣：短袖（夏）、长袖线衣（春秋）、背心（夏）、衬衫（春秋）、薄毛衣（春秋）、厚毛衣（冬）、外搭（春秋；开衫、罩衫等叠穿在外面的上衣，英文 prompt 要和夹克、风衣区分开）
  - 裤子：短裤（夏）、牛仔裤（春秋冬）、休闲裤（春秋）、西裤（春秋）、运动裤（春秋）、打底裤（春秋冬）
  - 外套：风衣（春秋）、运动服（春秋）、呢子大衣（冬）、夹克（春秋）
  - 鞋：皮鞋、运动鞋、板鞋、老爹鞋（春秋）、靴子（冬）、凉鞋（夏）
  - 裙子：连衣裙、半身裙（春夏秋）
- 分类管理界面放到阶段 4 做。

### 阶段 0 结论（2026-10-11）
- iPhone 上 RMBG-1.4 的内存在整个页面生命周期内累积。终止 Worker 不能释放这部分内存。
- 阶段 2a 接入 AI 抠图：每批 2 张（2026-10-11 由 3 张改为 2 张：第四次实测只抠图时第 3 张崩溃），结果存 IndexedDB，然后自动刷新页面续传下一批。
- iOS 系统抠图恢复为备选（2026-10-11 更正），见上方"备选方案"。
- 分类模型：fashionSigLIP q4f16，只加载图像模型，在 Worker 中运行（阶段 2b 接入）。

### 阶段 1 决策（2026-10-11）
- 图片存储格式：长边缩到 1024，不存原图。有透明区域的图存 WebP；浏览器不能输出带透明的 WebP 时存 PNG。没有透明区域的图存 JPEG 0.9。启动时用 `image.js` 的 `probeWebpAlpha()` 检测，结果显示在页面"关于"区。
- WebP 透明实测：Mac Chrome 155 可以；Mac Safari 27.0.1 不可以（`toBlob('image/webp')` 返回 `image/png`），所以 Safari 上透明图存 PNG。iPhone（iOS 27，2026-10-11 真机）：同样返回 `image/png`，透明图存 PNG。
- 衣物记录字段见 `store.js` 的 `newItem()`；分类、季节、场景的取值只在 `options.js` 定义。改了取值要考虑已存数据。
- `store.js` 是唯一访问 IndexedDB 的模块（数据库 `closet` v1，仓库 `items`）。改表结构必须升版本号并写迁移。
- Service Worker 缓存名 `closet-vN`（`sw.js`）。改了任何应用文件，发布前把 N 加 1，否则用户手机上一直是旧版本。
- Safari 坑（2026-10-11 确认）：从 IndexedDB 读出的 Blob 不能原样 put 回去，否则本次会话里该记录的图片读不出来（"The object can not be found here"，刷新后恢复）。`store.update()` 先复制成新 Blob 再写入。以后任何"读出再写回"带 Blob 的记录都要这样做。Chrome 不复现，只能在 Safari 验证。

### 配色（2026-10-11）
- 阿根廷蓝白：`style.css` 顶部的变量。天蓝 `#74acdf` 用于国旗条和选中状态（配墨蓝字）；深蓝 `#1f5a8e` 用于操作按钮（白字）；金色 `#f6b40e` 只用在页头的五月太阳。页头是简化国旗（上下天蓝条 + 白底）。
- 图标是白色衣架 + 天蓝底。iPhone 主屏幕图标要删掉后重新"添加到主屏幕"才会更新。

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
