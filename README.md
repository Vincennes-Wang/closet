# closet

给家人用的衣橱 + 搭配网页（PWA），个人非商用。

- 线上地址：https://vincennes-wang.github.io/closet/
- 用 iPhone Safari 打开后"添加到主屏幕"，从主屏幕图标打开。需要 iOS 26 / Safari 26 以上。

## 功能
- 录入衣物：拍照或选图，应用内自动抠图（RMBG-1.4）和分类（Marqo fashionSigLIP），确认后存入衣橱。
- 衣橱：按分类、季节、场景筛选；分类可改名、隐藏、自建。
- 搭配：每个位置选一件，自动排版成一张图，可手动调整。
- 下周：给每天排一套搭配，参考巴黎天气预报（Open-Meteo）。
- 备份：导出 / 导入 ZIP。

## 数据和隐私
衣物照片和搭配只存在本机浏览器（IndexedDB），不上传，也不在这个仓库里。换手机前先导出备份。

## 第三方
| 用途 | 来源 | 许可 |
|---|---|---|
| 抠图模型 | [briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) | Bria 非商用（商用前必须换模型或买许可） |
| 分类模型 | [Marqo/marqo-fashionSigLIP](https://huggingface.co/Marqo/marqo-fashionSigLIP) | Apache-2.0 |
| 模型运行库 | Transformers.js、ONNX Runtime Web（`vendor/`） | Apache-2.0 / MIT |
| 天气 | [Open-Meteo](https://open-meteo.com/) | CC BY 4.0，非商用免费 |

## 开发
- 无构建步骤、无 npm 依赖。本机起任意静态服务器即可。
- 测试：`node --test tests/*.test.mjs`（浏览器测试需要本机装有 Chrome）。
- 项目决策和约定见 `CLAUDE.md`。
