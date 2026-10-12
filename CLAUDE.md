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
- PROGRESS.md 只保留最近一次工作，不超过 60 行。更新前把上一次的记录移到 docs/HISTORY.md 顶部；已关闭的问题直接删除（结论写进 CLAUDE.md）。

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
- 平台：PWA，托管在 GitHub Pages。无构建步骤，无后端。第三方库放在 `vendor/`（本站加载，不用 CDN：jsDelivr 在中国打不开，2026-10-12 用户实测），固定版本号，来源 URL、许可证和 sha256 见 `vendor/README.md`，LICENSE 文件一起放进去。模型下载地址在 `config.js` 各模型的 `hosts`，按顺序尝试，网络错误时换下一个。
- 国内（2026-10-12 用户实测，诊断页 `check.html`）：网页打不开 huggingface.co 和 hf-mirror.com（"Load failed"），能打开 GitHub Pages。
  - 分类模型 SigLIP（Apache-2.0）放在自己的仓库 `Vincennes-Wang/closet-models`（Pages：https://vincennes-wang.github.io/closet-models/，目录结构和 HF 一样，固定版本，见该仓库 README）。`CLASSIFY_MODEL.hosts` 先用它，再用 HF。
  - 抠图模型 RMBG 只在 HF，不转发（许可原文打不开，下载要填表）。国内下载不了时跳过抠图：本任务照片标为"未抠图"、保留原图，照常分类；下个任务再试。国内怎样抠图以后再议。
  - "上次抠图"一行显示"分类模型 <域名>"。诊断页 `check.html`（"关于"区有链接）逐个检查本站文件和两个模型地址。
- 放弃 Safari 26 以下的设备（iOS 17 实测跑不通，2026-10-12）。
- 个人数据（衣物照片、搭配）只存在用户浏览器的 IndexedDB 中，绝不进仓库。
- 应用内抠图：RMBG-1.4（`briaai/RMBG-1.4`，Bria 非商用许可，允许个人非商用使用）。模型 ID 只在 `config.js` 的 `MATTING_MODEL.id` 定义，换模型只改这一处。
- 抠图是可选功能（2026-10-11 决策）：抠图失败或用户选"用原图"时，原图照常录入，应用完整可用。阶段 2a 在录入时批量抠图（队列），见下方"阶段计划"。仍接收透明 PNG（例如别处抠好的图）。
- 备选方案：iOS 系统抠图（2026-10-11 用户真机验证可行，更正之前的"做不到"）。在"照片"里长按衣服，等系统抠出主体 → 菜单选"共享" → "保存图像"，得到透明 PNG，再在应用里录入。应用显示为棋盘格背景、`hasAlpha: true`。只作备选，主方案仍是应用内 RMBG。之前的"'文件'App 移除背景"说法不对，不要再用。应用内暂不加系统抠图提示。粘贴导入（照片"拷贝主体"后粘贴）已取消（2026-10-11），用"保存图像"再选图录入代替。
- 商用前置条件：如果以后收费或商用，必须先替换抠图模型，或购买 Bria 商业许可。替换候选（2026-10-10 核实）：`studioludens/birefnet-lite-512`（MIT，同类 `onnx-community/BiRefNet_512x512-ONNX` 也是 MIT）、`Xenova/slimsam-77-uniform`（SlimSAM，Apache-2.0，需要点选提示，不是全自动）。
- 其他模型（分类等）仍优先选 MIT / Apache-2.0。
- 页面"关于"区域注明使用了 RMBG-1.4 及其许可。
- 分类在浏览器内运行：Transformers.js + WebGPU，WASM 兜底。手机端只加载 fashionSigLIP 图像模型（q4f16），在 Worker 中运行；标签文字向量在 Mac 上预先算好，存为根目录 `label-embeddings.json`（不是个人数据，可以提交，见下方模型表）。阶段 0 在 iPhone 上 3/3 成功，约 210 ms/张。

