import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetPlanNode } from '../../services/tapcanvasPlanApi.ts';
import { buildPlanExpansion, clampSeedanceDuration, layoutPlanSlots, readPlanLayoutMeta, resolveImageNode, resolveVideoNode } from './tapcanvasPlanExpansion.ts';

// 形状取自 TapCanvas 资产规划 v5 文档示例（第八章：角色基础卡 → 状态卡 → Clip 视频）。
const plan = [
  { nodeId: 'image:character:林嫣儿:base', assetKey: 'image:character:林嫣儿:base', title: '林嫣儿角色卡', type: 'image', prompt: '林嫣儿正面全身',
    upstreamDependencies: [{ assetKey: 'input:1', title: '风格图 1', role: 'style' }],
    parameters: { modelKey: 'gpt-image-2', aspectRatio: '3:4', negativePrompt: '多余手指', referenceType: 'character', size: '2K', quality: 'low' } },
  { nodeId: 'image:character:林嫣儿:wet', assetKey: 'image:character:林嫣儿:wet', title: '林嫣儿·浅碧色罗裙湿透角色卡', type: 'image', prompt: '同一人物湿透',
    upstreamDependencies: [{ assetKey: 'image:character:林嫣儿:base', title: '林嫣儿角色卡', role: 'identity' }],
    parameters: { modelKey: 'gpt-image-2', aspectRatio: '3:4' } },
  { nodeId: 'image:palette:全章:base', assetKey: 'image:palette:全章:base', title: '色锚', type: 'image', prompt: '冷暖对照色卡', upstreamDependencies: [], parameters: {} },
  { nodeId: 'text:clip:2:script', assetKey: 'text:clip:2:script', title: 'Clip 2', type: 'text', prompt: '', upstreamDependencies: [], parameters: { content: '镜头2：过肩近景' } },
  { nodeId: 'video:2', assetKey: 'video:2', title: 'Clip 2', type: 'video', prompt: '镜头2…\n参考：@林嫣儿·浅碧色罗裙湿透角色卡=林嫣儿（身份）',
    upstreamDependencies: [
      { assetKey: 'image:character:林嫣儿:wet', title: '林嫣儿·浅碧色罗裙湿透角色卡', role: 'reference_image' },
      { assetKey: 'text:clip:2:script', title: 'Clip 2', role: 'script' },
    ],
    parameters: { durationSeconds: 12, modelKey: 'doubao-seedance-2.0', resolution: '720p', aspectRatio: '16:9',
      referenceBindings: [{ assetKey: 'image:character:林嫣儿:wet', name: '林嫣儿', mention: '林嫣儿·浅碧色罗裙湿透角色卡' },
        { assetKey: 'image:palette:全章:base', name: '色锚', mention: '全章色锚' }] } },
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
  // 3 张图 ×（提示词 + 生图）+ 2 ×（视频提示词 + 视频节点）；镜头文本无节点消费，不建。
  assert.equal(result.nodes.length - 1, 3 * 2 + 2 * 2);
  assert.ok(!result.nodes.some((n) => n.type === 'textNote'));

  const base = byId.get('p1-img-0')!;
  assert.equal(base.type, 'gptImage2');
  assert.equal(base.data.model, 'gpt-image-2');
  assert.equal(base.data.aspectRatio, '3:4');
  assert.equal(base.data.resolution, '2K', 'planned image size is kept');
  assert.equal(base.data.quality, 'low');
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

  // 正文中出现的 @mention 绑定到对应生图节点；正文未出现的（全章色锚）不写提及。
  assert.deepEqual(byId.get('p1-vp-4')!.data.mentions, [{ id: 'flow:p1-img-1:img:0', token: '@林嫣儿·浅碧色罗裙湿透角色卡', label: '林嫣儿',
    source: 'flow', mediaType: 'image', ref: { nodeId: 'p1-img-1', handle: 'img' } }]);

  const fallback = byId.get('p1-video-5')!;
  assert.equal(fallback.type, 'seedance20Video', 'unsupported model falls back so the group can run end to end');
  assert.equal(fallback.data.seedanceModel, 'seedance-2.0');
  assert.ok(has('p1-vp-5', 'text', 'p1-video-5', 'text'));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /veo-4.*1 个 Clip 已改用 Seedance 2\.0/);
  assert.equal(new Set(result.edges.map((e) => e.id)).size, result.edges.length);
  assert.equal(new Set(result.nodes.map((n) => n.id)).size, result.nodes.length, 'Chinese-named assets never collide');

  // 视频提示词与对应 Clip 同行，且所有节点携带重排元数据。
  assert.equal(byId.get('p1-vp-4')!.position.y, byId.get('p1-video-4')!.position.y);
  assert.ok(result.nodes.every((n) => readPlanLayoutMeta(n.data)?.planId === 'p1'));
});

