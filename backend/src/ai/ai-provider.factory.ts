import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider } from './providers/ai-provider.interface';
import { GeminiProProvider } from './providers/gemini-pro.provider';
import { BananaProvider } from './providers/banana.provider';
import { RunningHubProvider } from './providers/runninghub.provider';
import { MidjourneyProvider } from './providers/midjourney.provider';

@Injectable()
export class AIProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(AIProviderFactory.name);
  private providers: Map<string, IAIProvider> = new Map();

  constructor(
    private readonly config: ConfigService,
    private readonly geminiProProvider: GeminiProProvider,
    private readonly bananaProvider: BananaProvider,
    private readonly runningHubProvider: RunningHubProvider,
    private readonly midjourneyProvider: MidjourneyProvider
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initializeProviders();
  }

  private async initializeProviders(): Promise<void> {
    this.logger.log('Initializing AI providers...');

    // 注册 Gemini Pro 提供商（同时注册为 gemini 和 gemini-pro 以保持兼容性）
    this.providers.set('gemini', this.geminiProProvider);
    this.providers.set('gemini-pro', this.geminiProProvider);
    await this.geminiProProvider.initialize();

    // 注册 Banana API 提供商
    this.providers.set('banana', this.bananaProvider);
    this.providers.set('banana-2.5', this.bananaProvider);
    this.providers.set('banana-3.1', this.bananaProvider);
    await this.bananaProvider.initialize();

    // 注册 RunningHub 提供商
    this.providers.set('runninghub', this.runningHubProvider);
    await this.runningHubProvider.initialize();

    // 注册 Midjourney 提供商
    this.providers.set('midjourney', this.midjourneyProvider);
    await this.midjourneyProvider.initialize();

    // TODO: 在这里注册其他提供商 (OpenAI, Claude, StableDiffusion等)
    // 例如:
    // this.providers.set('openai', new OpenAIProvider(this.config));
    // this.providers.set('claude', new ClaudeProvider(this.config));

    this.logger.log(
      `AI providers initialized: ${Array.from(this.providers.keys()).join(', ')}`
    );
  }

  getProvider(model?: string, aiProvider?: string): IAIProvider {
    // 如果显式指定了 aiProvider，直接使用
    if (aiProvider) {
      const provider = this.providers.get(aiProvider);
      if (provider) {
        return provider;
      }
    }

    // 如果指定了模型，根据模型名称推断提供商
    if (model) {
      if (model.includes('gemini') || model.includes('google')) {
        // 优先使用 gemini-pro，如果没有则使用 gemini
        return this.providers.get('gemini-pro') || this.providers.get('gemini')!;
      } else if (model.includes('banana') || model.includes('147') || model.includes('147ai')) {
        return this.providers.get('banana') || this.providers.get('gemini')!;
      } else if (model.includes('runninghub') || model.includes('su-effect')) {
        return this.providers.get('runninghub') || this.providers.get('gemini')!;
      } else if (model.includes('midjourney')) {
        return (
          this.providers.get('midjourney') ||
          this.providers.get('banana') ||
          this.providers.get('gemini')!
        );
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
