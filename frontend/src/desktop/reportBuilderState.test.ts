import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReportExportConfig,
  buildReportGenerationPrompt,
  buildReportOutlineMarkdown,
  classifyReportAsset,
  createDefaultReportChapters,
  createDefaultReportBuilderState,
  normalizeReportBuilderState,
} from './reportBuilderState';

test('report asset classification provides actionable routing hints from filenames', () => {
  assert.deepEqual(classifyReportAsset('A-01_总平面图.png', 'image'), { assetType: 'plan', assetLabel: '平面图' });
  assert.deepEqual(classifyReportAsset('site-analysis.pdf', 'document'), { assetType: 'analysis', assetLabel: '分析图' });
  assert.deepEqual(classifyReportAsset('walkthrough.mov', 'video'), { assetType: 'video', assetLabel: '视频' });
  assert.deepEqual(classifyReportAsset('说明书.docx', 'document'), { assetType: 'document', assetLabel: '文档' });
});

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
  assert.equal(state.chapters.length, 8);
  assert.equal(state.chapters.every((chapter) => chapter.enabled), true);
  assert.equal(state.presenterMode, true);
});

test('project type templates provide reference report structures', () => {
  assert.equal(createDefaultReportChapters('室内').length, 7);
  assert.equal(createDefaultReportChapters('规划')[0].name, '封面与愿景');
  assert.match(createDefaultReportChapters('建筑')[4].hint, /总平面/);
});

test('legacy five chapter sessions migrate to the reference project template', () => {
  const legacy = { ...createDefaultReportBuilderState(), chapters: ['项目概览', '场地与问题', '设计概念', '方案推演', '成果展示'].map((name, index) => ({ id: `chapter-${index + 1}`, name, hint: '', enabled: true })) };
  const migrated = normalizeReportBuilderState(legacy);
  assert.equal(migrated.chapters.length, 8);
  assert.equal(migrated.chapters[0].name, '封面与概览');
});

test('state normalization drops asset bindings to removed chapters', () => {
  const state = createDefaultReportBuilderState();
  state.assets = [{ id: 'stale', name: 'old.png', kind: 'image', remoteUrl: '/oss/old.png', chapterId: 'chapter-99', size: 1, status: 'ready' }];
  const normalized = normalizeReportBuilderState(state);
  assert.equal(normalized.assets[0].chapterId, undefined);
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

test('web report prompt keeps the editable HTML delivery contract', () => {
  const state = createDefaultReportBuilderState();
  const prompt = buildReportGenerationPrompt(state);
  assert.match(prompt, /design-presentation-web/);
  assert.match(prompt, /可编辑的 HTML/);
  assert.match(prompt, /章节导航/);
  assert.doesNotMatch(prompt, /pptx-generator/);
});

test('report builder persists the selected model and includes it in the export', () => {
  const state = { ...createDefaultReportBuilderState(), reportModel: 'xiaot-agent-gpt-5-6-terra' as const };
  const config = buildReportExportConfig(state);
  assert.equal(config.reportModel, 'xiaot-agent-gpt-5-6-terra');
  assert.match(buildReportGenerationPrompt(state), /xiaot-agent-gpt-5-6-terra/);
});
