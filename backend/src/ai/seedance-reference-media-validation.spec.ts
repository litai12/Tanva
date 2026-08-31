import assert from 'node:assert/strict';
import { AiController } from './ai.controller';

const run = async (): Promise<void> => {
  const controller = Object.create(AiController.prototype) as AiController;
  const validate = (dto: Record<string, unknown>) =>
    (controller as any).validateSeedance20ReferenceMedia(dto);

  // Tanva must not probe or range-reject Seedance input-media duration here.
  // The controller has no ReferenceVideoDurationService on purpose: if the old
  // local guard returns, this case fails before reaching new-api/Seedance.
  await validate({
    provider: 'doubao',
    seedanceModel: 'seedance-2.0',
    referenceVideos: ['https://cdn.example.com/15.1-seconds.mp4'],
  });

  await validate({
    provider: 'doubao',
    seedanceModel: 'seedance-2.0',
    audioUrls: ['https://cdn.example.com/reference-audio.mp3'],
  });

  await assert.rejects(
    () =>
      validate({
        provider: 'doubao',
        seedanceModel: 'seedance-2.0',
        referenceVideos: [
          'https://cdn.example.com/1.mp4',
          'https://cdn.example.com/2.mp4',
          'https://cdn.example.com/3.mp4',
          'https://cdn.example.com/4.mp4',
        ],
      }),
    /最多支持 3 条参考视频/,
  );
};

run()
  .then(() => console.log('seedance-reference-media-validation.spec: ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
