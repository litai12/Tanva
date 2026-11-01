import assert from 'node:assert/strict';
import { buildProductionGraph, clampSeedanceDuration, imageWaves, resolveImageNode, resolveSeedanceModel, type AssetPlanNode } from './plan-graph';

// 与 frontend/src/components/flow/tapcanvasPlanExpansion.test.ts 同一份规划样例：两边规则必须得出同一套「生成哪些图、每段怎么绑定」。
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
] as AssetPlanNode[];

{
  const g = buildProductionGraph(plan, { inputs: { 'input:1': 'https://cdn.example/style.png' } });
  assert.deepEqual(g.images.map(i => [i.key, i.nodeType]), [
    ['image:character:林嫣儿:base', 'gptImage2'], ['image:character:林嫣儿:wet', 'gptImage2'], ['image:palette:全章:base', 'generatePro']]);
  const base = g.images[0];
  assert.equal(base.model, 'gpt-image-2'); assert.equal(base.aspectRatio, '3:4'); assert.equal(base.resolution, '2K'); assert.equal(base.quality, 'low');
  assert.match(base.prompt, /避免：多余手指/);
  assert.deepEqual(base.refs, ['input:1'], 'input:N binds to the user reference image');
  assert.deepEqual(g.images[1].refs, ['image:character:林嫣儿:base'], 'state card uses identity reference');
  const clip = g.clips[0];
  assert.equal(clip.seedanceModel, 'seedance-2.0'); assert.equal(clip.durationSeconds, 12); assert.equal(clip.resolution, '720P');
  assert.equal(clip.mode, 'reference_images');
  assert.deepEqual(clip.references, ['image:character:林嫣儿:wet', 'image:palette:全章:base'], 'reference order follows bindings');
  assert.deepEqual(clip.mentions, [{ token: '@林嫣儿·浅碧色罗裙湿透角色卡', key: 'image:character:林嫣儿:wet', label: '林嫣儿' }]);
  assert.equal(g.clips[1].seedanceModel, 'seedance-2.0', 'unsupported model falls back');
  assert.equal(g.warnings.length, 1); assert.match(g.warnings[0], /veo-4.*1 个 Clip 已改用 Seedance 2\.0/);
  assert.deepEqual(imageWaves(g.images), [['image:character:林嫣儿:base', 'image:palette:全章:base'], ['image:character:林嫣儿:wet']]);
}

{ // Seedance 参考图上限；超出上限、无 Clip 能用上的图不生成。
  const refs = Array.from({ length: 11 }, (_, i) => ({ assetKey: `image:prop:p${i}:base`, title: `p${i}`, type: 'image', prompt: 'x', upstreamDependencies: [], parameters: {} }));
  const clip = { assetKey: 'video:1', title: 'Clip 1', type: 'video', prompt: 'v',
    upstreamDependencies: refs.map(r => ({ assetKey: r.assetKey, title: r.title, role: 'reference_image' })),
    parameters: { modelKey: 'minimax-h3', durationSeconds: 5, resolution: '768p' } };
  const g = buildProductionGraph([...refs, clip]);
  assert.equal(g.clips[0].references.length, 9); assert.equal(g.clips[0].resolution, '720P'); assert.equal(g.images.length, 9);
  assert.deepEqual(g.warnings.filter(w => /已省略/.test(w)), ['2 张参考图未被任何 Clip 使用，已省略：p9、p10']);
  // 用户指定 Seedance 2.5：上限 30，11 张全部用上。
  const g25 = buildProductionGraph([...refs, clip], { videoModel: 'seedance-2.5' });
  assert.equal(g25.clips[0].references.length, 11); assert.equal(g25.clips[0].seedanceModel, 'seedance-2.5');
}

