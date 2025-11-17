import { logger } from '@/utils/logger';

const COMFY_API_URL =
  import.meta.env.VITE_COMFYUI_API_URL || 'http://100.65.126.121:7865/api/comfy/run';
const COMFY_OUTPUT_BASE_URL =
  import.meta.env.VITE_COMFYUI_OUTPUT_BASE_URL || 'https://output.tgtai.com/view/';

type HdResolution = '2k' | '4k';

const MODEL_NAME_MAP: Record<HdResolution, string> = {
  '2k': 'RealESRGAN_x2plus.pth',
  '4k': 'RealESRGAN_x4plus.pth',
};

export interface OptimizeHdImageParams {
  imageUrl: string;
  resolution?: HdResolution;
  filenamePrefix?: string;
}

export interface OptimizeHdImageResult {
  success: boolean;
  imageUrl?: string;
  promptId?: string;
  error?: string;
}

interface ComfyUiResponse {
  prompt_id?: string;
  images?: Array<{ filename?: string }>;
  filename?: string;
  file?: string;
  result?: string;
  detail?: string;
}

function resolveFilename(data: ComfyUiResponse): string | null {
  if (data.images?.length) {
    const fromImages = data.images.map((img) => img.filename).find(Boolean);
    if (fromImages) return fromImages;
  }

  return data.filename || data.file || data.result || null;
}

export async function optimizeHdImage({
  imageUrl,
  resolution = '4k',
  filenamePrefix = 'optimize_HD_image',
}: OptimizeHdImageParams): Promise<OptimizeHdImageResult> {
  if (!imageUrl) {
    return { success: false, error: '缺少图片URL' };
  }

  const modelName = MODEL_NAME_MAP[resolution];

  const requestBody = {
    workflow: 'optimize_HD_image',
    params: {
      '2.model_name': modelName,
      '7.image_url': imageUrl,
      '8.filename_prefix': filenamePrefix,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000); // 15分钟

  try {
    const response = await fetch(COMFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('高清放大请求失败', { status: response.status, error: errorText });
      return {
        success: false,
        error: `高清放大失败（HTTP ${response.status}）`,
      };
    }

    const text = await response.text();
    if (!text) {
      return { success: false, error: '服务未返回结果' };
    }

    const data: ComfyUiResponse = JSON.parse(text);
    const filename = resolveFilename(data);

    if (!filename) {
      logger.error('高清放大返回缺少文件名', { data });
      return { success: false, error: '未获取到生成图片文件名' };
    }

    return {
      success: true,
      promptId: data.prompt_id,
      imageUrl: `${COMFY_OUTPUT_BASE_URL}${filename}`,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    const message = isAbort ? '请求超时，请稍后重试' : (error as Error)?.message || '高清放大失败';
    logger.error('调用高清放大接口异常', error);
    return {
      success: false,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}


