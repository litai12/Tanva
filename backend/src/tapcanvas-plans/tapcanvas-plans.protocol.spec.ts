import assert from 'node:assert/strict';
import { consumptionCredits } from '../consumption-orders/gateway-consumption.protocol';
import { FILM_GUIDE, buildAssetPlanRequest, compactProgress, parsePlanInput, readTapJob, upstreamErrorMessage } from './tapcanvas-plans.protocol';

const base = { modelKey: 'deepseek-v4.1-flash', reasoningEffort: 'none', clientRequestId: 'req-1' };

const run = (): void => {
  // 一键成片：固定引导语 + 原文；未声明字段不进入 TapCanvas strict 请求体。
  const film = parsePlanInput({ ...base, text: '第一章 雨夜', assets: [{ type: 'image', imageType: 'style', url: 'https://oss.example.com/a.png' }] });
  const request = buildAssetPlanRequest(film);
  assert.deepEqual(Object.keys(request).sort(), ['assets', 'modelKey', 'prompt', 'reasoningEffort']);
  assert.ok(String(request.prompt).startsWith(FILM_GUIDE));
  assert.ok(String(request.prompt).endsWith('第一章 雨夜'));
  assert.deepEqual(request.assets, [{ type: 'image', imageType: 'style', url: 'https://oss.example.com/a.png' }]);
  assert.deepEqual(buildAssetPlanRequest(parsePlanInput({ ...base, text: 'x', step: 12, clipPreference: 'max_duration', knowledgeTier: 'medium' })),
    { prompt: buildAssetPlanRequest(parsePlanInput({ ...base, text: 'x' })).prompt, modelKey: base.modelKey, reasoningEffort: 'none',
      assets: [], step: 12, clipPreference: 'max_duration', knowledgeTier: 'medium' });

  // 爆款复刻：必须恰好 1 个参考视频；原视频只作理解素材。
  assert.throws(() => parsePlanInput({ ...base, mode: 'remake', assets: [] }), /参考视频/);
  const remake = buildAssetPlanRequest(parsePlanInput({ ...base, mode: 'remake', assets: [{ type: 'video', url: 'https://oss.example.com/v.mp4' }] }));
  assert.match(String(remake.prompt), /原视频不得作为任何生成接口的输入/);
  assert.match(String(remake.prompt), /保留原片的叙事节奏/);
  assert.doesNotMatch(String(remake.prompt), /成片时长/, 'unknown source duration adds no constraint');
  const timed = parsePlanInput({ ...base, mode: 'remake', sourceDurationSeconds: 17.04, assets: [{ type: 'video', url: 'https://oss.example.com/v.mp4' }] });
  assert.equal(timed.sourceDurationSeconds, 17);
  assert.match(String(buildAssetPlanRequest(timed).prompt), /原片约 17 秒。全部 Clip 时长之和须与原片一致/);
  assert.ok(!('sourceDurationSeconds' in buildAssetPlanRequest(timed)), 'duration only travels in the prompt (TapCanvas request is strict)');
  for (const sourceDurationSeconds of ['abc', -3, 0, 99999]) {
    assert.equal(parsePlanInput({ ...base, mode: 'remake', sourceDurationSeconds, assets: [{ type: 'video', url: 'https://oss.example.com/v.mp4' }] }).sourceDurationSeconds, undefined);
  }
  assert.equal(parsePlanInput({ ...base, text: 'x', sourceDurationSeconds: 17 }).sourceDurationSeconds, undefined, 'film mode ignores it');

  // 设计 JSON 约束：data:/blob:/裸 base64 一律拒绝。
  for (const url of ['data:image/png;base64,AAAA', 'blob:https://x/1', 'iVBORw0KGgo']) {
    assert.throws(() => parsePlanInput({ ...base, text: 'x', assets: [{ type: 'image', url }] }), /地址/);
  }
  assert.throws(() => parsePlanInput({ ...base, text: '' }), /原文/);
  assert.throws(() => parsePlanInput({ ...base, text: 'x', clientRequestId: undefined }), /clientRequestId/);
  assert.throws(() => parsePlanInput({ ...base, text: 'x', reasoningEffort: 'turbo' }), /reasoningEffort/);

  // TapCanvas 信封解析。
  assert.equal(readTapJob({ ret: 0, data: { jobId: 'asset_plan_1', status: 'running' } })?.jobId, 'asset_plan_1');
  assert.equal(readTapJob({ ret: 0, data: { jobId: 'bad id', status: 'running' } }), null);
  assert.equal(readTapJob({ ret: 0, data: [] }), null);
  assert.deepEqual(compactProgress({ retryUrl: '/r', progress: { nodes: [{ label: '资产规划', status: 'running', items: [1] }] } }).nodes,
    [{ label: '资产规划', status: 'running' }]);
  assert.match(upstreamErrorMessage(402, {}), /余额不足/);

  // 计价口径：TapCanvas 1 元 = 10 积分；Tanva 1 元 = 100 积分且加价 50%。
  // TapCanvas 实扣 37 积分 → 回执 ¥3.7 → Tanva 扣 3.7 × 1.5 × 100 = 555 积分（= TapCanvas 积分 × 15）。
  assert.equal(consumptionCredits('3.7').creditsCharged, 555);
  assert.equal(consumptionCredits('0').creditsCharged, 0);
  assert.equal(consumptionCredits('0.1').creditsCharged, 15);
};

run();
console.log('tapcanvas-plans protocol ok');
