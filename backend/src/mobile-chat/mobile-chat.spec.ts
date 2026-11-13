import 'reflect-metadata';
import assert from 'node:assert/strict';
import { buildCapabilityManifestSummary, MOBILE_HOST_NAME } from '../agent/xiaot-host-context';
import {
  buildMobileManifest, collectUserUrls, composeUpstreamPrompt, MOBILE_TOOL_FILM, MOBILE_TOOL_IMAGE, MOBILE_TOOL_REMAKE, MOBILE_TOOL_DETAIL, toImageRequest, toDetailRequest, detailSectionPrompt, detailAnchorPrompt, previousProductReferences,
  parseAttachments, titleFrom, toProductionRequest,
} from './mobile-chat.protocol';
import { MobileChatService } from './mobile-chat.service';
import { nearestVideoRatio } from '../video-production/requests';
import sharp from 'sharp';
import { stitchVertical } from './mobile-chat.stitch';
import { TextPump, TurnGate, visibleText } from './mobile-chat.stream';
import { XIAOT_DURABLE_CONTINUATION_PLACEHOLDER } from '../agent/xiaot-agent-recovery';

const throwsMsg = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: any) => re.test(String(e?.response?.message ?? e?.message)));

// ---------------------------------------------------------------- manifest
{
  const manifest = buildMobileManifest();
  assert.equal(manifest.host, MOBILE_HOST_NAME);
  assert.ok(manifest.patchOps.length >= 1 && manifest.nodeSpecs.length >= 1, 'TapCanvas schema requires both');
  assert.deepEqual(manifest.hostTools.map(t => t.name), [MOBILE_TOOL_FILM, MOBILE_TOOL_REMAKE, MOBILE_TOOL_IMAGE, MOBILE_TOOL_DETAIL]);
  assert.equal((manifest as any).generationMode, undefined, 'default host mode: TapCanvas never generates media itself');
  const summary = buildCapabilityManifestSummary(manifest) as any;
  assert.deepEqual(summary.hostTools.map((t: any) => t.name), [MOBILE_TOOL_FILM, MOBILE_TOOL_REMAKE, MOBILE_TOOL_IMAGE, MOBILE_TOOL_DETAIL]);
  assert.deepEqual(summary.notes, manifest.notes, 'mobile keeps its own notes');
  assert.ok(!JSON.stringify(summary.notes).includes('query_canvas'), 'no canvas query guidance on mobile');
  const detailParams = summary.hostTools.find((t: any) => t.name === MOBILE_TOOL_DETAIL).parameters;
  assert.deepEqual(Object.keys(detailParams.properties.sections.items.properties), ['title', 'prompt'], 'nested item schema reaches the model');
  assert.ok(detailParams.properties.aspectRatio.enum.includes('3:4'), 'enum values not nulled');
  const filmParams = summary.hostTools.find((t: any) => t.name === MOBILE_TOOL_FILM).parameters;
  assert.ok(filmParams.properties.aspectRatio.enum.includes('9:16'));
  assert.equal(filmParams.properties.referenceImageUrls.items.type, 'string');
  const canvas = buildCapabilityManifestSummary({ ...manifest, host: 'tanva' }) as any;
  assert.ok(JSON.stringify(canvas.notes).includes('query_canvas'), 'canvas host unchanged');
}

// ---------------------------------------------------------------- attachments
{
  assert.deepEqual(parseAttachments(undefined), []);
  assert.deepEqual(parseAttachments([{ type: 'video', url: 'https://oss.example/a.mp4', name: 'a.mp4' }]),
    [{ type: 'video', url: 'https://oss.example/a.mp4', name: 'a.mp4' }]);
  throwsMsg(() => parseAttachments([{ type: 'image', url: 'data:image/png;base64,iVBOR' }]), /远程地址/);
  throwsMsg(() => parseAttachments([{ type: 'image', url: 'blob:https://x/1' }]), /远程地址/);
  throwsMsg(() => parseAttachments([{ type: 'audio', url: 'https://x/a.mp3' }]), /附件 1/);
  throwsMsg(() => parseAttachments(Array.from({ length: 10 }, () => ({ type: 'image', url: 'https://x/1.png' }))), /最多/);
}

