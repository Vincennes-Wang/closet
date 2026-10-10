@~/vibe-playbook/00_教练规则.md
@~/vibe-playbook/02_默认技术栈与免费方案.md
@~/vibe-playbook/05_本地AI模型方案.md

## 协作规则
- 先给计划（Plan mode），用户确认后再写代码。
- 开工前读 `~/vibe-playbook/03_经验日志.md`，避免重复踩坑。
- 实际检查网页、API、文件、模型输出，不凭猜测写代码。
- 每个阶段结束时运行验证，报告结果。
- 小步提交。不提交密钥、`.env`、`legacy/`、`private/`、模型文件和个人数据。
- 每次工作结束前：按下面的格式更新 `PROGRESS.md`，提交并推送，然后运行 `git status -sb` 确认没有未推送的提交。

## 交接清单
以下情况，回复末尾必须输出交接清单：
- 每次工作结束，推送完成后。
- 需要用户在 GitHub 网页、手机、账号或系统设置里操作时（例如开启 Pages、添加 Secrets、真机测试、授权）。
- 遇到无法自己解决的报错，或需要用户做决策时。
- 同一个问题修了两次仍未解决时，建议用户回 Claude.ai。

格式：

### 交接清单
- 推送状态：<已推送，最新提交 xxxxxxx / 未推送，原因>
- 需要你做：
  1. <具体操作，写明在哪里点什么；没有就写“无”>
- 发给 Claude.ai（可选，只在需要第二意见时填写；否则写“无”）：
  > 看看进度：<仓库地址>。<需要诊断的问题或待做的决策>

## PROGRESS.md 固定格式
```markdown
# PROGRESS
- 状态：<进行中 / 已完成 / 暂停>
- 当前阶段：<阶段编号和名称>
- 累计用时：<小时>
- 线上地址：<GitHub Pages 链接，没有就留空>

## 最近一次工作（<日期>）
- 完成：
- 验证结果：<运行了什么检查，结果如何>

## 下次从这里继续
1.

## 未解决问题
-
```

## 项目决策（穿搭 PWA）
- 用途：给家人用的衣橱 + 搭配网页。
- 平台：PWA，托管在 GitHub Pages。无构建步骤，无后端。第三方库只用 CDN 引入，并固定版本号。
- 个人数据（衣物照片、搭配）只存在用户浏览器的 IndexedDB 中，绝不进仓库。
- AI 在浏览器内运行：Transformers.js + WebGPU，WebGPU 不可用时用 WASM 兜底。iOS 系统抠图（长按"拷贝主体"）作为保底方案。
- 模型许可证必须允许商用（MIT / Apache-2.0）。非商用模型只能用于对照测试。

## 已核实的模型（2026-10-10，查 Hugging Face API）
| 用途 | 仓库 | 许可证 | 备注 |
|---|---|---|---|
| 运行库 | `@huggingface/transformers@4.3.1`（jsDelivr `dist/transformers.min.js`） | Apache-2.0 | 浏览器缓存默认开启（Cache API `transformers-cache`）。不要用 `transformers.web.min.js`：它含裸模块名 `onnxruntime-web/webgpu`，浏览器无法解析 |
| 抠图（主选） | `onnx-community/BiRefNet_lite-ONNX` | MIT | fp16 114.5 MB / fp32 224 MB。模型卡示例里的 `onnx-community/BiRefNet_lite` 不存在。**Mac Chrome 上跑不通**：WebGPU 超出 storage buffer 上限（需 11，上限 10），WASM 内存不足；输入固定 1024² |
| 抠图（对照） | `Xenova/modnet` | Apache-2.0 | fp16 13 MB / uint8 6.6 MB。人像抠图模型，衣物平铺图大量破洞，不可用 |
| 抠图（仅对照） | `briaai/RMBG-1.4` | Bria 非商用 | 效果最好，但不得用于正式应用 |
| 分类 | `Marqo/marqo-fashionSigLIP` | Apache-2.0 | `SiglipTextModel` + `SiglipVisionModel`；vision fp16 186 MB，text fp16 221 MB |

## 目录
- `spike/`：阶段 0 验证页（单文件 HTML）。
- `private/`：本地测试照片等，不提交（`private/samples/` 放样本照片）。

## 禁止事项
- 不提交照片、模型文件、`.env`、`private/` 下的任何内容。提交前运行 `git status` 确认。
- 不引入构建工具或 npm 依赖。
