// config.js 选后端的单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBackend, MATTING_MODEL, CLASSIFY_MODEL } from '../config.js';

test('没有 WebGPU：用 WASM 和 wasmDtype', () => {
  assert.deepEqual(pickBackend({ webgpu: false, shaderF16: false }, MATTING_MODEL), { device: 'wasm', dtype: 'quantized' });
});

test('有 WebGPU 且支持 fp16：用 WebGPU 和 dtype', () => {
  assert.deepEqual(pickBackend({ webgpu: true, shaderF16: true }, MATTING_MODEL), { device: 'webgpu', dtype: 'fp16' });
  assert.deepEqual(pickBackend({ webgpu: true, shaderF16: true }, CLASSIFY_MODEL), { device: 'webgpu', dtype: 'q4f16' });
});

test('有 WebGPU 但不支持 fp16（360 浏览器）：fp16 / q4f16 模型改用 WASM', () => {
  assert.deepEqual(pickBackend({ webgpu: true, shaderF16: false }, MATTING_MODEL), { device: 'wasm', dtype: 'quantized' });
  assert.deepEqual(pickBackend({ webgpu: true, shaderF16: false }, CLASSIFY_MODEL), { device: 'wasm', dtype: 'int8' });
});

test('有 WebGPU 但不支持 fp16：不需要 fp16 的 dtype 仍用 WebGPU', () => {
  assert.deepEqual(pickBackend({ webgpu: true, shaderF16: false }, { dtype: 'fp32', wasmDtype: 'int8' }), { device: 'webgpu', dtype: 'fp32' });
});
