import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDesktopArtifactEditPrompt,
  type DesktopArtifact,
} from './artifactState';

const artifact = (kind: 'presentation' | 'spreadsheet'): DesktopArtifact => ({
  id: `${kind}-1`,
  kind,
  title: kind === 'presentation' ? '本地验收演示' : '本地验收清单',
  fileName: kind === 'presentation' ? 'acceptance.pptx' : 'acceptance.xlsx',
  fileUrl: `https://assets.example.com/acceptance.${kind === 'presentation' ? 'pptx' : 'xlsx'}`,
  mimeType: kind === 'presentation'
    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  createdAt: '2026-08-24T00:00:00.000Z',
});

test('PPT edit context routes XiaoT to the real PPTX skill and source file', () => {
  const prompt = buildDesktopArtifactEditPrompt('把强调色改成紫色', artifact('presentation'));
  assert.match(prompt, /pptx-generator/);
  assert.match(prompt, /acceptance\.pptx/);
  assert.match(prompt, /present_file/);
  assert.match(prompt, /保留未要求修改的内容/);
});

test('Excel edit context routes XiaoT to the real XLSX skill and source file', () => {
  const prompt = buildDesktopArtifactEditPrompt('新增缺陷统计工作表', artifact('spreadsheet'));
  assert.match(prompt, /minimax-xlsx/);
  assert.match(prompt, /acceptance\.xlsx/);
  assert.match(prompt, /原生可编辑结构/);
});
