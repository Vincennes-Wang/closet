# PROGRESS
- 状态：进行中
- 当前阶段：国内可用（分类模型放 closet-models，国内跳过抠图），待国内真机确认；之后 B = 阶段 3 备份（导出 / 导入）
- 累计用时：约 26（本次约 1 小时，估计）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-12，国内：分类模型放 closet-models，抠图跳过）
- 诊断结果（国内 iPhone iOS 18.7，Safari 27，check.html）：GitHub Pages 正常（27 MB 用 5.4 s）；huggingface.co、hf-mirror.com 全部 `TypeError: Load failed`。
- 用户决定：国内先不抠图，以后再议；SigLIP 放新仓库；RMBG 不转发。
- 完成：
  - 新仓库 `Vincennes-Wang/closet-models`（公开，Pages 已开）：SigLIP `config.json`、`preprocessor_config.json`、`vision_model_q4f16.onnx`（54 MB）、`vision_model_int8.onnx`（94 MB），固定 HF 版本 `c56244c`，含 Apache-2.0 LICENSE 和 README（来源、sha256）。
  - `config.js`：每个模型自带 `hosts`。分类：closet-models → HF；抠图：只有 HF。删掉 hf-mirror.com 和"本设备记住地址"。
  - 抠图模型网络错误时不再暂停：本任务照片标为"未抠图"（保留原图），时间线记"抠图模型下载不了，跳过抠图"，刷新后分类。下个任务再试一次。
  - "上次抠图"一行：`取消` 改为 `未抠图`，末尾显示"分类模型 <域名>"。check.html 换成 closet-models + HF 两组。缓存名 `closet-v20`。
- 验证结果：
  - `node --test tests/*.test.mjs` 29/29 通过。改写 / 新增 2 个浏览器测试（先确认失败再实现）：HF 失败时抠图全部跳过、不暂停、分类完成、分类来自 github.io；closet-models 失败时分类改用 HF。
  - closet-models 线上 4 个文件：HTTP 200，大小、sha256 与 HF 的 LFS 记录一致，`access-control-allow-origin: *`。
  - 模拟国内（Mac Chrome 真模型，huggingface.co、*.hf.co、hf-mirror.com、jsDelivr 都设为解析失败），WebGPU 和 WASM 各 2 张：抠图 0.1 s 内跳过，分类模型从 closet-models 下载（q4f16 / int8），2 张都是"休闲短袖"，和之前一致；没有发往 jsDelivr 的请求。
  - check.html（Mac Chrome）8 项全部成功。

## 下次从这里继续
1. 国内朋友真机确认（见交接清单）。通过后做 B（阶段 3 备份）：Plan mode 给计划。
2. 以后再议：国内怎样抠图（候选：换可转发的抠图模型，或用 iOS 系统抠图）。
3. 下次 iPhone 录入时顺便看分类每页 6 张后是否还崩溃（看"详细记录"）。

## 未解决问题
- 国内真机未验证：分类从 closet-models 下载、抠图跳过。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）来自 iPhone 和小米各一次实测，未在其他设备核对；国内跳过抠图时开始前的估算偏高（含抠图时间）。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
