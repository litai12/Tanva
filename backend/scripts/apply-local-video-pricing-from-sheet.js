const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const SETTING_KEY = "model_provider_mapping_v2";

const toCredits = (priceYuan) => Number((Number(priceYuan) * 100).toFixed(1));

const durationRules = ({ when = {}, resolution, prices, extra = {} }) =>
  prices.map((priceYuan, index) => ({
    ruleKey: `${Object.values({ ...when, ...extra, resolution, duration: index + 1 })
      .map((item) => String(item))
      .join("_")
      .replace(/[^a-zA-Z0-9_]+/g, "_")
      .toLowerCase()}`,
    label: `${resolution} / ${index + 1}s`,
    when: {
      ...when,
      ...extra,
      resolution,
      duration: index + 1,
    },
    price: {
      credits: toCredits(priceYuan),
      priceYuan,
    },
  }));

const formulaAdjustment = (when, unitPriceYuan, label) => ({
  key: label.replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase(),
  label,
  when,
  unitPrice: {
    credits: toCredits(unitPriceYuan),
    priceYuan: unitPriceYuan,
  },
  multiplier: {
    field: "duration",
  },
});

const makeRulesPricing = (rules, unavailableReason) => ({
  version: "v1",
  defaultAvailable: false,
  unavailableReason,
  rules,
});

const makeFormulaPricing = (adjustments, unavailableReason) => ({
  version: "v1",
  defaultAvailable: false,
  unavailableReason,
  formula: {
    mode: "additive",
    adjustments,
  },
});

const VIDU_Q2_API_RULES = [
  ...durationRules({
    when: { viduModel: "q2-turbo", inputType: "image" },
    resolution: "720P",
    prices: [0.25, 0.313, 0.625, 0.938, 1.25, 1.563, 1.875, 2.188, 2.5, 2.813],
  }),
  ...durationRules({
    when: { viduModel: "q2-turbo", inputType: "image" },
    resolution: "1080P",
    prices: [1.094, 1.406, 1.719, 2.031, 2.344, 2.656, 2.969, 3.281, 3.594, 3.906],
  }),
  ...durationRules({
    when: { viduModel: "q2-pro", inputType: "image" },
    resolution: "720P",
    prices: [0.469, 0.781, 1.094, 1.406, 1.719, 2.031, 2.344, 2.656, 2.969, 3.281],
  }),
  ...durationRules({
    when: { viduModel: "q2-pro", inputType: "image" },
    resolution: "1080P",
    prices: [1.719, 2.188, 2.656, 3.125, 3.594, 4.063, 4.531, 5, 5.469, 5.938],
  }),
  ...durationRules({
    when: { viduModel: "q2", inputType: "text" },
    resolution: "720P",
    prices: [0.469, 0.625, 0.781, 0.938, 1.094, 1.25, 1.406, 1.563],
  }),
  ...durationRules({
    when: { viduModel: "q2", inputType: "text" },
    resolution: "1080P",
    prices: [0.625, 0.938, 1.25, 1.563, 1.875, 2.188, 2.5, 2.813],
  }),
  ...durationRules({
    when: { viduModel: "q2", inputType: "video" },
    resolution: "720P",
    prices: [0.781, 0.938, 1.094, 1.25, 1.406, 1.563, 1.719, 1.875, 2.031, 2.188],
  }),
  ...durationRules({
    when: { viduModel: "q2", inputType: "video" },
    resolution: "1080P",
    prices: [2.344, 2.656, 2.969, 3.281, 3.594, 3.906, 4.219, 4.531, 4.844, 5.156],
  }),
  ...durationRules({
    when: { viduModel: "q2-pro", inputType: "video" },
    resolution: "540P",
    prices: [0.625, 0.781, 0.938, 1.094, 1.25, 1.406, 1.563, 1.719, 1.875, 2.031],
  }),
  ...durationRules({
    when: { viduModel: "q2-pro", inputType: "video" },
    resolution: "720P",
    prices: [0.938, 1.094, 1.25, 1.406, 1.563, 1.719, 1.875, 2.031, 2.188, 2.344],
  }),
  ...durationRules({
    when: { viduModel: "q2-pro", inputType: "video" },
    resolution: "1080P",
    prices: [2.344, 2.5, 2.656, 2.813, 2.969, 3.125, 3.281, 3.438, 3.594, 3.75],
  }),
];