test('image grid groups state cards with their base and never overlaps', () => {
  const img = (key: string, deps: string[] = []) => ({ nodeId: key, assetKey: key, title: key, type: 'image', prompt: key,
    upstreamDependencies: deps.map((d) => ({ assetKey: d, title: d, role: 'identity' })), parameters: { modelKey: 'gpt-image-2.5-flare' } });
  const result = buildPlanExpansion([
    img('image:palette:p:base'), img('image:prop:knife:base'), img('image:character:a:base'),
    img('image:scene:s:base'), img('image:character:a:gloves', ['image:character:a:base']),
  ] as unknown as AssetPlanNode[], { origin: { x: 0, y: 0 }, idPrefix: 'g' });
  const gens = result.nodes.filter((n) => n.type === 'gptImage2')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x).map((n) => n.data.tapcanvasAssetKey);
  assert.deepEqual(gens, ['image:character:a:base', 'image:character:a:gloves', 'image:scene:s:base', 'image:prop:knife:base', 'image:palette:p:base']);

  const boxes = result.nodes.slice(1).map((n) => ({ ...n.position, w: n.type === 'textPrompt' ? 240 : 260, h: n.type === 'textPrompt' ? 200 : 680 }));
  for (const a of boxes) for (const b of boxes) {
    if (a === b) continue;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'nodes overlap');
  }
});

test('relayout uses the tallest node per row', () => {
  const { positions } = layoutPlanSlots([
    { id: 'a', slot: { block: 'clip', row: 0, col: 0 } }, { id: 'b', slot: { block: 'clip', row: 0, col: 2 } },
    { id: 'c', slot: { block: 'clip', row: 1, col: 2 } },
  ], { x: 0, y: 0 }, (id) => (id === 'b' ? { w: 300, h: 900 } : { w: 200, h: 100 }));
  assert.equal(positions.get('c')!.y - positions.get('b')!.y, 900 + 60);
});

test('video references respect the Seedance image limit', () => {
  const refs = Array.from({ length: 11 }, (_, i) => ({ nodeId: `image:prop:p${i}:base`, assetKey: `image:prop:p${i}:base`, title: `p${i}`,
    type: 'image', prompt: 'x', upstreamDependencies: [], parameters: {} }));
  const clip = { nodeId: 'video:1', assetKey: 'video:1', title: 'Clip 1', type: 'video', prompt: 'v',
    upstreamDependencies: refs.map((r) => ({ assetKey: r.assetKey, title: r.title, role: 'reference_image' })),
    parameters: { modelKey: 'minimax-h3', durationSeconds: 5, resolution: '768p' } };
  const result = buildPlanExpansion([...refs, clip] as unknown as AssetPlanNode[], { origin: { x: 0, y: 0 }, idPrefix: 'r' });
  const video = result.nodes.find((n) => n.type === 'seedance20Video')!;
  assert.equal(result.edges.filter((e) => e.target === video.id && e.targetHandle === 'image').length, 9);
  assert.equal(video.data.resolution, '720P');
  // 超出上限的两张没有任何 Clip 能用上，不建节点，只在提示中列出。
  assert.equal(result.nodes.filter((n) => n.type === 'generatePro').length, 9);
  assert.deepEqual(result.warnings.filter((w) => /已省略/.test(w)), ['2 张参考图未被任何 Clip 使用，已省略：p9、p10']);
});

