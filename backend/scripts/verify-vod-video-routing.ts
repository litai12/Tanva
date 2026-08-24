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
assert.equal(viduDto.offPeak, false);
assert.equal(viduDto.channelTier, 'vip');

const roleAwareDto = service.buildDtoFromUnifiedForTencent({
  model: 'kling-v3',
  metadata: {
    image_with_roles: [
      { url: 'https://example.com/first.png', role: 'first_frame' },
      { url: 'https://example.com/last.png', role: 'last_frame' },
    ],
  },
  provider_options: {},
});
assert.equal(roleAwareDto.videoMode, 'start_end');

const klingOmniElementDto = service.buildDtoFromUnifiedForTencent({
  model: 'kling-v3-omni',
  prompt: '@图1仙侠分镜画面脚本',
  metadata: {
    prompt: '@role1 @图1仙侠分镜画面脚本',
    element_list: [
      {
        name: 'role1',
        element_input_urls: [
          'https://example.com/character.png',
          'https://example.com/character.png',
        ],
      },
    ],
  },
  provider_options: { videoMode: 'text' },
});
assert.equal(klingOmniElementDto.videoMode, 'reference');
assert.deepEqual(klingOmniElementDto.referenceImages, [
  'https://example.com/character.png',
]);
assert.equal(
  klingOmniElementDto.prompt,
  '<<<image_1>>>仙侠分镜画面脚本',
);

const klingOmniVideoReferenceParams = service.buildKlingApimartParams(
  { provider: 'kling-o3', prompt: '保留镜头节奏', duration: 6 },
  'kling-v3-omni',
  [],
  ['https://example.com/three-seconds.mp4'],
  [],
  6,
);
assert.equal(
  klingOmniVideoReferenceParams.metadata.video_list[0].refer_type,
  'feature',
);

const klingOmniVideoEditParams = service.buildKlingApimartParams(
  {
    provider: 'kling-o3',
    prompt: '修改输入视频内容',
    duration: 6,
    referenceVideoType: 'base',
  },
  'kling-v3-omni',
  [],
  ['https://example.com/three-seconds.mp4'],
  [],
  6,
);
assert.equal(klingOmniVideoEditParams.metadata.video_list[0].refer_type, 'base');

const klingOmniTencentVideoReferenceDto = service.buildDtoFromUnifiedForTencent({
  model: 'kling-v3-omni',
  prompt: '参考动作生成新的六秒视频',
  reference_videos: ['https://example.com/three-seconds.mp4'],
  duration: 6,
  provider_options: { videoMode: 'video' },
});
assert.equal(klingOmniTencentVideoReferenceDto.referenceVideoType, 'feature');
assert.equal(klingOmniTencentVideoReferenceDto.duration, 6);

const klingOmniTencentVideoEditDto = service.buildDtoFromUnifiedForTencent({
  model: 'kling-v3-omni',
  prompt: '编辑输入视频',
  reference_videos: ['https://example.com/three-seconds.mp4'],
  duration: 6,
  provider_options: {
    videoMode: 'video',
    referenceVideoType: 'base',
  },
});
assert.equal(klingOmniTencentVideoEditDto.referenceVideoType, 'base');
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

const viduVodRequest = service.buildViduTencentCreateTaskRequest(
  {
    provider: 'viduq3-pro',
    prompt: 'move naturally',
    referenceImages: ['https://example.com/ref.png'],
    duration: 5,
    resolution: '4K',
    videoMode: 'reference2video',
    offPeak: true,
  },
  { modelName: 'Vidu', modelVersion: 'q3' },
  'q3',
);
assert.equal(viduVodRequest.offPeak, 'Disabled');
assert.equal(viduVodRequest.audioGeneration, 'Enabled');
assert.equal(viduVodRequest.fileInfos[0].usage, 'Reference');

