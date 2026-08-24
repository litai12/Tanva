import { ServiceUnavailableException } from '@nestjs/common';
import type {
  AIProviderResponse,
  TextResult,
} from './providers/ai-provider.interface';

export type TerminalTextPayload = {
  text: string;
  webSearchResult?: unknown;
  metadata?: Record<string, unknown>;
};

const EMPTY_TERMINAL_TEXT_MESSAGE =
  '文本生成服务未返回终态正文，请稍后重试';

export function requireTerminalTextResult(
  result: AIProviderResponse<TextResult>,
): TerminalTextPayload {
  if (!result.success || !result.data) {
    throw new ServiceUnavailableException(
      result.error?.message || '文本生成服务暂时不可用，请稍后重试',
    );
  }

  const text =
    typeof result.data.text === 'string' ? result.data.text.trim() : '';
  if (!text) {
    throw new ServiceUnavailableException(EMPTY_TERMINAL_TEXT_MESSAGE);
  }

  return {
    text,
    webSearchResult: result.data.webSearchResult,
    metadata: result.data.metadata,
  };
}

export function validateTerminalTextPayload(
  result: unknown,
): boolean | { ok: boolean; message?: string } {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, message: EMPTY_TERMINAL_TEXT_MESSAGE };
  }

  const text = (result as Record<string, unknown>).text;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, message: EMPTY_TERMINAL_TEXT_MESSAGE };
  }

  return true;
}
