# PROGRESS
- 状态：进行中
- 当前阶段：2b 已验收，安卓兼容性修复已完成（中国境内测试待做）；下一阶段 3 备份（导出 / 导入）
- 累计用时：约 22（本次约 2 小时，估计）
- 线上地址：https://vincennes-wang.github.io/closet/（应用）、https://vincennes-wang.github.io/closet/spike/（阶段 0 验证页）

## 最近一次工作（2026-10-12，小米手机：分类也改用 WASM）
- 小米真机验证上一条：抠图成功，每张 20–30 秒（WASM），以后都用 WASM 也正常。但分类离谱（短裤、背心 → 长袖线衣）。
- 已确认原因：验证页同一张短裤照片"不抠图"分类，强制 WebGPU q4f16 结果离谱，强制 WASM int8 正确。即小米的 WebGPU 分类也算错。
- 小米真机验证通过：分类正确；抠图约 18 s/张，分类约 2 s/张，用户可接受。
- 修复：本设备设置改为 `noWebgpu`，抠图和分类都只用 WASM。旧键 `mattingNoWebgpu`（closet-v16 写入，小米上已有）照样认，小米不用重新检测。缓存名 `closet-v17`。
- 验证结果：`node --test tests/*.test.mjs` 23/23 通过。空遮罩测试加了"分类后端是 wasm"的断言，先确认失败，再写修复。小米真机通过（见上）。

## 下次从这里继续
1. 阶段 3 备份：Plan mode 给计划，用户确认后写代码。
2. 中国境内测试（不急，别人的电脑，方便时再做）：360 浏览器重试："上次抠图"那行最后应显示 `wasm/quantized`，图片里应有衣服。再看下面两个链接在中国能否打开：huggingface.co 上 RMBG-1.4 的 config.json、jsDelivr 上 transformers 的 package.json。打不开就要决定是否改用国内镜像（例如 hf-mirror.com）。
3. 下次 iPhone 录入时顺便看分类每页 6 张后是否还崩溃（看"详细记录"）。
4. iPhone 看一眼页头文字和照片占用是否合理。

## 未解决问题
- 中国网络（2026-10-12）：huggingface.co、jsDelivr 能否访问未确认；360 浏览器第一次报 "Failed to fetch dynamically imported module"，原因未确认。
- 360 浏览器 "does not support fp16"：已修（改用 WASM），未真机验证。
- 交付前："关于"区的存图格式诊断（`app.js` `showDiag`）没必要就删除。
- iPhone 第一轮失败原因未确认（没有 JSON）。第一轮页面默认加载 BiRefNet + SigLIP fp16（共约 520 MB），第二轮默认什么都不加载；要确认是不是这个原因，可以在 iPhone 上用第一轮的组合再跑一次，但现在已不需要。
