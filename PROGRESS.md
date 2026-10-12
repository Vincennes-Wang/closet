# PROGRESS
- 状态：进行中
- 当前阶段：国内跑通模型下载（诊断页 + 自动换镜像），待国内测试；之后 B = 阶段 3 备份（导出 / 导入）
- 累计用时：约 25（本次约 1 小时，估计）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）

## 最近一次工作（2026-10-12，国内模型下载）
- 用户反馈：A 在 iPhone 通过。国内朋友 Safari 27 报"加载抠图模型失败：Load failed"。iOS 17 也不行，用户决定放弃 Safari 26 以下的设备。
- 已确认：错误原文就是 "Load failed"，即 Safari 的 `fetch` 网络错误，没有被 ONNX Runtime 包装，所以是下载模型文件的请求失败，不是 vendor 文件。哪个请求失败（huggingface.co 本身，还是大文件 CDN `us.aws.cdn.hf.co`）未确认。
- 完成：
  - 从 git 历史删除旧 Safari 用的 `ort-wasm-simd-threaded.{wasm,mjs}`（filter-branch，用户执行），强制推送；文档同步。
  - 诊断页 `check.html`：在浏览器里逐个下载本站 vendor 文件和两个模型地址（huggingface.co、hf-mirror.com）的 config、preprocessor、模型前 1 MB，显示状态、最终域名、耗时、错误原文，可复制结果。"关于"区加链接。本站文件加 `?net` 绕过 SW。
  - 自动换镜像：`config.js` `MODEL_HOSTS`，网络错误（TypeError）时换下一个地址；本设备记住成功的地址（`meta.device.modelHost`）；"上次抠图"一行显示域名。缓存名 `closet-v19`。
- 验证结果：
  - `node --test tests/*.test.mjs` 28/28 通过。新增浏览器测试（`?fakeHostFail=huggingface.co`）：先确认失败，再实现；断言换到 hf-mirror.com、本设备记住、下个任务直接用它。
  - 真模型（Mac Chrome，huggingface.co 设为解析失败）：transformers.js 报原始 `TypeError: Failed to fetch`，应用依次请求了 huggingface.co 和 hf-mirror.com，证明换地址生效。hf-mirror.com 从巴黎访问 308 跳回 huggingface.co 且没有 CORS 头，所以两者都失败，镜像在国内能否用只能国内测。
  - 诊断页（Mac Chrome，390 宽截图）：本站 2 项、huggingface.co 3 项成功（模型落在 `us.aws.cdn.hf.co`）；hf-mirror.com 3 项 `Failed to fetch`（原因同上）。

## 下次从这里继续
1. 看国内朋友的诊断页截图：
   - hf-mirror.com 成功：再在应用里录 1 张，"上次抠图"一行应显示 `hf-mirror.com`。
   - huggingface.co 和 hf-mirror.com 都失败：Plan mode 给"模型文件放 GitHub Pages"的计划（RMBG quantized 44 MB、fp16 88 MB；SigLIP q4f16 54 MB、int8 94 MB）。
2. 国内跑通后做 B（阶段 3 备份）：Plan mode 给计划。
3. 下次 iPhone 录入时顺便看分类每页 6 张后是否还崩溃（看"详细记录"）。

## 未解决问题
- 国内模型下载："Load failed" 是哪个请求失败未确认，等诊断页结果。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）来自 iPhone 和小米各一次实测，未在其他设备核对。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
- iPhone 第一轮失败原因未确认（没有 JSON），现在已不需要。
