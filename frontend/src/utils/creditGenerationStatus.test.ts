import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCreditGenerationStatus, formatCreditProcessingTime } from './creditGenerationStatus.ts';

test('terminal generation remains visible while the original receipt awaits reconciliation', () => {
  const record = { generationStatus: 'failed', apiResponseStatus: 'pending', processingTime: null };
  assert.equal(formatCreditGenerationStatus(record), '生成失败 · 待核账');
  assert.equal(formatCreditProcessingTime(record), '未记录');
  assert.equal(formatCreditGenerationStatus({ ...record, generationStatus: 'succeeded' }), '生成成功 · 待核账');
});

test('missing duration does not imply that a request failed', () => {
  const record = { apiResponseStatus: 'pending', processingTime: null };
  assert.equal(formatCreditGenerationStatus(record), '结果待确认');
  assert.equal(formatCreditProcessingTime(record), '待确认');
  assert.equal(formatCreditGenerationStatus({ ...record, generationStatus: 'processing' }), '生成中');
});

test('recorded duration including zero is retained independently of billing state', () => {
  assert.equal(formatCreditProcessingTime({ generationStatus: 'failed', apiResponseStatus: 'pending', processingTime: 0 }), '0秒');
  assert.equal(formatCreditProcessingTime({ processingTime: 1640 }), '2秒');
  assert.equal(formatCreditGenerationStatus({ apiResponseStatus: 'failed' }), '请求失败');
  assert.equal(formatCreditProcessingTime({}), '-');
});