### 阶段计划（2026-10-11 调整：先做 AI 录入，备份放后面）
| 阶段 | 内容 | 验收 |
|---|---|---|
| 2a | 批量抠图队列：选图 → 存队列 → 每次页面加载抠 K 张（默认 2）→ 自动刷新续传；崩溃恢复、暂停、取消、屏幕常亮 | iPhone（主屏幕图标打开，普通模式）一次选 12 张，不手动操作，全部处理完；报告成功数、失败数、自动刷新次数、崩溃恢复次数、总耗时 |
| 2b | 二级分类 + 待确认列表：`taxonomy.js`、Mac 端生成标签向量脚本、Worker 分类（每次加载最多 M 张，默认 10）、待确认列表 | iPhone 一次选 12 张，从选图到全部进入待确认列表不手动操作；20 张样本的准确率报告 |
| 3 | 备份（导出 / 导入） | Mac Safari、iPhone 导出 → 清空 → 导入全部恢复；再导入全部跳过 |
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
  - 上衣：休闲短袖（夏）、运动短袖（夏）（2026-10-11 由"短袖"拆分）、长袖线衣（春秋）、背心（夏）、衬衫（春秋）、薄毛衣（春秋）、厚毛衣（冬）、外搭（春秋；开衫、罩衫等叠穿在外面的上衣，英文 prompt 要和夹克、风衣区分开）
  - 裤子：短裤（夏）、牛仔裤（春秋冬）、休闲裤（春秋）、西裤（春秋）、运动裤（春秋）、打底裤（春秋冬）
  - 外套：风衣（春秋）、运动服（春秋）、呢子大衣（冬）、夹克（春秋）
  - 鞋：皮鞋、运动鞋、板鞋、老爹鞋（春秋）、靴子（冬）、凉鞋（夏）
  - 裙子：连衣裙、半身裙（春夏秋）
- 分类管理界面放到阶段 4 做。

### 阶段 0 结论（2026-10-11）
- iPhone 上 RMBG-1.4 的内存在整个页面生命周期内累积。终止 Worker 不能释放这部分内存。
- 所以抠图分批：每批结果存 IndexedDB，然后自动刷新页面续传下一批。每批张数见下方「阶段 2a 实现」的 `MATTING_PER_LOAD`。
- 详细测试记录见 `docs/HISTORY.md`。

### 阶段 1 决策（2026-10-11）
- 图片存储格式：长边缩到 1024，不存原图。有透明区域的图存 WebP；浏览器不能输出带透明的 WebP 时存 PNG。没有透明区域的图存 JPEG 0.9。启动时用 `image.js` 的 `probeWebpAlpha()` 检测，结果显示在页面"关于"区。
- WebP 透明实测：Mac Chrome 155 可以；Mac Safari 27.0.1 不可以（`toBlob('image/webp')` 返回 `image/png`），所以 Safari 上透明图存 PNG。iPhone（iOS 27，2026-10-11 真机）：同样返回 `image/png`，透明图存 PNG。
- 衣物记录字段见 `store.js` 的 `newItem()`：分类只存 `categoryId`、`subcategoryId`（来自 `taxonomy.js`），季节、场景的取值在 `options.js`。改了取值要考虑已存数据。
- `store.js` 是唯一访问 IndexedDB 的模块（数据库 `closet` v3：`items` 衣物、`queue` 待确认照片、`meta` 任务状态 `job` 和本设备设置 `device`、`categories` 自建分类和改名/隐藏）。改表结构必须升版本号并写迁移。例外：v1 → v2、v2 → v3 经用户确认直接清空，不迁移。
- Service Worker 缓存名 `closet-vN`（`sw.js`）。改了任何应用文件，发布前把 N 加 1，否则用户手机上一直是旧版本。
- Safari 坑（2026-10-11 确认）：从 IndexedDB 读出的 Blob 不能原样 put 回去，否则本次会话里该记录的图片读不出来（"The object can not be found here"，刷新后恢复）。`store.update()` 先复制成新 Blob 再写入。以后任何"读出再写回"带 Blob 的记录都要这样做。Chrome 不复现，只能在 Safari 验证。
- Safari 坑二（2026-10-11 确认，2a）：记录被改写后，改写前读出的 Blob 也读不出来（`createImageBitmap` 报 "An error occured reading the Blob argument"）。改写记录后要用改写后的新 Blob（`queue.js` 用 `markProcessing()` 的返回值）。

