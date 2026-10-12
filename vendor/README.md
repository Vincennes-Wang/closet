# vendor

第三方库放在本站，不用 CDN（jsDelivr 在中国打不开，2026-10-12 用户实测）。只从 `model-worker.js` 加载，路径在 `config.js` 的 `VENDOR`。

## transformers-4.3.1/

| 文件 | 来源 | 许可证 | sha256 |
|---|---|---|---|
| `transformers.min.js` | npm `@huggingface/transformers@4.3.1` `dist/`（与 https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js 相同） | Apache-2.0（`LICENSE-transformers`） | `8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743` |
| `ort-wasm-simd-threaded.asyncify.mjs` | npm `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` `dist/` | MIT（`LICENSE-onnxruntime`） | `0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611` |
| `ort-wasm-simd-threaded.asyncify.wasm` | 同上 | MIT | `49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082` |
| `ort-wasm-simd-threaded.mjs` | 同上 | MIT | `c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f` |
| `ort-wasm-simd-threaded.wasm` | 同上 | MIT | `06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3` |
| `LICENSE-transformers` | npm 包自带 | – | – |
| `LICENSE-onnxruntime` | https://raw.githubusercontent.com/microsoft/onnxruntime/8d85527a010e294a26b274749f74294b2a32cec5/LICENSE（npm 包没带） | – | – |

- onnxruntime-web 的版本是 transformers.js 4.3.1 内置的版本（`package.json` dependencies，和 `transformers.min.js` 里的 `versions.web` 一致）。换 transformers.js 版本时，ORT 文件要一起换。
- transformers.js 自己选用哪套 ORT 文件：一般是 `.asyncify` 版；Safari 26 以下且没有 WebGPU 时用普通版。`model-worker.js` 保留它选的文件名，只把地址换成本站。
- 运行时实际请求（2026-10-12，Mac Chrome 真模型，WebGPU 和 WASM 各一次）：只有 `transformers.min.js`、`.asyncify.mjs`、`.asyncify.wasm`。普通版没在真机验证（没有旧 Safari）。
- Service Worker 预缓存 `.asyncify` 那套；普通版 14 MB 不预缓存。
