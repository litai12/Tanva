import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';

/**
 * 后端背景移除服务
 * 优先使用 remove.bg API（如果配置了 API Key），否则使用本地 ONNX
 * 输出透明PNG格式
 */
@Injectable()
export class BackgroundRemovalService {
  private readonly logger = new Logger(BackgroundRemovalService.name);
  private removalModule: any = null;
  private localModuleAvailable: boolean | null = null; // null = 未测试, true = 可用, false = 不可用
  private readonly isWindows = process.platform === 'win32';

  constructor(private readonly configService: ConfigService) {
    // Windows 上 @imgly/background-removal-node 的 ONNX Runtime 有 GLib 兼容性问题
    // 会导致进程崩溃，所以在 Windows 上默认禁用本地模块
    if (this.isWindows) {
      this.localModuleAvailable = false;
      this.logger.warn(
        '⚠️ Local background removal disabled on Windows due to ONNX Runtime compatibility issues. ' +
        'Please configure REMOVE_BG_API_KEY for background removal functionality.'
      );
    }
  }

  /**
   * 使用 remove.bg API 移除背景
   * @param imageBuffer 图像 Buffer
   * @returns 透明PNG的base64数据
   */
  private async removeBackgroundViaRemoveBg(imageBuffer: Buffer): Promise<string> {
    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      throw new Error('REMOVE_BG_API_KEY not configured');
    }

    this.logger.log('🌐 Using remove.bg API for background removal...');