const VIDU_Q3_API_RULES = [
  ...durationRules({
    when: { viduModel: "q3", inputType: "video" },
    resolution: "720P",
    prices: [0.938, 1.875, 2.813, 3.75, 4.688, 5.625, 6.563, 7.5, 8.438, 9.375, 10.313, 11.25, 12.188, 13.125, 14.063, 15],
  }),
  ...durationRules({
    when: { viduModel: "q3", inputType: "video" },
    resolution: "1080P",
    prices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  }),
  ...durationRules({
    when: { viduModel: "q3-pro", inputType: ["text", "image"] },
    resolution: "540P",
    prices: [0.438, 0.875, 1.313, 1.75, 2.188, 2.625, 3.063, 3.5, 3.938, 4.375, 4.813, 5.25, 5.688, 6.125, 6.563, 7],
  }),
  ...durationRules({
    when: { viduModel: "q3-pro", inputType: ["text", "image"] },
    resolution: "720P",
    prices: [0.938, 1.875, 2.813, 3.75, 4.688, 5.625, 6.563, 7.5, 8.438, 9.375, 10.313, 11.25, 12.188, 13.125, 14.063, 15],
  }),
  ...durationRules({
    when: { viduModel: "q3-pro", inputType: ["text", "image"] },
    resolution: "1080P",
    prices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  }),
  ...durationRules({
    when: { viduModel: "q3-turbo", inputType: ["text", "image"] },
    resolution: "540P",
    prices: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4],
  }),
  ...durationRules({
    when: { viduModel: "q3-turbo", inputType: ["text", "image"] },
    resolution: "720P",
    prices: [0.375, 0.75, 1.125, 1.5, 1.875, 2.25, 2.625, 3, 3.375, 3.75, 4.125, 4.5, 4.875, 5.25, 5.625, 6],
  }),
  ...durationRules({
    when: { viduModel: "q3-turbo", inputType: ["text", "image"] },
    resolution: "1080P",
    prices: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8],
  }),
];

const VIDU_Q2_TENCENT_FORMULA = [
  formulaAdjustment({ viduModel: "q2", inputType: "text", resolution: "720P" }, 0.32, "Q2 文生 720P"),
  formulaAdjustment({ viduModel: "q2", inputType: "text", resolution: "1080P" }, 0.47, "Q2 文生 1080P"),
  formulaAdjustment({ viduModel: "q2", inputType: "text", resolution: "2K" }, 0.7, "Q2 文生 2K"),
  formulaAdjustment({ viduModel: "q2", inputType: "text", resolution: "4K" }, 1.05, "Q2 文生 4K"),
  formulaAdjustment({ viduModel: "q2", inputType: "video", resolution: "540P" }, 0.24, "Q2 参考生 540P"),
  formulaAdjustment({ viduModel: "q2", inputType: "video", resolution: "720P" }, 0.32, "Q2 参考生 720P"),
  formulaAdjustment({ viduModel: "q2", inputType: "video", resolution: "1080P" }, 0.82, "Q2 参考生 1080P"),
  formulaAdjustment({ viduModel: "q2", inputType: "video", resolution: "2K" }, 1.23, "Q2 参考生 2K"),
  formulaAdjustment({ viduModel: "q2", inputType: "video", resolution: "4K" }, 1.845, "Q2 参考生 4K"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "image", resolution: "720P" }, 0.35, "Q2 Pro 图生 720P"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "image", resolution: "1080P" }, 0.7, "Q2 Pro 图生 1080P"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "image", resolution: "2K" }, 1, "Q2 Pro 图生 2K"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "image", resolution: "4K" }, 1.5, "Q2 Pro 图生 4K"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "video", resolution: "540P" }, 0.27, "Q2 Pro 参考生 540P"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "video", resolution: "720P" }, 0.35, "Q2 Pro 参考生 720P"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "video", resolution: "1080P" }, 0.9, "Q2 Pro 参考生 1080P"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "video", resolution: "2K" }, 1.35, "Q2 Pro 参考生 2K"),
  formulaAdjustment({ viduModel: "q2-pro", inputType: "video", resolution: "4K" }, 2.025, "Q2 Pro 参考生 4K"),
];