test('images no Clip uses are dropped, identity chains of used images are kept', () => {
  const img = (key: string, deps: string[] = []) => ({ nodeId: key, assetKey: key, title: key.split(':')[2] + (key.endsWith(':base') ? '' : '·态'),
    type: 'image', prompt: key, upstreamDependencies: deps.map((d) => ({ assetKey: d, title: d, role: 'identity' })),
    parameters: { modelKey: 'gpt-image-2.5-flare', referenceAssetKeys: deps } });
  // 线上实例（2026-10-25 爆款复刻）：1 个 Clip 只引用角色与场景状态卡，道具/色板/特效无人引用。
  const images = [
    img('image:palette:色锚:base'), img('image:scene:台面:base'), img('image:scene:台面:chapter-state:s1', ['image:scene:台面:base']),
    img('image:character:工人:base'), img('image:prop:膜卷:base'), img('image:prop:膜卷:chapter-state:s1', ['image:prop:膜卷:base']),
    img('image:vfx:字卡:base'),
  ];
  const clip = { nodeId: 'video:1', assetKey: 'video:1', title: 'Clip 1', type: 'video', prompt: 'v',
    upstreamDependencies: [{ assetKey: 'image:character:工人:base', title: '工人', role: 'reference_image' }],
    parameters: { modelKey: 'minimax-h3', durationSeconds: 15,
      referenceBindings: [{ assetKey: 'image:scene:台面:chapter-state:s1', mention: '台面' }] } };
  const result = buildPlanExpansion([...images, clip] as unknown as AssetPlanNode[], { origin: { x: 0, y: 0 }, idPrefix: 'u' });
  const kept = result.nodes.filter((n) => n.type === 'gptImage2').map((n) => n.data.tapcanvasAssetKey).sort();
  assert.deepEqual(kept, ['image:character:工人:base', 'image:scene:台面:base', 'image:scene:台面:chapter-state:s1']);
  assert.equal(result.nodes.filter((n) => n.type === 'textPrompt').length, 3 + 1, 'image prompts are dropped together with their image');
  assert.deepEqual(result.warnings, ['4 张参考图未被任何 Clip 使用，已省略：色锚、膜卷、膜卷·态、字卡',
    '规划视频模型 minimax-h3 在 Tanva 暂无对应节点，1 个 Clip 已改用 Seedance 2.0']);
  const ids = new Set(result.nodes.map((n) => n.id));
  assert.ok(result.edges.every((e) => ids.has(e.source) && ids.has(e.target)), 'no edge points at a dropped node');
});

test('first frame dependency switches Seedance to first_frame mode', () => {
  const result = buildPlanExpansion([plan[0], { ...plan[4], parameters: { ...plan[4].parameters, firstFrameAssetKey: 'image:character:林嫣儿:base' } }],
    { origin: { x: 0, y: 0 }, idPrefix: 'p2' });
  const video = result.nodes.find((n) => n.type === 'seedance20Video')!;
  assert.equal(video.data.seedanceMode, 'first_frame');
  assert.deepEqual(result.edges.filter((e) => e.target === video.id && e.targetHandle === 'image').map((e) => e.source), ['p2-img-0']);
});

test('first_frame dependency role and image referenceAssetKeys are honored', () => {
  const base = { ...plan[0], upstreamDependencies: [] };
  const state = { ...plan[1], upstreamDependencies: [], parameters: { referenceAssetKeys: ['image:character:林嫣儿:base'] } };
  const clip = { ...plan[4], upstreamDependencies: [{ assetKey: 'image:character:林嫣儿:wet', title: 'x', role: 'first_frame' }], parameters: { modelKey: 'seedance-2.0' } };
  const result = buildPlanExpansion([base, state, clip] as unknown as AssetPlanNode[], { origin: { x: 0, y: 0 }, idPrefix: 'f' });
  assert.ok(result.edges.some((e) => e.source === 'f-img-0' && e.target === 'f-img-1' && e.targetHandle === 'img'));
  const video = result.nodes.find((n) => n.type === 'seedance20Video')!;
  assert.equal(video.data.seedanceMode, 'first_frame');
  assert.deepEqual(result.edges.filter((e) => e.target === video.id && e.targetHandle === 'image').map((e) => e.source), ['f-img-1']);
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