    const formData = new FormData();
    formData.append('image_file', new Blob([imageBuffer]), 'image.png');
    formData.append('size', 'auto');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`remove.bg API error: HTTP ${response.status} ${errorText}`);
    }

    const resultBuffer = Buffer.from(await response.arrayBuffer());
    const resultBase64 = resultBuffer.toString('base64');

    this.logger.log(`✅ remove.bg API completed. Output: ${(resultBuffer.length / 1024).toFixed(2)}KB`);

    return `data:image/png;base64,${resultBase64}`;
  }

  /**
   * 延迟加载本地背景移除模块
   * @imgly/background-removal-node 模块较大,只在需要时加载
   */
  private async getRemovalModule() {
    if (this.removalModule) {
      return this.removalModule;
    }

    // 如果已知本地模块不可用，直接抛出错误
    if (this.localModuleAvailable === false) {
      if (this.isWindows) {
        throw new Error(
          'Local background removal is disabled on Windows due to ONNX Runtime compatibility issues. ' +
          'Please configure REMOVE_BG_API_KEY environment variable to use the remove.bg cloud service.'
        );
      }
      throw new Error('Local background removal module is not available on this system');
    }

    try {
      this.logger.log('📦 Loading @imgly/background-removal-node module...');
      // 动态导入以支持可选依赖
      const mod = await import('@imgly/background-removal-node');
      this.removalModule = mod;
      this.localModuleAvailable = true;
      this.logger.log('✅ @imgly/background-removal-node loaded successfully');
      return mod;
    } catch (error) {
      this.localModuleAvailable = false;
      this.logger.error('❌ Failed to load @imgly/background-removal-node', error);
      throw new Error(
        'Background removal module is not available. Please ensure @imgly/background-removal-node is installed.'
      );
    }
  }

  /**
   * 使用本地 ONNX 模块移除背景
   */
  private async removeBackgroundLocal(imageBuffer: Buffer, mimeType: string): Promise<string> {
    // 将Buffer转换为Blob并指定正确的MIME type
    const blob = new Blob([imageBuffer], { type: mimeType || 'image/png' });

    // 调用背景移除函数
    const mod = await this.getRemovalModule();

    // 添加超时保护，防止 ONNX 处理卡死
    const timeoutMs = 120000; // 2分钟超时
    const resultPromise = mod.removeBackground(blob, {
      output: {
        format: 'image/png',
        quality: 0.8,
      },
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Background removal timed out')), timeoutMs);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]) as Blob;

    // 结果是Blob，转换为Buffer
    const arrayBuffer = await result.arrayBuffer();
    const resultBuffer = Buffer.from(arrayBuffer);

    // 转换为base64
    const resultBase64 = resultBuffer.toString('base64');

    this.logger.log(
      `✅ Local background removal completed. Output: ${(resultBuffer.length / 1024).toFixed(2)}KB`
    );

    // 返回带data URI前缀的base64 (PNG格式)
    return `data:image/png;base64,${resultBase64}`;
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

    this.logger.log(`📊 Input image: ${(buffer.length / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

    // 优先使用 remove.bg API（如果配置了）
    const hasRemoveBgKey = !!process.env.REMOVE_BG_API_KEY;

    if (hasRemoveBgKey) {
      try {
        return await this.removeBackgroundViaRemoveBg(buffer);
      } catch (error) {
        this.logger.warn('⚠️ remove.bg API failed, trying local module...', error);
      }
    }

    // 尝试本地模块
    try {
      return await this.removeBackgroundLocal(buffer, mimeType);
    } catch (localError) {
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      this.logger.error('❌ Local background removal failed:', localMessage);

      // 如果本地也失败了，给出明确的错误信息
      if (hasRemoveBgKey) {
        throw new BadRequestException(
          `Background removal failed. Both remove.bg API and local module failed.`
        );
      } else {
        throw new BadRequestException(
          `Background removal failed: ${localMessage}. Consider configuring REMOVE_BG_API_KEY for better reliability.`
        );
      }
    }
  }

  /**
   * 从URL移除背景
   * @param imageUrl 图像URL
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromUrl(imageUrl: string): Promise<string> {
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
    const buffer = Buffer.from(arrayBuffer);

    this.logger.log(`📊 Fetched image: ${(buffer.length / 1024).toFixed(2)}KB, MIME type: ${mimeType}`);

    // 优先使用 remove.bg API（如果配置了）
    const hasRemoveBgKey = !!process.env.REMOVE_BG_API_KEY;

    if (hasRemoveBgKey) {
      try {
        return await this.removeBackgroundViaRemoveBg(buffer);
      } catch (error) {
        this.logger.warn('⚠️ remove.bg API failed, trying local module...', error);
      }
    }

    // 尝试本地模块
    try {
      return await this.removeBackgroundLocal(buffer, mimeType);
    } catch (localError) {
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      this.logger.error('❌ Local background removal from URL failed:', localMessage);

      if (hasRemoveBgKey) {
        throw new BadRequestException(
          `Background removal failed. Both remove.bg API and local module failed.`
        );
      } else {
        throw new BadRequestException(
          `Background removal failed: ${localMessage}. Consider configuring REMOVE_BG_API_KEY for better reliability.`
        );
      }
    }
  }

  /**
   * 从本地文件移除背景
   * @param filePath 本地文件路径
   * @returns 透明PNG的base64数据
   */
  async removeBackgroundFromFile(filePath: string): Promise<string> {
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

    // 优先使用 remove.bg API（如果配置了）
    const hasRemoveBgKey = !!process.env.REMOVE_BG_API_KEY;

    if (hasRemoveBgKey) {
      try {
        return await this.removeBackgroundViaRemoveBg(fileBuffer);
      } catch (error) {
        this.logger.warn('⚠️ remove.bg API failed, trying local module...', error);
      }
    }

    // 尝试本地模块
    try {
      return await this.removeBackgroundLocal(fileBuffer, mimeType);
    } catch (localError) {
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      this.logger.error('❌ Local background removal from file failed:', localMessage);

      if (hasRemoveBgKey) {
        throw new BadRequestException(
          `Background removal failed. Both remove.bg API and local module failed.`
        );
      } else {
        throw new BadRequestException(
          `Background removal failed: ${localMessage}. Consider configuring REMOVE_BG_API_KEY for better reliability.`
        );
      }
    }
  }

  /**
   * 检查服务是否可用
   * @returns 是否可用
   */
  async isAvailable(): Promise<boolean> {
    // 如果配置了 remove.bg API Key，服务就是可用的
    if (process.env.REMOVE_BG_API_KEY) {
      return true;
    }

    // 否则检查本地模块
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
    provider?: string;
  }> {
    const hasRemoveBgKey = !!process.env.REMOVE_BG_API_KEY;

    // 如果有 remove.bg API Key，优先报告该服务
    if (hasRemoveBgKey) {
      return {
        available: true,
        version: 'remove.bg API',
        provider: 'remove.bg',
        features: [
          'Remove background with transparency',
          'Support PNG, JPEG, GIF, WebP',
          'High quality AI-powered removal',
          'Cloud-based processing',
        ],
      };
    }

    // 检查本地模块
    try {
      const mod = await this.getRemovalModule();
      return {
        available: true,
        version: mod.version || 'unknown',
        provider: 'local-onnx',
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
        provider: 'none',
        features: [],
      };
    }
  }
}
