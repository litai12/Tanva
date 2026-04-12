import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManagedVideoPricingContext,
  mapRawVideoModeToInputType,
} from '../src/ai/services/video-pricing-context';

test('mapRawVideoModeToInputType normalizes supported raw modes', () => {
  assert.equal(mapRawVideoModeToInputType('reference_images'), 'image');
  assert.equal(mapRawVideoModeToInputType('first_clip'), 'video');
  assert.equal(mapRawVideoModeToInputType('image_video_audio'), 'image_video_audio');
  assert.equal(mapRawVideoModeToInputType('text'), 'text');
  assert.equal(mapRawVideoModeToInputType(''), undefined);
});

test('buildManagedVideoPricingContext exposes canonical video pricing fields', () => {
  const context = buildManagedVideoPricingContext({
    resolution: '1080p',
    duration: '10',
    seedanceMode: 'video_audio',
    generateAudio: 'true',
    aspectRatio: '16:9',
  });

  assert.equal(context.resolution, '1080P');
  assert.equal(context.duration, 10);
  assert.equal(context.inputType, 'video_audio');
  assert.equal(context.hasAudio, true);
  assert.equal(context.aspectRatio, '16:9');
});

test('buildManagedVideoPricingContext infers inputType from media payloads', () => {
  const context = buildManagedVideoPricingContext({
    firstFrameUrl: 'https://example.com/frame.png',
    referenceVideoUrl: 'https://example.com/input.mp4',
    audioUrl: 'https://example.com/audio.mp3',
  });

  assert.equal(context.inputType, 'image_video_audio');
});
