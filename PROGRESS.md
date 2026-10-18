# PROGRESS
- 状态：进行中
- 当前阶段：4d 搭配自动排版已上线并在 iPhone 验收；下一步 4e（待定）或 4c
- 累计用时：约 18.5（用户报）（工作 25 次）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-18，阶段 4d 搭配自动排版）
- 完成：
  - 阶段顺序改为 4d → 4e（待定）→ 4c → 5 → 6（Claude.ai 决定）。
  - `layout.js` 自动排版（槽位区域 + 透明轮廓）；合成图 450×600 缓存在 `thumbs` 表（`outfit:`、`bbox:` 键，sig 失效），不升数据库；搭配列表每套一张合成图；编辑弹窗实时预览；备份 formatVersion 3（可选 layout，v1、v2 仍可导入）；`closet-v25`。
  - 用户 iPhone 验收：列表显示合成图、新建和修改时预览更新、滚动流畅。
- 验证结果：
  - `node --test tests/*.test.mjs` 72/72；故意让 `alphaBBox` 不裁透明边，单元和浏览器各 1 个失败，恢复后通过。
  - 真实抠图截图 3 套（鞋、半身裙、包用画出来的轮廓代替），390 / 1280 px，上衣在上、下装在中、鞋在底。
  - 内存（40 件 + 20 套）：Chrome 图片解码大小，搭配页 4b 7.5–13.8 MB → 6.2–12.4 MB；Mac Safari 标签页（活动监视器，用户测）4b 97.5 MB → 79.9 MB。

## 下次从这里继续
1. 决定 4e 手动调整做不做；然后 4c 分类管理（Plan mode；自建一级分类放不放进搭配槽位要决定）。

## 未解决问题
- 完整测试偶发一次失败（3 次中 1 次）：`应用：选图进队列…` 等待 `#lastJob` 超时；单独重跑 3 次都通过，原因未确认。再出现时先保存该次 `job.events` 时间线看卡在哪一步。
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
