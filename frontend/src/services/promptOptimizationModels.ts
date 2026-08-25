export const PROMPT_OPTIMIZATION_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
] as const;

export type PromptOptimizationModel =
  (typeof PROMPT_OPTIMIZATION_MODELS)[number];

export const DEFAULT_PROMPT_OPTIMIZATION_MODEL: PromptOptimizationModel =
  "gpt-5.6-terra";

export const PROMPT_OPTIMIZATION_MODEL_OPTIONS: ReadonlyArray<{
  label: string;
  value: PromptOptimizationModel;
}> = [
  { label: "GPT-5.6 Luna", value: "gpt-5.6-luna" },
  { label: "GPT-5.6 Terra", value: "gpt-5.6-terra" },
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
