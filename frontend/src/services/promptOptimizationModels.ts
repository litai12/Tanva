export const PROMPT_OPTIMIZATION_MODELS = [
  "deepseek-v4-flash",
] as const;

export type PromptOptimizationModel =
  (typeof PROMPT_OPTIMIZATION_MODELS)[number];

export const DEFAULT_PROMPT_OPTIMIZATION_MODEL: PromptOptimizationModel =
  "deepseek-v4-flash";

export const PROMPT_OPTIMIZATION_MODEL_OPTIONS: ReadonlyArray<{
  label: string;
  value: PromptOptimizationModel;
}> = [
  { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
];

export const resolvePromptOptimizationModel = (
  model: unknown,
): PromptOptimizationModel =>
  PROMPT_OPTIMIZATION_MODELS.includes(model as PromptOptimizationModel)
    ? (model as PromptOptimizationModel)
    : DEFAULT_PROMPT_OPTIMIZATION_MODEL;

export const getPromptOptimizationModelLabel = (model: unknown): string => {
  const resolved = resolvePromptOptimizationModel(model);
  return (
    PROMPT_OPTIMIZATION_MODEL_OPTIONS.find(
      (option) => option.value === resolved,
    )?.label ?? PROMPT_OPTIMIZATION_MODEL_OPTIONS[0].label
  );
};
