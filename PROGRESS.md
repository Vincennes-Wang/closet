# PROGRESS
- 状态：进行中
- 当前阶段：阶段 1 — 应用骨架 + 手动录入（代码完成，待 Mac Safari 和 iPhone 真机验收）
- 累计用时：6
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/spike/（阶段 0 验证页）

## 阶段 0 总结（2026-10-11 结束）
- 结论：
  - iPhone 上 RMBG-1.4 的内存在整个页面生命周期内累积，终止 Worker 不能释放。主线程做法第 3 张崩溃；Worker + 每 2 张重启做法第 5 张前崩溃。
  - 分类（fashionSigLIP q4f16，只加载图像模型 + 预计算标签向量）在 iPhone 上稳定：3/3 成功，约 210 ms/张，下载 54 MB。
- 决策：
  - 阶段 5 接入 AI 抠图时采用"每批 3 张 + 结果存 IndexedDB + 自动刷新页面续传"。验收：连续 3 批共 9 张不崩溃。
  - iOS 系统抠图（透明 PNG）始终作为批量录入和兜底方案。
  - 分类模型用 fashionSigLIP q4f16，只加载图像模型，在 Worker 中运行（阶段 5 接入）。
- 详细测试记录见文末"阶段 0 详细记录"。

## 最近一次工作（2026-10-11，阶段 1）
- 完成：
  - 根目录应用：`index.html` + ES modules，无框架、无构建。`spike/` 未改。
  - PWA：`manifest.webmanifest`、衣架图标（Node 脚本生成，无依赖）、`sw.js` 预缓存应用文件（缓存优先、后台更新，缓存名 `closet-v1`）。启动时调用 `navigator.storage.persist()`，页面顶部显示结果和已用空间。
  - `store.js`：唯一访问 IndexedDB 的模块。字段按要求，不含价格、材质；保存前校验分类、季节、场景取值。
  - 录入：拍照 / 相册 / "文件"多选；`createImageBitmap` 直接缩到长边 1024，不存原图；检测透明区域记入 `hasAlpha`，无透明时提示用"文件"App"移除背景"后重新上传；分类单选，季节、场景多选按钮。
  - 存储格式：透明图 WebP（浏览器不支持带透明的 WebP 时 PNG），不透明图 JPEG 0.9。
  - 衣橱：按一级分类分组；点开可编辑、归档；"显示已归档"里可恢复或彻底删除（二次确认）。
  - 测试：`node --test tests/*.test.mjs`，不用 fake-indexeddb，无新依赖。纯函数用 node:test；真实 IndexedDB 和录入流程用 headless Chrome（CDP）。
- 验证结果：
  - `node --test tests/*.test.mjs`：8/8 通过，连跑 3 次稳定。覆盖：增删改查、归档 / 恢复、重开数据库数据仍在、录入 2 件（透明 PNG → WebP，不透明 JPEG → JPEG，均缩到 1024×768）、刷新后仍在、编辑、归档、Service Worker 接管后断网刷新仍能打开。
  - 变异测试：把长边改成 1000，浏览器测试失败；改回后通过。说明测试能发现缩图错误。
  - 单元测试发现并修复 1 个 bug：`scenes` 传字符串时会被拆成单字，现在会报"必须是数组"。
  - 浏览器测试第一次全过属于时序巧合：`app.js` 在 `await openStore()` 之后才绑定事件，测试在绑定前就触发了选图。用户手动操作不会碰到。已加就绪标记 `<html data-ready="1">`，测试等它出现再操作。
  - Mac Safari 27.0.1：`toBlob('image/webp')` 返回 `image/png`，透明图会存 PNG（本地探测页 + 日志确认）；`navigator.storage.persist` 存在。
  - Mac Safari 录入 5 件：**未做**。safaridriver 未开启，不能自动化，也没有截屏权限。需要用户手动测。
  - 手机尺寸截图（headless Chrome 390 px 宽）：布局正常，透明图显示棋盘格背景。

