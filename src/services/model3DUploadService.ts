/**
 * 3D模型文件上传服务
 * 支持GLB格式的3D模型处理和上传
 */

export interface Model3DUploadResult {
  success: boolean;
  url?: string;
  error?: string;
  data?: string; // base64 data
  metadata?: {
    fileName: string;
    fileSize: number;
    format: 'glb' | 'gltf';
  };
}

export interface Model3DData {
  path: string;
  format: 'glb' | 'gltf';
  fileName: string;
  fileSize: number;
  defaultScale: { x: number; y: number; z: number };
  defaultRotation: { x: number; y: number; z: number };
  timestamp: number;
}

class Model3DUploadService {
  private readonly supportedFormats = ['.glb', '.gltf'];
  private readonly maxFileSize = 50 * 1024 * 1024; // 50MB

  /**
   * 处理3D模型文件，返回base64数据
   */
  async processModel3DFile(file: File): Promise<Model3DUploadResult> {
    try {
      // 验证文件格式
      if (!this.isValidModel3DType(file)) {
        return {
          success: false,
          error: '不支持的3D模型格式，请选择 GLB 或 GLTF 格式的文件'
        };
      }

      // 验证文件大小
      if (file.size > this.maxFileSize) {
        return {
          success: false,
          error: '3D模型文件过大，请选择小于50MB的文件'
        };
      }

      console.log('🎲 开始处理3D模型文件:', file.name, `(${(file.size / 1024 / 1024).toFixed(2)}MB)`);

      const dataUrl = await this.fileToDataURL(file);
      const format = this.getFileFormat(file.name);

      return {
        success: true,
        data: dataUrl,
        url: dataUrl,
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          format: format
        }
      };
    } catch (error) {
      console.error('❌ 3D模型处理失败:', error);
      return {
        success: false,
        error: '3D模型处理失败，请重试'
      };
    }
  }

  /**
   * 创建3D模型数据对象
   */
  createModel3DData(result: Model3DUploadResult): Model3DData | null {
    if (!result.success || !result.data || !result.metadata) {
      return null;
    }

    return {
      path: result.data,
      format: result.metadata.format,
      fileName: result.metadata.fileName,
      fileSize: result.metadata.fileSize,
      defaultScale: { x: 1, y: 1, z: 1 },
      defaultRotation: { x: 0, y: 0, z: 0 },
      timestamp: Date.now()
    };
  }

  /**
   * 验证3D模型文件类型
   */
  private isValidModel3DType(file: File): boolean {
    const fileName = file.name.toLowerCase();
    return this.supportedFormats.some(format => fileName.endsWith(format));
  }

  /**
   * 获取文件格式
   */
  private getFileFormat(fileName: string): 'glb' | 'gltf' {
    const name = fileName.toLowerCase();
    if (name.endsWith('.glb')) {
      return 'glb';
    } else if (name.endsWith('.gltf')) {
      return 'gltf';
    }
    return 'glb'; // 默认格式
  }

  /**
   * 将文件转换为DataURL
   */
  private fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          resolve(e.target.result as string);
        } else {
          reject(new Error('文件读取失败'));
        }
      };
      reader.onerror = () => {
        reject(new Error('文件读取错误'));
      };
      reader.readAsDataURL(file);
    });
  }


  /**
   * 获取支持的文件格式列表
   */
  getSupportedFormats(): string[] {
    return [...this.supportedFormats];
  }

  /**
   * 获取最大文件大小限制
   */
  getMaxFileSize(): number {
    return this.maxFileSize;
  }

  /**
   * 格式化文件大小显示
   */
  formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

export const model3DUploadService = new Model3DUploadService();