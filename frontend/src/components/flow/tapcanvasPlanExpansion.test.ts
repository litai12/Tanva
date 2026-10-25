import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetPlanNode } from '../../services/tapcanvasPlanApi.ts';
import { buildPlanExpansion, clampSeedanceDuration, resolveImageNode, resolveVideoNode } from './tapcanvasPlanExpansion.ts';

// 形状取自 TapCanvas 资产规划 v5 文档示例（第八章：角色基础卡 → 状态卡 → Clip 视频）。
const plan = [
  { nodeId: 'image:character:林嫣儿:base', assetKey: 'image:character:林嫣儿:base', title: '林嫣儿角色卡', type: 'image', prompt: '林嫣儿正面全身',
    upstreamDependencies: [{ assetKey: 'input:1', title: '风格图 1', role: 'style' }],
    parameters: { modelKey: 'gpt-image-2', aspectRatio: '3:4', negativePrompt: '多余手指', referenceType: 'character' } },
  { nodeId: 'image:character:林嫣儿:wet', assetKey: 'image:character:林嫣儿:wet', title: '林嫣儿·浅碧色罗裙湿透角色卡', type: 'image', prompt: '同一人物湿透',
    upstreamDependencies: [{ assetKey: 'image:character:林嫣儿:base', title: '林嫣儿角色卡', role: 'identity' }],
    parameters: { modelKey: 'gpt-image-2', aspectRatio: '3:4' } },
  { nodeId: 'image:palette:全章:base', assetKey: 'image:palette:全章:base', title: '色锚', type: 'image', prompt: '冷暖对照色卡', upstreamDependencies: [], parameters: {} },
  { nodeId: 'text:clip:2:script', assetKey: 'text:clip:2:script', title: 'Clip 2', type: 'text', prompt: '', upstreamDependencies: [], parameters: { content: '镜头2：过肩近景' } },
  { nodeId: 'video:2', assetKey: 'video:2', title: 'Clip 2', type: 'video', prompt: '镜头2…@林嫣儿·浅碧色罗裙湿透角色卡',
    upstreamDependencies: [
      { assetKey: 'image:character:林嫣儿:wet', title: '林嫣儿·浅碧色罗裙湿透角色卡', role: 'reference_image' },
      { assetKey: 'text:clip:2:script', title: 'Clip 2', role: 'script' },
    ],
    parameters: { durationSeconds: 12, modelKey: 'doubao-seedance-2.0', resolution: '720p', aspectRatio: '16:9',
      referenceBindings: [{ assetKey: 'image:character:林嫣儿:wet', name: '林嫣儿' }, { assetKey: 'image:palette:全章:base', name: '色锚' }] } },
  { nodeId: 'video:3', assetKey: 'video:3', title: 'Clip 3', type: 'video', prompt: 'Veo 镜头', upstreamDependencies: [],
    parameters: { durationSeconds: 8, modelKey: 'veo-4' } },
] as unknown as AssetPlanNode[];

test('expands plan into prompt-driven Tanva nodes wired by dependencies', () => {
  const result = buildPlanExpansion(plan, { origin: { x: 1000, y: 200 }, idPrefix: 'p1',
    inputs: { 'input:1': { nodeId: 'canvas-style', sourceHandle: 'img', kind: 'image' } }, groupName: '第八章' });
  const byId = new Map(result.nodes.map((n) => [n.id, n]));
  const group = result.nodes[0];
  assert.equal(group.type, 'nodeGroup');
  assert.equal(group.data.groupName, '第八章');
  assert.deepEqual(group.position, { x: 1000, y: 200 });
  assert.equal((group.data.childNodeIds as string[]).length, result.nodes.length - 1);
  // 3 张图 ×（提示词 + 生图）+ 1 脚本 + 2 视频提示词 + 1 视频节点
  assert.equal(result.nodes.length - 1, 3 * 2 + 1 + 2 + 1);

  const base = byId.get('p1-img-0')!;
  assert.equal(base.type, 'gptImage2');
  assert.equal(base.data.model, 'gpt-image-2');
  assert.equal(base.data.aspectRatio, '3:4');
  const basePrompt = byId.get('p1-ip-0')!;
  assert.match(String(basePrompt.data.text), /避免：多余手指/);
  assert.equal(byId.get('p1-img-2')!.type, 'generatePro');

  const has = (source: string, sh: string, target: string, th: string) =>
    result.edges.some((e) => e.source === source && e.sourceHandle === sh && e.target === target && e.targetHandle === th);
  assert.ok(has('p1-ip-0', 'text', 'p1-img-0', 'text'));
  assert.ok(has('canvas-style', 'img', 'p1-img-0', 'img'), 'input:N binds to the existing canvas node');
  assert.ok(has('p1-img-0', 'img', 'p1-img-1', 'img'), 'state card uses identity reference');

  const video = byId.get('p1-video-4')!;
  assert.equal(video.type, 'seedance20Video');
  assert.equal(video.data.clipDuration, 12);
  assert.equal(video.data.resolution, '720P');
  assert.equal(video.data.seedanceMode, 'reference_images');
  assert.ok(has('p1-vp-4', 'text', 'p1-video-4', 'text'));
  const refs = result.edges.filter((e) => e.target === 'p1-video-4' && e.targetHandle === 'image').map((e) => e.source);
  assert.deepEqual(refs, ['p1-img-1', 'p1-img-2'], 'reference order follows bindings');

  assert.ok(byId.has('p1-vp-5'), 'unsupported model keeps its prompt');
  assert.ok(!byId.has('p1-video-5'));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /veo-4/);
  assert.equal(new Set(result.edges.map((e) => e.id)).size, result.edges.length);
  assert.equal(new Set(result.nodes.map((n) => n.id)).size, result.nodes.length, 'Chinese-named assets never collide');
});

test('first frame dependency switches Seedance to first_frame mode', () => {
  const result = buildPlanExpansion([plan[0], { ...plan[4], parameters: { ...plan[4].parameters, firstFrameAssetKey: 'image:character:林嫣儿:base' } }],
    { origin: { x: 0, y: 0 }, idPrefix: 'p2' });
  const video = result.nodes.find((n) => n.type === 'seedance20Video')!;
  assert.equal(video.data.seedanceMode, 'first_frame');
  assert.deepEqual(result.edges.filter((e) => e.target === video.id && e.targetHandle === 'image').map((e) => e.source), ['p2-img-0']);
});

test('model and duration mapping', () => {
  assert.equal(resolveImageNode('nano-banana-2.1').type, 'nano2');
  assert.equal(resolveImageNode(undefined).type, 'generatePro');
  assert.deepEqual(resolveVideoNode('doubao-seedance-2.5'), { type: 'seedance20Video', seedanceModel: 'seedance-2.5' });
  assert.equal(resolveVideoNode('kling-v3'), null);
  assert.equal(clampSeedanceDuration(2), 4);
  assert.equal(clampSeedanceDuration(30), 15);
  assert.equal(clampSeedanceDuration('x'), 5);
});