## 下次从这里继续
1. 看用户的 Mac Safari 和 iPhone 验收结果；把 iPhone 的 WebP 检测结果写进 CLAUDE.md「阶段 1 决策」。
2. 验收通过后进入下一阶段（搭配或导出导入，按总计划）。

## 未解决问题
- ~~没有可商用、在浏览器跑得通、效果合格的抠图模型~~ — 已决策（2026-10-10）：非商用定位，应用内用 RMBG-1.4，iOS 系统抠图保底。
- ~~同一页面内 BiRefNet 从 WebGPU 回退到 WASM 后仍报 WebGPU 错误~~ — **已放弃**（2026-10-10）：BiRefNet_lite 不再使用，不排查。
- iPhone 第一轮失败原因未确认（没有 JSON）。第一轮页面默认加载 BiRefNet + SigLIP fp16（共约 520 MB），第二轮默认什么都不加载；要确认是不是这个原因，可以在 iPhone 上用第一轮的组合再跑一次，但现在已不需要。
- 系统抠图导入 / 粘贴没有在 iPhone 上验证（用户决定不测）。如果以后要靠系统抠图保底，需要重新验证。
- ~~iPhone 上抠图：主线程做法第 3 张必崩；Worker + 每 2 张重启做法第 5 张前崩溃~~ — 已决策（2026-10-11）：阶段 5 用"每批 3 张 + 存 IndexedDB + 自动刷新续传"，见阶段 0 总结。
- 厚度在 q4f16 下和 fp32 有 4/20 不一致，阶段 1 前要用人工标注确认哪个更准。
- iPhone 上 `toBlob('image/webp')` 能否保留透明：未测。Mac Safari 不能，预计 iPhone 也存 PNG（同为 WebKit，这是推断）。
- 粘贴导入（照片"拷贝主体"后粘贴）阶段 1 没做，计划阶段 5 与系统抠图一起做。

## 阶段 0 详细记录（2026-10-10 至 10-11）
- 完成：
  - 仓库初始化（CLAUDE.md、PROGRESS.md、.gitignore）。样本文件夹 `private:samples` 改名为 `private/samples`（原名不会被 `.gitignore` 忽略）。
  - `spike/index.html`：选图 → 抠图（BiRefNet_lite / MODNet / RMBG-1.4）→ fashionSigLIP 零样本分类（品类 / 袖长 / 厚度 top-3）→ 指标面板 → 复制结果 JSON。
  - **第二轮（收尾）**：
    - 决策（同日修订）：项目定位为个人和家人朋友免费使用，非商用。应用内抠图用 RMBG-1.4（Bria 非商用许可）；iOS 系统抠图（"文件"批量"移除背景" / 照片"拷贝主体"）作为保底。以后收费或商用前，必须替换抠图模型或购买 Bria 商业许可。页面新增"关于"区域注明 RMBG-1.4 及其许可。
    - 背景：iPhone 上第一轮一次都没跑通，单张图也不行（用户实测，未拿到报错 JSON）。RMBG-1.4 能否在 iPhone 上跑，仍待真机验证。
    - spike 新增「系统抠图导入」：从"文件"多选 PNG、粘贴（contenteditable 粘贴框），检测透明通道，再分类，结果记入 JSON 的 `imports`。
    - 分类减负：`spike/label-embeddings.json`（fashionSigLIP fp32 文本模型在 Mac 上生成，145 KB）。手机端默认只加载图像模型；图像 dtype 可切 fp16 / q4f16 / int8 / fp32。
    - 抠图默认改为"不抠图"，iPhone 打开页面不会加载任何抠图模型。
    - 页面记录"上次会话停在哪一步"（localStorage），崩溃后重开能看到。
  - 第二轮验证（Mac Chrome 155，20 张样本，先用 RMBG 抠图再分类）：
    - 预计算（fp32 文本）vs 实时（fp16 文本），同一图像向量下的 top-1 一致数：