// ---------------------------------------------------------------- tool → video-productions request
{
  const urls = collectUserUrls([
    { content: '复刻这个 https://cdn.example/v.mp4，谢谢', attachments: [{ type: 'image', url: 'https://oss.example/p.png' }] },
  ]);
  assert.ok(urls.has('https://cdn.example/v.mp4') && urls.has('https://oss.example/p.png'));

  const film = toProductionRequest(MOBILE_TOOL_FILM, { story: '  一只猫的冒险  ', targetSeconds: 30.4, referenceImageUrls: ['https://oss.example/p.png'] }, urls);
  assert.deepEqual(film, { mode: 'film', story: '一只猫的冒险', aspectRatio: '9:16', resolution: '720P',
    referenceImageUrls: ['https://oss.example/p.png'], targetSeconds: 30 });
  const filmRatio = toProductionRequest(MOBILE_TOOL_FILM, { story: 's', aspectRatio: '16:9', targetSeconds: 999 }, urls);
  assert.equal(filmRatio.aspectRatio, '16:9'); assert.equal(filmRatio.targetSeconds, undefined, 'out-of-range target dropped');
  throwsMsg(() => toProductionRequest(MOBILE_TOOL_FILM, {}, urls), /故事/);
  throwsMsg(() => toProductionRequest(MOBILE_TOOL_FILM, { story: 's', referenceImageUrls: ['https://evil.example/x.png'] }, urls), /本会话/);

  const remake = toProductionRequest(MOBILE_TOOL_REMAKE, { referenceVideoUrl: 'https://cdn.example/v.mp4', requirements: '换成古风' }, urls);
  assert.deepEqual(remake, { mode: 'remake', referenceVideoUrl: 'https://cdn.example/v.mp4', resolution: '720P', requirements: '换成古风' });
  assert.equal(remake.videoModel, undefined, 'video model follows the TapCanvas plan (e.g. Seedance 2.5), never forced');

  // 线上 2026-11-11：用户附车图说“用图中车替换”，模型漏传 referenceImageUrls → 宿主必须自动补上本条附件。
  const turn = [{ type: 'video' as const, url: 'https://oss.example/src.mov' }, { type: 'image' as const, url: 'https://oss.example/car.jpeg' }];
  const turnUrls = collectUserUrls([{ content: '复刻这个视频，用图中车替换', attachments: turn }]);
  const auto = toProductionRequest(MOBILE_TOOL_REMAKE, { referenceVideoUrl: 'https://oss.example/src.mov', requirements: '换车' }, turnUrls, turn);
  assert.deepEqual(auto.referenceImageUrls, ['https://oss.example/car.jpeg']);
  const noVideoArg = toProductionRequest(MOBILE_TOOL_REMAKE, {}, turnUrls, turn);
  assert.equal(noVideoArg.referenceVideoUrl, 'https://oss.example/src.mov', 'single video attachment used when the model omits it');
  const dedup = toProductionRequest(MOBILE_TOOL_FILM, { story: 's', referenceImageUrls: ['https://oss.example/car.jpeg'] }, turnUrls, turn);
  assert.deepEqual(dedup.referenceImageUrls, ['https://oss.example/car.jpeg']);

  // 生图
  const img = toImageRequest({ prompt: ' 一张海报 ', aspectRatio: '9:16', count: 9 }, turnUrls, turn);
  assert.deepEqual(img, { prompt: '一张海报', referenceImageUrls: ['https://oss.example/car.jpeg'], aspectRatio: '9:16', count: 4 });
  assert.equal(toImageRequest({ prompt: 'x', aspectRatio: '7:1' }, turnUrls).aspectRatio, '1:1');
  throwsMsg(() => toImageRequest({}, turnUrls), /画面描述/);
  throwsMsg(() => toImageRequest({ prompt: 'x', referenceImageUrls: ['https://evil.example/a.png'] }, turnUrls), /本会话/);

  // 详情页
  const detail = toDetailRequest({ title: '保温杯', style: '奶油白+森林绿', sections: [{ title: '首屏', prompt: '主图' }, { title: '', prompt: '卖点' }, { title: '空', prompt: '' }] }, turnUrls, turn);
  assert.deepEqual(detail.sections, [{ title: '首屏', prompt: '主图' }, { title: '第 2 屏', prompt: '卖点' }], 'empty prompts dropped, missing titles numbered');
  assert.equal(detail.aspectRatio, '3:4'); assert.deepEqual(detail.referenceImageUrls, ['https://oss.example/car.jpeg']);
  const sp = detailSectionPrompt(detail, 1);
  assert.match(sp, /第 2\/2 屏/); assert.match(sp, /奶油白\+森林绿/); assert.match(sp, /本屏画面：卖点/); assert.match(sp, /严格以参考图为准/);
  // 商品锁定：每屏逐字带同一段商品结构；定妆图只要商品、不要文字
  const locked = toDetailRequest({ title: '保温杯详情页', product: '雾蓝直筒杯身，同色弹盖+金色按键，无提绳', productChanged: true,
    sections: [{ title: 'a', prompt: 'x' }, { title: 'b', prompt: 'y' }] }, turnUrls);
  assert.equal(locked.productChanged, true);
  assert.ok([0, 1].every(i => detailSectionPrompt(locked, i).includes('商品（每屏都是同一件，结构不得改变）：雾蓝直筒杯身，同色弹盖+金色按键，无提绳')));
  assert.match(detailAnchorPrompt(locked), /#FFFFFF[\s\S]*正面、侧面[\s\S]*不要：任何文字/);
  assert.equal(toDetailRequest({ sections: ['a', 'b'] }, turnUrls).productChanged, false);
  assert.deepEqual(previousProductReferences([
    { kind: 'image_set', attachments: { productReferenceUrls: ['https://oss.example/old.png'] } },
    { kind: 'text', attachments: null },
    { kind: 'image_set', attachments: { productReferenceUrls: ['https://oss.example/new.png', 'javascript:x'] } },
    { kind: 'image_set', attachments: { sections: [] } },
  ]), ['https://oss.example/new.png'], 'latest image_set that recorded references wins');
  throwsMsg(() => toDetailRequest({ sections: [{ title: 'a', prompt: 'x' }] }, turnUrls), /至少需要 2 屏/);
  // 容错：字段名不同 / 字符串数组 / JSON 字符串
  assert.deepEqual(toDetailRequest({ sections: [{ name: '首屏', content: 'a' }, { heading: '卖点', description: 'b' }] }, turnUrls).sections,
    [{ title: '首屏', prompt: 'a' }, { title: '卖点', prompt: 'b' }]);
  assert.equal(toDetailRequest({ sections: ['a', 'b', 'c'] }, turnUrls).sections.length, 3);
  assert.equal(toDetailRequest({ sections: JSON.stringify([{ title: 'x', prompt: 'a' }, { title: 'y', prompt: 'b' }]) }, turnUrls).sections.length, 2);
  assert.equal(toDetailRequest({ sections: Array.from({ length: 15 }, (_, i) => ({ title: `${i}`, prompt: 'p' })) }, turnUrls).sections.length, 10);

  // 复刻画幅跟随原片
  assert.equal(nearestVideoRatio(720, 1200), '9:16');
  assert.equal(nearestVideoRatio(1920, 1080), '16:9');
  assert.equal(nearestVideoRatio(1080, 1080), '1:1');
  assert.equal(nearestVideoRatio(0, 1080), undefined);
  assert.equal(remake.aspectRatio, undefined, 'remake follows the source unless asked');
  throwsMsg(() => toProductionRequest(MOBILE_TOOL_REMAKE, { referenceVideoUrl: 'https://made-up.example/v.mp4' }, urls), /本会话/);
  throwsMsg(() => toProductionRequest('flow_patch', {}, urls), /未知/);
}

// ---------------------------------------------------------------- prompt / title
{
  const prompt = composeUpstreamPrompt('帮我复刻', [{ type: 'video', url: 'https://cdn.example/v.mp4' }],
    [{ jobId: 'vprod_1', mode: 'film', stage: 'succeeded', finalVideoUrl: 'https://oss/f.mp4' }, { jobId: 'vprod_2', mode: 'remake', stage: 'waiting_credits' }]);
  assert.match(prompt, /【用户附件】\n- 视频：https:\/\/cdn\.example\/v\.mp4/);
  assert.match(prompt, /一键成片 vprod_1：已完成，成片 https:\/\/oss\/f\.mp4/);
  assert.match(prompt, /一键复刻 vprod_2：余额不足已暂停/);
  assert.equal(composeUpstreamPrompt('', [], []), '（用户只发送了附件）');
  assert.equal(titleFrom('  做一个   关于春天的短片 ', []), '做一个 关于春天的短片');
  assert.equal(titleFrom('', [{ type: 'video', url: 'https://x/v.mp4' }]), '视频复刻');
  assert.equal(titleFrom('一'.repeat(30), []).length, 25);
}

// ---------------------------------------------------------------- turn gate
{
  let t = 0;
  const gate = new TurnGate({ maxConcurrent: 3, perUserConcurrent: 2, perUserPerMinute: 4 }, () => t);
  const r1 = gate.acquire('u1', 'c1');
  throwsMsg(() => gate.acquire('u1', 'c1'), /处理中/);
  const r2 = gate.acquire('u1', 'c2');
  throwsMsg(() => gate.acquire('u1', 'c3'), /2 条消息在处理中/);
  const r3 = gate.acquire('u2', 'c4');
  throwsMsg(() => gate.acquire('u3', 'c5'), /使用人数较多/);
  assert.equal(gate.activeTurns, 3);
  r1(); r1(); r2(); r3();
  assert.equal(gate.activeTurns, 0, 'release is idempotent');
  gate.acquire('u1', 'c1')(); gate.acquire('u1', 'c1')();
  throwsMsg(() => gate.acquire('u1', 'c1'), /太频繁/);
  t += 61_000; gate.sweep();
  gate.acquire('u1', 'c1')();
  try { gate.acquire('u1', 'c1'); } catch (e: any) { assert.fail(e.message); }
}

// ---------------------------------------------------------------- live text pump
(async () => {
  const P = XIAOT_DURABLE_CONTINUATION_PLACEHOLDER;
  assert.equal(visibleText(`好的${P}`), '好的');
  assert.equal(visibleText(`好的\n${P.slice(0, 6)}`), '好的', 'partial placeholder tail held back');
  assert.equal(visibleText('任务已'), '任务已', 'short ordinary text untouched');
  const events: Array<[string, any]> = [];
  const saved: string[] = [];
  const pump = new TextPump((e, d) => events.push([e, d]), async text => { saved.push(text); }, 5, 20);
  pump.delta('你'); pump.delta('好');
  await new Promise(r => setTimeout(r, 15));
  pump.delta('，世界');
  await new Promise(r => setTimeout(r, 15));
  pump.reset(); pump.delta('重来');
  await new Promise(r => setTimeout(r, 30));
  pump.close();
  assert.deepEqual(events, [['delta', { text: '你好' }], ['delta', { text: '，世界' }], ['text', { content: '重来' }]],
    'coalesced deltas, snapshot after reset');
  assert.ok(saved.length >= 1 && saved[saved.length - 1] === '重来', 'partial text persisted');
})().catch(error => { console.error(error); process.exit(1); });

// ---------------------------------------------------------------- service turn (fake prisma / agent / productions)
(async () => {
  const conversations: any[] = [{ id: 'c1', userId: 'u1', title: '新会话', deletedAt: null, lastMessageAt: new Date() }];
  const messages: any[] = [];
  let seq = 0;
  const prisma: any = {
    mobileConversation: {
      findFirst: async ({ where }: any) => conversations.find(c => c.id === where.id && c.userId === where.userId && !c.deletedAt) ?? null,
      update: async ({ where, data }: any) => Object.assign(conversations.find(c => c.id === where.id), data),
    },
    mobileMessage: {
      create: async ({ data }: any) => { const m = { id: `m${++seq}`, kind: 'text', content: '', status: 'done', attachments: null, jobId: null, createdAt: new Date(), ...data }; messages.push(m); return m; },
      update: async ({ where, data }: any) => Object.assign(messages.find(m => m.id === where.id), data),
      findMany: async () => messages.slice(),
      updateMany: async () => ({ count: 0 }),
    },
    videoTask: { count: async () => 0, findMany: async () => [] },
    creditAccount: { findUnique: async () => ({ balance: 100 }) },
  };
  const created: any[] = [];
  const productions: any = { create: async (userId: string, body: any) => { created.push({ userId, body }); return { jobId: `vprod_${created.length}` }; } };
  let lastDto: any;
  const xiaot: any = {
    run: async (dto: any, _userId: string, emit: any, _t: any, _c: any, _q: any, _root: any, stream: any) => {
      lastDto = dto;
      emit('run_started', {});
      stream.delta('已提交');
      emit('flow_patch', { data: { patch: { op: 'addNode' } } });
      emit('host_tool', { data: { name: MOBILE_TOOL_REMAKE, arguments: { referenceVideoUrl: 'https://oss.example/v.mp4' } } });
      emit('host_tool', { data: { name: 'query_canvas', arguments: {} } });
      emit('final', { message: '已提交复刻任务' });
      emit('done', {});
    },
  };
  const service = new MobileChatService(prisma, xiaot, productions);
  const events: Array<[string, any]> = [];
  const turn = await service.prepareTurn('u1', 'c1', { text: '复刻这个', attachments: [{ type: 'video', url: 'https://oss.example/v.mp4' }] });
  await assert.rejects(service.prepareTurn('u1', 'c1', { text: 'again' }), /处理中/);
  await service.runTurn(turn, (e, d) => events.push([e, d]));
  assert.equal(conversations[0].title, '复刻这个');
  assert.equal(lastDto.sessionId, 'mobile:c1');
  assert.match(lastDto.prompt, /【用户附件】/);
  assert.equal(created.length, 1, 'only declared host tools execute; flow_patch / query_canvas ignored');
  assert.deepEqual(created[0], { userId: 'u1', body: { mode: 'remake', referenceVideoUrl: 'https://oss.example/v.mp4', resolution: '720P' } });
  const job = messages.find(m => m.kind === 'job');
  assert.equal(job.jobId, 'vprod_1');
  assert.equal(messages.find(m => m.id === turn.assistantMessage.id).content, '已提交复刻任务');
  assert.deepEqual(events.map(e => e[0]).filter(e => e !== 'status' && e !== 'delta'), ['message', 'final', 'done']);
  assert.deepEqual(events.find(e => e[0] === 'delta')?.[1], { text: '已提交' }, 'live text reaches the client before final');
  await assert.rejects(service.prepareTurn('u2', 'c1', { text: 'x' }), /不存在/);

  // 上游失败：占位消息转 error，用户可见文案不暴露内部细节。
  xiaot.run = async () => { throw new Error('xiaot-agent upstream error: status=502'); };
  const turn2 = await service.prepareTurn('u1', 'c1', { text: '再来' });
  await service.runTurn(turn2, () => undefined);
  const failed = messages.find(m => m.id === turn2.assistantMessage.id);
  assert.equal(failed.status, 'error'); assert.equal(failed.content, '对话服务暂时不可用，请稍后重试');

  // 并发上限：已有 2 个运行中任务时不提交，生成 error 卡。
  prisma.videoTask.count = async () => 2;
  xiaot.run = async (_dto: any, _u: string, emit: any) => {
    emit('host_tool', { data: { name: MOBILE_TOOL_FILM, arguments: { story: '故事' } } });
    emit('final', { message: '' });
  };
  const turn3 = await service.prepareTurn('u1', 'c1', { text: '做个片' });
  await service.runTurn(turn3, () => undefined);
  assert.equal(created.length, 1);
  assert.match(messages.filter(m => m.kind === 'error').pop().content, /同时最多进行 2 个/);

  // 生图：每张一张卡片，幂等键按助手消息 + 序号；附件自动带上。
  const images: any[] = [];
  productions.submitUserImage = async (userId: string, body: any) => { images.push({ userId, body }); return { taskId: `img_${images.length}` }; };
  xiaot.run = async (_dto: any, _u: string, emit: any) => {
    emit('host_tool', { data: { name: MOBILE_TOOL_IMAGE, arguments: { prompt: '把这辆车做成海报', count: 2, aspectRatio: '3:4' } } });
    emit('final', { message: '正在生成' });
  };
  const turnImg = await service.prepareTurn('u1', 'c1', { text: '做海报', attachments: [{ type: 'image', url: 'https://oss.example/car.png' }] });
  await service.runTurn(turnImg, () => undefined);
  assert.equal(images.length, 2);
  assert.deepEqual(images[0].body.referenceImageUrls, ['https://oss.example/car.png']);
  assert.equal(images[0].body.idempotencyKey, `${turnImg.assistantMessage.id}-1-1`);
  assert.equal(images[1].body.idempotencyKey, `${turnImg.assistantMessage.id}-1-2`);
  const imageCards = messages.filter(m => m.kind === 'image');
  assert.deepEqual(imageCards.map(m => m.jobId), ['img_1', 'img_2']);

  // 详情页：没有商品图时先出定妆图并等到图，再每屏都参考它；一张 image_set 卡，拼长图须全部完成、拼过后幂等。
  images.length = 0;
  (service as any).anchorPollMs = 1;
  const anchorStatus: Record<string, any> = { img_1: { status: 'processing', imageUrl: null } };
  let anchorPolls = 0;
  productions.imageTaskStatus = async (_u: string, id: string) => {
    if (id === 'img_1' && ++anchorPolls >= 2) anchorStatus.img_1 = { status: 'succeeded', imageUrl: 'https://oss.example/anchor.png' };
    return anchorStatus[id] ?? { status: 'processing', imageUrl: null };
  };
  xiaot.run = async (_dto: any, _u: string, emit: any) => {
    emit('host_tool', { data: { name: MOBILE_TOOL_DETAIL, arguments: { title: '杯子详情页', sections: [{ title: '首屏', prompt: 'a' }, { title: '卖点', prompt: 'b' }, { title: '参数', prompt: 'c' }] } } });
    emit('final', { message: '' });
  };
  const turnDetail = await service.prepareTurn('u1', 'c1', { text: '做个详情页' });
  const detailEvents: Array<[string, any]> = [];
  await service.runTurn(turnDetail, (e, d) => detailEvents.push([e, d]));
  assert.equal(images.length, 4, 'anchor first, then one task per section');
  assert.deepEqual([images[0].body.aspectRatio, images[0].body.referenceImageUrls, images[0].body.idempotencyKey],
    ['3:2', [], `${turnDetail.assistantMessage.id}-1-anchor`]);
  assert.ok(detailEvents.some(([e, d]) => e === 'status' && /商品定妆图/.test(d.text)), 'user sees the anchor wait');
  assert.deepEqual(images.slice(1).map(i => i.body.aspectRatio), ['3:4', '3:4', '3:4']);
  assert.ok(images.slice(1).every(i => i.body.referenceImageUrls.join() === 'https://oss.example/anchor.png'), 'every section references the anchor');
  assert.ok(images.slice(1).every(i => /严格以参考图为准/.test(i.body.prompt)));
  assert.equal(images[3].body.idempotencyKey, `${turnDetail.assistantMessage.id}-1-s3`);
  const setMsg = messages.find(m => m.kind === 'image_set');
  assert.deepEqual(setMsg.attachments.sections.map((x: any) => x.taskId), ['img_2', 'img_3', 'img_4']);
  assert.deepEqual(setMsg.attachments.productReferenceUrls, ['https://oss.example/anchor.png']);
  assert.deepEqual(setMsg.attachments.anchor, { taskId: 'img_1', imageUrl: 'https://oss.example/anchor.png' });
  prisma.mobileMessage.findFirst = async ({ where }: any) => messages.find(m => m.id === where.id && m.userId === where.userId && m.kind === where.kind) ?? null;
  const png = (h: number, color: string) => sharp({ create: { width: 300, height: h, channels: 3, background: color } }).png().toBuffer();
  const pngs: Record<string, Buffer> = { img_2: await png(400, '#ff0000'), img_3: await png(400, '#00ff00'), img_4: await png(200, '#0000ff') };
  let done = false;
  productions.imageTaskStatus = async (_u: string, id: string) => ({ status: done ? 'succeeded' : 'processing', imageUrl: done ? `https://oss.example/${id}.png` : null });
  const puts: any[] = [];
  (service as any).oss = { isEnabled: () => true, putBuffer: async (key: string, buf: Buffer) => { puts.push({ key, buf }); return { key, url: `https://oss.example/${key}` }; } };
  const realFetch = global.fetch;
  (global as any).fetch = async (url: URL) => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => pngs[String(url).match(/(img_\d)/)![1]] });
  await assert.rejects(service.stitch('u1', setMsg.id), /还没生成完/);
  done = true;
  const stitched: any = await service.stitch('u1', setMsg.id);
  assert.equal(stitched.imageSet.longImageUrl, `https://oss.example/mobile-chat/u1/${setMsg.id}/detail-long.jpg`);
  const meta = await sharp(puts[0].buf).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [300, 1000, 'jpeg']);
  const { data } = await sharp(puts[0].buf).raw().toBuffer({ resolveWithObject: true });
  const px = (y: number) => [...data.subarray((y * 300 + 150) * 3, (y * 300 + 150) * 3 + 3)].map(v => Math.round(v / 255));
  assert.deepEqual([px(100), px(600), px(900)], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'sections stacked top to bottom in order');
  await service.stitch('u1', setMsg.id);
  assert.equal(puts.length, 1, 'stitch is idempotent');
  await assert.rejects(service.stitch('u2', setMsg.id), /不存在/);
  (global as any).fetch = realFetch;

  // 同会话补规格重做：本轮没附图也沿用上一套的商品参考，不再出定妆图（茶月山案）。
  images.length = 0;
  const detailArgs = (extra: Record<string, unknown> = {}) => ({ title: '杯子详情页', sections: [{ title: '首屏', prompt: 'a' }, { title: '参数', prompt: '高 135mm' }], ...extra });
  xiaot.run = async (_dto: any, _u: string, emit: any) => { emit('host_tool', { data: { name: MOBILE_TOOL_DETAIL, arguments: detailArgs() } }); emit('final', { message: '' }); };
  const turnRedo = await service.prepareTurn('u1', 'c1', { text: '规格是高135mm' });
  await service.runTurn(turnRedo, () => undefined);
  assert.equal(images.length, 2, 'no second anchor');
  assert.ok(images.every(i => i.body.referenceImageUrls.join() === 'https://oss.example/anchor.png'));
  assert.deepEqual(messages.filter(m => m.kind === 'image_set').pop().attachments.productReferenceUrls, ['https://oss.example/anchor.png']);

  // 本轮附了商品图：直接用它，不出定妆图，也不混入上一套的参考。
  images.length = 0;
  const turnPhoto = await service.prepareTurn('u1', 'c1', { text: '换成这张图', attachments: [{ type: 'image', url: 'https://oss.example/cup.png' }] });
  await service.runTurn(turnPhoto, () => undefined);
  assert.equal(images.length, 2);
  assert.ok(images.every(i => i.body.referenceImageUrls.join() === 'https://oss.example/cup.png'));

  // 换了另一件商品且没图：重新出定妆图；定妆图失败则整套不提交、报错卡，不退回成各屏文生图。
  images.length = 0;
  productions.imageTaskStatus = async () => ({ status: 'failed', imageUrl: null, error: '内容审核未通过' });
  xiaot.run = async (_dto: any, _u: string, emit: any) => { emit('host_tool', { data: { name: MOBILE_TOOL_DETAIL, arguments: detailArgs({ productChanged: true, product: '黑色电动牙刷' }) } }); emit('final', { message: '' }); };
  const turnNew = await service.prepareTurn('u1', 'c1', { text: '再做个牙刷的' });
  await service.runTurn(turnNew, () => undefined);
  assert.equal(images.length, 1, 'only the anchor was submitted');
  assert.match(images[0].body.prompt, /黑色电动牙刷/);
  assert.match(messages.filter(m => m.kind === 'error').pop().content, /商品定妆图生成失败：内容审核未通过，详情页未提交/);

  // 余额不足：不进上游、不落库消息、不占并发位。
  prisma.creditAccount.findUnique = async () => ({ balance: 3 });
  const before = messages.length;
  await assert.rejects(service.prepareTurn('u1', 'c1', { text: '再来一个' }), (e: any) => e.getStatus() === 402 && /余额不足/.test(e.message));
  assert.equal(messages.length, before);
  prisma.creditAccount.findUnique = async () => ({ balance: 100 });
  const turn4 = await service.prepareTurn('u1', 'c1', { text: '余额恢复' });
  turn4.release();
  console.log('mobile-chat spec ok');
})().catch(error => { console.error(error); process.exit(1); });

