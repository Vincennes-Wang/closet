# PROGRESS
- 状态：进行中
- 当前阶段：4b 搭配已上线并在 iPhone 验收；下一步 4c 分类管理界面
- 累计用时：约 17.5（用户报）（工作 23 次）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-15，阶段 4b 搭配）
- 完成：
  - 4a iPhone 验收通过（用户确认）。
  - 4b：7 行槽位搭配（连衣裙 / 套装单独一行，帽子归配饰）、场景、季节推算；数据库 v4（新建 outfits、plans、thumbs，保留 v3 数据）；VersionError / 被挡住时的提示；"关于"区显示版本；缩略图按需加载；备份 formatVersion 2（v1 仍可导入）；归档 / 删除在搭配里的衣物先提示；`closet-v23`。
  - 用户上线前已导出备份；上线后主屏幕图标和 Safari 都显示 closet-v23，数据还在，iPhone 新建搭配刷新后还在。
- 验证结果：
  - `node --test tests/*.test.mjs` 61/61（新增迁移固件测试、从 0 建库、VersionError、搭配流程、缩略图、备份 v2 / v1）。
  - 故意去掉"有连衣裙时上衣、下装可空"：单元和浏览器各 1 个测试失败，恢复后通过。
  - 图片解码大小（Chrome，40 件 1024 图）：衣橱 160 MB → 2.5–4.5 MB；20 套搭配页 7.5–13.8 MB。Mac Safari 标签页内存（用户在活动监视器测）：衣橱 97.2 MB，搭配页 97.5 MB。
  - 截图 390 / 1280 px 检查通过。

## 下次从这里继续
1. 4c 分类管理界面开始前用 Plan mode 给计划（规则见 CLAUDE.md「分类规则」；自建一级分类放不放进搭配槽位要决定）。

## 未解决问题
- 完整测试偶发一次失败（3 次中 1 次）：`应用：选图进队列…` 等待 `#lastJob` 超时；单独重跑 3 次都通过，原因未确认。再出现时先保存该次 `job.events` 时间线看卡在哪一步。
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
