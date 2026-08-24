const IMAGE_ALIAS_PATTERN = /@图(\d+)(?!\d)/g;

const imagePlaceholder = (index: number): string => `<<<image_${index}>>>`;
const videoPlaceholder = (index: number): string => `<<<video_${index}>>>`;

export interface KlingOmniNamedImageAlias {
  name: string;
  imageIndex: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function translateNamedImageAliases(
  prompt: string,
  aliases: KlingOmniNamedImageAlias[],
  imageCount: number,
): string {
  return aliases.reduce((current, alias) => {
    const name = String(alias.name || "").trim();
    const index = Math.floor(alias.imageIndex);
    if (!name || index < 1 || index > imageCount) return current;
    // Element names commonly touch Chinese prompt text with no separating
    // whitespace. Only protect ASCII identifier continuations so @role1 does
    // not accidentally rewrite @role10.
    const pattern = new RegExp(`@${escapeRegExp(name)}(?![A-Za-z0-9_])`, "g");
    return current.replace(pattern, imagePlaceholder(index));
  }, prompt);
}

function collapseAdjacentMediaPlaceholders(prompt: string): string {
  let normalized = prompt;
  const repeated = /(<<<(?:image|video)_\d+>>>)\s+\1/g;
  while (repeated.test(normalized)) {
    normalized = normalized.replace(repeated, "$1");
    repeated.lastIndex = 0;
  }
  return normalized;
}

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
  namedImageAliases?: KlingOmniNamedImageAlias[];
}): string {
  const imageCount = Math.max(0, Math.floor(input.imageCount));
  const videoCount = Math.max(0, Math.floor(input.videoCount || 0));
  const withNamedAliases = translateNamedImageAliases(
    String(input.prompt || ""),
    input.namedImageAliases || [],
    imageCount,
  );
  const translated = collapseAdjacentMediaPlaceholders(
    translateKlingOmniPromptAliases(withNamedAliases, imageCount),
  ).trim();
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
