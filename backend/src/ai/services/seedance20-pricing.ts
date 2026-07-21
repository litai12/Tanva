import type { ManagedPricingBook } from './model-pricing-resolver';

export const SEEDANCE20_DISCOUNT_CREDITS = 750;
export const SEEDANCE20_DISCOUNT_PRICE_YUAN = 7.5;

// Canvas retail pricing previously reflected cost x1.2. Raising it to x1.5
// means scaling every existing per-second price by 1.5 / 1.2 = 1.25.
export const SEEDANCE20_PRICE_SCALE = 1.5 / 1.2;

export const calculateSeedance20BillingDuration = (
  outputDurationSec: number,
  inputVideoDurationsSec: readonly number[],
): { outputDurationSec: number; inputVideoDurationSec: number; billingDurationSec: number } => {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec <= 0) {
    throw new RangeError('Seedance 2.0 output duration must be a positive number');
  }
  if (
    inputVideoDurationsSec.some(
      (duration) => !Number.isFinite(duration) || duration <= 0,
    )
  ) {
    throw new RangeError('Seedance 2.0 reference video durations must be positive numbers');
  }

  const normalizedOutputDurationSec = Number(outputDurationSec.toFixed(3));
  const inputVideoDurationSec = Number(
    inputVideoDurationsSec.reduce((total, duration) => total + duration, 0).toFixed(3),
  );
  return {
    outputDurationSec: normalizedOutputDurationSec,
    inputVideoDurationSec,
    billingDurationSec: Number(
      (normalizedOutputDurationSec + inputVideoDurationSec).toFixed(3),
    ),
  };
};

/**
 * 限时免费活动开关。设置环境变量 SEEDANCE20_FREE=1/true/on/yes 时，
 * Seedance 2.0 / Fast / Mini 全分辨率一律按 0 积分计价（预览与实扣同源）。
 * 关闭/未设置时恢复进价 x1.5 定价。逐请求读取，可随进程内 env 实时生效、可逆。
 */
export const isSeedance20FreeEnabled = (): boolean => {
  const raw = String(process.env.SEEDANCE20_FREE ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
};

export const seedance20EffectiveCredits = (): number =>
  isSeedance20FreeEnabled() ? 0 : SEEDANCE20_DISCOUNT_CREDITS;

export const seedance20EffectivePriceYuan = (): number =>
  isSeedance20FreeEnabled() ? 0 : SEEDANCE20_DISCOUNT_PRICE_YUAN;

const applySeedance20Discount = (unitPriceYuan: number): number =>
  isSeedance20FreeEnabled()
    ? 0
    : Number((unitPriceYuan * SEEDANCE20_PRICE_SCALE).toFixed(4));

export const createSeedance20DiscountPricingTemplate = (): ManagedPricingBook => ({
  version: 'v2',
  dimensions: [
    {
      key: 'seedanceModel',
      label: 'Seedance 型号',
      type: 'enum',
      required: true,
      options: [
        { value: 'seedance-2.0', label: 'Seedance 2.0' },
        { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast' },
        { value: 'seed-2.0-mini', label: 'Seedance 2.0 Mini' },
      ],
    },
    {
      key: 'resolution',
      label: '分辨率',
      type: 'enum',
      required: true,
      options: [
        { value: '480P', label: '480P' },
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' },
        { value: '4K', label: '4K' },
      ],
    },
    {
      key: 'duration',
      label: '时长(秒)',
      type: 'number',
      required: true,
    },
  ],
  matchingRules: [
    {
      ruleKey: 'seedance20_fast_480p',
      label: 'Seedance 2.0 Fast 480P',
      enabled: true,
      priority: 120,
      evaluatorKey: 'seedance20_fast_480p_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seedance-2.0-fast' },
          { field: 'resolution', op: 'eq', value: '480P' },
        ],
      },
    },
    {
      ruleKey: 'seedance20_fast_720p',
      label: 'Seedance 2.0 Fast 720P',
      enabled: true,
      priority: 120,
      evaluatorKey: 'seedance20_fast_720p_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seedance-2.0-fast' },
          { field: 'resolution', op: 'eq', value: '720P' },
        ],
      },
    },
    {
      ruleKey: 'seedance20_mini_480p',
      label: 'Seedance 2.0 Mini 480P',
      enabled: true,
      priority: 120,
      evaluatorKey: 'seedance20_fast_480p_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seed-2.0-mini' },
          { field: 'resolution', op: 'eq', value: '480P' },
        ],
      },
    },
    {
      ruleKey: 'seedance20_mini_720p',
      label: 'Seedance 2.0 Mini 720P',
      enabled: true,
      priority: 120,
      evaluatorKey: 'seedance20_fast_720p_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seed-2.0-mini' },
          { field: 'resolution', op: 'eq', value: '720P' },
        ],
      },
    },
    {
      ruleKey: 'seedance20_480p',
      label: 'Seedance 2.0 480P',
      enabled: true,
      priority: 110,
      evaluatorKey: 'seedance20_480p_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seedance-2.0' },
          { field: 'resolution', op: 'eq', value: '480P' },
        ],
      },
    },
    {
      ruleKey: 'seedance20_720p',
      label: 'Seedance 2.0 720P',
      enabled: true,
      priority: 110,
      evaluatorKey: 'seedance20_720p_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seedance-2.0' },
          { field: 'resolution', op: 'eq', value: '720P' },
        ],
      },
    },
    {
      ruleKey: 'seedance20_1080p',
      label: 'Seedance 2.0 1080P',
      enabled: true,
      priority: 110,
      evaluatorKey: 'seedance20_1080p_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seedance-2.0' },
          { field: 'resolution', op: 'eq', value: '1080P' },
        ],
      },
    },
    {
      ruleKey: 'seedance20_4k',
      label: 'Seedance 2.0 4K',
      enabled: true,
      priority: 110,
      evaluatorKey: 'seedance20_4k_eval',
      conditions: {
        all: [
          { field: 'seedanceModel', op: 'eq', value: 'seedance-2.0' },
          { field: 'resolution', op: 'eq', value: '4K' },
        ],
      },
    },
  ],
  evaluators: {
    seedance20_fast_480p_eval: {
      type: 'linear',
      unitField: 'duration',
      unitPriceYuan: applySeedance20Discount(0.806),
    },
    seedance20_fast_720p_eval: {
      type: 'linear',
      unitField: 'duration',
      unitPriceYuan: applySeedance20Discount(0.966),
    },
    seedance20_480p_eval: {
      type: 'linear',
      unitField: 'duration',
      unitPriceYuan: applySeedance20Discount(1.0),
    },
    seedance20_720p_eval: {
      type: 'linear',
      unitField: 'duration',
      unitPriceYuan: applySeedance20Discount(1.2),
    },
    seedance20_1080p_eval: {
      type: 'linear',
      unitField: 'duration',
      unitPriceYuan: applySeedance20Discount(3.0),
    },
    seedance20_4k_eval: {
      type: 'linear',
      unitField: 'duration',
      unitPriceYuan: applySeedance20Discount(6.0),
    },
  },
  displayConfig: {
    specAxes: ['seedanceModel', 'resolution', 'duration'],
    labels: {
      'seedanceModel.seedance-2.0': 'Seedance 2.0',
      'seedanceModel.seedance-2.0-fast': 'Seedance 2.0 Fast',
      'seedanceModel.seed-2.0-mini': 'Seedance 2.0 Mini',
      'resolution.480P': '480P',
      'resolution.720P': '720P',
      'resolution.1080P': '1080P',
      'resolution.4K': '4K',
    },
    defaultSelections: {
      seedanceModel: 'seedance-2.0',
      resolution: '720P',
      duration: 5,
    },
    presets: [
      { seedanceModel: 'seedance-2.0', resolution: '720P', duration: 5 },
      { seedanceModel: 'seedance-2.0', resolution: '720P', duration: 10 },
      { seedanceModel: 'seedance-2.0', resolution: '1080P', duration: 5 },
      { seedanceModel: 'seedance-2.0', resolution: '4K', duration: 5 },
      { seedanceModel: 'seedance-2.0-fast', resolution: '480P', duration: 5 },
      { seedanceModel: 'seedance-2.0-fast', resolution: '720P', duration: 5 },
      { seedanceModel: 'seed-2.0-mini', resolution: '480P', duration: 5 },
      { seedanceModel: 'seed-2.0-mini', resolution: '720P', duration: 5 },
    ],
  },
});

