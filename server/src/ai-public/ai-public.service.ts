import { Injectable, Logger } from '@nestjs/common';
import { AIProviderFactory } from '../ai/ai-provider.factory';
import {
  ImageGenerationRequest,
  ImageEditRequest,
  ImageBlendRequest,
  ImageAnalysisRequest,
  TextChatRequest,
  AIProviderResponse,
  ImageResult,
  AnalysisResult,
  TextResult,
} from '../ai/providers/ai-provider.interface';

@Injectable()
export class AiPublicService {
  private readonly logger = new Logger(AiPublicService.name);

  constructor(private readonly providerFactory: AIProviderFactory) {}

  /**
   * 生成图像
   */
  async generateImage(request: ImageGenerationRequest): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(`Public API: Generating image with model: ${request.model || 'default'}`);

    const provider = this.providerFactory.getProvider(request.model);
    return provider.generateImage(request);
  }

  /**
   * 编辑图像
   */
  async editImage(request: ImageEditRequest): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(`Public API: Editing image with model: ${request.model || 'default'}`);

    const provider = this.providerFactory.getProvider(request.model);
    return provider.editImage(request);
  }

  /**
   * 融合多张图像
   */
  async blendImages(request: ImageBlendRequest): Promise<AIProviderResponse<ImageResult>> {
    this.logger.log(`Public API: Blending images with model: ${request.model || 'default'}`);

    const provider = this.providerFactory.getProvider(request.model);
    return provider.blendImages(request);
  }

  /**
   * 分析图像
   */
  async analyzeImage(request: ImageAnalysisRequest): Promise<AIProviderResponse<AnalysisResult>> {
    this.logger.log(`Public API: Analyzing image with model: ${request.model || 'default'}`);

    const provider = this.providerFactory.getProvider(request.model);
    return provider.analyzeImage(request);
  }

  /**
   * 文本对话
   */
  async chat(request: TextChatRequest): Promise<AIProviderResponse<TextResult>> {
    this.logger.log(`Public API: Chat request with model: ${request.model || 'default'}`);

    const provider = this.providerFactory.getProvider(request.model);
    return provider.generateText(request);
  }

  /**
   * 获取可用的 AI 提供商列表
   */
  getAvailableProviders() {
    return this.providerFactory.getAvailableProviders();
  }
}
