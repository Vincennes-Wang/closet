# PROGRESS
- 状态：已完成
- 当前阶段：6 交付已完成（iPhone 走查通过），项目完成
- 累计用时：约 19.9（用户报）（工作 29 次）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-18，阶段 6 交付）
- 完成：
  - 处理中只显示张数和剩余时间；待确认写"上次处理：抠图 N 张，未抠图 M 张，用时…"。完整统计移到折叠的"详细记录"第一行。
  - 抠图模型下载不了时，待确认列表顶部显示 iPhone 系统抠图的三步说明；卡片提示缩短。
  - 用户 iPhone 走查通过（用时 10 分钟）。
  - "关于"删掉存图格式诊断，保留版本号和网络检查。`README.md` 写中文说明和第三方许可。`closet-v29`。
- 验证结果：
  - `node --test tests/*.test.mjs` 96/96；故意不显示说明卡，对应测试失败，恢复后通过。
  - 截图 390 px：说明卡、"关于"区检查通过。

## 下次从这里继续
1. 复盘草稿已给用户，确认后追加到 `~/vibe-playbook/03_经验日志.md`。
2. 以后（可选）：国内自动抠图（`birefnet-lite-512` 转存 `closet-models`）。

## 未解决问题
- 中国境内能否访问 Open-Meteo 未知：以后在国内打开 `check.html` 看最后一行。
- 截图脚本第一次运行卡在 1280-outfits，重跑正常，原因未确认。再出现时记下卡在哪个 waitFor。
- 完整测试偶发一次失败（3 次中 1 次）：`应用：选图进队列…` 等待 `#lastJob` 超时；单独重跑 3 次都通过，原因未确认。再出现时先保存该次 `job.events` 时间线看卡在哪一步。
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
