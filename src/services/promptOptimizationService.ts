import { GoogleGenAI } from '@google/genai';
import type { AIServiceResponse } from '@/types/ai';

export interface PromptOptimizationRequest {
  input: string;
  language?: '中文' | 'English';
  focus?: string;
  tone?: string;
  lengthPreference?: 'concise' | 'balanced' | 'detailed';
}

export interface PromptOptimizationResult {
  optimizedPrompt: string;
  model: string;
  tokenUsage?: number;
}

class PromptOptimizationService {
  private genAI: GoogleGenAI | null = null;
  private readonly DEFAULT_MODEL = 'gemini-2.5-flash';
  private readonly DEFAULT_TIMEOUT = 90000;

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_GEMINI_API_KEY
      : (typeof process !== 'undefined' ? (process as any).env?.VITE_GOOGLE_GEMINI_API_KEY : undefined);

    const defaultApiKey = 'AIzaSyAWVrzl5s4JQDhrZN8iSPcxmbFmgEJTTxw';
    const finalApiKey = apiKey || defaultApiKey;

    if (!finalApiKey) {
      console.warn('Google Gemini API key not found. Please set VITE_GOOGLE_GEMINI_API_KEY in your .env.local file');
      return;
    }

    try {
      this.genAI = new GoogleGenAI({ apiKey: finalApiKey });
      console.log('✅ PromptOptimizationService initialized');
    } catch (error) {
      console.error('❌ Failed to initialize PromptOptimizationService:', error);
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async withRetry<T>(
    operation: (attempt: number) => Promise<T>,
    retryCount: number = 5,
    baseDelayMs: number = 400
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (attempt > retryCount) {
          break;
        }

        const delay = baseDelayMs;
        console.warn(`⚠️ Prompt optimization attempt ${attempt} failed, retrying in ${delay}ms`, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('Prompt optimization failed after retries');
  }

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
    if (!request.input || !request.input.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: '请输入需要优化的提示描述',
          timestamp: new Date()
        }
      };
    }

    if (!this.genAI) {
      return {
        success: false,
        error: {
          code: 'CLIENT_NOT_INITIALIZED',
          message: 'PromptOptimizationService not initialized',
          timestamp: new Date()
        }
      };
    }

    try {
      const instruction = this.buildInstruction(request);
      const language = request.language || '中文';

      const response = await this.withRetry((attempt) => {
        const apiCall = this.genAI!.models.generateContent({
          model: this.DEFAULT_MODEL,
          contents: [{ text: instruction }]
        });

        return this.withTimeout(apiCall, this.DEFAULT_TIMEOUT, `Prompt optimization (attempt ${attempt})`);
      }, 5);
      const optimized = response.text?.trim();

      if (!optimized) {
        throw new Error('No optimized prompt returned from API');
      }

      const cleaned = this.normalizeOutput(optimized, language);

      return {
        success: true,
        data: {
          optimizedPrompt: cleaned,
          model: this.DEFAULT_MODEL,
          tokenUsage: (response as any)?.usageMetadata?.totalTokenCount
        }
      };
    } catch (error) {
      console.error('❌ Prompt optimization failed:', error);
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
