import assert from 'node:assert/strict';
import { VideoProviderService } from '../src/ai/services/video-provider.service';

async function main() {
  const service = Object.assign(Object.create(VideoProviderService.prototype), {
    newApiKey: 'test-gateway-key',
    newApiVodKey: 'test-vod-key',
    newApiTaskPrefix: 'newapi:',
    logger: { log() {}, warn() {}, debug() {} },
  }) as any;
  let calls = 0;
  const conflict = new Error('first/last frame content cannot be mixed with reference media content');
  service.requestNewApiJson = async (path: string) => {
    assert.equal(path, '/v1/videos');
    calls++;
    throw conflict;
  };
  const originalFetch = globalThis.fetch;
  let directCalls = 0;
  globalThis.fetch = async () => { directCalls++; throw new Error('Unexpected direct request'); };
  try {
    await assert.rejects(service.generateVideo({
      provider: 'doubao', seedanceModel: 'seedance-2.0', prompt: 'test',
      duration: 5, resolution: '720P', videoMode: 'text',
    }), (error: unknown) => error === conflict);
    assert.equal(calls, 1);
    assert.equal(directCalls, 0);
    for (const seedanceModel of ['seedance-1.5-pro', 'seedance-2.0', 'seedance-2.5']) {
      service.requestNewApiJson = async (path: string, init: any) => {
        assert.equal(path, '/v1/videos');
        assert.match(JSON.parse(init.body).model, /^doubao-seedance-/);
        return { id: 'gateway-task', status: 'queued' };
      };
      const result = await service.generateVideo({ provider: 'doubao', seedanceModel, prompt: 'test', duration: 5 });
      assert.equal(result.taskId, 'newapi:gateway-task');
    }
    assert.equal(directCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('video gateway submission and fail-closed regression: PASS');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
