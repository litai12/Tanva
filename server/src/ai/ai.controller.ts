import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ImageGenerationService, ImageGenerationResult } from './image-generation.service';
import { AIProviderFactory } from './ai-provider.factory';
import { ToolSelectionRequestDto } from './dto/tool-selection.dto';
import {
  GenerateImageDto,
  EditImageDto,
  BlendImagesDto,
  AnalyzeImageDto,
  TextChatDto,
} from './dto/image-generation.dto';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly imageGeneration: ImageGenerationService,
    private readonly factory: AIProviderFactory,
  ) {}

  @Post('tool-selection')
  async toolSelection(@Body() dto: ToolSelectionRequestDto) {
    const result = await this.ai.runToolSelectionPrompt(dto.prompt);
    return result;
  }

  @Post('generate-image')
  async generateImage(@Body() dto: GenerateImageDto): Promise<ImageGenerationResult> {
    // 如果指定了aiProvider，使用工厂路由到相应提供商
    if (dto.aiProvider === 'banana') {
      const provider = this.factory.getProvider(dto.model, 'banana');
      const result = await provider.generateImage({
        prompt: dto.prompt,
        model: dto.model || 'gemini-2.5-flash-image',
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
    if (dto.aiProvider === 'banana') {
      const provider = this.factory.getProvider(dto.model, 'banana');
      const result = await provider.editImage({
        prompt: dto.prompt,
        sourceImage: dto.sourceImage,
        model: dto.model || 'gemini-2.5-flash-image',
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
    if (dto.aiProvider === 'banana') {
      const provider = this.factory.getProvider(dto.model, 'banana');
      const result = await provider.blendImages({
        prompt: dto.prompt,
        sourceImages: dto.sourceImages,
        model: dto.model || 'gemini-2.5-flash-image',
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
    if (dto.aiProvider === 'banana') {
      const provider = this.factory.getProvider(dto.model, 'banana');
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
    if (dto.aiProvider === 'banana') {
      const provider = this.factory.getProvider(dto.model, 'banana');
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
