import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ImageGenerationService, ImageGenerationResult } from './image-generation.service';
import { AIProviderFactory } from './ai-provider.factory';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ToolSelectionRequestDto } from './dto/tool-selection.dto';
import {
  GenerateImageDto,
  EditImageDto,
  BlendImagesDto,
  AnalyzeImageDto,
  TextChatDto,
} from './dto/image-generation.dto';

@ApiTags('ai')
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly ai: AiService,
    private readonly imageGeneration: ImageGenerationService,
    private readonly factory: AIProviderFactory,
  ) {}

  private resolveImageModel(providerName: string | null, requestedModel?: string): string {
    // 🔥 先进行规范化处理
    let model = requestedModel ? requestedModel.trim() : '';

    // 🔥 移除无效前缀
    if (model.startsWith('kuai-')) {
      model = model.substring(5);
    }

    // 🔥 如果是Kuai提供商，需要特殊处理
    if (providerName === 'kuai') {
      // 如果用户显式指定了model，让Kuai provider自己处理规范化
      if (model.length > 0) {
        this.logger.debug(`[Kuai] Using requested model: ${model}`);
        return model;
      }
      // 否则返回Kuai的默认模型
      return 'gemini-2.5-flash-image-preview';
    }

    // 其他提供商的默认模型
    if (model.length > 0) {
      this.logger.debug(`[${providerName || 'default'}] Using requested model: ${model}`);
      return model;
    }

    return 'gemini-2.5-flash-image';
  }

  @Post('tool-selection')
  async toolSelection(@Body() dto: ToolSelectionRequestDto) {
    // 🔥 添加详细日志
    this.logger.log('🎯 Tool selection request:', {
      aiProvider: dto.aiProvider,
      model: dto.model,
      prompt: dto.prompt.substring(0, 50) + '...',
      hasImages: dto.hasImages,
      imageCount: dto.imageCount,
      availableTools: dto.availableTools,
    });

    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      try {
        // 🔥 先规范化模型
        const normalizedModel = this.resolveImageModel(providerName, dto.model);

        this.logger.log(`[${providerName.toUpperCase()}] Using provider for tool selection`, {
          originalModel: dto.model,
          normalizedModel,
        });

        const provider = this.factory.getProvider(normalizedModel, providerName);
        const result = await provider.selectTool({
          prompt: dto.prompt,
          availableTools: dto.availableTools,
          hasImages: dto.hasImages,
          imageCount: dto.imageCount,
          hasCachedImage: dto.hasCachedImage,
          context: dto.context,
          model: normalizedModel,
        });

        if (result.success && result.data) {
          this.logger.log(`✅ [${providerName.toUpperCase()}] Tool selected: ${result.data.selectedTool}`);
          return {
            selectedTool: result.data.selectedTool,
            parameters: { prompt: dto.prompt },
            reasoning: result.data.reasoning,
            confidence: result.data.confidence,
          };
        }

        this.logger.warn(
          `⚠️ [${providerName.toUpperCase()}] provider returned error: ${result.error?.message ?? 'unknown error'}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`⚠️ [${providerName.toUpperCase()}] provider threw exception: ${message}`);
      }
    }

    // 🔥 降级到Google Gemini进行工具选择
    this.logger.log('📊 Falling back to Gemini tool selection');
    const result = await this.ai.runToolSelectionPrompt(dto.prompt);

    this.logger.log('✅ [GEMINI] Tool selected:', result.selectedTool);
    return result;
  }

  @Post('generate-image')
  async generateImage(@Body() dto: GenerateImageDto): Promise<ImageGenerationResult> {
    // 如果指定了aiProvider，使用工厂路由到相应提供商
    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      const provider = this.factory.getProvider(dto.model, providerName);
      const model = this.resolveImageModel(providerName, dto.model);
      const result = await provider.generateImage({
        prompt: dto.prompt,
        model,
        imageOnly: dto.imageOnly,
        aspectRatio: dto.aspectRatio,
      });
      if (result.success && result.data) {
        return {
          imageData: result.data.imageData,
          textResponse: result.data.textResponse || '',
        };
      }
      throw new Error(result.error?.message || 'Failed to generate image');
    }

    // 否则使用默认的Gemini服务
    const result = await this.imageGeneration.generateImage(dto);
    return result;
  }

  @Post('edit-image')
  async editImage(@Body() dto: EditImageDto): Promise<ImageGenerationResult> {
    // 如果指定了aiProvider，使用工厂路由到相应提供商
    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      const provider = this.factory.getProvider(dto.model, providerName);
      const model = this.resolveImageModel(providerName, dto.model);
      const result = await provider.editImage({
        prompt: dto.prompt,
        sourceImage: dto.sourceImage,
        model,
        imageOnly: dto.imageOnly,
        aspectRatio: dto.aspectRatio,
      });
      if (result.success && result.data) {
        return {
          imageData: result.data.imageData,
          textResponse: result.data.textResponse || '',
        };
      }
      throw new Error(result.error?.message || 'Failed to edit image');
    }

    // 否则使用默认的Gemini服务
    const result = await this.imageGeneration.editImage(dto);
    return result;
  }

  @Post('blend-images')
  async blendImages(@Body() dto: BlendImagesDto): Promise<ImageGenerationResult> {
    // 如果指定了aiProvider，使用工厂路由到相应提供商
    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      const provider = this.factory.getProvider(dto.model, providerName);
      const model = this.resolveImageModel(providerName, dto.model);
      const result = await provider.blendImages({
        prompt: dto.prompt,
        sourceImages: dto.sourceImages,
        model,
        imageOnly: dto.imageOnly,
        aspectRatio: dto.aspectRatio,
      });
      if (result.success && result.data) {
        return {
          imageData: result.data.imageData,
          textResponse: result.data.textResponse || '',
        };
      }
      throw new Error(result.error?.message || 'Failed to blend images');
    }

    // 否则使用默认的Gemini服务
    const result = await this.imageGeneration.blendImages(dto);
    return result;
  }

  @Post('analyze-image')
  async analyzeImage(@Body() dto: AnalyzeImageDto) {
    // 如果指定了aiProvider，使用工厂路由到相应提供商
    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      const provider = this.factory.getProvider(dto.model, providerName);
      const result = await provider.analyzeImage({
        prompt: dto.prompt,
        sourceImage: dto.sourceImage,
        model: dto.model || 'gemini-2.0-flash',
      });
      if (result.success && result.data) {
        return {
          text: result.data.text,
        };
      }
      throw new Error(result.error?.message || 'Failed to analyze image');
    }

    // 否则使用默认的Gemini服务
    const result = await this.imageGeneration.analyzeImage(dto);
    return result;
  }

  @Post('text-chat')
  async textChat(@Body() dto: TextChatDto) {
    // 如果指定了aiProvider，使用工厂路由到相应提供商
    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      const provider = this.factory.getProvider(dto.model, providerName);
      const result = await provider.generateText({
        prompt: dto.prompt,
        model: dto.model || 'gemini-2.0-flash',
        enableWebSearch: dto.enableWebSearch,
      });
      if (result.success && result.data) {
        return {
          text: result.data.text,
        };
      }
      throw new Error(result.error?.message || 'Failed to generate text');
    }

    // 否则使用默认的Gemini服务
    const result = await this.imageGeneration.generateTextResponse(dto);
    return result;
  }
}
