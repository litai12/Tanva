export const DEEPSEEK_V41_FLASH_MODEL = 'deepseek-v4.1-flash';
export const DEFAULT_TEXT_MODEL = DEEPSEEK_V41_FLASH_MODEL;

const LEGACY_DEEPSEEK_TEXT_MODELS = new Set([
  'deepseek-flash',
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v3.2',
  'deepseek-v4-flash',
  'deepseek-v4-flash-260425',
  'deepseek-v4-flash-vision-exp',
  'deepseek-v4-pro',
  'deepseek-v4-pro-260425',
]);

// Migrate historical text-model IDs at the final provider boundary, including
// public API requests and saved configurations. Vision models keep their route.
export function resolveLegacyTextModel(model: string | undefined): string {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return DEFAULT_TEXT_MODEL;
  if (normalized.startsWith('xiaot-agent-gpt-')) {
    return 'xiaot-agent-deepseek-v4-flash';
  }
  if (LEGACY_DEEPSEEK_TEXT_MODELS.has(normalized)) {
    return DEFAULT_TEXT_MODEL;
  }
  if (normalized.startsWith('tanvas-right-gpt-') ||
      normalized.startsWith('gpt-') && !normalized.startsWith('gpt-image-')) {
    return DEFAULT_TEXT_MODEL;
  }
  return normalized;
}
