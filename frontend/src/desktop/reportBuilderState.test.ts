import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReportExportConfig,
  buildReportGenerationPrompt,
  buildReportOutlineMarkdown,
  createDefaultReportBuilderState,
} from './reportBuilderState';

test('report builder prompt carries the selected workflow and only ready remote assets', () => {
  const state = createDefaultReportBuilderState();
  state.coverTitle = '滨水文化中心';
  state.purpose = 'slides';
  state.assets = [
    { id: 'ready', name: 'site.png', kind: 'image', remoteUrl: 'https://cdn.example/site.png', size: 12, status: 'ready' },
    { id: 'pending', name: 'local.png', kind: 'image', remoteUrl: 'blob:temporary', size: 12, status: 'uploading' },
  ];
  const prompt = buildReportGenerationPrompt(state);
  assert.match(prompt, /滨水文化中心/);
  assert.match(prompt, /PPT 交互形式/);
  assert.match(prompt, /https:\/\/cdn\.example\/site\.png/);
  assert.doesNotMatch(prompt, /blob:temporary/);
  assert.match(prompt, /pptx-generator/);
  assert.match(prompt, /present_file/);
});

test('default report builder has an actionable chapter set and presenter mode', () => {
  const state = createDefaultReportBuilderState();
  assert.ok(state.chapters.length >= 4);
  assert.equal(state.chapters.every((chapter) => chapter.enabled), true);
  assert.equal(state.presenterMode, true);
});

test('report exports keep only remote asset references and expose a readable outline', () => {
  const state = createDefaultReportBuilderState();
  state.coverTitle = '导出测试';
  state.assets = [
    { id: 'remote', name: 'plan.pdf', kind: 'document', remoteUrl: '/oss/plan.pdf', size: 1, status: 'ready' },
    { id: 'data', name: 'preview.png', kind: 'image', remoteUrl: 'data:image/png;base64,AAAA', size: 1, status: 'ready' },
  ];
  const config = buildReportExportConfig(state);
  assert.equal(config.assets.length, 1);
  assert.equal(config.assets[0].remoteUrl, '/oss/plan.pdf');
  assert.match(buildReportOutlineMarkdown(state), /导出测试/);
  assert.doesNotMatch(buildReportOutlineMarkdown(state), /base64/);
});
