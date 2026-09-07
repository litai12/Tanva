// 小T可选「大脑」模型清单。
// 与 backend/src/agent/xiaot-agent.service.ts 的 XIAOT_CHAT_MODELS 对齐
// （前后端不共享包，两边须手工同步；后端对未知值会回退默认模型）。
export const XIAOT_CHAT_MODELS = [
  "xiaot-agent-deepseek-v4-flash",
] as const;
export type XiaotChatModel = (typeof XIAOT_CHAT_MODELS)[number];

// 用户侧统一以“小T”品牌外显；value 仍保留专属门面名供网关路由。
export const XIAOT_CHAT_MODEL_OPTIONS: ReadonlyArray<{
  label: string;
  value: XiaotChatModel;
}> = [
  {
    label: "小T-DeepSeek V4 Flash",
    value: "xiaot-agent-deepseek-v4-flash",
  },
];

export const getXiaotChatModelLabel = (model: XiaotChatModel): string =>
  XIAOT_CHAT_MODEL_OPTIONS.find((option) => option.value === model)?.label ??
  XIAOT_CHAT_MODEL_OPTIONS[0].label;

export const DEFAULT_XIAOT_CHAT_MODEL: XiaotChatModel = XIAOT_CHAT_MODELS[0];

export const resolveXiaotChatModel = (_storedModel: unknown): XiaotChatModel =>
  DEFAULT_XIAOT_CHAT_MODEL;
