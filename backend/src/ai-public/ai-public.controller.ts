import { Body, Controller, Get, Post, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AiPublicService } from './ai-public.service';
import {
  ImageGenerationRequest,
  ImageEditRequest,
  ImageBlendRequest,
  ImageAnalysisRequest,
  TextChatRequest,
} from '../ai/providers/ai-provider.interface';
import { BackgroundRemovalService } from '../ai/services/background-removal.service';
import { RemoveBackgroundDto } from '../ai/dto/background-removal.dto';
import { VeoVideoService } from '../ai/services/veo-video.service';
import { VeoGenerateVideoDto, VeoVideoResponseDto, VeoModelsResponseDto } from '../ai/dto/veo-video.dto';

/**
 * 公开 AI API 控制器
 * 无需认证,供外部调用
 * 其他PC可直接调用这些端点,无需API KEY配置
 */
@ApiTags('public-ai')
@Controller('public/ai')
export class AiPublicController {
  private readonly logger = new Logger(AiPublicController.name);

  constructor(
    private readonly aiPublicService: AiPublicService,
    private readonly backgroundRemoval: BackgroundRemovalService,
    private readonly veoVideoService: VeoVideoService,
  ) {}

  @Post('generate')
  @ApiOperation({
    summary: '生成图像',
    description: '根据文本提示生成新图像。无需身份认证。',
  })
  @ApiResponse({
    status: 200,
    description: '图像生成成功',
    schema: {
      example: {
        success: true,
        data: {
          imageData: 'base64...',
          textResponse: 'Here is a cute cat image for you!',
          hasImage: true,
        },
      },
    },
  })
  async generateImage(@Body() request: ImageGenerationRequest) {
    return this.aiPublicService.generateImage(request);
  }

  @Post('edit')
  @ApiOperation({
    summary: '编辑图像',
    description: '编辑现有图像。无需身份认证。',
  })
  async editImage(@Body() request: ImageEditRequest) {
    return this.aiPublicService.editImage(request);
  }

  @Post('blend')
  @ApiOperation({
    summary: '融合多张图像',
    description: '融合多张图像成一张。无需身份认证。',
  })
  async blendImages(@Body() request: ImageBlendRequest) {
    return this.aiPublicService.blendImages(request);
  }

  @Post('analyze')
  @ApiOperation({
    summary: '分析图像',
    description: '分析图像内容并返回详细描述。无需身份认证。',
  })
  async analyzeImage(@Body() request: ImageAnalysisRequest) {
    return this.aiPublicService.analyzeImage(request);
  }

  @Post('chat')
  @ApiOperation({
    summary: '文本对话',
    description: '与AI进行文本对话。无需身份认证。',
  })
  async chat(@Body() request: TextChatRequest) {
    return this.aiPublicService.chat(request);
  }

  @Get('providers')
  @ApiOperation({
    summary: '获取可用的AI提供商',
    description: '查看当前可用的AI提供商列表及其信息。',
  })
  @ApiResponse({
    status: 200,
    description: '返回可用提供商列表',
    schema: {
      example: [
        {
          name: 'gemini',
          available: true,
          info: {
            name: 'Google Gemini',
            version: '2.5',
            supportedModels: ['gemini-3-pro-image-preview', 'gemini-2.5-flash'],
          },
        },
      ],
    },
  })
  getAvailableProviders() {
    return this.aiPublicService.getAvailableProviders();
  }

  @Post('remove-background')
  @ApiOperation({
    summary: '移除背景',
    description: '从图像中移除背景。无需身份认证。',
  })
  @ApiResponse({
    status: 200,
    description: '背景移除成功',
    schema: {
      example: {
        success: true,
        imageData: 'data:image/png;base64,...',
        format: 'png',
      },
    },
  })
  async removeBackground(@Body() dto: RemoveBackgroundDto) {
    this.logger.log('🎯 [PUBLIC] Background removal request received');
    this.logger.log(`   Image size: ${dto.imageData?.length || 0} bytes`);
    this.logger.log(`   MIME type: ${dto.mimeType}`);
    this.logger.log(`   Source: ${dto.source || 'base64'}`);

    try {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        this.logger.log('   Processing from URL...');
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        this.logger.log('   Processing from file...');
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        // 默认为base64
        this.logger.log('   Processing from base64...');
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('✅ [PUBLIC] Background removal succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('❌ [PUBLIC] Background removal failed:', message);
      this.logger.error('   Error details:', error);
      return {
        success: false,
        error: message,
      };
    }
  }

  @Get('background-removal-info')
  @ApiOperation({
    summary: '获取抠图功能信息',
    description: '获取后台移除功能的详细信息。',
  })
  async getBackgroundRemovalInfo() {
    this.logger.log('📊 [PUBLIC] Background removal info requested');
    try {
      const info = await this.backgroundRemoval.getInfo();
      this.logger.log('✅ Background removal info retrieved:', info);
      return info;
    } catch (error) {
      this.logger.error('❌ Failed to get background removal info:', error);
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        version: '1.0.0',
      };
    }
  }

  @Get('test-background-removal')
  @ApiOperation({
    summary: '测试抠图服务',
    description: '检查抠图服务是否可用。',
  })
  async testBackgroundRemoval() {
    this.logger.log('🧪 [PUBLIC] Testing background removal service...');
    return {
      message: 'Background removal service is accessible',
      timestamp: new Date().toISOString(),
    };
  }

  // ==================== VEO 视频生成 ====================

  @Get('veo/models')
  @ApiOperation({
    summary: '获取 VEO 可用模型',
    description: '获取 VEO 视频生成可用的模型列表。无需身份认证。',
  })
  @ApiResponse({
    status: 200,
    description: '返回可用模型列表',
  })
  async getVeoModels(): Promise<VeoModelsResponseDto[]> {
    this.logger.log('📋 [PUBLIC] VEO models list requested');
    return this.veoVideoService.getAvailableModels();
  }

  @Post('veo/generate')
  @ApiOperation({
    summary: 'VEO 视频生成',
    description: `
      使用 VEO 生成视频。无需身份认证。
      - veo3-fast: 文字快速生成视频
      - veo3-pro: 文字生成高质量视频（不支持垫图）
      - veo3-pro-frames: 图片+文字生成视频（支持垫图）
    `,
  })
  @ApiResponse({
    status: 200,
    description: '视频生成结果',
    schema: {
      example: {
        success: true,
        taskId: 'veo3-pro:xxx',
        videoUrl: 'https://...',
        downloadUrl: 'https://...',
      },
    },
  })
  async generateVeoVideo(@Body() dto: VeoGenerateVideoDto): Promise<VeoVideoResponseDto> {
    this.logger.log(`🎬 [PUBLIC] VEO video generation: model=${dto.model}, prompt=${dto.prompt.substring(0, 50)}...`);

    // 验证：veo3-pro-frames 需要图片
    if (dto.model === 'veo3-pro-frames' && !dto.referenceImageUrl) {
      return {
        success: false,
        error: 'veo3-pro-frames 模式需要提供 referenceImageUrl 参数',
      };
    }

    if (dto.model !== 'veo3-pro-frames' && dto.referenceImageUrl) {
      this.logger.warn(`Model ${dto.model} does not support image input, ignoring referenceImageUrl`);
    }

    const result = await this.veoVideoService.generateVideo({
      prompt: dto.prompt,
      model: dto.model,
      referenceImageUrl: dto.model === 'veo3-pro-frames' ? dto.referenceImageUrl : undefined,
    });

    return result;
  }
}
