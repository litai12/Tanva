export const PROMPT_OPTIMIZATION_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
] as const;

export type PromptOptimizationModel =
  (typeof PROMPT_OPTIMIZATION_MODELS)[number];

export const DEFAULT_PROMPT_OPTIMIZATION_MODEL: PromptOptimizationModel =
  'gpt-5.6-luna';

export const PROMPT_OPTIMIZATION_GATEWAY_MODELS = {
  'gpt-5.6-luna': 'tanvas-right-gpt-5.6-luna',
  'gpt-5.6-terra': 'tanvas-right-gpt-5.6-terra',
} as const satisfies Record<PromptOptimizationModel, string>;

export type PromptOptimizationGatewayModel =
  (typeof PROMPT_OPTIMIZATION_GATEWAY_MODELS)[PromptOptimizationModel];

export function resolvePromptOptimizationModel(
  model: unknown,
): PromptOptimizationModel {
  const normalized = typeof model === 'string' ? model.trim().toLowerCase() : '';
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
