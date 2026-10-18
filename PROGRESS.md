# PROGRESS
- 状态：进行中
- 当前阶段：4d 搭配自动排版（计划中）
- 累计用时：约 18（用户报）（工作 24 次）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-16，4c 前的小改）
- 完成：
  - 上衣加"卫衣"`top.hoodie`（春秋，只算套头款）；裤子"短裤"拆成"休闲短裤"（沿用 `bottom.shorts`，已录入的不迁移）和"运动短裤"`bottom.sport_shorts`（都是夏）。
  - 用户决定：拉链连帽抓绒衫算"运动服"。运动服 prompt 改为含拉链连帽款，卫衣 prompt 强调套头、无拉链。重新生成 `label-embeddings.json`。
  - 搭配里鞋改为选填（只剩：没有连衣裙 / 套装时上衣和下装必填）。`closet-v24`，线上已确认。
- 验证结果：
  - `node --test tests/*.test.mjs` 61/61。
  - `node tools/eval.mjs`（22 张样本）：第一版卫衣 prompt 把 2 张拉链连帽衫判成卫衣，top-1 降到 18/22；改 prompt 后 top-1 20/22（91%）、top-3 22/22（100%，上次 21/22）。样本里没有卫衣和短裤，这两类的效果还没验证。

## 下次从这里继续
1. 4d 搭配自动排版（Plan mode 给计划）。之后 4e 手动调整（待定）→ 4c 分类管理（自建一级分类放不放进搭配槽位要决定）。

## 未解决问题
- 完整测试偶发一次失败（3 次中 1 次）：`应用：选图进队列…` 等待 `#lastJob` 超时；单独重跑 3 次都通过，原因未确认。再出现时先保存该次 `job.events` 时间线看卡在哪一步。
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
