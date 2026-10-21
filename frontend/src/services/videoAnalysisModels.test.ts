import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_VIDEO_ANALYZE_MODEL,
  VIDEO_ANALYZE_MODELS,
  getVideoAnalyzeModelOptions,
  isDurationPricedVideoAnalyzeModel,
  resolveVideoAnalyzeModel,
} from './videoAnalysisModels.ts';

test('new video analysis defaults to the exact Seed 2.1 Lite ID', () => {
  assert.equal(DEFAULT_VIDEO_ANALYZE_MODEL, 'doubao-seed-2-1-lite-260915');
  assert.equal(resolveVideoAnalyzeModel(undefined), DEFAULT_VIDEO_ANALYZE_MODEL);
  assert.deepEqual(VIDEO_ANALYZE_MODELS.slice(0, 3).map((option) => option.value), [
    'doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-turbo-260628',
  ]);
  for (const option of VIDEO_ANALYZE_MODELS.slice(0, 3)) {
    assert.match(option.label, /Seed 2\.1/);
    assert.doesNotMatch(option.label, /Mini/);
    assert.equal(resolveVideoAnalyzeModel(option.value), option.value);
    assert.equal(isDurationPricedVideoAnalyzeModel(option.value), true);
  }
  assert.equal(VIDEO_ANALYZE_MODELS.some((option) => option.value.includes('-2-0-')), false);
});

test('saved Seed 2.0 models stay exact and visibly legacy until manually changed', () => {
  for (const saved of ['doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428']) {
    assert.equal(resolveVideoAnalyzeModel(saved), saved);
    const options = getVideoAnalyzeModelOptions(saved);
    assert.equal(options.length, VIDEO_ANALYZE_MODELS.length + 1);
    assert.match(options.find((option) => option.value === saved)!.label, /旧版/);
    assert.equal(isDurationPricedVideoAnalyzeModel(resolveVideoAnalyzeModel(saved)), true);
    assert.equal(getVideoAnalyzeModelOptions('doubao-seed-2-1-lite-260915').some((option) => option.value === saved), false);
  }
});

test('Gemini remains selectable and unknown IDs do not fabricate Seed 2.1 Mini', () => {
  for (const saved of ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-pro']) {
    assert.equal(resolveVideoAnalyzeModel(saved), saved);
    assert.equal(isDurationPricedVideoAnalyzeModel(resolveVideoAnalyzeModel(saved)), false);
  }
  assert.equal(resolveVideoAnalyzeModel('doubao-seed-2-1-mini-260915'), DEFAULT_VIDEO_ANALYZE_MODEL);
});