### 阶段 2a 实现（2026-10-11）
- 配置只在 `config.js`：`MATTING_MODEL`、`MATTING_PER_LOAD`（每次加载抠几张。阶段 0 定 3 张；2026-10-11 改为 2 张：第四次实测只抠图时第 3 张崩溃；2b 验收时每页第 2 张崩溃过，再改为 1 张，见 `docs/HISTORY.md`）、`MAX_ATTEMPTS`（同一张失败几次标为失败，默认 2）。
- `queue.js`：任务分两段（2b 起）：`phase = matting` 抠图，全部抠完刷新一次，`phase = classify` 分类（每次加载最多 `CLASSIFY_PER_LOAD` 张，2026-10-11 由 10 改为 6）。两段的差别都在 `PHASES` 里；等待、续传、崩溃恢复、时间线两段共用。队列记录的分类状态在 `classify` 字段（status、attempts、top3）。任务状态存 `meta.job`。页面加载时：`processing` 记录 = 上次崩溃，attempts+1；加载模型时连续崩溃 2 次自动暂停，防止无限刷新。
- `model-worker.js`：抠图 Worker（复制自 `spike/rmbg-worker.js`）。后端由 `config.js` `pickBackend()` 选：没有 WebGPU，或 fp16 / q4f16 模型遇到显卡不支持 `shader-f16`（电脑 360 浏览器，2026-10-12），改用 WASM + `wasmDtype`。抠图结果不透明像素少于 `EMPTY_MASK_RATIO` 算空遮罩（小米手机 WebGPU，2026-10-12）：用 WebGPU 时本设备记住 `meta.device.noWebgpu`（旧键 `mattingNoWebgpu` 也认），刷新后用 WASM 重抠，以后抠图和分类都只用 WASM（小米 WebGPU 分类结果也离谱，`queue.js`）。测试用 `?fakeEmptyMask=1` 模拟。URL 加 `?fakeMatting=毫秒` 时不加载模型，测试用。
- 全部抠完后再刷新一次，等 `RESULTS_DELAY_MS`（2 秒）再显示结果（iPhone 两次验收都在显示 12 张结果图时崩溃）。
- 队列只显示缩略图（记录字段 `thumb`，长边 `THUMB_SIDE` = 256），"录入"时才用原尺寸。每批结束先 `dispose` 模型再结束 Worker、刷新。
- 刷新后（任务第一次加载除外）等 `LOAD_DELAY_MS`（3 秒）再加载模型。iPhone 前三次验收 6 次崩溃里有 4 次在"刷新后马上加载模型"。
- `saveCutout()` 只在记录仍是 `processing` 时保存，已取消或已判为崩溃的不覆盖。
- 用时提示（2026-10-12）：开始前用 `queue.js` `guessBackend()` 猜本设备后端，WASM 时提示"这台设备处理较慢，N 张约需 X 分钟"（经验值 `config.js` `ESTIMATE_MS`）。处理中显示"剩余约 X 分钟"：每段已完成照片的实际平均（`job.timing`，含刷新和等待），没有时用经验值。
- 事件时间线存 `job.events`，界面"详细记录"可展开，用来确认崩在哪一步。时间线文字在 `queue.js` `EVENT_TEXT`。
- 发布后第一次打开，Service Worker 先给旧文件、后台更新，第二次打开才是新版（Safari 实测）。验收前先打开一次、完全关掉再开。
- 选图时透明图直接算"已抠图"。取消后剩下的标为"未抠图"，保留原图。处理完的照片进待确认列表（`app.js` `reviewCard`）：建议分类 + 另外 2 个候选、其他分类、季节、"用原图"、确认 / 全部确认。确认用 `store.confirmQueued()`：同一个事务里新建衣物、删除队列记录，图片只存一份。新录入只走这条路；`itemFields` 只用于编辑。

### 阶段 3 备份（2026-10-12）
- `backup.js`：自己写的 ZIP（只存储、不压缩，CRC32），不加依赖。导出时逐个读图算 CRC，拼接用原始 Blob；导入用 `blob.slice` 逐个取文件并校验 CRC，不把整个 ZIP 读进内存。
- 格式 `formatVersion: 1`：`manifest.json`（formatVersion、exportedAt、appVersion = SW 缓存名、dbVersion、itemCount、全部衣物记录含已归档、categories 表全部记录；图片字段写成 ZIP 内文件名）+ `images/<id>.webp|png|jpg`。不导出 queue、meta（job、device、backup）。
- 导入：先 `parseBackup()` 全部校验（版本、衣物字段 `store.validate()`、分类 `taxonomy.js` `categoryError()`（内置组合或备份里的自建分类）、每张图存在且 CRC 正确），再 `store.importData()` 一个事务写入。合并：衣物和分类记录 id 已存在就跳过（不覆盖本机修改）。任何一步失败数据库不变。图片复制成新 Blob 再写入（Safari 坑）。
- 改了衣物字段（`store.js` `newItem()`）必须同时改 `backup.js` `FIELDS`，`FORMAT_VERSION` 加 1，并保留旧版本的导入。
- 导出：手机（`pointer: coarse` 且支持 `navigator.canShare({ files })`）用分享菜单（iPhone"存储到文件"），其他用下载。分享报 NotAllowedError（生成 ZIP 太久，不再算用户点击）时显示"保存备份文件"按钮让用户再点一次。分享成功或已下载才记录备份时间（`meta.backup`，本机，不导出）。
- 页头"上次备份：今天 / N 天前 / 还没有备份"；超过 7 天、或有衣物却从未备份时用提醒色 `--warn`。处理照片时隐藏备份卡片。

