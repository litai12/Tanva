import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildImageCall, buildVideoCall } from './requests';
import { VideoProductionService, type VideoProductionExecutor } from './video-production.service';

// ---------------------------------------------------------------- request builders
{
  const pro = (refs: string[]) => buildImageCall({ nodeType: 'generatePro', prompt: '角色卡\n\n避免：多余手指', resolution: '2K', aspectRatio: '3:4' }, refs, 'n1');
  assert.equal(pro([]).kind, 'generate'); assert.equal(pro([]).dto.enableWebSearch, true);
  assert.equal(pro([]).dto.prompt, '角色卡 避免：多余手指', 'whitespace collapsed like the canvas');
  assert.equal(pro([]).dto.imageSize, '2K', 'planned size reaches the request');
  assert.deepEqual(pro(['https://a/1.png']).dto.sourceImageUrl, 'https://a/1.png'); assert.equal(pro(['https://a/1.png']).kind, 'edit');
  const blend = pro(Array.from({ length: 13 }, (_, i) => `https://a/${i}.png`));
  assert.equal(blend.kind, 'blend'); assert.equal(blend.dto.sourceImageUrls.length, 11);
  const gpt = buildImageCall({ nodeType: 'gptImage2', model: 'gpt-image-2', prompt: 'x', quality: 'low' }, ['https://a/1.png'], 'n2');
  assert.deepEqual([gpt.kind, gpt.dto.aiProvider, gpt.dto.model, gpt.dto.officialFallback, gpt.dto.quality, gpt.dto.imageUrls], ['generate', 'nano2', 'gpt-image-2', false, undefined, ['https://a/1.png']]);
  const vip = buildImageCall({ nodeType: 'gptImage2', model: 'gpt-image-2.5-flare-vip', prompt: 'x', aspectRatio: '9:21' }, [], 'n3');
  assert.deepEqual([vip.dto.managedModelKey, vip.dto.quality, vip.dto.aspectRatio], ['gpt-image-2.5-flare-vip', 'high', '1:1']);
  assert.equal(buildImageCall({ nodeType: 'nano2', prompt: 'x' }, [], 'n4').dto.model, 'gemini-3.1-flash-image-preview');

  const urls: Record<string, string> = { a: 'https://img/a.png', b: 'https://img/b.png', c: 'https://img/c.png' };
  const video = buildVideoCall({ prompt: '镜头：@角色甲 走向 @场景 。@角色甲1 不改写', seedanceModel: 'seedance-2.0', mode: 'reference_images', durationSeconds: 8,
    resolution: '720P', aspectRatio: '9:16', references: ['c', 'b', 'a'],
    mentions: [{ token: '@场景', key: 'b', label: '场景' }, { token: '@角色甲', key: 'a', label: '甲' }] }, k => urls[k], { idempotencyKey: 'k1', clientNodeId: 'n' });
  assert.deepEqual(video.referenceImages, ['https://img/b.png', 'https://img/a.png', 'https://img/c.png'], 'mentioned images first');
  assert.match(video.prompt, /^镜头：@图2 走向 @图1 。@角色甲1 不改写/, 'tokens rewritten; digit continuation is not a match (canvas rule)');
  assert.match(video.prompt, /引用图片映射：@图1=第1张参考图（场景）；@图2=第2张参考图（甲）。请严格按这个映射理解 @ 图片引用。$/);
  assert.deepEqual([video.provider, video.videoMode, video.duration, video.aspectRatio, video.generateAudio, video.idempotencyKey], ['doubao', 'reference_images', 8, '9:16', true, 'k1']);
  assert.equal(video.omniReferenceTaskType, undefined);
  const v25 = buildVideoCall({ prompt: 'x', seedanceModel: 'seedance-2.5', mode: 'reference_images', durationSeconds: 5, resolution: '720P', aspectRatio: '16:9', references: ['a'], mentions: [] }, k => urls[k], { idempotencyKey: 'k', clientNodeId: 'n' });
  assert.equal(v25.omniReferenceTaskType, 'reference');
  const ff = buildVideoCall({ prompt: 'x', seedanceModel: 'seedance-2.0', mode: 'first_frame', firstFrame: 'a', durationSeconds: 5, resolution: '720P', aspectRatio: '16:9', references: [], mentions: [] }, k => urls[k], { idempotencyKey: 'k', clientNodeId: 'n' });
  assert.deepEqual([ff.videoMode, ff.referenceImages], ['first_frame', ['https://img/a.png']]);
  assert.throws(() => buildVideoCall({ prompt: 'x'.repeat(5001), seedanceModel: 'seedance-2.0', mode: 'reference_images', durationSeconds: 5, resolution: '720P', aspectRatio: '16:9', references: [], mentions: [] }, () => undefined, { idempotencyKey: 'k', clientNodeId: 'n' }), /5000/);
}

