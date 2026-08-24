const IMAGE_ALIAS_PATTERN = /@图(\d+)(?!\d)/g;

const imagePlaceholder = (index: number): string => `<<<image_${index}>>>`;
const videoPlaceholder = (index: number): string => `<<<video_${index}>>>`;

export function translateKlingOmniPromptAliases(
  prompt: string | undefined,
  imageCount: number,
): string {
  const boundedImageCount = Math.max(0, Math.floor(imageCount));
  return String(prompt || "").replace(
    IMAGE_ALIAS_PATTERN,
    (match, rawIndex: string) => {
      const index = Number(rawIndex);
      return Number.isInteger(index) && index >= 1 && index <= boundedImageCount
        ? imagePlaceholder(index)
        : match;
    },
  );
}

/**
 * Tanva exposes readable `@图N` tokens in the canvas, while Kling Omni's API
 * contract accepts `<<<image_N>>>` / `<<<video_N>>>`. Every submitted media
 * item must be represented in the final prompt: merely connecting and
 * uploading an image must not produce an invalid upstream request.
 */
export function normalizeKlingOmniPrompt(input: {
  prompt?: string;
  imageCount: number;
  videoCount?: number;
}): string {
  const imageCount = Math.max(0, Math.floor(input.imageCount));
  const videoCount = Math.max(0, Math.floor(input.videoCount || 0));
  const translated = translateKlingOmniPromptAliases(input.prompt, imageCount).trim();
  const missingPlaceholders: string[] = [];

  for (let index = 1; index <= imageCount; index += 1) {
    const placeholder = imagePlaceholder(index);
    if (!translated.includes(placeholder)) missingPlaceholders.push(placeholder);
  }
  for (let index = 1; index <= videoCount; index += 1) {
    const placeholder = videoPlaceholder(index);
    if (!translated.includes(placeholder)) missingPlaceholders.push(placeholder);
  }

  if (missingPlaceholders.length === 0) return translated;
  const mediaPrefix = missingPlaceholders.join(" ");
  return translated ? `${mediaPrefix}\n${translated}` : mediaPrefix;
}
