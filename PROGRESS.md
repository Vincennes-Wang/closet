# PROGRESS
- 状态：进行中
- 当前阶段：4c 分类管理已上线并在 iPhone 验收；阶段 4 全部完成，下一步 5 下周穿搭
- 累计用时：约 19.3（用户报）（工作 27 次）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-18，阶段 4c 分类管理）
- 完成：
  - 衣橱"管理分类"：内置改名、隐藏 / 显示；自建一级（选搭配位置）和二级的新建、改名、隐藏、删除（无衣物时；删一级连同二级）。重名检查。
  - 自建分类在编辑、待确认"其他分类"、搭配槽位里可用；改名处处生效；隐藏的内置分类不进 AI 建议。数据库、备份格式不变。`closet-v27`。
  - 用户 iPhone 验收通过（用时 20 分钟）。
- 验证结果：
  - `node --test tests/*.test.mjs` 85/85；故意让 `store.update` 不传分类表，"改到自建分类"的测试失败，恢复后通过。
  - 管理弹窗截图 390 / 1280 px 检查通过。

## 下次从这里继续
1. 阶段 5 下周穿搭 + 天气：开工前核实天气接口（免费、无需密钥、国内能否访问），再用 Plan mode 给计划。`plans` 表（v4）已建好，结构 `{ id, createdAt, date, outfitId }`。

## 未解决问题
- 完整测试偶发一次失败（3 次中 1 次）：`应用：选图进队列…` 等待 `#lastJob` 超时；单独重跑 3 次都通过，原因未确认。再出现时先保存该次 `job.events` 时间线看卡在哪一步。
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
