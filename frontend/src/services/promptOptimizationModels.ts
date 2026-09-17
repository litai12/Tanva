export const PROMPT_OPTIMIZATION_MODELS = [
  "deepseek-v4.1-flash",
] as const;

export type PromptOptimizationModel =
  (typeof PROMPT_OPTIMIZATION_MODELS)[number];

export const DEFAULT_PROMPT_OPTIMIZATION_MODEL: PromptOptimizationModel =
  "deepseek-v4.1-flash";

export const PROMPT_OPTIMIZATION_MODEL_OPTIONS: ReadonlyArray<{
  label: string;
  value: PromptOptimizationModel;
}> = [
  { label: "DeepSeek V4.1 Flash", value: "deepseek-v4.1-flash" },
];

const LEGACY_PROMPT_OPTIMIZATION_MODELS = new Set([
  "deepseek-flash",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
  "deepseek-v4-flash-260425",
  "deepseek-v4-pro",
  "deepseek-v4-pro-260425",
]);

export const resolvePromptOptimizationModel = (
  model: unknown,
): PromptOptimizationModel => {
  const normalized = typeof model === "string" ? model.trim().toLowerCase() : "";
  if (LEGACY_PROMPT_OPTIMIZATION_MODELS.has(normalized)) {
    return DEFAULT_PROMPT_OPTIMIZATION_MODEL;
  }
  return PROMPT_OPTIMIZATION_MODELS.includes(normalized as PromptOptimizationModel)
    ? (normalized as PromptOptimizationModel)
    : DEFAULT_PROMPT_OPTIMIZATION_MODEL;
};

export const getPromptOptimizationModelLabel = (model: unknown): string => {
  const resolved = resolvePromptOptimizationModel(model);
  return (
    PROMPT_OPTIMIZATION_MODEL_OPTIONS.find(
      (option) => option.value === resolved,
    )?.label ?? PROMPT_OPTIMIZATION_MODEL_OPTIONS[0].label
  );
};