export const applySeedance20DiscountVendorPricing = <T>(
  vendor: T,
): T => {
  const current = vendor && typeof vendor === 'object' ? (vendor as Record<string, any>) : {};
  return {
    ...current,
    vendorKey: current.vendorKey || 'seedance_api',
    platformKey: current.platformKey || 'seedance_api',
    label: current.label || 'Seedance API',
    enabled: current.enabled !== false,
    route: current.route || 'legacy',
    provider: current.provider || 'doubao',
    modelName: current.modelName || 'Seedance',
    modelVersion: '2.0',
    creditsPerCall: seedance20EffectiveCredits(),
    priceYuan: seedance20EffectivePriceYuan(),
    pricing: createSeedance20DiscountPricingTemplate(),
  } as T;
};

export const normalizeSeedance20DiscountPricing = <T>(
  mapping: T,
): T => {
  const root = mapping && typeof mapping === 'object' ? (mapping as Record<string, any>) : null;
  if (!root || !Array.isArray(root.models)) {
    return mapping;
  }

  return {
    ...root,
    models: root.models.map((model: Record<string, any>) => {
      const modelKey = String(model?.modelKey || '').trim().toLowerCase();
      if (modelKey !== 'seedance-2.0') return model;

      const currentVendors = Array.isArray(model.vendors) ? model.vendors : [];
      const hasSeedanceVendor = currentVendors.some(
        (vendor) =>
          String(vendor?.vendorKey || '').trim().toLowerCase() === 'seedance_api',
      );
      const vendors = (hasSeedanceVendor
        ? currentVendors
        : [
            ...currentVendors,
            {
              vendorKey: 'seedance_api',
              platformKey: 'seedance_api',
              label: 'Seedance API',
              enabled: true,
              route: 'legacy',
              provider: 'doubao',
              modelName: 'Seedance',
              modelVersion: '2.0',
            },
          ]
      ).map((vendor) =>
        String(vendor?.vendorKey || '').trim().toLowerCase() === 'seedance_api'
          ? applySeedance20DiscountVendorPricing(vendor)
          : vendor,
      );

      return {
        ...model,
        defaultVendor: 'seedance_api',
        vendors,
      };
    }),
  } as T;
};
