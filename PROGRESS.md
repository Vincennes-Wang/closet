# PROGRESS
- 状态：进行中
- 当前阶段：3 备份（导出 / 导入）代码完成，待 Mac Safari 和 iPhone 真机验收；下一阶段 4 衣橱筛选 + 搭配
- 累计用时：约 28（本次约 2 小时，估计）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/check.html（网络检查）、https://vincennes-wang.github.io/closet-models/（模型）

## 最近一次工作（2026-10-12，阶段 3 备份）
- 国内真机测试通过（用户确认）：分类从 closet-models 下载，抠图跳过。
- 完成：
  - `backup.js`：自己写 ZIP（只存储 + CRC32），导出 `manifest.json` + `images/<id>.<扩展名>`，含已归档衣物和分类表，不含待确认照片和本设备设置。导入先全部校验（版本、字段、分类含自建、图片存在且 CRC 正确），再一个事务合并写入（id 已存在跳过），失败时数据库不变。
  - `store.js`：`exportData`、`importData`（一个事务）、`getBackupAt` / `setBackupAt`；`validate()` 可传分类表放行自建分类（`taxonomy.js` 新增 `categoryError`）。
  - 界面：页头"上次备份：今天 / N 天前 / 还没有备份"，超过 7 天或有衣物却从未备份时用提醒色；"备份"卡片：导出（手机分享菜单 / 电脑下载）、导入（显示"新增 X 件，跳过 Y 件"或错误原文）。缓存名 `closet-v21`。
- 验证结果：
  - `node --test tests/*.test.mjs` 38/38 通过（先写测试、确认失败再实现）。新增：Node 5 个（CRC32 标准值、`unzip -t` 校验通过、读回字节一致、CRC 不一致和非 ZIP 报错、分类校验、文件名）；浏览器 4 个（导出 → 删库 → 导入：衣物全部字段、分类表、图片字节完全一致，含透明图和已归档；再导入"新增 0 件，跳过 3 件"；版本 2 / 缺图片 / 不存在的 subcategoryId 三种都失败且数据库不变；importData 中途出错整个事务回滚；页头文字和提醒样式）。
  - 变异检查：把 `crc32` 改成返回 0，3 个测试失败（CRC 标准值、`unzip -t`、篡改检测），已改回。
  - 390 宽截图检查页头提醒色和备份卡片。
  - Mac Safari 自动验收没跑成：同源 harness 页面在 Safari 里不执行任何脚本（连一行普通脚本都不执行，标题也没出来），原因未确认。改为请用户手动验收。

## 下次从这里继续
1. 用户验收 Mac Safari 和 iPhone（见交接清单）。通过后进入阶段 4：Plan mode 给计划。
2. 以后再议：国内怎样抠图。
3. 下次 iPhone 录入时顺便看分类每页 6 张后是否还崩溃（看"详细记录"）。

## 未解决问题
- Mac Safari 自动化：harness 页面不执行脚本，原因未确认。下次要用时先手动在 Safari 打开 `http://127.0.0.1:<端口>/` 看页面是否正常（可能是旧 Service Worker 或 Safari 设置）。
- iPhone 分享：生成 ZIP 后调用分享可能被判为"不是用户点击"（NotAllowedError），已做"保存备份文件"再点一次的兜底，未在真机验证。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 慢速提示的经验值（`ESTIMATE_MS`）只来自两台设备；国内跳过抠图时开始前的估算偏高。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
