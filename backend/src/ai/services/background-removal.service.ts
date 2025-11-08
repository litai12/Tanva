import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';

/**
 * 后端背景移除服务
 * 使用 @imgly/background-removal-node 库实现高质量的背景移除
 * 输出透明PNG格式
 */
@Injectable()
export class BackgroundRemovalService {
  private readonly logger = new Logger(BackgroundRemovalService.name);
  private removalModule: any = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * 延迟加载背景移除模块
   * @imgly/background-removal-node 模块较大,只在需要时加载
   */
  private async getRemovalModule() {
    if (this.removalModule) {
      return this.removalModule;
    }

    try {
      this.logger.log('📦 Loading @imgly/background-removal-node module...');
      // 动态导入以支持可选依赖
      const mod = await import('@imgly/background-removal-node');
      this.removalModule = mod;
      this.logger.log('✅ @imgly/background-removal-node loaded successfully');
      return mod;
    } catch (error) {
      this.logger.error('❌ Failed to load @imgly/background-removal-node', error);
      throw new BadRequestException(
        'Background removal service is not available. Please ensure @imgly/background-removal-node is installed.'
      );
    }
  }

  /**
   * 从base64数据移除背景
   * @param imageData base64编码的图像数据
   * @param mimeType 图像MIME类型 (image/png, image/jpeg等)
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromBase64(
    imageData: string,
    mimeType: string = 'image/png'
  ): Promise<string> {
    try {
      this.logger.log('🎯 Starting background removal from base64 data');

      // 验证输入
      if (!imageData || typeof imageData !== 'string') {
        throw new BadRequestException('Invalid image data provided');
      }

      // 移除data URI前缀(如果存在)
      const base64Data = imageData.includes(',')
        ? imageData.split(',')[1]
        : imageData;

      // 转换为Buffer
      const buffer = Buffer.from(base64Data, 'base64');

      // 将Buffer转换为Blob并指定正确的MIME type，以帮助库自动检测格式
      const blob = new Blob([buffer], { type: mimeType || 'image/png' });

      this.logger.log(`📊 Input image: ${(buffer.length / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

      // 调用背景移除函数
      const mod = await this.getRemovalModule();
      const result = await mod.removeBackground(blob, {
        output: {
          format: 'image/png',
          quality: 0.8,
        },
      });

      // 结果是Blob，转换为Buffer
      const arrayBuffer = await result.arrayBuffer();
      const resultBuffer = Buffer.from(arrayBuffer);

      // 转换为base64
      const resultBase64 = resultBuffer.toString('base64');

      this.logger.log(
        `✅ Background removal completed. Output: ${(resultBuffer.length / 1024).toFixed(2)}KB`
      );

      // 返回带data URI前缀的base64 (PNG格式)
      return `data:image/png;base64,${resultBase64}`;
    } catch (error) {
      this.logger.error('❌ Background removal failed:', error);
      throw new BadRequestException(
        `Background removal failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 从URL移除背景
   * @param imageUrl 图像URL
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromUrl(imageUrl: string): Promise<string> {
    try {
      this.logger.log(`🌐 Fetching image from URL: ${imageUrl}`);

      // 验证URL
      const url = new URL(imageUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new BadRequestException('Invalid URL protocol');
      }

      // 获取图像
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new BadRequestException(`Failed to fetch image: HTTP ${response.status}`);
      }

      const mimeType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();

      this.logger.log(`📊 Fetched image: ${(arrayBuffer.byteLength / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

      // 创建Blob以保留MIME type信息
      const blob = new Blob([arrayBuffer], { type: mimeType });

      // 调用背景移除函数
      const mod = await this.getRemovalModule();
      const result = await mod.removeBackground(blob, {
        output: {
          format: 'image/png',
          quality: 0.8,
        },
      });

      const resultArrayBuffer = await result.arrayBuffer();
      const resultBuffer = Buffer.from(resultArrayBuffer);
      const resultBase64 = resultBuffer.toString('base64');

      this.logger.log(`✅ Background removal from URL completed. Output: ${(resultBuffer.length / 1024).toFixed(2)}KB`);

      return `data:image/png;base64,${resultBase64}`;
    } catch (error) {
      this.logger.error('❌ Background removal from URL failed:', error);
      throw new BadRequestException(
        `Background removal failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 从本地文件移除背景
   * @param filePath 本地文件路径
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromFile(filePath: string): Promise<string> {
    try {
      this.logger.log(`📁 Reading image from file: ${filePath}`);

      // 验证文件存在
      if (!fs.existsSync(filePath)) {
        throw new BadRequestException(`File not found: ${filePath}`);
      }

      // 读取文件
      const fileBuffer = fs.readFileSync(filePath);

      // 确定MIME类型
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const mimeType = mimeTypeMap[ext] || 'image/png';

      this.logger.log(`📊 File size: ${(fileBuffer.length / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

      // 创建Blob以保留MIME type信息
      const blob = new Blob([fileBuffer], { type: mimeType });

      // 调用背景移除函数
      const mod = await this.getRemovalModule();
      const result = await mod.removeBackground(blob, {
        output: {
          format: 'image/png',
          quality: 0.8,
        },
      });

      const arrayBuffer = await result.arrayBuffer();
      const resultBuffer = Buffer.from(arrayBuffer);
      const resultBase64 = resultBuffer.toString('base64');

      this.logger.log(`✅ Background removal from file completed. Output: ${(resultBuffer.length / 1024).toFixed(2)}KB`);

      return `data:image/png;base64,${resultBase64}`;
    } catch (error) {
      this.logger.error('❌ Background removal from file failed:', error);
      throw new BadRequestException(
        `Background removal failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 检查服务是否可用
   * @returns 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getRemovalModule();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取模块信息
   * @returns 模块版本和特性信息
   */
  async getInfo(): Promise<{
    available: boolean;
    version?: string;
    features: string[];
  }> {
    try {
      const mod = await this.getRemovalModule();
      return {
        available: true,
        version: mod.version || 'unknown',
        features: [
          'Remove background with transparency',
          'Support PNG, JPEG, GIF, WebP',
          'Preview mode available',
          'ONNX model powered',
        ],
      };
    } catch {
      return {
        available: false,
        features: [],
      };
    }
  }
}