const VIDU_Q3_TENCENT_FORMULA = [
  formulaAdjustment({ viduModel: "q3", inputType: "video", resolution: "540P" }, 0.313, "Q3 参考生 540P"),
  formulaAdjustment({ viduModel: "q3", inputType: "video", resolution: "720P" }, 0.625, "Q3 参考生 720P"),
  formulaAdjustment({ viduModel: "q3", inputType: "video", resolution: "1080P" }, 0.782, "Q3 参考生 1080P"),
  formulaAdjustment({ viduModel: "q3", inputType: "video", resolution: "2K" }, 0.939, "Q3 参考生 2K"),
  formulaAdjustment({ viduModel: "q3", inputType: "video", resolution: "4K" }, 1.127, "Q3 参考生 4K"),
  formulaAdjustment({ viduModel: "q3-pro", inputType: ["text", "image"], resolution: "540P" }, 0.313, "Q3 Pro 图生文生 540P"),
  formulaAdjustment({ viduModel: "q3-pro", inputType: ["text", "image"], resolution: "720P" }, 0.782, "Q3 Pro 图生文生 720P"),
  formulaAdjustment({ viduModel: "q3-pro", inputType: ["text", "image"], resolution: "1080P" }, 0.938, "Q3 Pro 图生文生 1080P"),
  formulaAdjustment({ viduModel: "q3-pro", inputType: ["text", "image"], resolution: "2K" }, 1.126, "Q3 Pro 图生文生 2K"),
  formulaAdjustment({ viduModel: "q3-pro", inputType: ["text", "image"], resolution: "4K" }, 1.351, "Q3 Pro 图生文生 4K"),
];

const KLING_26_API_RULES = [
  { hasAudio: false, mode: "std", duration: 5, priceYuan: 1.5 },
  { hasAudio: false, mode: "std", duration: 10, priceYuan: 3 },
  { hasAudio: false, mode: "pro", duration: 5, priceYuan: 3 },
  { hasAudio: false, mode: "pro", duration: 10, priceYuan: 5 },
  { hasAudio: true, mode: "std", duration: 5, priceYuan: 5 },
  { hasAudio: true, mode: "std", duration: 10, priceYuan: 10 },
  { hasAudio: true, mode: "pro", duration: 5, priceYuan: 6 },
  { hasAudio: true, mode: "pro", duration: 10, priceYuan: 12 },
].map((item) => ({
  ruleKey: `kling26_${item.hasAudio ? "audio" : "silent"}_${item.mode}_${item.duration}`,
  label: `Kling 2.6 ${item.duration}s`,
  when: {
    hasAudio: item.hasAudio,
    mode: item.mode,
    duration: item.duration,
  },
  price: {
    credits: toCredits(item.priceYuan),
    priceYuan: item.priceYuan,
  },
}));

const KLING_30_API_RULES = [
  { hasAudio: false, mode: "std", duration: 5, priceYuan: 3 },
  { hasAudio: false, mode: "std", duration: 10, priceYuan: 6 },
  { hasAudio: false, mode: "pro", duration: 5, priceYuan: 4 },
  { hasAudio: false, mode: "pro", duration: 10, priceYuan: 8 },
  { hasAudio: true, mode: "std", duration: 5, priceYuan: 4.5 },
  { hasAudio: true, mode: "std", duration: 10, priceYuan: 9 },
  { hasAudio: true, mode: "pro", duration: 5, priceYuan: 6 },
  { hasAudio: true, mode: "pro", duration: 10, priceYuan: 12 },
].map((item) => ({
  ruleKey: `kling30_${item.hasAudio ? "audio" : "silent"}_${item.mode}_${item.duration}`,
  label: `Kling 3.0 ${item.duration}s`,
  when: {
    hasAudio: item.hasAudio,
    mode: item.mode,
    duration: item.duration,
  },
  price: {
    credits: toCredits(item.priceYuan),
    priceYuan: item.priceYuan,
  },
}));

