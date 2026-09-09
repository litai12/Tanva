// The canvas exposes one GPT Image 2.5 model. Normalize saved legacy variants.
export function normalizeCanvasGptImage25Model(model: string, nodeConfigKey?: string): string {
  return ["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model) ||
    ["gptImage25", "gptImage25Flare", "gptImage25Sunburst"].includes(nodeConfigKey || "")
    ? "gpt-image-2.5" : model;
}
