import type { ManagedPricingBook } from './model-pricing-resolver';

export const GEMINI_OMNI_FLASH_MODEL_ID = 'gemini_omni_flash';
export const GEMINI_OMNI_FLASH_MARKUP = 1.5;

export const GEMINI_OMNI_FLASH_COST_YUAN = {
  '720P': { 4: 1.05, 6: 1.05, 8: 1.26, 10: 1.4 },
  '1080P': { 4: 1.4, 6: 1.4, 8: 1.54, 10: 1.75 },
} as const;

export type GeminiOmniFlashResolution = keyof typeof GEMINI_OMNI_FLASH_COST_YUAN;
export type GeminiOmniFlashDuration = keyof (typeof GEMINI_OMNI_FLASH_COST_YUAN)['720P'];

export const getGeminiOmniFlashRetailPriceYuan = (
  resolution: GeminiOmniFlashResolution,
  duration: GeminiOmniFlashDuration,
): number =>
  Number(
    (GEMINI_OMNI_FLASH_COST_YUAN[resolution][duration] * GEMINI_OMNI_FLASH_MARKUP).toFixed(4),
  );

export const createGeminiOmniFlashPricingTemplate = (): ManagedPricingBook => ({
  version: 'v2',
  dimensions: [
    {
      key: 'resolution',
      label: '分辨率',
      type: 'enum',
      required: true,
      options: [
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' },
      ],
    },
    {
      key: 'durationSec',
      label: '时长（秒）',
      type: 'enum',
      required: true,
      options: [4, 6, 8, 10].map((value) => ({ value, label: `${value} 秒` })),
    },
  ],
  defaults: {
    priceYuan: getGeminiOmniFlashRetailPriceYuan('720P', 6),
    credits: 158,
  },
  matchingRules: [
    {
      ruleKey: 'gemini_omni_flash_matrix_rule',
      label: 'Gemini Omni Flash 分辨率/时长价格矩阵',
      enabled: true,
      priority: 100,
      evaluatorKey: 'gemini_omni_flash_matrix',
      conditions: {
        all: [
          { field: 'resolution', op: 'in', value: ['720P', '1080P'] },
          { field: 'durationSec', op: 'in', value: [4, 6, 8, 10] },
        ],
        any: [],
      },
    },
  ],
  evaluators: {
    gemini_omni_flash_matrix: {
      type: 'lookup_matrix',
      axes: ['resolution', 'durationSec'],
      matrix: {
        '720P': {
          '4': getGeminiOmniFlashRetailPriceYuan('720P', 4),
          '6': getGeminiOmniFlashRetailPriceYuan('720P', 6),
          '8': getGeminiOmniFlashRetailPriceYuan('720P', 8),
          '10': getGeminiOmniFlashRetailPriceYuan('720P', 10),
        },
        '1080P': {
          '4': getGeminiOmniFlashRetailPriceYuan('1080P', 4),
          '6': getGeminiOmniFlashRetailPriceYuan('1080P', 6),
          '8': getGeminiOmniFlashRetailPriceYuan('1080P', 8),
          '10': getGeminiOmniFlashRetailPriceYuan('1080P', 10),
        },
      },
    },
  },
  displayConfig: {
    specAxes: ['resolution', 'durationSec'],
    labels: {
      'resolution.720P': '720P',
      'resolution.1080P': '1080P',
      'durationSec.4': '4 秒',
      'durationSec.6': '6 秒',
      'durationSec.8': '8 秒',
      'durationSec.10': '10 秒',
    },
    defaultSelections: {
      resolution: '720P',
      durationSec: 6,
    },
    presets: [
      { resolution: '720P', durationSec: 4 },
      { resolution: '720P', durationSec: 6 },
      { resolution: '720P', durationSec: 8 },
      { resolution: '720P', durationSec: 10 },
      { resolution: '1080P', durationSec: 4 },
      { resolution: '1080P', durationSec: 6 },
      { resolution: '1080P', durationSec: 8 },
      { resolution: '1080P', durationSec: 10 },
    ],
    costYuan: GEMINI_OMNI_FLASH_COST_YUAN,
    markup: GEMINI_OMNI_FLASH_MARKUP,
  },
});
