export const PROMPT_OPTIMIZATION_MODELS = [
  'deepseek-v4.1-flash',
] as const;

export type PromptOptimizationModel =
  (typeof PROMPT_OPTIMIZATION_MODELS)[number];

export const DEFAULT_PROMPT_OPTIMIZATION_MODEL: PromptOptimizationModel =
  'deepseek-v4.1-flash';

export const PROMPT_OPTIMIZATION_GATEWAY_MODELS = {
  'deepseek-v4.1-flash': 'deepseek-v4.1-flash',
} as const satisfies Record<PromptOptimizationModel, string>;

const LEGACY_PROMPT_OPTIMIZATION_MODELS = new Set([
  'deepseek-flash',
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v4-flash',
  'deepseek-v4-flash-260425',
  'deepseek-v4-pro',
  'deepseek-v4-pro-260425',
]);

export type PromptOptimizationGatewayModel =
  (typeof PROMPT_OPTIMIZATION_GATEWAY_MODELS)[PromptOptimizationModel];

export function resolvePromptOptimizationModel(
  model: unknown,
): PromptOptimizationModel {
  const normalized = typeof model === 'string' ? model.trim().toLowerCase() : '';
  if (LEGACY_PROMPT_OPTIMIZATION_MODELS.has(normalized)) {
    return DEFAULT_PROMPT_OPTIMIZATION_MODEL;
  }
  return PROMPT_OPTIMIZATION_MODELS.includes(
    normalized as PromptOptimizationModel,
  )
    ? (normalized as PromptOptimizationModel)
    : DEFAULT_PROMPT_OPTIMIZATION_MODEL;
}

export function resolvePromptOptimizationGatewayModel(
  model: unknown,
): PromptOptimizationGatewayModel {
  return PROMPT_OPTIMIZATION_GATEWAY_MODELS[
    resolvePromptOptimizationModel(model)
  ];
}