{ // 无 Clip 引用的图片省略，被用图片的身份链保留。
  const img = (key: string, deps: string[] = []) => ({ assetKey: key, title: key.split(':')[2] + (key.endsWith(':base') ? '' : '·态'),
    type: 'image', prompt: key, upstreamDependencies: deps.map(d => ({ assetKey: d, title: d, role: 'identity' })),
    parameters: { modelKey: 'gpt-image-2.5-flare', referenceAssetKeys: deps } });
  const images = [img('image:palette:色锚:base'), img('image:scene:台面:base'), img('image:scene:台面:chapter-state:s1', ['image:scene:台面:base']),
    img('image:character:工人:base'), img('image:prop:膜卷:base'), img('image:prop:膜卷:chapter-state:s1', ['image:prop:膜卷:base']), img('image:vfx:字卡:base')];
  const clip = { assetKey: 'video:1', title: 'Clip 1', type: 'video', prompt: 'v',
    upstreamDependencies: [{ assetKey: 'image:character:工人:base', title: '工人', role: 'reference_image' }],
    parameters: { modelKey: 'minimax-h3', durationSeconds: 15, referenceBindings: [{ assetKey: 'image:scene:台面:chapter-state:s1', mention: '台面' }] } };
  const g = buildProductionGraph([...images, clip]);
  assert.deepEqual(g.images.map(i => i.key).sort(), ['image:character:工人:base', 'image:scene:台面:base', 'image:scene:台面:chapter-state:s1']);
  assert.ok(g.images.every(i => i.model === 'gpt-image-2.5-flare'));
  assert.equal(g.warnings[0], '4 张参考图未被任何 Clip 使用，已省略：色锚、膜卷、膜卷·态、字卡');
  // 用户指定生图模型覆盖规划。
  const forced = buildProductionGraph([...images, clip], { imageModel: 'nano-banana-2' });
  assert.ok(forced.images.every(i => i.nodeType === 'nano2' && !i.model));
}

{ // 首帧
  const g = buildProductionGraph([plan[0], { ...plan[4], parameters: { ...plan[4].parameters, firstFrameAssetKey: 'image:character:林嫣儿:base' } }]);
  assert.equal(g.clips[0].mode, 'first_frame'); assert.equal(g.clips[0].firstFrame, 'image:character:林嫣儿:base'); assert.deepEqual(g.clips[0].references, []);
  const base = { ...plan[0], upstreamDependencies: [] };
  const state = { ...plan[1], upstreamDependencies: [], parameters: { referenceAssetKeys: ['image:character:林嫣儿:base'] } };
  const clip = { ...plan[4], upstreamDependencies: [{ assetKey: 'image:character:林嫣儿:wet', title: 'x', role: 'first_frame' }], parameters: { modelKey: 'seedance-2.0' } };
  const g2 = buildProductionGraph([base, state, clip]);
  assert.deepEqual(g2.images[1].refs, ['image:character:林嫣儿:base']);
  assert.equal(g2.clips[0].mode, 'first_frame'); assert.equal(g2.clips[0].firstFrame, 'image:character:林嫣儿:wet');
}

{ // 用户画幅 / 分辨率覆盖；非 Seedance 视频模型直接拒绝。
  const g = buildProductionGraph(plan, { aspectRatio: '9:16', resolution: '1080p' });
  assert.ok(g.clips.every(c => c.aspectRatio === '9:16' && c.resolution === '1080P'));
  assert.throws(() => buildProductionGraph(plan, { videoModel: 'kling-v3' }), /Seedance/);
}

assert.equal(resolveImageNode('nano-banana-2.1').nodeType, 'nano2');
assert.equal(resolveImageNode(undefined).nodeType, 'generatePro');
assert.equal(resolveSeedanceModel('doubao-seedance-2.5'), 'seedance-2.5');
assert.equal(resolveSeedanceModel('kling-v3'), null);
assert.equal(clampSeedanceDuration(2), 4); assert.equal(clampSeedanceDuration(30), 15); assert.equal(clampSeedanceDuration('x'), 5);
console.log('video production plan graph (parity with canvas expansion) checks passed');