| 图像 dtype | 品类 | 袖长 | 厚度 | 不一致项（两边分数） |
|---|---|---|---|---|
| fp16 | 20/20 | 19/20 | 20/20 | IMG_4021 裤子 袖长：长袖 47.1% vs 短袖 46.6% |
| q4f16 | 20/20 | 20/20 | 20/20 | – |
| int8 | 20/20 | 20/20 | 20/20 | – |
| fp32 | 20/20 | 19/20 | 19/20 | IMG_4021 袖长（同上）；IMG_4027 厚度：中 49.6% vs 薄 49.9% |

    - 结论：不一致只出现在前两名几乎打平的情况（差距 < 1 个百分点），来自文本模型 fp16 和 fp32 的精度差。手机端可以用预计算向量。
    - 图像 dtype 对 top-1 的影响（都用预计算向量，以 fp32 图像为基准）：fp16 三组都是 20/20；q4f16 为品类 20、袖长 19、厚度 16；int8 为品类 18、袖长 19、厚度 18。手机端建议先用 q4f16（54 MB，品类一致）；厚度要稳定的话再试 fp16（186 MB）。
    - 导入测试：20 张透明 PNG 全部识别为"已抠图"（透明 31–73%）；3 张原图 JPG 全部提示"未抠图"；模拟粘贴（页面内构造 `ClipboardEvent`）收到 PNG，透明占比 50%，与构造的图一致。真实 iOS 粘贴只能真机测。
    - 手机模式（预计算 + 图像 q4f16）总下载：53.7 MB 模型 + 145 KB 向量；不加载 tokenizer 和文本模型。单图分类 26 ms（Mac WebGPU）。
  - **iPhone 实测（2026-10-10，iOS 27，用户在"关于本机"确认）**：
    - UA：`iPhone OS 18_7 ... Version/27.0 Mobile Safari`。实际系统是 iOS 27：UA 里的"18_7"不是真实系统版本，Safari 版本号 27.0 与系统一致。以后从 JSON 判断系统版本时看 `Version/xx`。
    - RMBG-1.4 WebGPU fp16：✅ 1 张成功，抠图 1638 ms（首张，含着色器编译），缓存加载 1147 ms，无错误。
    - WebGPU：可用，shader-f16 支持，storage buffer 上限 **44**（Mac Chrome 只有 10）。
    - 分类：RMBG + 分类（SigLIP q4f16）一起跑时失败（用户反馈"一旦加入分类，就无法测试了"）。贴回的 JSON 与上一次完全相同（同一时间戳，`classify: false`），是剪贴板里的旧内容，这次运行没有留下数据，原因未确认。
    - 为此 spike 新增：每一步都把会话 JSON 存进 localStorage；页面崩溃后重开，出现「复制上次崩溃会话 JSON」按钮。JSON 增加 `sessionStartedAt` / `savedAt`，用来识别旧数据。Mac Chrome 上用 CDP `Page.crash` 模拟崩溃验证通过（崩溃在"处理 4/20"，重开后能看到该步骤和崩溃前已加载的模型）。
    - 系统抠图导入 / 粘贴：未测。用户找不到粘贴入口，也不想测这部分；RMBG 已能用，系统抠图只作保底，**不再测**。
  - **iPhone 第二次实测（iOS 27，崩溃会话 JSON）**：
    - 现象：页面自动刷新（iOS 杀掉了标签页进程）。
    - RMBG fp16 + SigLIP fp16（默认 dtype）：在"加载 siglip-vision（webgpu, fp16）"时崩溃。
    - 只分类，SigLIP q4f16：✅ 首张 634 ms，品类"背心 99%"正确。下载 53.7 MB。
    - "RMBG + q4f16"那次实际用的是 fp16：切换抠图模型时页面把 SigLIP dtype 重置成默认 fp16（页面 bug），旧的 q4f16 也没释放。崩溃时内存里有 q4f16 + RMBG fp16 + SigLIP fp16，约 330 MB 权重，崩在处理第 1 张时。
    - 已修：切换抠图模型不再改 SigLIP dtype；同一模型换 dtype 或后端时先释放旧的。Mac Chrome 按用户操作顺序复现验证通过（dtype 保持 q4f16；改 fp16 时日志出现"释放 siglip-vision|webgpu|q4f16"）。
    - 判断：iPhone 上的崩溃与同时驻留的模型总量有关（88 MB 单独可以，54 MB 单独可以，88+186 MB 不行）。具体内存上限未测。
  - **iPhone 第三次实测（iOS 27）**：RMBG fp16 + SigLIP q4f16 同时加载成功（共 142 MB）。第 1 张完整跑完（抠图 1693 ms，分类 204 ms，"背心 97%"正确），第 2 张开始处理（"处理 2/3"，分类前）时页面刷新。说明问题不只是权重总量，还和每张图处理时的内存峰值或逐张累积有关。原因未确认：RMBG 单独在 iPhone 上只测过 1 张，单独连跑多张是否也会崩还不知道。
    - spike 新增"串行"选项：先抠完全部图并释放 RMBG，再加载 SigLIP 分类；抠图结果暂存为 JPEG Blob；每张处理完把 canvas 宽度设为 0（iOS 要显式释放 canvas 内存）。Mac Chrome 验证：步骤顺序正确（抠完 → 释放 rmbg → 加载 siglip → 分类）；5 张样本串行与非串行 top-1 完全一致（5/5）。
  - **方案 a：Web Worker + 每 N 张重启**（2026-10-11，限时 1.5 小时）：
    - 诊断（Mac Safari，主线程旧做法，只抠图 5 张，按阶段读标签页进程内存）：**已确认两者都有**。加载 RMBG 后固定在约 1.0 GB（不加载模型时 60–175 MB）；之后逐张上涨 1.04 → 1.05 → 1.21 → 1.31 → 1.34 GB，第 3 张解码时峰值 1.58 GB。
    - 旧代码的释放情况（审查结论）：