const KLING_O3_API_RULES = [
  { inputType: "text", hasAudio: false, mode: "std", duration: 5, priceYuan: 3 },
  { inputType: "text", hasAudio: false, mode: "std", duration: 10, priceYuan: 6 },
  { inputType: "text", hasAudio: false, mode: "pro", duration: 5, priceYuan: 4 },
  { inputType: "text", hasAudio: false, mode: "pro", duration: 10, priceYuan: 8 },
  { inputType: "text", hasAudio: true, mode: "std", duration: 5, priceYuan: 4 },
  { inputType: "text", hasAudio: true, mode: "std", duration: 10, priceYuan: 8 },
  { inputType: "text", hasAudio: true, mode: "pro", duration: 5, priceYuan: 5 },
  { inputType: "text", hasAudio: true, mode: "pro", duration: 10, priceYuan: 10 },
  { inputType: "video", hasAudio: false, mode: "std", duration: 5, priceYuan: 4.5 },
  { inputType: "video", hasAudio: false, mode: "std", duration: 10, priceYuan: 9 },
  { inputType: "video", hasAudio: false, mode: "pro", duration: 5, priceYuan: 6 },
  { inputType: "video", hasAudio: false, mode: "pro", duration: 10, priceYuan: 12 },
].map((item) => ({
  ruleKey: `klingo3_${item.inputType}_${item.hasAudio ? "audio" : "silent"}_${item.mode}_${item.duration}`,
  label: `Kling O3 ${item.duration}s`,
  when: {
    inputType: item.inputType,
    hasAudio: item.hasAudio,
    mode: item.mode,
    duration: item.duration,
  },
  price: {
    credits: toCredits(item.priceYuan),
    priceYuan: item.priceYuan,
  },
}));

const KLING_26_TENCENT_FORMULA = [
  formulaAdjustment({ hasAudio: false, resolution: "720P" }, 0.3, "Kling 2.6 无声 720P"),
  formulaAdjustment({ hasAudio: false, resolution: "1080P" }, 0.5, "Kling 2.6 无声 1080P"),
  formulaAdjustment({ hasAudio: false, resolution: "2K" }, 0.75, "Kling 2.6 无声 2K"),
  formulaAdjustment({ hasAudio: false, resolution: "4K" }, 1.12, "Kling 2.6 无声 4K"),
  formulaAdjustment({ hasAudio: true, resolution: "1080P" }, 1, "Kling 2.6 有声 1080P"),
  formulaAdjustment({ hasAudio: true, resolution: "2K" }, 1.5, "Kling 2.6 有声 2K"),
  formulaAdjustment({ hasAudio: true, resolution: "4K" }, 2.25, "Kling 2.6 有声 4K"),
];

const KLING_30_TENCENT_FORMULA = [
  formulaAdjustment({ hasAudio: false, resolution: "720P" }, 0.6, "Kling 3.0 无声 720P"),
  formulaAdjustment({ hasAudio: false, resolution: "1080P" }, 0.8, "Kling 3.0 无声 1080P"),
  formulaAdjustment({ hasAudio: false, resolution: "2K" }, 1, "Kling 3.0 无声 2K"),
  formulaAdjustment({ hasAudio: false, resolution: "4K" }, 1.2, "Kling 3.0 无声 4K"),
  formulaAdjustment({ hasAudio: true, resolution: "720P" }, 0.9, "Kling 3.0 有声 720P"),
  formulaAdjustment({ hasAudio: true, resolution: "1080P" }, 1.2, "Kling 3.0 有声 1080P"),
  formulaAdjustment({ hasAudio: true, resolution: "2K" }, 1.5, "Kling 3.0 有声 2K"),
  formulaAdjustment({ hasAudio: true, resolution: "4K" }, 2, "Kling 3.0 有声 4K"),
];

