import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AiPublicService } from './ai-public.service';
import {
  ImageGenerationRequest,
  ImageEditRequest,
  ImageBlendRequest,
  ImageAnalysisRequest,
  TextChatRequest,
} from '../ai/providers/ai-provider.interface';

/**
 * 公开 AI API 控制器
 * 无需认证,供外部调用
 * 其他PC可直接调用这些端点,无需API KEY配置
 */
@ApiTags('public-ai')
@Controller('public/ai')
export class AiPublicController {
  constructor(private readonly aiPublicService: AiPublicService) {}

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
            supportedModels: ['gemini-2.5-flash-image', 'gemini-2.0-flash'],
          },
        },
      ],
    },
  })
  getAvailableProviders() {
    return this.aiPublicService.getAvailableProviders();
  }
}