// ---------------------------------------------------------------- failed image retries persist only the selected replacement
(async () => {
  const messages: any[] = [
    { id: 'set', userId: 'u1', conversationId: 'c1', role: 'assistant', kind: 'image_set', createdAt: new Date(),
      attachments: { title: '详情页', aspectRatio: '3:4', sections: [{ title: '主图', taskId: 'ok' }, { title: '售后', taskId: 'failed' }] } },
    { id: 'single', userId: 'u1', conversationId: 'c1', role: 'assistant', kind: 'image', jobId: 'failed-single', createdAt: new Date(),
      content: 'truncated', attachments: { aspectRatio: '1:1' } },
    { id: 'empty', userId: 'u1', conversationId: 'c1', role: 'assistant', kind: 'image_set', createdAt: new Date(),
      attachments: { aspectRatio: '3:4', referenceImageUrls: ['https://oss.example/product.png'],
        productReferenceUrls: ['https://oss.example/anchor.png'],
        sections: [{ title: '参数', taskId: null, prompt: '完整参数描述', error: '余额不足' }] } },
  ];
  const tasks: any[] = [
    { id: 'ok', userId: 'u1', status: 'succeeded', prompt: '主图' },
    { id: 'failed', userId: 'u1', status: 'failed', prompt: '完整售后描述', requestData: { imageUrls: ['https://oss.example/product.png'] } },
    { id: 'failed-single', userId: 'u1', status: 'failed', prompt: '完整原始描述'.repeat(100), requestData: { imageUrls: ['https://oss.example/source.png'] } },
  ];
  const tx: any = {
    mobileConversation: { findFirst: async ({ where }: any) => where.userId === 'u1' ? { id: 'c1' } : null },
    $queryRaw: async () => [],
    mobileMessage: {
      findFirst: async ({ where }: any) => messages.find(m => m.id === where.id && m.userId === where.userId) ?? null,
      update: async ({ where, data }: any) => Object.assign(messages.find(m => m.id === where.id), data),
    },
    imageTask: { findFirst: async ({ where }: any) => tasks.find(t => t.userId === where.userId && (where.id ? t.id === where.id : t.nodeId === where.nodeId)) ?? null },
  };
  let chain = Promise.resolve();
  const prisma: any = {
    ...tx,
    $transaction: (run: any) => {
      const result = chain.then(() => run(tx));
      chain = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const calls: any[] = [];
  let rejectSubmit = false;
  const productions: any = { submitUserImage: async (userId: string, input: any) => {
    if (rejectSubmit) throw new Error('积分余额不足');
    calls.push({ userId, ...input });
    const id = `retry-${calls.length}`;
    tasks.push({ id, userId, status: 'queued', prompt: input.prompt, requestData: { imageUrls: input.referenceImageUrls },
      nodeId: `mimg-${input.idempotencyKey}`, createdAt: new Date() });
    return { taskId: id };
  } };
  const service = new MobileChatService(prisma, {} as any, productions);
  await assert.rejects(service.retryImage('u2', 'set', { taskId: 'failed', sectionIndex: 1 }), /不存在/);
  await assert.rejects(service.retryImage('u1', 'set', { taskId: 'failed', sectionIndex: -1 }), /序号/);
  await assert.rejects(service.retryImage('u1', 'set', { taskId: 'failed', sectionIndex: '1' }), /序号/);
  await assert.rejects(service.retryImage('u1', 'set', {}), /原图片任务/);
  await assert.rejects(service.retryImage('u1', 'set', { taskId: 'ok', sectionIndex: 0 }), /无需/);
  assert.equal(calls.length, 0);
  rejectSubmit = true;
  await assert.rejects(service.retryImage('u1', 'set', { taskId: 'failed', sectionIndex: 1 }), /余额不足/);
  assert.equal(messages[0].attachments.sections[1].taskId, 'failed');
  rejectSubmit = false;
  const results = await Promise.all([
    service.retryImage('u1', 'set', { taskId: 'failed', sectionIndex: 1 }),
    service.retryImage('u1', 'set', { taskId: 'failed', sectionIndex: 1 }),
  ]);
  assert.equal(calls.length, 1, 'duplicate clicks submit once');
  assert.deepEqual(results.map(r => r.imageSet.sections[1].taskId), ['retry-1', 'retry-1']);
  assert.equal(messages[0].attachments.sections[0].taskId, 'ok', 'successful sibling preserved');
  assert.equal(calls[0].prompt, '完整售后描述', 'historical task prompt recovered');
  assert.deepEqual(calls[0].referenceImageUrls, ['https://oss.example/product.png']);
  assert.ok(results[0].imageSet.sections[1].startedAt);
  await assert.rejects(service.retryImage('u1', 'set', { taskId: 'retry-1', sectionIndex: 1 }), /无需/);
  const single = await service.retryImage('u1', 'single', { taskId: 'failed-single' });
  assert.equal(single.jobId, 'retry-2');
  assert.equal(calls[1].prompt, tasks[2].prompt, 'full prompt survives the truncated message content');
  assert.deepEqual(calls[1].referenceImageUrls, ['https://oss.example/source.png']);
  assert.ok(single.generationStartedAt);
  const empty = await service.retryImage('u1', 'empty', { taskId: null, sectionIndex: 0 });
  assert.equal(empty.imageSet.sections[0].taskId, 'retry-3');
  assert.equal(empty.imageSet.sections[0].error, undefined);
  assert.equal(calls[2].prompt, '完整参数描述');
  assert.deepEqual(calls[2].referenceImageUrls, ['https://oss.example/anchor.png'], 'detail retry preserves product anchor');
  messages[1].jobId = 'failed-single';
  await service.retryImage('u1', 'single', { taskId: 'failed-single' });
  assert.equal(calls.length, 3, 'recover submitted task after interrupted message persistence');
  tasks.find(t => t.id === 'retry-1').status = 'failed';
  const again = await service.retryImage('u1', 'set', { taskId: 'retry-1', sectionIndex: 1 });
  assert.equal(again.imageSet.sections[1].taskId, 'retry-4');
  assert.notEqual(calls[3].idempotencyKey, calls[0].idempotencyKey);
  // 自然语言补图走同一重试路径，更新原卡片且不调用整套生成。
  prisma.mobileMessage.findMany = async () => [messages[0]];
  prisma.imageTask.findMany = async () => tasks;
  const events: any[] = [];
  const retryText = (text: string) => (service as any).retryFromText({ text, userId: 'u1', conversationId: 'c1' }, (event: string, data: any) => events.push({ event, data }));
  tasks.find(t => t.id === 'retry-4').status = 'failed';
  const beforeNatural = calls.length;
  assert.match(await retryText('生成未能生成成功的这张图'), /已提交 1 张/);
  assert.equal(calls.length, beforeNatural + 1);
  assert.equal(messages[0].attachments.sections[0].taskId, 'ok');
  assert.equal(events.find(e => e.event === 'message').data.message.id, 'set');
  assert.match(await retryText('补上没生成成功的图'), /已完成或正在生成/);
  assert.equal(calls.length, beforeNatural + 1, 'running replacement is never duplicated');
  const current = messages[0].attachments.sections[1].taskId;
  tasks.find(t => t.id === current).status = 'failed';
  assert.match(await retryText('重做第二屏'), /已提交 1 张/);
  assert.match(await retryText('重做第一屏'), /已完成或正在生成/);
  assert.match(await retryText('重做第八屏'), /没有找到/);
  tasks.find(t => t.id === messages[0].attachments.sections[1].taskId).status = 'failed';
  assert.match(await retryText('重新生成售后这张图'), /已提交 1 张/);
  assert.equal(await retryText('重新生成一张猫的图片'), null, 'new image requests still use planner');
  assert.equal(await retryText('重新生成视频'), null);
  // 多个失败项仅替换失败项，成功图继续保留。
  messages[0].attachments.sections.push({ title: '参数', taskId: null, prompt: '参数描述', error: '未提交' });
  tasks.find(t => t.id === messages[0].attachments.sections[1].taskId).status = 'failed';
  const beforeAll = calls.length;
  assert.match(await retryText('补齐没生成成功的图'), /已提交 2 张/);
  assert.equal(calls.length, beforeAll + 2);
  assert.equal(messages[0].attachments.sections[0].taskId, 'ok');
  prisma.mobileConversation.update = async () => ({});
  const turn = { text: '补上没生成成功的图', userId: 'u1', conversationId: 'c1', assistantMessage: messages[1], release: () => {} };
  // xiaot mock has no run method, so this also verifies the planner is bypassed.
  await service.runTurn(turn as any, (event, data) => events.push({ event, data }));
  assert.equal(events.at(-2).data.message.status, 'done');
  assert.match(events.at(-2).data.message.content, /已完成或正在生成/);
  messages[1].jobId = null;
  messages[1].attachments = { prompt: '未提交的单图', aspectRatio: '1:1', error: '提交失败' };
  const unsubmitted = await service.retryImage('u1', 'single', { taskId: null });
  assert.ok(unsubmitted.jobId);
  assert.equal(unsubmitted.submitError, undefined);
  assert.equal(calls.at(-1).prompt, '未提交的单图');
  prisma.mobileMessage.create = async ({ data }: any) => {
    const message = { id: `unsubmitted-${messages.length}`, createdAt: new Date(), jobId: null, ...data };
    messages.push(message);
    return message;
  };
  rejectSubmit = true;
  const submitTurn = { attachments: [{ type: 'image', url: 'https://oss.example/product.png' }] };
  await (service as any).executeImageTool('u1', 'c1', { prompt: '商品详情主图' }, new Set(), submitTurn, 'initial-single', () => {});
  assert.equal(messages.at(-1).kind, 'image');
  assert.equal(messages.at(-1).attachments.prompt, '商品详情主图');
  await (service as any).executeDetailTool('u1', 'c1', { title: '详情页', sections: [{ title: '首屏', prompt: '主图' }, { title: '售后', prompt: '保障' }] }, new Set(), submitTurn, 'initial-set', () => {});
  assert.equal(messages.at(-1).kind, 'image_set');
  assert.ok(messages.at(-1).attachments.sections.every((s: any) => !s.taskId && s.prompt && s.error), 'all rejected sections retain retry parameters');
  console.log('mobile image retry tests passed');
})().catch(error => { console.error(error); process.exit(1); });