const KLING_O3_TENCENT_FORMULA = [
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: false, resolution: "720P" }, 0.6, "Kling O3 无参考无声 720P"),
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: false, resolution: "1080P" }, 0.8, "Kling O3 无参考无声 1080P"),
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: false, resolution: "2K" }, 1, "Kling O3 无参考无声 2K"),
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: false, resolution: "4K" }, 1.2, "Kling O3 无参考无声 4K"),
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: true, resolution: "720P" }, 0.8, "Kling O3 无参考有声 720P"),
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: true, resolution: "1080P" }, 1, "Kling O3 无参考有声 1080P"),
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: true, resolution: "2K" }, 1.2, "Kling O3 无参考有声 2K"),
  formulaAdjustment({ inputType: ["text", "image"], hasAudio: true, resolution: "4K" }, 1.5, "Kling O3 无参考有声 4K"),
  formulaAdjustment({ inputType: "video", hasAudio: false, resolution: "720P" }, 0.9, "Kling O3 有参考无声 720P"),
  formulaAdjustment({ inputType: "video", hasAudio: false, resolution: "1080P" }, 1.2, "Kling O3 有参考无声 1080P"),
  formulaAdjustment({ inputType: "video", hasAudio: false, resolution: "2K" }, 1.5, "Kling O3 有参考无声 2K"),
  formulaAdjustment({ inputType: "video", hasAudio: false, resolution: "4K" }, 2, "Kling O3 有参考无声 4K"),
  formulaAdjustment({ inputType: "video", hasAudio: true, resolution: "720P" }, 1.1, "Kling O3 有参考有声 720P"),
  formulaAdjustment({ inputType: "video", hasAudio: true, resolution: "1080P" }, 1.4, "Kling O3 有参考有声 1080P"),
  formulaAdjustment({ inputType: "video", hasAudio: true, resolution: "2K" }, 1.8, "Kling O3 有参考有声 2K"),
  formulaAdjustment({ inputType: "video", hasAudio: true, resolution: "4K" }, 2.4, "Kling O3 有参考有声 4K"),
];

const SEEDANCE15_FORMULA = [
  formulaAdjustment({ hasAudio: false, resolution: "480P" }, 0.08, "Seedance 1.5 无声 480P"),
  formulaAdjustment({ hasAudio: false, resolution: "720P" }, 0.172, "Seedance 1.5 无声 720P"),
  formulaAdjustment({ hasAudio: false, resolution: "1080P" }, 0.388, "Seedance 1.5 无声 1080P"),
  formulaAdjustment({ hasAudio: false, resolution: "2K" }, 0.691, "Seedance 1.5 无声 2K"),
  formulaAdjustment({ hasAudio: false, resolution: "4K" }, 1.552, "Seedance 1.5 无声 4K"),
  formulaAdjustment({ hasAudio: true, resolution: "480P" }, 0.16, "Seedance 1.5 有声 480P"),
  formulaAdjustment({ hasAudio: true, resolution: "720P" }, 0.346, "Seedance 1.5 有声 720P"),
  formulaAdjustment({ hasAudio: true, resolution: "1080P" }, 0.778, "Seedance 1.5 有声 1080P"),
  formulaAdjustment({ hasAudio: true, resolution: "2K" }, 1.382, "Seedance 1.5 有声 2K"),
  formulaAdjustment({ hasAudio: true, resolution: "4K" }, 3.11, "Seedance 1.5 有声 4K"),
];

const SEEDANCE20_FORMULA = [
  formulaAdjustment(
    {
      seedanceModel: "seedance-2.0-fast",
      inputType: ["text", "image", "image_audio"],
      resolution: "480P",
    },
    0.372,
    "Seedance 2.0 Fast 480P"
  ),
  formulaAdjustment(
    {
      seedanceModel: "seedance-2.0-fast",
      inputType: ["text", "image", "image_audio"],
      resolution: "720P",
    },
    0.8,
    "Seedance 2.0 Fast 720P"
  ),
  formulaAdjustment(
    {
      seedanceModel: "seedance-2.0",
      inputType: ["text", "image", "image_audio"],
      resolution: "480P",
    },
    0.462,
    "Seedance 2.0 480P"
  ),
  formulaAdjustment(
    {
      seedanceModel: "seedance-2.0",
      inputType: ["text", "image", "image_audio"],
      resolution: "720P",
    },
    0.994,
    "Seedance 2.0 720P"
  ),
];

