import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveManagedVendorPricing } from '../src/ai/services/model-pricing-resolver';

test('resolveManagedVendorPricing prefers exact fixed rule over formula/defaults', () => {
  const resolved = resolveManagedVendorPricing(
    {
      vendorKey: 'kapon',
      pricing: {
        defaults: {
          credits: 600,
          priceYuan: 6,
        },
        formula: {
          base: {
            credits: 0,
          },
          adjustments: [
            {
              label: 'base per second',
              unitPrice: { credits: 80 },
              multiplier: { field: 'duration' },
            },
          ],
        },
        rules: [
          {
            ruleKey: 'video-audio-4k-10s',
            label: '4k 10s with video input and audio',
            when: {
              inputType: 'video_audio',
              resolution: '4K',
              duration: 10,
              hasAudio: true,
            },
            price: {
              credits: 1280,
              priceYuan: 12.8,
            },
          },
        ],
      },
    },
    {
      inputType: 'video_audio',
      resolution: '4K',
      duration: 10,
      hasAudio: true,
    },
  );

  assert.equal(resolved.source, 'vendor_rule');
  assert.equal(resolved.ruleKey, 'video-audio-4k-10s');
  assert.equal(resolved.price.credits, 1280);
  assert.equal(resolved.price.priceYuan, 12.8);
});

test('resolveManagedVendorPricing computes additive formula breakdown', () => {
  const resolved = resolveManagedVendorPricing(
    {
      vendorKey: 'kapon',
      pricing: {
        formula: {
          base: {
            credits: 0,
          },
          adjustments: [
            {
              key: 'base_per_second',
              label: 'base',
              unitPrice: { credits: 80 },
              multiplier: { field: 'duration' },
            },
            {
              key: 'audio_per_second',
              label: 'audio',
              when: { hasAudio: true },
              unitPrice: { credits: 10 },
              multiplier: { field: 'duration' },
            },
            {
              key: 'video_input_per_second',
              label: 'video input',
              when: { inputType: 'video_audio' },
              unitPrice: { credits: 15 },
              multiplier: { field: 'duration' },
            },
          ],
        },
      },
    },
    {
      inputType: 'video_audio',
      duration: 10,
      hasAudio: true,
    },
  );

  assert.equal(resolved.source, 'vendor_formula');
  assert.equal(resolved.price.credits, 1050);
  assert.deepEqual(resolved.breakdown, [
    {
      type: 'base',
      label: 'base',
      price: { credits: 0 },
    },
    {
      type: 'adjustment',
      key: 'base_per_second',
      label: 'base',
      multiplier: 10,
      price: { credits: 800 },
    },
    {
      type: 'adjustment',
      key: 'audio_per_second',
      label: 'audio',
      multiplier: 10,
      price: { credits: 100 },
    },
    {
      type: 'adjustment',
      key: 'video_input_per_second',
      label: 'video input',
      multiplier: 10,
      price: { credits: 150 },
    },
  ]);
});

test('resolveManagedVendorPricing treats unmatched video pricing as unavailable when defaultAvailable is false', () => {
  const resolved = resolveManagedVendorPricing(
    {
      vendorKey: 'q2-pro',
      creditsPerCall: 999,
      pricing: {
        defaultAvailable: false,
        unavailableReason: '当前规格未开放，请先补充价格规则',
        defaults: {
          credits: 999,
          priceYuan: 9.99,
        },
        rules: [
          {
            ruleKey: 'video-audio-4k-10s',
            when: {
              inputType: 'video_audio',
              resolution: '4K',
              duration: 10,
              hasAudio: true,
            },
            price: {
              credits: 1280,
            },
          },
        ],
      },
    },
    {
      inputType: 'text',
      resolution: '720P',
      duration: 5,
      hasAudio: false,
    },
  );

  assert.equal(resolved.source, 'none');
  assert.equal(resolved.defaultAvailable, false);
  assert.equal(resolved.unavailableReason, '当前规格未开放，请先补充价格规则');
  assert.deepEqual(resolved.price, {});
});

test('resolveManagedVendorPricing still resolves matching formula when defaultAvailable is false', () => {
  const resolved = resolveManagedVendorPricing(
    {
      vendorKey: 'seedance',
      pricing: {
        defaultAvailable: false,
        formula: {
          adjustments: [
            {
              key: 'base',
              label: 'base',
              unitPrice: { credits: 100 },
              multiplier: { field: 'duration' },
            },
            {
              key: 'audio',
              label: 'audio',
              when: { hasAudio: true },
              unitPrice: { credits: 20 },
              multiplier: { field: 'duration' },
            },
          ],
        },
      },
    },
    {
      duration: 10,
      hasAudio: true,
    },
  );

  assert.equal(resolved.source, 'vendor_formula');
  assert.equal(resolved.defaultAvailable, false);
  assert.equal(resolved.price.credits, 1200);
});

test('resolveManagedVendorPricing supports Seedance 2.0 per-second formula pricing', () => {
  const resolved = resolveManagedVendorPricing(
    {
      vendorKey: 'seedance_api',
      pricing: {
        defaultAvailable: false,
        unavailableReason: '当前 Seedance 2.0 仅开放文生 / 图片输入 / 图片+音频的按秒计价规格；其他输入组合暂未配置。',
        formula: {
          adjustments: [
            {
              key: 'seedance20_480p',
              label: 'Seedance 2.0 480P',
              when: {
                seedanceModel: 'seedance-2.0',
                inputType: ['text', 'image', 'image_audio'],
                resolution: '480P',
              },
              unitPrice: {
                credits: 46.2,
                priceYuan: 0.462,
              },
              multiplier: { field: 'duration' },
            },
          ],
        },
      },
    },
    {
      seedanceModel: 'seedance-2.0',
      inputType: 'text',
      resolution: '480P',
      duration: 9,
      hasAudio: false,
    },
  );

  assert.equal(resolved.source, 'vendor_formula');
  assert.equal(resolved.price.credits, 415.8);
  assert.equal(resolved.price.priceYuan, 4.158);
});
