# PROGRESS
- 状态：进行中
- 当前阶段：4a 衣橱新布局已完成，等 iPhone 真机检查；下一步 4b 搭配
- 累计用时：约 15.5（用户报）（工作 22 次）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-15，文档更新 + 阶段 4a）
- 完成：
  - CLAUDE.md：阶段表改为 4a / 4b / 4c / 5 / 6 / 以后（Claude.ai 定的范围）；加用时规则（只记用户报的数）。
  - 4a：`picker.js` 衣物选择器（左边栏一级分类 + 件数、二级分类、季节/场景多选、"共 N 件"、清除筛选、2 列网格，宽屏自动加列）；筛选存 URL hash，刷新后保留；已归档改为"已归档（N 件）"按钮；分类图标（emoji）在 `taxonomy.js`；`closet-v22`。
- 验证结果：
  - `node --test tests/*.test.mjs` 47/47 通过（新增 `picker.test.mjs` 8 个、浏览器筛选测试 1 个）。
  - 故意把"季节 且 场景"改成"或"：`不同组之间"且"` 和浏览器筛选测试失败（实际 4 件、应为 1 件），恢复后通过。
  - `node tools/shots.mjs` 截图 390 px（2 列）、1280 px（7 列），布局正常。

## 下次从这里继续
1. 用户在 iPhone 检查 4a（见交接清单）；有问题先修。
2. 4b 开始前用 Plan mode 给计划：6 槽位搭配、数据库 v4 迁移（新建 `outfits`、`plans`，保留 v3 数据）、备份 `formatVersion` 2；复用 `createPicker`（`mode: 'single'`、`canSwitchCategory`）。上线前提醒用户先导出备份。

## 未解决问题
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
