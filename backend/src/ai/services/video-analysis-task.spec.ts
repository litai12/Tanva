import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { VideoAnalysisTaskService, planVideoAnalysisSegments, mergeVideoAnalysisSegments } from './video-analysis-task.service';
import { ReferenceVideoDurationService } from './reference-video-duration.service';
import { calculateDoubaoSeedVideoAnalysisDurationBilling, DOUBAO_SEED_LITE_VIDEO_ANALYSIS_MODEL } from './doubao-seed-video-analysis-pricing';
import { AiController } from '../ai.controller';
import { transpileModule, ModuleKind } from 'typescript';
import { runInNewContext } from 'node:vm';

const command = promisify(execFile);
async function main() {
  assert.deepEqual(planVideoAnalysisSegments(72.585).map(s => [s.startSec, s.endSec]), [[0, 30], [30, 60], [60, 72.585]]);
  const directory = await fs.mkdtemp(join(tmpdir(), 'tanva-video-analysis-test-'));
  try {
    const source = join(directory, 'source.mp4');
    await command('ffmpeg', ['-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=200', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '72.585', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', source]);
    const media = new ReferenceVideoDurationService();
    const row: any = { id: 'test', userId: 'user', status: 'processing', metadata: { segments: [] } };
    const prisma: any = { videoTask: {
      findUniqueOrThrow: async () => structuredClone(row),
      updateMany: async ({ data }: any) => { Object.assign(row, structuredClone(data)); return { count: 1 }; },
    } };
    const files: string[] = [];
    const oss: any = { putStream: async (_key: string, stream: any) => {
      const path = join(directory, `clip-${files.length}.mp4`);
      await pipeline(stream, createWriteStream(path)); files.push(path);
      return { url: `https://example.test/${files.length}.mp4` };
    } };
    const download = media.downloadToFile.bind(media);
    media.downloadToFile = async (_url, target) => { await fs.copyFile(source, target); };
    const service = new VideoAnalysisTaskService({} as any, prisma, oss, media);
    const duration = await service.prepare('test', 'https://example.test/source.mp4');
    assert.equal(duration, 72.585);
    assert.equal(files.length, 3);
    const actual = await Promise.all(files.map(file => media.probeLocalFile(file)));
    for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - [30, 30, 12.585][i]) < .06, `${actual}`);
    let active = 0, maxActive = 0;
    const calls: number[] = []; let failSecond = true;
    const prompt = '逐镜分析所有微动作，按0.2–0.5秒输出表格，完整保留对白。';
    const provider: any = { analyzeVideo: async (request: any) => {
      assert.ok(request.prompt.startsWith(prompt)); assert.match(request.prompt, /局部时间加/);
      const index = Number(/第 (\d+) 段/.exec(request.prompt)![1]) - 1;
      calls.push(index); active++; maxActive = Math.max(active, maxActive);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      if (index === 1 && failSecond) return { success: false, error: { message: 'temporary failure' } };
      return { success: true, data: { text: `| 序号 | 时间 | 动作 |\n| --- | --- | --- |\n| 1 | ${index * 30} | 实际观察${index} |`, metadata: { raw: { usage: { input_tokens: 10, output_tokens: 5 } } } } };
    } };
    await assert.rejects(service.analyze('test', provider, { prompt }), /已完成片段已保存/);
    assert.equal(row.metadata.segments.filter((s: any) => s.status === 'succeeded').length, 2);
    failSecond = false;
    const result = await service.analyze('test', provider, { prompt });
    assert.deepEqual(calls.sort(), [0, 1, 1, 2]); assert.equal(maxActive, 2);
    assert.equal((result.data!.text.match(/序号/g) || []).length, 1);
    assert.match(result.data!.text, /\| 3 \| 60 \|/);
    assert.equal(row.metadata.stage, 'settling');
    assert.equal(mergeVideoAnalysisSegments(row.metadata.segments), result.data!.text);
    const storyboards = planVideoAnalysisSegments(72.585).map(segment => ({ ...segment, status: 'succeeded' as const,
      text: `【镜头总览】\n总镜数：1\n素材总时长：${segment.endSec - segment.startSec}s\n\n=========单镜头开始=========\n镜号：M001\n时间区间（镜头完整区间）：${segment.startSec}s - ${segment.endSec}s\n景别：近景\n台词文本：本段对白${segment.index}\n---镜头内时序细分（微表情/短时动作拆解）\n时间段：${segment.startSec}s - ${segment.startSec + .3}s\n目标人物：角色${segment.index}\n肢体动作变化：完整细动作${segment.index}\n=========单镜头结束=========` }));
    const merged = mergeVideoAnalysisSegments(storyboards);
    assert.equal((merged.match(/【镜头总览】/g) || []).length, 1);
    assert.ok(merged.includes('完整细动作2'));
    const parserModule = { exports: {} as any };
    const parserSource = await fs.readFile(join(__dirname, '../../../../frontend/src/components/flow/storyboardPromptTable.ts'), 'utf8');
    runInNewContext(transpileModule(parserSource, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText, { exports: parserModule.exports, module: parserModule });
    const parsed = parserModule.exports.parseStoryboardAnalysis(merged);
    assert.equal(parsed.overview['总镜数'], '3');
    assert.equal(parsed.overview['素材总时长'], '72.585s');
    assert.deepEqual(Array.from(parsed.rows, (r: any) => r.values['镜号']), ['M001', 'M002', 'M003']);
    media.downloadToFile = download;

    const charge = calculateDoubaoSeedVideoAnalysisDurationBilling(DOUBAO_SEED_LITE_VIDEO_ANALYSIS_MODEL, duration).creditsCharged;
    const receipts = new Map(); let debits = 0;
    const controller: any = Object.create(AiController.prototype);
    controller.logger = { debug() {}, warn() {} };
    controller.creditsService = { getOrCreateAccount: async () => ({}), getBalance: async () => 10000,
      deductExact: async (_u: any, _t: any, amount: number, meta: any) => {
        debits++; assert.equal(amount, charge);
        const receipt = { id: meta.apiUsageId, userId: 'user', creditsUsed: amount }; receipts.set(receipt.id, receipt);
        return { apiUsageId: receipt.id };
      } };
    controller.prisma = { apiUsageRecord: { findUnique: async ({ where }: any) => receipts.get(where.id) || null } };
    const op = async () => ({ result: { analysis: result.data!.text }, consumedCredits: charge });
    const req = { user: { id: 'user' }, headers: {} };
    await controller.withCreditsFromGateway(req, 'gemini-video-analyze', op, { videoAnalysisTaskId: 'test' }, { balanceGuardCredits: charge });
    await controller.withCreditsFromGateway(req, 'gemini-video-analyze', op, { videoAnalysisTaskId: 'test' }, { balanceGuardCredits: charge });
    assert.equal(debits, 1, 'resume must reuse the whole-video receipt rather than charge each segment/attempt');
    console.log(JSON.stringify({ duration, clipDurations: actual, calls, maxConcurrent: maxActive, productCharges: debits, creditsCharged: charge }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
