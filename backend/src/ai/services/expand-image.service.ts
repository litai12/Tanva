import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ComfyUIResponse {
  detail?: string;
  prompt_id?: string;
  images?: Array<{
    filename: string;
  }>;
}

@Injectable()
export class ExpandImageService {
  private readonly logger = new Logger(ExpandImageService.name);
  private readonly COMFYUI_API_URL: string;

  constructor(private readonly config: ConfigService) {
    this.COMFYUI_API_URL =
      this.config.get<string>('COMFYUI_API_URL') || 'http://100.65.126.121:7865/api/comfy/run';
  }

  /**
   * 调用ComfyUI API进行扩图
   * @param imageUrl 图片URL
   * @param expandRatios 扩图比例 {left, top, right, bottom}
   * @param prompt 提示词
   * @returns 扩图后的图片URL
   */
  async expandImage(
    imageUrl: string,
    expandRatios: { left: number; top: number; right: number; bottom: number },
    prompt: string = '扩图'
  ): Promise<{ imageUrl: string; promptId?: string }> {
    try {
      if (!imageUrl || typeof imageUrl !== 'string') {
        throw new ServiceUnavailableException('Invalid image URL provided');
      }

      const requestBody = {
        workflow: 'optimize_Expand_image-text',
        params: {
          '54.text': prompt,
          '68.value': expandRatios.left,
          '69.value': expandRatios.top,
          '70.value': expandRatios.right,
          '71.value': expandRatios.bottom,
          '72.image_url': imageUrl,
          '73.filename_prefix': 'optimize_Expand_image-text',
        },
      };

      // 添加超时控制（20分钟，满足最长等待需求）
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

        if (errorText.includes('DeepTranslatorTextNode')) {
          throw new ServiceUnavailableException(
            'ComfyUI workflow依赖 DeepTranslatorTextNode (#55)，但该节点在当前实例中不存在。请在ComfyUI服务器中安装相关插件或提供不需要翻译节点的workflow。'
          );
        }

        throw new ServiceUnavailableException(
          `ComfyUI API request failed: ${response.status} ${response.statusText}`
        );
      }

      // 确保完整读取响应体
      const responseText = await response.text();
      if (!responseText || responseText.trim().length === 0) {
        throw new ServiceUnavailableException('Empty response from ComfyUI API');
      }

      let data: ComfyUIResponse;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        this.logger.error(`Failed to parse ComfyUI response: ${responseText}`);
        throw new ServiceUnavailableException('Invalid JSON response from ComfyUI API');
      }

      if (!data.images || data.images.length === 0) {
        this.logger.error(`No images in response: ${JSON.stringify(data)}`);
        throw new ServiceUnavailableException('No images returned from ComfyUI API');
      }

      const image = data.images[0];
      if (!image.filename) {
        this.logger.error(`Image filename missing: ${JSON.stringify(image)}`);
        throw new ServiceUnavailableException('Image filename is missing in response');
      }

      const fileName = image.filename;
      const imageUrl_result = `https://output.tgtai.com/view/${fileName}`;

      return {
        imageUrl: imageUrl_result,
        promptId: data.prompt_id,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Expand image failed: ${message}`, error);
      throw new ServiceUnavailableException(`Expand image failed: ${message}`);
    }
  }
}

