import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveXiaotTerminalContent } from './xiaotTerminalContent.ts';

test('terminal text replaces progress but preserves actual model output', () => {
  assert.equal(resolveXiaotTerminalContent('', '正在执行画布操作', 'completed', '正在执行画布操作'), '任务已完成');
  assert.equal(resolveXiaotTerminalContent('', '画布与工具信息已读取...', 'stopped', '画布与工具信息已读取'), '任务已停止');
  assert.equal(resolveXiaotTerminalContent('真实回答', '正在执行画布操作', 'completed', '正在执行画布操作'), '真实回答');
  assert.equal(resolveXiaotTerminalContent('', '保留已有正文', 'completed', '正在执行画布操作'), '保留已有正文');
});