### 配色（2026-10-11）
- 阿根廷蓝白：`style.css` 顶部的变量。天蓝 `#74acdf` 用于国旗条和选中状态（配墨蓝字）；深蓝 `#1f5a8e` 用于操作按钮（白字）；金色 `#f6b40e` 只用在页头的五月太阳。页头是简化国旗（上下天蓝条 + 白底）。
- 图标是白色衣架 + 天蓝底。iPhone 主屏幕图标要删掉后重新"添加到主屏幕"才会更新。

## 已核实的模型（2026-10-10，查 Hugging Face API）
| 用途 | 仓库 | 许可证 | 备注 |
|---|---|---|---|
| 运行库 | `@huggingface/transformers@4.3.1`（`vendor/transformers-4.3.1/transformers.min.js`）+ 内置版本的 `onnxruntime-web` wasm | Apache-2.0 / MIT | 浏览器缓存默认开启（Cache API `transformers-cache`）。不要用 `transformers.web.min.js`：它含裸模块名 `onnxruntime-web/webgpu`，浏览器无法解析 |
| 抠图（已放弃） | `onnx-community/BiRefNet_lite-ONNX` | MIT | fp16 114.5 MB / fp32 224 MB。模型卡示例里的 `onnx-community/BiRefNet_lite` 不存在。**Mac Chrome 上跑不通**：WebGPU 超出 storage buffer 上限（需 11，上限 10），WASM 内存不足；输入固定 1024² |
| 抠图（对照） | `Xenova/modnet` | Apache-2.0 | fp16 13 MB / uint8 6.6 MB。人像抠图模型，衣物平铺图大量破洞，不可用 |
| 抠图（应用内） | `briaai/RMBG-1.4` | Bria 非商用（模型卡："source-available model for non-commercial use"，Creative Commons 非商用；商用需与 Bria 签协议。卡片上的许可页链接 2026-10-10 返回 404） | fp16 88 MB / quantized 44 MB。Mac Chrome 效果最好，WebGPU 222 ms/张；iPhone（Safari 27）WebGPU fp16 可用，首张 1.6 s。小米手机（Chrome/Opera）WebGPU fp16、fp32 输出无效遮罩（结果全透明），WASM 正常，约 18 s/张；三星 Chrome、华为鸿蒙浏览器正常（2026-10-12） |
| 分类 | `Marqo/marqo-fashionSigLIP`（应用从 `closet-models` 仓库下载 q4f16 / int8 图像模型，HF 兜底） | Apache-2.0 | `SiglipTextModel` + `SiglipVisionModel`；vision fp16 186 MB / q4f16 54 MB / int8 94 MB，text fp16 221 MB。小米手机 WebGPU q4f16 分类结果离谱，WASM int8 正确，约 2 s/张（2026-10-12） |
| 标签向量 | `label-embeddings.json`（根目录，应用用） | – | `node tools/embed.mjs` 用 fashionSigLIP fp32 文本模型生成，内容来自 `taxonomy.js`。改了英文 prompt 必须重新生成，测试会检查。`spike/label-embeddings.json` 只给 spike 用 |

## 目录
- 根目录：应用（`index.html`、`app.js` 界面、`store.js` 存储、`image.js` 图片处理、`options.js` 选项、`config.js` 配置、`queue.js` 抠图队列、`model-worker.js` 模型 Worker、`backup.js` 备份 ZIP、`check.html` 网络检查、`sw.js`、`manifest.webmanifest`、`icons/`）。
- `vendor/`：第三方库（transformers.js、ONNX Runtime），见 `vendor/README.md`。
- `docs/HISTORY.md`：PROGRESS.md 移出的旧记录。
- `tests/`：`node --test tests/*.test.mjs`。`store.test.mjs` 测纯函数；`browser.test.mjs` 用 headless Chrome（CDP，`tests/cdp.mjs`，无依赖）测真实 IndexedDB、录入流程、抠图队列（假模型）和离线打开。模拟崩溃用"处理中直接重新打开页面"，不用 CDP `Page.crash`（装了 Service Worker 后崩溃后的导航不返回）。需要本机装有 Chrome。
- `tools/`：Mac 上运行的脚本。`embed.mjs` 生成标签向量；`eval.mjs` 用 `private/samples` + `private/labels.json` 算分类准确率。都用 headless Chrome（`tests/cdp.mjs`），不加依赖。
- `spike/`：阶段 0 验证页（`index.html` 单文件）和预计算的标签向量 `label-embeddings.json`。
- `private/`：本地测试照片等，不提交（`private/samples/` 放样本照片）。

## 禁止事项
- 不提交照片、模型文件、`.env`、`private/` 下的任何内容。提交前运行 `git status` 确认。
- 不引入构建工具或 npm 依赖。
