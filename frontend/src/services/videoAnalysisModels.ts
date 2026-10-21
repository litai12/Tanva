export type VideoAnalyzeModel =
  | 'doubao-seed-2-1-pro-260915'
  | 'doubao-seed-2-1-lite-260915'
  | 'doubao-seed-2-1-turbo-260628'
  | 'doubao-seed-2-0-mini-260428'
  | 'doubao-seed-2-0-lite-260428'
  | 'doubao-seed-2-0-pro-260215'
  | 'gemini-2.5-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.1-pro';

export const DEFAULT_VIDEO_ANALYZE_MODEL: VideoAnalyzeModel =
  'doubao-seed-2-1-lite-260915';

type VideoAnalyzeModelOption = {
  value: VideoAnalyzeModel;
  label: string;
  descriptionZh: string;
  descriptionEn: string;
};

export const VIDEO_ANALYZE_MODELS: readonly VideoAnalyzeModelOption[] = [
  {
    value: 'doubao-seed-2-1-lite-260915', label: '豆包 Seed 2.1 Lite',
    descriptionZh: '推荐 · 产品按视频时长计费，积分以运行报价为准',
    descriptionEn: 'Recommended · duration-based product price; see the Run quote',
  },
  {
    value: 'doubao-seed-2-1-pro-260915', label: '豆包 Seed 2.1 Pro',
    descriptionZh: '高精度 · 产品按视频时长计费，积分以运行报价为准',
    descriptionEn: 'High precision · duration-based product price; see the Run quote',
  },
  {
    value: 'doubao-seed-2-1-turbo-260628', label: '豆包 Seed 2.1 Turbo',
    descriptionZh: 'Turbo · 产品按视频时长计费，积分以运行报价为准',
    descriptionEn: 'Turbo · duration-based product price; see the Run quote',
  },
  {
    value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash',
    descriptionZh: 'Gemini 均衡模型', descriptionEn: 'Balanced Gemini model',
  },
  {
    value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro',
    descriptionZh: 'Gemini 高精度模型', descriptionEn: 'High-precision Gemini model',
  },
  {
    value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash',
    descriptionZh: 'Gemini 快速模型', descriptionEn: 'Fast Gemini model',
  },
];

const LEGACY_VIDEO_ANALYZE_MODELS: readonly VideoAnalyzeModelOption[] = [
  {
    value: 'doubao-seed-2-0-lite-260428', label: '豆包 Seed 2.0 Lite（旧版）',
    descriptionZh: '保留此节点的旧版型号与报价，可手动切换为 Seed 2.1',
    descriptionEn: 'Saved legacy model and price; choose Seed 2.1 to upgrade',
  },
  {
    value: 'doubao-seed-2-0-pro-260215', label: '豆包 Seed 2.0 Pro（旧版）',
    descriptionZh: '保留此节点的旧版型号与报价，可手动切换为 Seed 2.1',
    descriptionEn: 'Saved legacy model and price; choose Seed 2.1 to upgrade',
  },
  {
    value: 'doubao-seed-2-0-mini-260428', label: '豆包 Seed 2.0 Mini（旧版）',
    descriptionZh: '保留此节点的旧版型号与报价；Turbo 为独立新型号',
    descriptionEn: 'Saved legacy model and price; Turbo is a separate model',
  },
];

export const getVideoAnalyzeModelOptions = (savedModel?: unknown): readonly VideoAnalyzeModelOption[] => {
  const legacy = LEGACY_VIDEO_ANALYZE_MODELS.find((option) => option.value === savedModel);
  return legacy ? [...VIDEO_ANALYZE_MODELS, legacy] : VIDEO_ANALYZE_MODELS;
};

export const resolveVideoAnalyzeModel = (savedModel?: unknown): VideoAnalyzeModel =>
  getVideoAnalyzeModelOptions(savedModel).find((option) => option.value === savedModel)?.value || DEFAULT_VIDEO_ANALYZE_MODEL;

export const isDurationPricedVideoAnalyzeModel = (model: VideoAnalyzeModel): boolean =>
  model.startsWith('doubao-seed-');