| 对象 | 旧做法（主线程） | 新做法（Worker） |
|---|---|---|
| 输入 / 输出张量 | 从未 `dispose()` | 每张处理完全部 `dispose()` |
| ImageBitmap | `fileToCanvas` 里 `close()` | 主线程转移给 Worker，Worker 画完即 `close()` |
| object URL | 没用（用 dataURL，DOM 里一直保留） | 显示用 object URL，图片加载完立即 revoke |
| 临时 canvas | 上一轮起 `width = 0`（只在 C 区运行流程里） | OffscreenCanvas 用完 `width = 0` |
| 全尺寸原图解码 | 主线程 `createImageBitmap` 全尺寸解码（24 MP 约 98 MB） | 先用 `<img>` 的 onload 读尺寸（不触发全图解码），再让 `createImageBitmap` 直接输出长边 1024 的位图 |

    - 前提核实（Mac Safari）：`createImageBitmap` 的缩放选项可用（4284×5712 → 768×1024）；位图转移后主线程那份变 0×0；Worker 里有 WebGPU 适配器和 OffscreenCanvas。
    - 新增 `spike/rmbg-worker.js`：模型只在 Worker 里加载（RMBG 或 SigLIP 图像模型，从不同时驻留）。主线程负责缩图，抠完全部图后才开始分类；每 N 张执行 `dispose` → `terminate` → 新建 Worker。页面「D. Worker 模式」区可调 N（默认 2），记录每张耗时和每次重启耗时（JSON `workerRuns`）。
    - Mac Chrome：10 张，N=2 / 3 / 5 均无错误。抠图约 240 ms/张；重启耗时：抠图约 0.6 s，分类约 0.42 s。Worker 与主线程串行做法的分类 top-1 一致（10/10）。
    - Mac Safari（N=2，8 张，只抠图）：每批峰值 1.6–1.8 GB（与旧做法前 2 张相当）；`terminate` 后降到 0.65–0.73 GB；全部结束后降到 205 MB。说明重启确实释放了 Worker 占用的内存，但 terminate 后仍残留约 0.7 GB，第二批起点比第一批高。iPhone 上 N=2 能否稳定，需真机验证。
    - **iPhone 验收（iOS 27，普通模式，N=2，10 张，q4f16）：❌ 未达标。**
      - 抠图成功 4 张（1.59–1.68 s/张），比主线程做法多 2 张。
      - 第 1 次重启（第 2 张后）成功：dispose 5 ms，重启共 1.9 s，模型从缓存加载 1.5 s。
      - 第 2 次重启（第 4 张后）时页面刷新。JSON 里没有第 5 张的记录，也没有第 3 次加载记录，所以崩溃发生在"结束旧 Worker → 新 Worker 加载 RMBG"这一步或紧接其后。
      - 与 Mac Safari 的观察一致：terminate 后仍残留约 0.7 GB，内存没有完全回到起点，每批的起点逐渐抬高。这一点是推断，iPhone 上无法直接测内存。
      - 按限时规则停止，没有尝试其他方案（例如重启前等待、降低抠图分辨率、换更小的模型）。
  - **iPhone 第四次实测（iOS 27，每项都新开标签页，3 张图，SigLIP q4f16）**：
    - 只抠图（RMBG fp16）：第 1、2 张成功（1.8 s/张），第 3 张崩溃。
    - 只分类：3/3 成功，213 ms/张（不含首张），结果正确。
    - 串行：抠图阶段第 3 张崩溃（与只抠图相同）。用户另测串行 2 张：成功（抠图 1.8 s + 分类 0.2 s/张）。
    - 结论：问题出在抠图环节，且与 SigLIP 无关。只抠图也在第 3 张崩溃；同时加载 SigLIP 时提前到第 2 张。
    - 另外：这几次 `storageQuota` 从 41 GB 变成 1 GB，且每次都重新下载模型（`fromCache: false`）。原因已确认：用户用的是 Safari 无痕浏览，关闭标签页即清空缓存。以后测缓存要用普通模式。
  - **Mac 上的内存测量**（Safari 不能自动化，用 `open` 打开页面，`top` 读 WebKit 进程内存，进度用 `?beacon=1` 发到本地服务器日志，`?slow=毫秒` 在每个阶段后停顿）：
    - Chrome：RMBG 连跑 20 张，渲染进程稳定在约 1.6 GB，没有逐张增长。
    - Safari 标签页进程：只读图和显示 60–175 MB；RMBG fp16 WebGPU 约 1.0 GB；RMBG quantized WASM 约 1.45 GB；SigLIP q4f16 430–825 MB。模型在网页进程里的占用是模型文件的 8–30 倍。
    - Safari 逐张：前 3 张持续上涨（1.0 → 1.12 → 第 3 张解码时 1.53 GB），之后被回收、回落到 1.2 GB。与 iPhone 固定在第 3 张崩溃吻合：iOS 在回收之前就到了进程内存上限。这一点是推断，iPhone 上没有内存 API，无法直接确认。
    - 已试且无效：关闭 ONNX Runtime 内存池（`enableCpuMemArena` / `enableMemPattern`）对内存没有影响，已删除。串行和释放 canvas 有帮助（串行让抠图不受 SigLIP 影响），但解决不了抠图本身第 3 张崩溃。
  - **第一轮**结果见下表。
- 验证结果（第一轮，Mac Chrome 155，Apple M5，20 张样本，长边缩到 1024 px）：

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
  - Safari：未测（safaridriver 未开启）。iPhone：第一轮一次都没跑通（用户反馈，无 JSON）；第二轮 RMBG 跑通，见上。
