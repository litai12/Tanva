import { generateTextResponseViaAPI } from '@/services/aiBackendAPI';
import type { AIServiceResponse, SupportedAIProvider } from '@/types/ai';

export interface PromptTidyRequest {
  input: string;
  language?: '中文' | 'English';
  aiProvider?: SupportedAIProvider;
  model?: string;
}

export interface PromptTidyResult {
  tidiedPrompt: string;
  model: string;
  tokenUsage?: number;
}

const DEFAULT_MODEL = 'gemini-3-flash-preview';

const normalizeOutput = (text: string): string =>
  text.replace(/\r\n/g, '\n').trim();

const buildInstruction = (request: PromptTidyRequest): string => {
  const language = request.language || '中文';
  return `你是一名资深提示词编辑。请在尽量不改变原意和信息的前提下，对下面的提示词进行整理润色，目标是更清晰、更易读、更适合直接用于 AI 生成任务。
要求：
1) 输出语言：${language}。
2) 只做“整理”，不要明显扩写：不新增关键设定/对象/场景，不凭空补充不存在的信息。
3) 允许做的事：修正明显错别字与语病、统一标点和空格、合并重复、调整句子连接与顺序、适度补全连接词。
4) 保留原有信息密度与结构：如原文有换行可保留，必要时可微调换行以增强可读性。
5) 输出格式：仅返回整理后的提示词正文，不要标题、不要解释、不要条列编号。

原始提示词："""${request.input.trim()}"""

请直接返回整理后的提示词。`;
};

export async function tidyPrompt(
  request: PromptTidyRequest
): Promise<AIServiceResponse<PromptTidyResult>> {
  const trimmed = request.input?.trim();
  if (!trimmed) {
    return {
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: '请输入需要整理的提示词',
        timestamp: new Date(),
      },
    };
  }

  const modelToUse = request.model || DEFAULT_MODEL;

  const response = await generateTextResponseViaAPI({
    prompt: buildInstruction({ ...request, input: trimmed }),
    aiProvider: request.aiProvider,
    model: modelToUse,
    enableWebSearch: false,
  });

  if (!response.success || !response.data?.text) {
    return {
      success: false,
      error: response.error || {
        code: 'PROMPT_TIDY_FAILED',
        message: 'Prompt tidy failed',
        timestamp: new Date(),
      },
    };
  }

  const tidied = normalizeOutput(response.data.text);
  if (!tidied) {
    return {
      success: false,
      error: {
        code: 'EMPTY_RESULT',
        message: '整理结果为空',
        timestamp: new Date(),
      },
    };
  }

  return {
    success: true,
    data: {
      tidiedPrompt: tidied,
      model: response.data.model || modelToUse,
      tokenUsage: response.data.tokenUsage,
    },
  };
}
