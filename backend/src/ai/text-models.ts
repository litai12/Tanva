export const DEFAULT_TEXT_MODEL = 'deepseek-v4-flash';

// Migrate historical text-model IDs at the final provider boundary, including
// public API requests and saved configurations. Vision models keep their route.
export function resolveLegacyTextModel(model: string | undefined): string {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return DEFAULT_TEXT_MODEL;
  if (normalized.startsWith('xiaot-agent-gpt-')) {
    return 'xiaot-agent-deepseek-v4-flash';
  }
  if (normalized.startsWith('tanvas-right-gpt-') ||
      normalized.startsWith('gpt-') && !normalized.startsWith('gpt-image-')) {
    return DEFAULT_TEXT_MODEL;
  }
  return normalized;
}
