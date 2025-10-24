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
    if (requestedModel && requestedModel.trim().length > 0) {
      return requestedModel;
    }

    if (providerName === 'kuai') {
      return 'gemini-2.5-flash-image-preview';
    }

    return 'gemini-2.5-flash-image';
  }

  @Post('tool-selection')
  async toolSelection(@Body() dto: ToolSelectionRequestDto) {
    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      try {
        const provider = this.factory.getProvider(dto.model, providerName);
        const result = await provider.selectTool({
          prompt: dto.prompt,
          availableTools: dto.availableTools,
          hasImages: dto.hasImages,
          imageCount: dto.imageCount,
          hasCachedImage: dto.hasCachedImage,
          context: dto.context,
          model: dto.model,
        });

        if (result.success && result.data) {
          return {
            selectedTool: result.data.selectedTool,
            parameters: { prompt: dto.prompt },
            reasoning: result.data.reasoning,
            confidence: result.data.confidence,
          };
        }

        this.logger.warn(
          `[ToolSelection] ${providerName} provider returned error: ${result.error?.message ?? 'unknown error'}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[ToolSelection] ${providerName} provider threw exception: ${message}`);
      }
    }

    const result = await this.ai.runToolSelectionPrompt(dto.prompt);
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
