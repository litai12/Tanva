import 'reflect-metadata';
import assert from 'node:assert/strict';
import { buildCapabilityManifestSummary, MOBILE_HOST_NAME } from '../agent/xiaot-host-context';
import {
  buildMobileManifest, collectUserUrls, composeUpstreamPrompt, MOBILE_TOOL_FILM, MOBILE_TOOL_REMAKE,
  parseAttachments, titleFrom, toProductionRequest,
} from './mobile-chat.protocol';
import { MobileChatService } from './mobile-chat.service';
import { TextPump, TurnGate, visibleText } from './mobile-chat.stream';
import { XIAOT_DURABLE_CONTINUATION_PLACEHOLDER } from '../agent/xiaot-agent-recovery';

const throwsMsg = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: any) => re.test(String(e?.response?.message ?? e?.message)));

// ---------------------------------------------------------------- manifest
{
  const manifest = buildMobileManifest();
  assert.equal(manifest.host, MOBILE_HOST_NAME);
  assert.ok(manifest.patchOps.length >= 1 && manifest.nodeSpecs.length >= 1, 'TapCanvas schema requires both');
  assert.deepEqual(manifest.hostTools.map(t => t.name), [MOBILE_TOOL_FILM, MOBILE_TOOL_REMAKE]);
  assert.equal((manifest as any).generationMode, undefined, 'default host mode: TapCanvas never generates media itself');
  const summary = buildCapabilityManifestSummary(manifest) as any;
  assert.deepEqual(summary.hostTools.map((t: any) => t.name), [MOBILE_TOOL_FILM, MOBILE_TOOL_REMAKE]);
  assert.deepEqual(summary.notes, manifest.notes, 'mobile keeps its own notes');
  assert.ok(!JSON.stringify(summary.notes).includes('query_canvas'), 'no canvas query guidance on mobile');
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
  assert.deepEqual(film, { mode: 'film', story: '一只猫的冒险', aspectRatio: '9:16', resolution: '720P', videoModel: 'seedance-2.0',
    referenceImageUrls: ['https://oss.example/p.png'], targetSeconds: 30 });
  const filmRatio = toProductionRequest(MOBILE_TOOL_FILM, { story: 's', aspectRatio: '16:9', targetSeconds: 999 }, urls);
  assert.equal(filmRatio.aspectRatio, '16:9'); assert.equal(filmRatio.targetSeconds, undefined, 'out-of-range target dropped');
  throwsMsg(() => toProductionRequest(MOBILE_TOOL_FILM, {}, urls), /故事/);
  throwsMsg(() => toProductionRequest(MOBILE_TOOL_FILM, { story: 's', referenceImageUrls: ['https://evil.example/x.png'] }, urls), /本会话/);

  const remake = toProductionRequest(MOBILE_TOOL_REMAKE, { referenceVideoUrl: 'https://cdn.example/v.mp4', requirements: '换成古风' }, urls);
  assert.deepEqual(remake, { mode: 'remake', referenceVideoUrl: 'https://cdn.example/v.mp4', resolution: '720P', videoModel: 'seedance-2.0', requirements: '换成古风' });
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
  assert.deepEqual(created[0], { userId: 'u1', body: { mode: 'remake', referenceVideoUrl: 'https://oss.example/v.mp4', resolution: '720P', videoModel: 'seedance-2.0' } });
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