service.logger = { warn() {}, log() {}, error() {} };
const klingVodRequests: any[] = [];
service.tencentVodAigcService = {
  createVideoTask: async (request: any) => {
    klingVodRequests.push(request);
    return { taskId: `vod-${klingVodRequests.length}` };
  },
};
await service.generateKlingViaTencent(
  klingOmniTencentVideoReferenceDto,
  { modelName: 'Kling', modelVersion: '3.0-Omni' },
  '3.0-Omni',
  true,
);
assert.equal(klingVodRequests[0].duration, 6);
assert.equal(klingVodRequests[0].fileInfos[0].referenceType, 'feature');

await service.generateKlingViaTencent(
  {
    provider: 'kling',
    klingModel: 'kling-v3-0',
    prompt: 'camera push',
    referenceImages: [
      'https://example.com/first.png',
      'https://example.com/last.png',
    ],
    videoMode: 'frame',
    duration: 5,
    resolution: '1080P',
    sound: 'on',
  },
  { modelName: 'Kling', modelVersion: '3.0' },
  '3.0',
  true,
);
assert.equal(klingVodRequests[1].fileInfos[0].usage, 'FirstFrame');
assert.equal(klingVodRequests[1].lastFrameUrl, 'https://example.com/last.png');
assert.equal(klingVodRequests[1].audioGeneration, 'Enabled');

await service.generateKlingViaTencent(
  {
    provider: 'kling',
    klingModel: 'kling-v2-6',
    referenceImages: [
      'https://example.com/first.png',
      'https://example.com/last.png',
    ],
    videoMode: 'frame',
    duration: 5,
    resolution: '1080P',
    sound: 'on',
  },
  { modelName: 'Kling', modelVersion: '2.6' },
  '2.6',
  true,
);
assert.equal(klingVodRequests[2].audioGeneration, 'Disabled');

await assert.rejects(
  service.generateKlingViaTencent(
    {
      provider: 'kling',
      klingModel: 'kling-v3-0',
      referenceVideo: 'https://example.com/reference.mp4',
      duration: 5,
      resolution: '1080P',
    },
    { modelName: 'Kling', modelVersion: '3.0' },
    '3.0',
    true,
  ),
  /不支持视频参考模式/,
);

await assert.rejects(
  service.generateKlingViaTencent(
    {
      provider: 'kling-o3',
      klingModel: 'kling-o3',
      referenceVideo: 'https://example.com/reference.mp4',
      duration: 5,
      resolution: '4K',
    },
    { modelName: 'Kling', modelVersion: '3.0-Omni' },
    '3.0-Omni',
    true,
  ),
  /不支持 4K/,
);

await service.generateKlingViaTencent(
  klingOmniElementDto,
  { modelName: 'Kling', modelVersion: '3.0-Omni' },
  '3.0-Omni',
  true,
);
const klingOmniElementRequest = klingVodRequests.at(-1);
assert.equal(klingOmniElementRequest.prompt, '<<<image_1>>>仙侠分镜画面脚本');
assert.equal(klingOmniElementRequest.fileInfos.length, 1);
assert.equal(klingOmniElementRequest.fileInfos[0].url, 'https://example.com/character.png');
assert.equal(klingOmniElementRequest.fileInfos[0].usage, 'Reference');

service.prepareRemoteImageUrls = async (urls: string[]) => urls;
service.uploadBase64ImageToOSS = async (url: string) => url;
await service.createViaTencentVod({
  model: 'hailuo-h3',
  prompt: 'first to last frame',
  images: [
    'https://example.com/first.png',
    'https://example.com/last.png',
  ],
  duration: 5,
  resolution: '2K',
  mode: 'start_end',
  provider_options: { generateAudio: true },
});
const hailuoRequest = klingVodRequests.at(-1);
assert.equal(hailuoRequest.fileInfos[0].usage, 'FirstFrame');
assert.equal(hailuoRequest.fileInfos[1].usage, 'LastFrame');
assert.equal(hailuoRequest.audioGeneration, 'Enabled');

await assert.rejects(
  service.createViaTencentVod({
    model: 'hailuo-h3',
    audio_urls: ['https://example.com/voice.mp3'],
    duration: 5,
    resolution: '2K',
    mode: 'reference',
  }),
  /不能单独使用/,
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
