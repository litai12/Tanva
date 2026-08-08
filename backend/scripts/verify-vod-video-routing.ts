import assert from 'node:assert/strict';
import { VideoProviderService } from '../src/ai/services/video-provider.service';

async function main(): Promise<void> {
const service = Object.create(VideoProviderService.prototype) as any;

assert.equal(
  service.resolveNewApiVideoModel({
    provider: 'kling-o3',
    managedModelKey: 'kling-3.0',
    klingModel: 'kling-v3-0',
  }),
  'kling-v3',
);
assert.equal(
  service.resolveNewApiVideoModel({
    provider: 'kling-o3',
    managedModelKey: 'kling-o3',
    klingModel: 'kling-o3',
  }),
  'kling-v3-omni',
);

const viduDto = service.buildDtoFromUnifiedForTencent({
  model: 'vidu-q3',
  prompt: 'reference motion',
  images: ['https://example.com/ref.png'],
  provider_options: {
    viduModelVariant: 'q3-mix',
    videoMode: 'reference',
    offPeak: true,
  },
});
assert.equal(viduDto.viduModelVariant, 'q3-mix');
assert.equal(viduDto.viduModel, 'q3-mix');
assert.equal(viduDto.videoMode, 'reference');
assert.equal(viduDto.offPeak, true);
assert.equal(viduDto.channelTier, 'vip');
assert.equal(
  service.resolveManagedViduModel({ viduModel: 'q3', videoMode: 'reference2video' })
    .modelVersion,
  'q3',
);
assert.equal(
  service.resolveManagedViduModel({ viduModelVariant: 'q3-mix', videoMode: 'reference2video' })
    .modelVersion,
  'q3-mix',
);

const forceVod: boolean[] = [];
service.createNewApiVideoTask = async (_options: unknown, forced: boolean) => {
  forceVod.push(forced);
  return { taskId: 'test', status: 'queued' };
};
await service.generateVideoAttempt({ provider: 'vidu', viduModel: 'q2' });
await service.generateVideoAttempt({ provider: 'hailuo', hailuoModel: 'h3' });
await service.generateVideoAttempt({ provider: 'kling', klingModel: 'kling-v2-6' });
await service.generateVideoAttempt({
  provider: 'doubao',
  seedanceModel: 'seedance-2.0',
});
assert.deepEqual(forceVod, [true, true, true, false]);

console.log('VOD video routing verification passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
