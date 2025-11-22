import {
  Body,
  Controller,
  Logger,
  Post,
  UseGuards,
  ServiceUnavailableException,
  Get,
  Optional,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ImageGenerationService, ImageGenerationResult } from './image-generation.service';
import { BackgroundRemovalService } from './services/background-removal.service';
import { AIProviderFactory } from './ai-provider.factory';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ToolSelectionRequestDto } from './dto/tool-selection.dto';
import { RemoveBackgroundDto } from './dto/background-removal.dto';
import {
  GenerateImageDto,
  EditImageDto,
  BlendImagesDto,
  AnalyzeImageDto,
  TextChatDto,
  MidjourneyActionDto,
  MidjourneyModalDto,
  Convert2Dto3DDto,
  ExpandImageDto,
} from './dto/image-generation.dto';
import { Convert2Dto3DService } from './services/convert-2d-to-3d.service';
import { ExpandImageService } from './services/expand-image.service';
import { MidjourneyProvider } from './providers/midjourney.provider';

@ApiTags('ai')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);
  private readonly providerDefaultImageModels: Record<string, string> = {
    gemini: 'gemini-2.5-flash-image',
    'gemini-pro': 'gemini-3-pro-image-preview',
    banana: 'gemini-2.5-flash-image',
    runninghub: 'runninghub-su-effect',
    midjourney: 'midjourney-fast',
  };
  private readonly providerDefaultTextModels: Record<string, string> = {
    gemini: 'gemini-2.5-flash',
    'gemini-pro': 'gemini-3-pro-preview',
    banana: 'banana-gemini-2.5-flash',
    runninghub: 'gemini-2.5-flash',
    midjourney: 'gemini-2.5-flash',
  };

  constructor(
    private readonly ai: AiService,
    private readonly imageGeneration: ImageGenerationService,
    private readonly backgroundRemoval: BackgroundRemovalService,
    private readonly factory: AIProviderFactory,
    private readonly convert2Dto3DService: Convert2Dto3DService,
    private readonly expandImageService: ExpandImageService,
  ) {}

  private resolveImageModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultImageModels[providerName] || 'gemini-2.5-flash-image';
    }
    return this.providerDefaultImageModels.gemini;
  }

  private resolveTextModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested text model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultTextModels[providerName] || 'gemini-2.5-flash';
    }
    return this.providerDefaultTextModels.gemini;
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

        const message = result.error?.message ?? 'provider returned an error response';
        this.logger.warn(`⚠️ [${providerName.toUpperCase()}] provider responded with error: ${message}`);
        throw new ServiceUnavailableException(
          `[${providerName}] tool selection failed: ${message}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`⚠️ [${providerName.toUpperCase()}] provider threw exception: ${message}`);
        throw new ServiceUnavailableException(
          `[${providerName}] tool selection failed: ${message}`
        );
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
        imageSize: dto.imageSize,
        thinkingLevel: dto.thinkingLevel,
        outputFormat: dto.outputFormat,
        providerOptions: dto.providerOptions,
      });
      if (result.success && result.data) {
        return {
          imageData: result.data.imageData,
          textResponse: result.data.textResponse || '',
          metadata: result.data.metadata,
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
        imageSize: dto.imageSize,
        thinkingLevel: dto.thinkingLevel,
        outputFormat: dto.outputFormat,
        providerOptions: dto.providerOptions,
      });
      if (result.success && result.data) {
        return {
          imageData: result.data.imageData,
          textResponse: result.data.textResponse || '',
          metadata: result.data.metadata,
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
        imageSize: dto.imageSize,
        thinkingLevel: dto.thinkingLevel,
        outputFormat: dto.outputFormat,
        providerOptions: dto.providerOptions,
      });
      if (result.success && result.data) {
        return {
          imageData: result.data.imageData,
          textResponse: result.data.textResponse || '',
          metadata: result.data.metadata,
        };
      }
      throw new Error(result.error?.message || 'Failed to blend images');
    }

    // 否则使用默认的Gemini服务
    const result = await this.imageGeneration.blendImages(dto);
    return result;
  }

  @Post('midjourney/action')
  async midjourneyAction(@Body() dto: MidjourneyActionDto): Promise<ImageGenerationResult> {
    const provider = this.factory.getProvider('midjourney-fast', 'midjourney');
    if (!(provider instanceof MidjourneyProvider)) {
      throw new ServiceUnavailableException('Midjourney provider is unavailable.');
    }

    const result = await provider.triggerAction({
      taskId: dto.taskId,
      customId: dto.customId,
      state: dto.state,
      notifyHook: dto.notifyHook,
      chooseSameChannel: dto.chooseSameChannel,
      accountFilter: dto.accountFilter,
    });

    if (result.success && result.data) {
      return {
        imageData: result.data.imageData,
        textResponse: result.data.textResponse || '',
        metadata: result.data.metadata,
      };
    }

    throw new ServiceUnavailableException(
      result.error?.message || 'Failed to execute Midjourney action.'
    );
  }

  @Post('midjourney/modal')
  async midjourneyModal(@Body() dto: MidjourneyModalDto): Promise<ImageGenerationResult> {
    const provider = this.factory.getProvider('midjourney-fast', 'midjourney');
    if (!(provider instanceof MidjourneyProvider)) {
      throw new ServiceUnavailableException('Midjourney provider is unavailable.');
    }

    const result = await provider.executeModal({
      taskId: dto.taskId,
      prompt: dto.prompt,
      maskBase64: dto.maskBase64,
    });

    if (result.success && result.data) {
      return {
        imageData: result.data.imageData,
        textResponse: result.data.textResponse || '',
        metadata: result.data.metadata,
      };
    }

    throw new ServiceUnavailableException(
      result.error?.message || 'Failed to execute Midjourney modal action.'
    );
  }

  @Post('analyze-image')
  async analyzeImage(@Body() dto: AnalyzeImageDto) {
    // 如果指定了aiProvider，使用工厂路由到相应提供商
    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    if (providerName) {
      const provider = this.factory.getProvider(dto.model, providerName);
      const model = this.resolveImageModel(providerName, dto.model);
      const result = await provider.analyzeImage({
        prompt: dto.prompt,
        sourceImage: dto.sourceImage,
        model,
        providerOptions: dto.providerOptions,
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
      const model = this.resolveTextModel(providerName, dto.model);
      const result = await provider.generateText({
        prompt: dto.prompt,
        model,
        enableWebSearch: dto.enableWebSearch,
        providerOptions: dto.providerOptions,
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

  @Post('remove-background')
  async removeBackground(@Body() dto: RemoveBackgroundDto) {
    this.logger.log('🎯 Background removal request received');

    try {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        // 默认为base64
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('✅ Background removal succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('❌ Background removal failed:', message);
      throw new ServiceUnavailableException({
        success: false,
        error: message,
      });
    }
  }

  // 开发模式：无需认证的抠图接口
  @Post('remove-background-public')
  async removeBackgroundPublic(@Body() dto: RemoveBackgroundDto) {
    this.logger.log('🎯 Background removal (public) request received');

    try {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        // 默认为base64
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('✅ Background removal (public) succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('❌ Background removal (public) failed:', message);
      throw new ServiceUnavailableException({
        success: false,
        error: message,
      });
    }
  }

  @Get('background-removal-info')
  async getBackgroundRemovalInfo() {
    this.logger.log('📊 Background removal info requested');
    const info = await this.backgroundRemoval.getInfo();
    return info;
  }

  @Post('convert-2d-to-3d')
  async convert2Dto3D(@Body() dto: Convert2Dto3DDto) {
    this.logger.log('🎨 2D to 3D conversion request received');
    
    try {
      const result = await this.convert2Dto3DService.convert2Dto3D(dto.imageUrl);
      
      return {
        success: true,
        modelUrl: result.modelUrl,
        promptId: result.promptId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`❌ 2D to 3D conversion failed: ${message}`, error);
      throw error;
    }
  }

  @Post('expand-image')
  async expandImage(@Body() dto: ExpandImageDto) {
    this.logger.log('🖼️ Expand image request received');
    
    try {
      const result = await this.expandImageService.expandImage(
        dto.imageUrl,
        dto.expandRatios,
        dto.prompt || '扩图'
      );
      
      return {
        success: true,
        imageUrl: result.imageUrl,
        promptId: result.promptId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`❌ Expand image failed: ${message}`, error);
      throw error;
    }
  }
}
