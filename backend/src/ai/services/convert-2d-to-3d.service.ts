import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ComfyUIResponse {
  detail?: string;
  prompt_id?: string;
  models?: Array<{
    filename: string;
  }>;
}

@Injectable()
export class Convert2Dto3DService {
  private readonly logger = new Logger(Convert2Dto3DService.name);
  private readonly COMFYUI_API_URL: string;

  constructor(private readonly config: ConfigService) {
    // 从环境变量获取ComfyUI API地址，默认使用提供的地址
    this.COMFYUI_API_URL =
      this.config.get<string>('COMFYUI_API_URL') || 'http://100.65.126.121:7865/api/comfy/run';
  }

  /**
   * 调用ComfyUI API进行2D转3D
   * @param imageUrl OSS原生可访问的图片URL
   * @returns 3D模型文件的访问URL
   */
  async convert2Dto3D(imageUrl: string): Promise<{ modelUrl: string; promptId?: string }> {
    try {
      if (!imageUrl || typeof imageUrl !== 'string') {
        throw new ServiceUnavailableException('Invalid image URL provided');
      }

      const requestBody = {
        workflow: '3D_Hunyuan',
        params: {
          '23.image_url': imageUrl,
          '8.filename_prefix': '3D_Hunyuan',
        },
      };

      const timeoutMs = 20 * 60 * 1000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(this.COMFYUI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new ServiceUnavailableException('ComfyUI API request timeout');
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`ComfyUI API error: ${response.status} ${response.statusText} - ${errorText}`);
        throw new ServiceUnavailableException(
          `ComfyUI API request failed: ${response.status} ${response.statusText}`
        );
      }

      const data: ComfyUIResponse = await response.json();

      if (data.detail && !data.models) {
        this.logger.warn(`ComfyUI returned detail but no models: ${data.detail}`);
      }

      if ((!data.models || data.models.length === 0) && data.prompt_id) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        throw new ServiceUnavailableException(
          `Task submitted with prompt_id: ${data.prompt_id}, but no models returned yet. The task may still be processing.`
        );
      }

      if (!data.models || data.models.length === 0) {
        this.logger.error(`No models in response: ${JSON.stringify(data)}`);
        throw new ServiceUnavailableException('No models returned from ComfyUI API');
      }

      const model = data.models[0];
      if (!model.filename) {
        this.logger.error(`Model filename missing: ${JSON.stringify(model)}`);
        throw new ServiceUnavailableException('Model filename is missing in response');
      }

      const fileName = this.extractFileName(model.filename);
      if (!fileName) {
        throw new ServiceUnavailableException(`Failed to extract filename from path: ${model.filename}`);
      }

      if (!fileName.includes('3D_Hunyuan')) {
        this.logger.warn(`Filename does not contain expected prefix: ${fileName}`);
      }

      const modelUrl = `https://output.tgtai.com/view/${fileName}`;

      return {
        modelUrl,
        promptId: data.prompt_id,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`2D to 3D conversion failed: ${message}`, error);
      throw new ServiceUnavailableException(`2D to 3D conversion failed: ${message}`);
    }
  }

  private extractFileName(fullPath: string): string | null {
    if (!fullPath) {
      return null;
    }

    const outputIndex = fullPath.indexOf('output/');
    if (outputIndex !== -1) {
      return fullPath.substring(outputIndex + 7).trim();
    }

    const parts = fullPath.split('/');
    return parts[parts.length - 1].trim() || null;
  }
}