const PATCHES = [
  {
    modelKey: "vidu-q2",
    vendorKey: "vidu_api",
    pricing: makeRulesPricing(
      VIDU_Q2_API_RULES,
      "当前 Vidu Q2 规格未配置价格，请选择已支持的模式 / 分辨率 / 时长。"
    ),
  },
  {
    modelKey: "vidu-q2",
    vendorKey: "tencent_vod",
    pricing: makeFormulaPricing(
      VIDU_Q2_TENCENT_FORMULA,
      "当前腾讯 VOD Vidu Q2 规格未配置价格，请选择已支持的模式 / 分辨率。"
    ),
  },
  {
    modelKey: "vidu-q3",
    vendorKey: "vidu_api",
    pricing: makeRulesPricing(
      VIDU_Q3_API_RULES,
      "当前 Vidu Q3 规格未配置价格，请选择已支持的模式 / 分辨率 / 时长。"
    ),
  },
  {
    modelKey: "vidu-q3",
    vendorKey: "tencent_vod",
    pricing: makeFormulaPricing(
      VIDU_Q3_TENCENT_FORMULA,
      "当前腾讯 VOD Vidu Q3 规格未配置价格，请选择已支持的模式 / 分辨率。"
    ),
  },
  {
    modelKey: "kling-2.6",
    vendorKey: "legacy",
    pricing: makeRulesPricing(KLING_26_API_RULES, "当前 Kling 2.6 规格未配置价格。"),
  },
  {
    modelKey: "kling-2.6",
    vendorKey: "tencent_vod",
    pricing: makeFormulaPricing(KLING_26_TENCENT_FORMULA, "当前腾讯 VOD Kling 2.6 规格未配置价格。"),
  },
  {
    modelKey: "kling-3.0",
    vendorKey: "legacy",
    pricing: makeRulesPricing(KLING_30_API_RULES, "当前 Kling 3.0 规格未配置价格。"),
  },
  {
    modelKey: "kling-3.0",
    vendorKey: "tencent_vod",
    pricing: makeFormulaPricing(KLING_30_TENCENT_FORMULA, "当前腾讯 VOD Kling 3.0 规格未配置价格。"),
  },
  {
    modelKey: "kling-o3",
    vendorKey: "legacy",
    pricing: makeRulesPricing(KLING_O3_API_RULES, "当前 Kling O3 规格未配置价格。"),
  },
  {
    modelKey: "kling-o3",
    vendorKey: "tencent_vod",
    pricing: makeFormulaPricing(KLING_O3_TENCENT_FORMULA, "当前腾讯 VOD Kling O3 规格未配置价格。"),
  },
  {
    modelKey: "seedance-1.5",
    vendorKey: "seedance_api",
    pricing: makeFormulaPricing(SEEDANCE15_FORMULA, "当前 Seedance 1.5 规格未配置价格。"),
  },
  {
    modelKey: "seedance-1.5",
    vendorKey: "tencent_vod",
    pricing: makeFormulaPricing(SEEDANCE15_FORMULA, "当前腾讯 VOD Seedance 1.5 规格未配置价格。"),
  },
  {
    modelKey: "seedance-2.0",
    vendorKey: "seedance_api",
    pricing: makeFormulaPricing(
      SEEDANCE20_FORMULA,
      "当前 Seedance 2.0 仅开放文生 / 图片输入 / 图片+音频的按秒计价规格；其他输入组合暂未配置。"
    ),
  },
];

async function main() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEY },
    select: { id: true, value: true },
  });
  if (!setting) {
    throw new Error(`system_setting ${SETTING_KEY} 不存在`);
  }

  const parsed = JSON.parse(setting.value);
  const models = Array.isArray(parsed.models) ? parsed.models : [];

  for (const patch of PATCHES) {
    const model = models.find((item) => item && item.modelKey === patch.modelKey);
    if (!model || !Array.isArray(model.vendors)) continue;
    const vendor = model.vendors.find((item) => item && item.vendorKey === patch.vendorKey);
    if (!vendor) continue;
    vendor.pricing = patch.pricing;
    delete vendor.creditsPerCall;
    delete vendor.priceYuan;
  }

  await prisma.systemSetting.update({
    where: { key: SETTING_KEY },
    data: {
      value: JSON.stringify(parsed, null, 2),
      description: "统一模型管理(JSON 映射，V2) - local real video pricing",
    },
  });

  console.log(
    JSON.stringify(
      {
        key: SETTING_KEY,
        patchedModels: PATCHES.map((item) => `${item.modelKey}/${item.vendorKey}`),
      },
      null,
      2
    )
  );
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
