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
  BadRequestException,
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
import { CreditsService } from '../credits/credits.service';
import { ServiceType } from '../credits/credits.config';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { GenerateVideoDto } from './dto/video-generation.dto';
import { Sora2VideoService } from './services/sora2-video.service';

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
    private readonly creditsService: CreditsService,
    private readonly sora2VideoService: Sora2VideoService,
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

  /**
   * 获取用户ID（从JWT或API Key认证）
   * API Key 认证不扣积分
   */
  private getUserId(req: any): string | null {
    // API Key 认证不扣积分
    if (req.apiClient) {
      return null;
    }
    return req.user?.sub || req.user?.id || null;
  }

  /**
   * 确定图像生成服务类型
   */
  private getImageGenerationServiceType(model?: string, provider?: string): ServiceType {
    // 根据 provider 和 model 确定服务类型
    if (provider === 'midjourney') {
      return 'midjourney-imagine';
    }

    // Gemini 模型
    if (model?.includes('gemini-3') || model?.includes('imagen-3')) {
      return 'gemini-3-pro-image';
    }

    return 'gemini-2.5-image';
  }

  /**
   * 预扣积分并执行操作
   * @param skipCredits 如果为 true，则跳过积分扣除（例如使用自定义 API Key 时）
   */
  private async withCredits<T>(
    req: any,
    serviceType: ServiceType,
    model: string | undefined,
    operation: () => Promise<T>,
    inputImageCount?: number,
    outputImageCount?: number,
    skipCredits?: boolean,
  ): Promise<T> {
    const userId = this.getUserId(req);

    // 如果没有用户ID（API Key认证）或明确跳过积分，直接执行操作
    if (!userId) {
      this.logger.debug('API Key authentication - skipping credits deduction');
      return operation();
    }

    if (skipCredits) {
      this.logger.debug('Using custom API key - skipping credits deduction');
      return operation();
    }

    // 确保用户有积分账户
    await this.creditsService.getOrCreateAccount(userId);

    const startTime = Date.now();
    let apiUsageId: string | null = null;

    try {
      // 预扣积分
      const deductResult = await this.creditsService.preDeductCredits({
        userId,
        serviceType,
        model,
        inputImageCount,
        outputImageCount,
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
      });

      apiUsageId = deductResult.apiUsageId;
      this.logger.debug(`Credits pre-deducted: ${serviceType}, apiUsageId: ${apiUsageId}`);

      // 执行实际操作
      const result = await operation();

      // 更新状态为成功
      const processingTime = Date.now() - startTime;
      await this.creditsService.updateApiUsageStatus(
        apiUsageId,
        ApiResponseStatus.SUCCESS,
        undefined,
        processingTime,
      );

      return result;
    } catch (error) {
      // 更新状态为失败并退还积分
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (apiUsageId) {
        await this.creditsService.updateApiUsageStatus(
          apiUsageId,
          ApiResponseStatus.FAILED,
          errorMessage,
          processingTime,
        );

        // 退还积分
        try {
          await this.creditsService.refundCredits(userId, apiUsageId);
          this.logger.debug(`Credits refunded for failed operation: ${apiUsageId}`);
        } catch (refundError) {
          this.logger.error('Failed to refund credits:', refundError);
        }
      }

      throw error;
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
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);
    const serviceType = this.getImageGenerationServiceType(model, providerName || undefined);

    // 检查是否使用自定义 API Key（仅对默认 Gemini 服务有效）
    const customApiKey = !providerName ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, serviceType, model, async () => {
      if (providerName) {
        const provider = this.factory.getProvider(dto.model, providerName);
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
      return this.imageGeneration.generateImage({ ...dto, customApiKey });
    }, 0, 1, skipCredits);
  }

  @Post('edit-image')
  async editImage(@Body() dto: EditImageDto, @Req() req: any): Promise<ImageGenerationResult> {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（仅对默认 Gemini 服务有效）
    const customApiKey = !providerName ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-image-edit', model, async () => {
      if (providerName) {
        const provider = this.factory.getProvider(dto.model, providerName);
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

      return this.imageGeneration.editImage({ ...dto, customApiKey });
    }, 1, 1, skipCredits);
  }

  @Post('blend-images')
  async blendImages(@Body() dto: BlendImagesDto, @Req() req: any): Promise<ImageGenerationResult> {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（仅对默认 Gemini 服务有效）
    const customApiKey = !providerName ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-image-blend', model, async () => {
      if (providerName) {
        const provider = this.factory.getProvider(dto.model, providerName);
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

      return this.imageGeneration.blendImages({ ...dto, customApiKey });
    }, dto.sourceImages?.length || 0, 1, skipCredits);
  }

  @Post('midjourney/action')
  async midjourneyAction(@Body() dto: MidjourneyActionDto, @Req() req: any): Promise<ImageGenerationResult> {
    return this.withCredits(req, 'midjourney-variation', 'midjourney-fast', async () => {
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
    });
  }

  @Post('midjourney/modal')
  async midjourneyModal(@Body() dto: MidjourneyModalDto, @Req() req: any): Promise<ImageGenerationResult> {
    return this.withCredits(req, 'midjourney-variation', 'midjourney-fast', async () => {
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
    });
  }

  @Post('analyze-image')
  async analyzeImage(@Body() dto: AnalyzeImageDto, @Req() req: any) {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（仅对默认 Gemini 服务有效）
    const customApiKey = !providerName ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-image-analyze', model, async () => {
      if (providerName) {
        const provider = this.factory.getProvider(dto.model, providerName);
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

      return this.imageGeneration.analyzeImage({ ...dto, customApiKey });
    }, 1, 0, skipCredits);
  }

  @Post('text-chat')
  async textChat(@Body() dto: TextChatDto, @Req() req: any) {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（仅对默认 Gemini 服务有效）
    const customApiKey = !providerName ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-text', model, async () => {
      if (providerName) {
        const provider = this.factory.getProvider(dto.model, providerName);
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

      return this.imageGeneration.generateTextResponse({ ...dto, customApiKey });
    }, undefined, undefined, skipCredits);
  }

  @Post('remove-background')
  async removeBackground(@Body() dto: RemoveBackgroundDto, @Req() req: any) {
    this.logger.log('🎯 Background removal request received');

    return this.withCredits(req, 'background-removal', undefined, async () => {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
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
    }, 1, 1);
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
  async convert2Dto3D(@Body() dto: Convert2Dto3DDto, @Req() req: any) {
    this.logger.log('🎨 2D to 3D conversion request received');

    return this.withCredits(req, 'convert-2d-to-3d', undefined, async () => {
      const result = await this.convert2Dto3DService.convert2Dto3D(dto.imageUrl);

      return {
        success: true,
        modelUrl: result.modelUrl,
        promptId: result.promptId,
      };
    }, 1, 1);
  }

  @Post('expand-image')
  async expandImage(@Body() dto: ExpandImageDto, @Req() req: any) {
    this.logger.log('🖼️ Expand image request received');

    return this.withCredits(req, 'expand-image', undefined, async () => {
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
    }, 1, 1);
  }

  @Post('generate-video')
  async generateVideo(@Body() dto: GenerateVideoDto, @Req() req: any) {
    const quality = dto.quality === 'sd' ? 'sd' : 'hd';
    const serviceType: ServiceType = quality === 'sd' ? 'sora-sd' : 'sora-hd';
    const model = this.sora2VideoService.getModelForQuality(quality);
    const inputImageCount = dto.referenceImageUrl ? 1 : undefined;

    this.logger.log(
      `🎬 Video generation request received (quality=${quality}, hasReference=${Boolean(dto.referenceImageUrl)})`,
    );

    return this.withCredits(
      req,
      serviceType,
      model,
      async () =>
        this.sora2VideoService.generateVideo({
          prompt: dto.prompt,
          referenceImageUrl: dto.referenceImageUrl,
          quality,
        }),
      inputImageCount,
      0,
    );
  }

  /**
   * 生成 Paper.js 代码
   */
  @Post('generate-paperjs')
  async generatePaperJS(@Body() dto: PaperJSGenerateRequestDto, @Req() req: any): Promise<PaperJSGenerateResponseDto> {
    this.logger.log(`📐 Paper.js code generation request: ${dto.prompt.substring(0, 50)}...`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（仅对默认 Gemini 服务有效）
    const customApiKey = !providerName ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-paperjs', model, async () => {
      const startTime = Date.now();

      if (providerName) {
        const provider = this.factory.getProvider(dto.model, providerName);

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

      // 使用默认的 ImageGenerationService（Gemini SDK）
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
    }, undefined, undefined, skipCredits);
  }
}
