import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider } from './ai-provider.interface';
import { GeminiProvider } from './gemini.provider';

@Injectable()
export class AIProviderFactory {
  private readonly logger = new Logger(AIProviderFactory.name);
  private providers: Map<string, IAIProvider> = new Map();

  constructor(
    private readonly config: ConfigService,
    private readonly geminiProvider: GeminiProvider
  ) {
    this.initializeProviders();
  }

  private async initializeProviders(): Promise<void> {
    this.logger.log('Initializing AI providers...');

    // 注册 Gemini 提供商
    this.providers.set('gemini', this.geminiProvider);
    await this.geminiProvider.initialize();

    // TODO: 在这里注册其他提供商 (OpenAI, Claude, StableDiffusion等)
    // 例如:
    // this.providers.set('openai', new OpenAIProvider(this.config));
    // this.providers.set('claude', new ClaudeProvider(this.config));

    this.logger.log(
      `AI providers initialized: ${Array.from(this.providers.keys()).join(', ')}`
    );
  }

  /**
   * 获取指定的 AI 提供商
   * @param model 模型名称或提供商名称
   * @returns IAIProvider 实例
   */
  getProvider(model?: string): IAIProvider {
    // 如果指定了模型,根据模型名称推断提供商
    if (model) {
      if (model.includes('gemini') || model.includes('google')) {
        return this.providers.get('gemini')!;
      } else if (model.includes('gpt') || model.includes('openai')) {
        return this.providers.get('openai') || this.providers.get('gemini')!;
      } else if (model.includes('claude')) {
        return this.providers.get('claude') || this.providers.get('gemini')!;
      } else if (model.includes('stable')) {
        return this.providers.get('stable-diffusion') || this.providers.get('gemini')!;
      }
    }

    // 使用默认提供商
    const defaultProvider = this.config.get<string>('DEFAULT_AI_PROVIDER', 'gemini');
    const provider = this.providers.get(defaultProvider);

    if (!provider) {
      this.logger.warn(
        `Provider "${defaultProvider}" not found, falling back to "gemini"`
      );
      return this.providers.get('gemini')!;
    }

    return provider;
  }

  /**
   * 获取所有可用的提供商列表
   */
  getAvailableProviders(): Array<{
    name: string;
    available: boolean;
    info: any;
  }> {
    const providers: Array<{
      name: string;
      available: boolean;
      info: any;
    }> = [];

    for (const [name, provider] of this.providers) {
      providers.push({
        name,
        available: provider.isAvailable(),
        info: provider.getProviderInfo(),
      });
    }

    return providers;
  }

  /**
   * 检查是否存在指定的提供商
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * 注册新的提供商
   */
  registerProvider(name: string, provider: IAIProvider): void {
    this.logger.log(`Registering AI provider: ${name}`);
    this.providers.set(name, provider);
  }
}