// ---------------------------------------------------------------- full pipeline (fake executor, real ffmpeg)
async function pipelineRun() {
  const dir = mkdtempSync(join(tmpdir(), 'vprod-spec-'));
  const clipFile = (name: string, color: string) => {
    const file = join(dir, name);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x568:d=1:r=24`, '-f', 'lavfi', '-i', 'sine=d=1',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
    return readFileSync(file);
  };
  const store = new Map<string, Buffer>([['/up/c1.mp4', clipFile('c1.mp4', 'red')], ['/up/c2.mp4', clipFile('c2.mp4', 'blue')]]);
  const server = createServer((req, res) => { const body = store.get(req.url!); if (!body) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': 'video/mp4' }).end(body); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const rows = new Map<string, any>();
  const prisma = { videoTask: {
    create: async ({ data }: any) => { const row = { ...data, createdAt: new Date(), updatedAt: new Date(), completedAt: null, error: null, result: null }; rows.set(data.id, row); return row; },
    findUnique: async ({ where }: any) => rows.get(where.id) ? JSON.parse(JSON.stringify(rows.get(where.id)), (k, v) => (['createdAt', 'updatedAt', 'completedAt'].includes(k) && v ? new Date(v) : v)) : null,
    update: async ({ where, data }: any) => { const row = rows.get(where.id); Object.assign(row, data, { updatedAt: new Date() }); return row; },
    findMany: async ({ where }: any) => [...rows.values()].filter(r => !where?.userId || r.userId === where.userId),
  } };
  const oss = { isEnabled: () => true, putStream: async (key: string, stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = []; for await (const c of stream as any) chunks.push(c as Buffer); store.set(`/oss/${key}`, Buffer.concat(chunks)); return { key, url: `${base}/oss/${key}` }; } };
  const plan = [
    { assetKey: 'image:character:甲:base', title: '甲角色卡', type: 'image', prompt: '甲', upstreamDependencies: [{ assetKey: 'input:1', title: '风格' }], parameters: { modelKey: 'gpt-image-2' } },
    { assetKey: 'image:character:甲:wet', title: '甲·湿', type: 'image', prompt: '甲湿', upstreamDependencies: [{ assetKey: 'image:character:甲:base', title: 'x', role: 'identity' }], parameters: {} },
    { assetKey: 'image:prop:无用:base', title: '无用道具', type: 'image', prompt: 'p', upstreamDependencies: [], parameters: {} },
    { assetKey: 'video:1', title: 'Clip 1', type: 'video', prompt: '@甲 出场', upstreamDependencies: [{ assetKey: 'image:character:甲:base', role: 'reference_image', title: '' }],
      parameters: { durationSeconds: 6, modelKey: 'seedance-2.0', referenceBindings: [{ assetKey: 'image:character:甲:base', mention: '甲', name: '甲' }] } },
    { assetKey: 'video:2', title: 'Clip 2', type: 'video', prompt: '湿身', upstreamDependencies: [{ assetKey: 'image:character:甲:wet', role: 'first_frame', title: '' }], parameters: { durationSeconds: 20 } },
  ];
  let planPolls = 0;
  const plans = {
    options: () => ({ enabled: true, authorModels: ['m1', 'm2'], defaultModel: 'm1' }),
    create: async (_u: string, body: any) => { plans.lastBody = body; plans.bodies = [...(plans.bodies ?? []), body]; return { id: 'plan-1' }; },
    get: async () => ({ status: ++planPolls >= 2 ? 'succeeded' : 'running', hasResult: planPolls >= 2 }),
    result: async () => ({ id: 'plan-1', nodes: plan }),
    lastBody: null as any,
  };
  const calls: any[] = [];
  let imageSeq = 0; const imagePolls = new Map<string, number>();
  let failFirstVideo = true;
  const exec: VideoProductionExecutor = {
    submitImage: async (kind, dto) => { calls.push({ type: 'image', kind, dto }); return { taskId: `img-${++imageSeq}` }; },
    getImageTask: async taskId => { const n = (imagePolls.get(taskId) ?? 0) + 1; imagePolls.set(taskId, n); return n >= 2 ? { status: 'succeeded', imageUrl: `https://img/${taskId}.png` } : { status: 'processing' }; },
    submitVideo: async (dto, req) => { calls.push({ type: 'video', dto, idem: req.headers['idempotency-key'] }); return { taskId: `vid-${calls.filter(c => c.type === 'video').length}` }; },
    getVideoTask: async (_p, taskId) => {
      if (taskId === 'vid-1' && failFirstVideo) { failFirstVideo = false; return { status: 'failed', error: '上游失败' }; }
      return { status: 'succeeded', videoUrl: `${base}/up/${taskId === 'vid-3' ? 'c2' : 'c1'}.mp4` };
    },
    seedanceAccess: async () => ({ allowed: true }),
    quoteImage: async () => 30, quoteVideo: async (_u, dto) => dto.duration * 10,
    probeDuration: async () => 17,
  };
  const credits = { getOrCreateAccount: async () => ({ balance: 10_000 }) };
  const service = new VideoProductionService({ get: () => undefined } as any, prisma as any, oss as any, credits as any, plans as any);
  (service as any).queue = { add: async () => undefined };
  service.registerExecutor(exec);
  const userId = 'u1';
  const drive = async (id: string, max = 30) => { for (let i = 0; i < max && rows.get(id).status === 'processing'; i += 1) await (service as any).tick(id); };

  try {
    // 参数校验
    await assert.rejects(service.create(userId, { mode: 'film' }, undefined), /story/);
    await assert.rejects(service.create(userId, { mode: 'film', story: 's', videoModel: 'kling-v3' }, undefined), /videoModel 无效/);
    await assert.rejects(service.create(userId, { mode: 'film', story: 's', planModel: 'nope' }, undefined), /planModel 无效/);
    await assert.rejects(service.create(userId, { mode: 'remake' }, undefined), /referenceVideoUrl/);

    const job = await service.create(userId, { mode: 'film', story: '故事', referenceImageUrls: ['https://in/style.png'], planModel: 'm2', imageModel: 'nano-banana-pro', targetSeconds: 20 }, undefined);
    assert.equal(job.stage, 'planning');
    await drive(job.jobId);
    assert.equal(plans.lastBody.modelKey, 'm2'); assert.equal(plans.lastBody.targetDurationSeconds, 20);
    assert.equal(plans.bodies.length, 1, '21 秒对 20 秒在容差内，不重规划'); assert.doesNotMatch(String(plans.lastBody.requirement ?? ''), /成片总时长/);
    assert.deepEqual(plans.lastBody.assets, [{ type: 'image', imageType: 'normal', url: 'https://in/style.png' }]);
    const view = await service.get(job.jobId, userId);
    assert.equal(view.status, 'succeeded', JSON.stringify(view));
    // 无用道具不生成；指定模型覆盖规划；身份链按依赖顺序；用户参考图传入。
    const images = calls.filter(c => c.type === 'image');
    assert.equal(images.length, 2);
    assert.ok(images.every(c => c.dto.aiProvider === 'banana'));
    assert.equal(images[0].kind, 'edit'); assert.equal(images[0].dto.sourceImageUrl, 'https://in/style.png');
    assert.equal(images[1].dto.sourceImageUrl, 'https://img/img-1.png', 'state card waits for its base and references it');
    // 视频：第一段失败后自动重试一次（新的幂等键），提及改写为 @图1；第二段首帧、时长截到 15。
    const videos = calls.filter(c => c.type === 'video');
    assert.equal(videos.length, 3);
    assert.deepEqual(videos.map(v => v.idem).sort(), [`vprod-${job.jobId}-c1-a1`, `vprod-${job.jobId}-c1-a2`, `vprod-${job.jobId}-c2-a1`].sort());
    const c1 = videos.find(v => v.idem.endsWith('c1-a1'))!.dto;
    assert.match(c1.prompt, /^@图1 出场/); assert.equal(c1.aspectRatio, '9:16', 'film defaults to 9:16'); assert.equal(c1.duration, 6);
    const c2 = videos.find(v => v.idem.endsWith('c2-a1'))!.dto;
    assert.deepEqual([c2.videoMode, c2.referenceImages, c2.duration], ['first_frame', ['https://img/img-2.png'], 15]);
    assert.equal(view.estimate!.credits, 30 * 2 + 60 + 150, JSON.stringify(view.estimate));
    assert.equal(view.storyboard!.length, 2); assert.equal(view.totalSeconds, 21);
    assert.ok(view.warnings.some(w => /无用道具/.test(w)));
    // 成片：两段 1 秒 → 约 2 秒，已转存。
    assert.ok(view.finalVideoUrl!.endsWith(`/oss/video-productions/u1/${job.jobId}/final.mp4`));
    const finalFile = join(dir, 'final.mp4');
    require('node:fs').writeFileSync(finalFile, store.get(new URL(view.finalVideoUrl!).pathname)!);
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', finalFile]).toString());
    assert.ok(seconds > 1.8 && seconds < 2.5, String(seconds));
    assert.ok(view.storyboard!.every(c => c.videoUrl?.includes('/oss/')), 'clips persisted to OSS');

    // 余额不足：停在 waiting_credits，继续后跑完。
    credits.getOrCreateAccount = async () => ({ balance: 10 });
    planPolls = 0;
    const poor = await service.create(userId, { mode: 'film', story: '故事2' }, undefined);
    await drive(poor.jobId);
    const paused = await service.get(poor.jobId, userId);
    assert.deepEqual([paused.status, paused.stage], ['paused', 'waiting_credits']); assert.match(paused.error!, /余额不足/);
    assert.equal(calls.filter(c => c.type === 'image').length, 2, 'nothing generated while waiting');
    const resumed = await service.produce(poor.jobId, userId, { clipEdits: [{ index: 2, remove: true }, { index: 1, prompt: '改过的提示词' }] });
    assert.equal(resumed.storyboard!.length, 1);
    await drive(poor.jobId);
    const done = await service.get(poor.jobId, userId);
    assert.equal(done.status, 'succeeded'); assert.equal(calls.filter(c => c.type === 'video').at(-1).dto.prompt, '改过的提示词');
    assert.ok(done.finalVideoUrl!.includes('/oss/'), 'single clip result is the final video');

    // 单段生视频：不走规划。
    credits.getOrCreateAccount = async () => ({ balance: 10_000 });
    const single = await service.create(userId, { mode: 'single', prompt: '海浪', videoModel: 'seedance-2.5', durationSeconds: 25, referenceImageUrls: ['https://in/r.png'] }, undefined);
    await drive(single.jobId);
    const s = await service.get(single.jobId, userId);
    const sDto = calls.filter(c => c.type === 'video').at(-1).dto;
    assert.equal(s.status, 'succeeded'); assert.deepEqual([sDto.seedanceModel, sDto.duration, sDto.referenceImages, sDto.omniReferenceTaskType], ['seedance-2.5', 25, ['https://in/r.png'], 'reference']);

    // 失败后只重跑失败部分；取消。
    await assert.rejects(service.retry(single.jobId, userId, {}), /只有失败/);
    const c = await service.create(userId, { mode: 'film', story: 'x' }, undefined);
    assert.equal((await service.cancel(c.jobId, userId)).status, 'canceled');
    await assert.rejects(service.get(c.jobId, 'someone-else'), /不存在/);
    assert.equal((await service.list(userId)).length, 4);
    // 规划时长严重偏离（21 秒对 60 秒）：生成画面前丢弃规划、换新 clientRequestId 重规划一次。
    const offMeta: any = { input: { kind: 'film', targetSeconds: 60, referenceImageUrls: [] }, stage: 'planning', planTaskId: 'plan-1', images: {}, clips: {}, warnings: [] };
    await (service as any).advancePlanning({ id: 'off', userId }, offMeta);
    assert.deepEqual([offMeta.stage, offMeta.planTaskId, offMeta.planAttempts, offMeta.durationReplanned, offMeta.graph], ['planning', undefined, 1, true, undefined]);
    assert.match(offMeta.warnings[0], /规划时长 21 秒与要求的 60 秒相差过大/);
    // 各段尺寸不一致：不能直接拼接，统一编码到 Clip 画幅。
    store.set('/up/odd.mp4', (() => { const f = join(dir, 'odd.mp4'); execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=640x360:d=1:r=30', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]); return readFileSync(f); })());
    const mixedMeta: any = { input: { kind: 'film' }, graph: { clips: [{ key: 'a', resolution: '480P', aspectRatio: '9:16' }, { key: 'b', resolution: '480P', aspectRatio: '9:16' }] },
      clips: { a: { url: `${base}/up/c1.mp4` }, b: { url: `${base}/up/odd.mp4` } } };
    await (service as any).compose({ id: 'mixed', userId }, mixedMeta);
    const mixedFile = join(dir, 'mixed.mp4');
    require('node:fs').writeFileSync(mixedFile, store.get(new URL(mixedMeta.finalVideoUrl).pathname)!);
    const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mixedFile]).toString().trim();
    assert.equal(dims, '480,854', 'mixed clips are re-encoded to the clip frame');
    const mixedSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mixedFile]).toString());
    assert.ok(mixedSeconds > 1.8 && mixedSeconds < 2.5, String(mixedSeconds));
    console.log('video production: request builders, plan → images → Seedance → retry → ffmpeg compose → OSS, credit pause/resume with clip edits, single clip, cancel, ownership checks passed');
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}
void pipelineRun().catch(error => { console.error(error); process.exitCode = 1; });
