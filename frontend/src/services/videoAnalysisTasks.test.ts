import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVideoAnalysisTaskClient,
  hasUnconfirmedVideoAnalysisSubmission,
  VideoAnalysisRequestError,
  videoAnalysisAttemptHistory,
  videoAnalysisResumeTaskId,
  type VideoAnalysisTask,
  type VideoAnalysisTaskNodeData,
  type VideoAnalysisTaskRequest,
} from './videoAnalysisTasks.ts';

const request: VideoAnalysisTaskRequest = {
  clientRequestId: 'attempt-1', nodeId: 'analyzer-1', prompt: 'Describe every shot',
  videoUrl: 'https://media.example/video.mp4', model: 'doubao-seed-2-1-lite-260915',
  bananaImageRoute: 'fast', channelHint: 'apimart', providerOptions: { banana: { imageRoute: 'fast' } },
};
const receipt = (status: VideoAnalysisTask['status'], completed: number): VideoAnalysisTask => ({
  taskId: 'task-1', status, progress: { completed, total: 3 },
  ...(status === 'succeeded' ? { result: { analysis: '| Shot | Action |\n|---|---|\n|1|Run|' } } : {}),
});

test('submits once and polls short GET requests until all clips complete', async () => {
  const calls: { url: string; init: RequestInit & { timeoutMs?: number } }[] = [];
  const responses = [receipt('queued', 0), receipt('processing', 1), receipt('processing', 2), receipt('succeeded', 3)];
  const client = createVideoAnalysisTaskClient(async (url, init) => {
    calls.push({ url, init });
    return Response.json(responses.shift());
  }, 'https://api.example/');
  const accepted = await client.submit(request);
  assert.equal(accepted.taskId, 'task-1');
  const progress: number[] = [];
  const result = await client.observe(accepted.taskId, new AbortController().signal,
    (task) => progress.push(task.progress.completed), async () => {});
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(progress, [1, 2, 3]);
  assert.deepEqual(calls.map(({ init }) => init.method), ['POST', 'GET', 'GET', 'GET']);
  assert.equal(calls[0].url, 'https://api.example/api/ai/video-analysis-tasks');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), request);
  assert.equal(calls[0].init.timeoutMs, 30000);
  assert.ok(calls.slice(1).every(({ init }) => init.timeoutMs === 20000));
});

test('failed polling never resubmits; refresh/reconnect observes the same task', async () => {
  const methods: string[] = [];
  let reconnect = false;
  const client = createVideoAnalysisTaskClient(async (_url, init) => {
    methods.push(init.method!);
    if (!reconnect) throw new Error('connection lost');
    return Response.json(receipt('succeeded', 3));
  }, 'https://api.example');
  await assert.rejects(client.observe('task-1', new AbortController().signal, () => {}), /connection lost/);
  reconnect = true;
  assert.equal((await client.observe('task-1', new AbortController().signal, () => {})).status, 'succeeded');
  assert.deepEqual(methods, ['GET', 'GET']);
});

test('unmount abort stops polling without cancelling or failing the backend task', async () => {
  const controller = new AbortController();
  const methods: string[] = [];
  const client = createVideoAnalysisTaskClient(async (_url, init) => {
    methods.push(init.method!);
    return Response.json(receipt('processing', 1));
  }, 'https://api.example');
  const observing = client.observe('task-1', controller.signal, () => {
    controller.abort(new Error('view unmounted'));
  });
  await assert.rejects(observing, /view unmounted/);
  assert.deepEqual(methods, ['GET']);
});

test('explicit failed retry reuses clips only for identical inputs; completed rerun is independent', () => {
  const previous: VideoAnalysisTaskNodeData = {
    analysisTaskId: 'failed-1', analysisTaskStatus: 'failed',
    analysisTaskRequest: request, analysisTaskProgress: { completed: 2, total: 3 },
    error: 'clip 3 failed',
  };
  assert.equal(videoAnalysisResumeTaskId(previous, request), 'failed-1');
  assert.equal(videoAnalysisResumeTaskId(previous, { ...request, prompt: 'A new prompt' }), undefined);
  assert.equal(videoAnalysisResumeTaskId(previous, { ...request, videoUrl: 'https://media.example/new.mp4' }), undefined);
  assert.equal(videoAnalysisResumeTaskId(previous, { ...request, model: 'gemini-3.1-pro' }), undefined);
  assert.equal(videoAnalysisResumeTaskId({ ...previous, analysisTaskStatus: 'succeeded' }, request), undefined);
  assert.equal(videoAnalysisResumeTaskId({ ...previous, analysisTaskStatus: 'processing' }, request), undefined);
  const history = videoAnalysisAttemptHistory(previous);
  assert.deepEqual(history, [{ taskId: 'failed-1', clientRequestId: 'attempt-1', status: 'failed',
    progress: { completed: 2, total: 3 }, error: 'clip 3 failed' }]);
  assert.deepEqual(videoAnalysisAttemptHistory({ ...previous, analysisTaskHistory: history }), history);
  assert.equal(videoAnalysisAttemptHistory({ ...previous, analysisTaskRequest: { ...request, clientRequestId: 'attempt-2' },
    analysisTaskHistory: history }).length, 2, 'same backend task preserves separate retry attempts');
});

test('lost submit receipt preserves the key for explicit recovery and never auto-retries', async () => {
  const keys: string[] = [];
  const client = createVideoAnalysisTaskClient(async (_url, init) => {
    keys.push(JSON.parse(init.body as string).clientRequestId);
    throw new Error('receipt lost');
  }, 'https://api.example');
  await assert.rejects(client.submit(request), /receipt lost/);
  assert.deepEqual(keys, ['attempt-1']);
  const saved: VideoAnalysisTaskNodeData = { analysisTaskRequest: request, analysisSubmissionState: 'unknown' };
  assert.equal(hasUnconfirmedVideoAnalysisSubmission(saved), true);
  await assert.rejects(client.submit(saved.analysisTaskRequest!), /receipt lost/);
  assert.deepEqual(keys, ['attempt-1', 'attempt-1']);
  assert.equal(hasUnconfirmedVideoAnalysisSubmission({ ...saved, analysisTaskId: 'task-1' }), false);
  assert.equal(hasUnconfirmedVideoAnalysisSubmission({ ...saved, analysisSubmissionState: 'rejected' }), false);
});

test('failed tasks return terminal evidence and mismatched receipts are rejected', async () => {
  const failed = { ...receipt('failed', 2), error: 'clip 3 failed' };
  const client = createVideoAnalysisTaskClient(async () => Response.json(failed), 'https://api.example');
  assert.deepEqual(await client.observe('task-1', new AbortController().signal, () => {}), failed);
  await assert.rejects(client.get('another-task'), /does not match/);
  const rejected = createVideoAnalysisTaskClient(async () => Response.json({ message: ['invalid model'] }, { status: 400 }), '');
  await assert.rejects(rejected.submit(request), (error: unknown) =>
    error instanceof VideoAnalysisRequestError && error.submissionRejected && error.message === 'invalid model');
});
