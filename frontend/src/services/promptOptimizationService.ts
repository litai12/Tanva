import { generateTextResponseViaAPI } from '@/services/aiBackendAPI';
import type { AIProviderOptions, AIServiceResponse, SupportedAIProvider } from '@/types/ai';
import { DEFAULT_PROMPT_OPTIMIZATION_MODEL } from '@/services/promptOptimizationModels';

export interface PromptOptimizationRequest {
  input: string;
  language?: '中文' | 'English';
  focus?: string;
  tone?: string;
  lengthPreference?: 'concise' | 'balanced' | 'detailed';
  aiProvider?: SupportedAIProvider;
  model?: string;
  providerOptions?: AIProviderOptions;
}

export interface PromptOptimizationResult {
  optimizedPrompt: string;
  model: string;
  tokenUsage?: number;
}

export const PROMPT_OPTIMIZATION_TIMEOUT_MS = 120_000;

class PromptOptimizationService {
  private readonly DEFAULT_MODEL = DEFAULT_PROMPT_OPTIMIZATION_MODEL;

  private buildInstruction(request: PromptOptimizationRequest): string {
    const language = request.language || '中文';
    const tone = request.tone ? `语气倾向：${request.tone}` : '语气倾向：专业、友好';
    const focus = request.focus ? `重点关注：${request.focus}` : '重点关注：在不偏离主题的前提下补充背景、上下文、目标和可执行细节';
    const length = (() => {
      switch (request.lengthPreference) {
        case 'concise':
          return '长度要求：紧凑但完整，控制在 3 句以内。';
        case 'detailed':
          return '长度要求：适当展开，控制在 6 句以内。';
        default:
          return '长度要求：保持平衡，控制在 4-5 句。';
      }
    })();

    return `你是一名资深提示词优化专家。请将用户提供的原始描述扩展成一个用于 AI 生成任务的高质量提示词，务必严格遵守以下约束：
1. 输出语言：${language}。
2. 输出格式：仅返回一段连续文本，不可出现条列、换行、标题、引用或额外解释。
3. ${focus}。
4. ${tone}。
5. ${length}
6. 在补充细节时保持主题一致，避免引入无关元素或虚假信息。
7. 如原始描述信息不足，可合理补足背景（环境、受众、目的、风格、关键要素），但不得偏离核心需求。

用户原始描述："""${request.input.trim()}"""

请直接返回优化后的提示词。`;
  }

  private normalizeOutput(text: string, language: string): string {
    const singleLine = text.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ');
    if (language === '中文') {
      return singleLine.trim();
    }
    return singleLine.trim();
  }

  async optimizePrompt(request: PromptOptimizationRequest): Promise<AIServiceResponse<PromptOptimizationResult>> {
    const trimmedInput = request.input?.trim();
    if (!trimmedInput) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: '请输入需要优化的提示描述',
          timestamp: new Date()
        }
      };
    }

    try {
      const instruction = this.buildInstruction({ ...request, input: trimmedInput });
      const language = request.language || '中文';
      const modelToUse = request.model || this.DEFAULT_MODEL;

      const response = await generateTextResponseViaAPI(
        {
            prompt: instruction,
            aiProvider: request.aiProvider,
            model: modelToUse,
            enableWebSearch: false,
            billingTag: 'prompt_optimize',
            providerOptions: request.providerOptions,
        },
        { timeoutMs: PROMPT_OPTIMIZATION_TIMEOUT_MS },
      );

      if (!response.success || !response.data?.text) {
        throw new Error(response.error?.message || 'Prompt optimization failed');
      }

      const result = response.data;

      const optimized = result.text?.trim();
      if (!optimized) {
        throw new Error('优化结果为空');
      }

      const cleaned = this.normalizeOutput(optimized, language);

      return {
        success: true,
        data: {
          optimizedPrompt: cleaned,
          model: result.model || modelToUse,
          tokenUsage: result.tokenUsage
        }
      };
    } catch (error) {
      console.error('❌ Prompt optimization failed via backend:', error);
      return {
        success: false,
        error: {
          code: 'PROMPT_OPTIMIZATION_FAILED',
          message: error instanceof Error ? error.message : 'Prompt optimization failed',
          details: error,
          timestamp: new Date()
        }
      };
    }
  }
}

export const promptOptimizationService = new PromptOptimizationService();
export default promptOptimizationService;
