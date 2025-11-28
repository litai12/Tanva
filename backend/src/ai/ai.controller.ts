import {
  Body,
  Controller,
  Logger,
  Post,
  UseGuards,
  ServiceUnavailableException,
  Get,
  Optional,
  Req,
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
import { PaperJSGenerateRequestDto, PaperJSGenerateResponseDto } from './dto/paperjs-generation.dto';
import { Convert2Dto3DService } from './services/convert-2d-to-3d.service';
import { ExpandImageService } from './services/expand-image.service';
import { MidjourneyProvider } from './providers/midjourney.provider';
import { UsersService } from '../users/users.service';

@ApiTags('ai')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);
  private readonly providerDefaultImageModels: Record<string, string> = {
    gemini: 'gemini-3-pro-image-preview',
    'gemini-pro': 'gemini-3-pro-image-preview',
    banana: 'gemini-3-pro-image-preview',
    runninghub: 'runninghub-su-effect',
    midjourney: 'midjourney-fast',
  };
  private readonly providerDefaultTextModels: Record<string, string> = {
    gemini: 'gemini-2.5-flash',
    'gemini-pro': 'gemini-3-pro-preview',
    banana: 'banana-gemini-3-pro-preview',
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
    private readonly usersService: UsersService,
  ) {}

  /**
   * 从请求中获取用户的自定义 Google API Key
   * 如果用户设置了自定义 Key 且 mode 为 'custom'，则返回该 Key
   * 否则返回 null（使用系统默认 Key）
   */
  private async getUserCustomApiKey(req: any): Promise<string | null> {
    try {
      // 如果是 API Key 认证（外部调用），不使用用户自定义 Key
      if (req.apiClient) {
        return null;
      }

      // 获取 JWT 中的用户 ID
      const userId = req.user?.sub;
      if (!userId) {
        return null;
      }

      const { apiKey, mode } = await this.usersService.getGoogleApiKey(userId);

      // 只有当 mode 为 'custom' 且有 apiKey 时才使用
      if (mode === 'custom' && apiKey) {
        this.logger.debug(`Using custom Google API Key for user ${userId.slice(0, 8)}...`);
        return apiKey;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get user custom API key:', error);
      return null;
    }
  }

  private resolveImageModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultImageModels[providerName] || 'gemini-3-pro-image-preview';
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
  async generateImage(@Body() dto: GenerateImageDto, @Req() req: any): Promise<ImageGenerationResult> {
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

    // 否则使用默认的Gemini服务，获取用户自定义 API Key
    const customApiKey = await this.getUserCustomApiKey(req);
    const result = await this.imageGeneration.generateImage({ ...dto, customApiKey });
    return result;
  }

  @Post('edit-image')
  async editImage(@Body() dto: EditImageDto, @Req() req: any): Promise<ImageGenerationResult> {
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

    // 否则使用默认的Gemini服务，获取用户自定义 API Key
    const customApiKey = await this.getUserCustomApiKey(req);
    const result = await this.imageGeneration.editImage({ ...dto, customApiKey });
    return result;
  }

  @Post('blend-images')
  async blendImages(@Body() dto: BlendImagesDto, @Req() req: any): Promise<ImageGenerationResult> {
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

    // 否则使用默认的Gemini服务，获取用户自定义 API Key
    const customApiKey = await this.getUserCustomApiKey(req);
    const result = await this.imageGeneration.blendImages({ ...dto, customApiKey });
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
  async analyzeImage(@Body() dto: AnalyzeImageDto, @Req() req: any) {
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

    // 否则使用默认的Gemini服务，获取用户自定义 API Key
    const customApiKey = await this.getUserCustomApiKey(req);
    const result = await this.imageGeneration.analyzeImage({ ...dto, customApiKey });
    return result;
  }

  @Post('text-chat')
  async textChat(@Body() dto: TextChatDto, @Req() req: any) {
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

    // 否则使用默认的Gemini服务，获取用户自定义 API Key
    const customApiKey = await this.getUserCustomApiKey(req);
    const result = await this.imageGeneration.generateTextResponse({ ...dto, customApiKey });
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

  /**
   * 生成 Paper.js 代码
   */
  @Post('generate-paperjs')
  async generatePaperJS(@Body() dto: PaperJSGenerateRequestDto, @Req() req: any): Promise<PaperJSGenerateResponseDto> {
    this.logger.log(`📐 Paper.js code generation request: ${dto.prompt.substring(0, 50)}...`);
    const startTime = Date.now();

    try {
      // 如果指定了aiProvider，使用工厂路由到相应提供商
      const providerName =
        dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

      if (providerName) {
        const provider = this.factory.getProvider(dto.model, providerName);
        const model = this.resolveTextModel(providerName, dto.model);

        const result = await provider.generatePaperJS({
          prompt: dto.prompt,
          model,
          thinkingLevel: dto.thinkingLevel,
          canvasWidth: dto.canvasWidth,
          canvasHeight: dto.canvasHeight,
        });

        if (result.success && result.data) {
          const processingTime = Date.now() - startTime;
          this.logger.log(`✅ Paper.js code generated successfully in ${processingTime}ms`);

          return {
            code: result.data.code,
            explanation: result.data.explanation,
            model,
            provider: providerName,
            createdAt: new Date().toISOString(),
            metadata: {
              canvasSize: {
                width: dto.canvasWidth || 1920,
                height: dto.canvasHeight || 1080,
              },
              processingTime,
            },
          };
        }
        throw new Error(result.error?.message || 'Failed to generate Paper.js code');
      }

      // 否则使用默认的 ImageGenerationService（Gemini SDK），获取用户自定义 API Key
      const customApiKey = await this.getUserCustomApiKey(req);
      const result = await this.imageGeneration.generatePaperJSCode({
        prompt: dto.prompt,
        model: dto.model,
        thinkingLevel: dto.thinkingLevel,
        canvasWidth: dto.canvasWidth,
        canvasHeight: dto.canvasHeight,
        customApiKey,
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Paper.js code generated successfully in ${processingTime}ms`);

      return {
        code: result.code,
        explanation: result.explanation,
        model: result.model,
        provider: dto.aiProvider || 'gemini',
        createdAt: new Date().toISOString(),
        metadata: {
          canvasSize: {
            width: dto.canvasWidth || 1920,
            height: dto.canvasHeight || 1080,
          },
          processingTime,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`❌ Paper.js code generation failed: ${message}`, error);
      throw error;
    }
  }
}
