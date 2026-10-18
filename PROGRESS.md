# PROGRESS
- 状态：进行中
- 当前阶段：4e 手动调整排版已上线并在 iPhone 验收；下一步 4c 分类管理
- 累计用时：约 19（用户报）（工作 26 次）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-18，阶段 4e 手动调整排版）
- 完成：
  - 用户决定现在做 4e。编辑弹窗"调整排版"：点选、拖动、大小 / 角度滑块、往前 / 往后一层、这件 / 全部恢复自动，写入 `outfit.layout`（只存动过的槽位；换衣物该槽位恢复自动）。数据库、备份格式不变。`closet-v26`。
  - 用户 iPhone 验收通过。
- 验证结果：
  - `node --test tests/*.test.mjs` 78/78；故意去掉 `clampPlacement`，单元和浏览器各 1 个失败，恢复后通过。
  - 调整模式截图（390 px）检查通过。截图脚本等待条件改为跳过被弹窗裁掉的图片（之前误判超时）。

## 下次从这里继续
1. 4c 分类管理界面（Plan mode）。已定（用户 2026-10-18）：自建一级分类新建时选"放进哪个搭配槽位"（或不放），存在分类记录里，以后可改。

## 未解决问题
- 完整测试偶发一次失败（3 次中 1 次）：`应用：选图进队列…` 等待 `#lastJob` 超时；单独重跑 3 次都通过，原因未确认。再出现时先保存该次 `job.events` 时间线看卡在哪一步。
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
