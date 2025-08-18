/**
 * 图片上传服务
 * 提供基础的图片处理和上传功能
 */

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
  data?: string; // base64 data
}

export interface ImageProcessOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.0-1.0
}

class ImageUploadService {
  private readonly defaultOptions: ImageProcessOptions = {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.8,
  };

  /**
   * 处理图片文件，返回base64数据
   */
  async processImageFile(file: File, options?: ImageProcessOptions): Promise<UploadResult> {
    try {
      // 验证文件类型
      if (!this.isValidImageType(file)) {
        return {
          success: false,
          error: '不支持的图片格式，请选择 PNG、JPG、JPEG、GIF、WebP 格式的图片'
        };
      }

      // 验证文件大小（默认最大10MB）
      if (file.size > 10 * 1024 * 1024) {
        return {
          success: false,
          error: '图片文件过大，请选择小于10MB的图片'
        };
      }

      const processOptions = { ...this.defaultOptions, ...options };
      const processedDataUrl = await this.processImage(file, processOptions);

      return {
        success: true,
        data: processedDataUrl,
        url: processedDataUrl
      };
    } catch (error) {
      console.error('图片处理失败:', error);
      return {
        success: false,
        error: '图片处理失败，请重试'
      };
    }
  }

  /**
   * 验证图片文件类型
   */
  private isValidImageType(file: File): boolean {
    const validTypes = [
      'image/png',
      'image/jpeg', 
      'image/jpg',
      'image/gif',
      'image/webp'
    ];
    return validTypes.includes(file.type.toLowerCase());
  }

  /**
   * 处理图片：压缩、调整大小
   */
  private async processImage(file: File, options: ImageProcessOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('无法创建Canvas上下文'));
        return;
      }

      img.onload = () => {
        const { width, height } = this.calculateDimensions(
          img.width, 
          img.height,
          options.maxWidth!,
          options.maxHeight!
        );

        canvas.width = width;
        canvas.height = height;

        // 绘制图片到canvas
        ctx.drawImage(img, 0, 0, width, height);

        // 转换为base64
        const dataUrl = canvas.toDataURL('image/jpeg', options.quality);
        resolve(dataUrl);
      };

      img.onerror = () => {
        reject(new Error('图片加载失败'));
      };

      // 加载图片
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * 计算缩放后的尺寸，保持宽高比
   */
  private calculateDimensions(
    originalWidth: number,
    originalHeight: number, 
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    // 如果原始尺寸都小于最大值，不需要缩放
    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }

    // 计算缩放比例
    const widthRatio = maxWidth / originalWidth;
    const heightRatio = maxHeight / originalHeight;
    const ratio = Math.min(widthRatio, heightRatio);

    return {
      width: Math.round(originalWidth * ratio),
      height: Math.round(originalHeight * ratio)
    };
  }

  /**
   * 从URL创建图片对象（用于预加载）
   */
  async createImageFromUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.crossOrigin = 'anonymous'; // 处理跨域图片
      img.src = url;
    });
  }
}

export const imageUploadService = new ImageUploadService();