/**
 * 视频生成供应商API调用服务
 * 根据文档实现各供应商的正确API调用格式
 */

export type VideoProvider = 
  | 'kling'
  | 'vidu'
  | 'doubao';

export interface VideoGenerationRequest {
  prompt: string;
  referenceImages?: string[]; // Base64 Data URI 数组
  duration?: number;
  aspectRatio?: string;
  provider: VideoProvider;
  // Vidu 专用参数
  resolution?: '540p' | '720p' | '1080p';
  style?: 'general' | 'anime';
  offPeak?: boolean;
  // 豆包专用参数
  camerafixed?: boolean;
  watermark?: boolean;
}

export interface VideoGenerationResult {
  taskId: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  status: string;
  error?: string;
}

// API Keys (从环境变量或配置中获取)
const API_KEYS = {
  'kling': 'sk-T401EAnQ2NsW7YL_RWuLrU7vcI9LxSU-20xuKnBH657_uk-GRn4tm9cOQiM',
  'vidu': 'sk-T401EAnQ2NsW7YL_RWuLrU7vcI9LxSU-20xuKnBH657_uk-GRn4tm9cOQiM',
  'doubao': '04fe24c5-2a7f-40c4-a1a8-2b1bbf1c3548',
};

/**
 * 可灵 Kling 视频生成
 */
async function generateKling(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const apiKey = API_KEYS['kling'];
  
  const hasImage = request.referenceImages && request.referenceImages.length > 0;
  const endpoint = hasImage 
    ? 'https://models.kapon.cloud/kling/v1/videos/image2video'
    : 'https://models.kapon.cloud/kling/v1/videos/text2video';

  const payload: any = {
    model_name: 'kling-v1-6', // ⚠️ 使用 model_name
    prompt: request.prompt,
    duration: String(request.duration || 5), // ⚠️ 字符串类型
    aspect_ratio: request.aspectRatio || '16:9',
    mode: 'std',
  };

  if (hasImage) {
    // ⚠️ 需要纯Base64（去除 data URI 前缀）
    const imageData = request.referenceImages![0];
    const base64Only = imageData.includes(',') 
      ? imageData.split(',')[1] 
      : imageData.replace(/^data:image\/[^;]+;base64,/, '');
    payload.image = base64Only;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    taskId: data.data?.task_id || data.task_id,
    status: data.data?.task_status || 'submitted',
  };
}

/**
 * Vidu 视频生成
 */
async function generateVidu(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const apiKey = API_KEYS['vidu'];
  
  const hasImage = request.referenceImages && request.referenceImages.length > 0;
  const endpoint = hasImage
    ? 'https://models.kapon.cloud/vidu/ent/v2/img2video'
    : 'https://models.kapon.cloud/vidu/ent/v2/text2video';

  const payload: any = {
    model: 'viduq2',
    prompt: request.prompt,
    duration: request.duration || 4,
    resolution: request.resolution || '720p',
    style: request.style || 'general',
    off_peak: request.off_peak || false,
  };

  if (hasImage) {
    // ⚠️ Vidu 需要 URL 数组，不支持 Base64
    // 这里假设图片已经上传到 OSS，直接使用 URL
    payload.images = request.referenceImages;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    taskId: data.task_id || String(data.id),
    status: data.state || 'created',
  };
}

/**
 * 豆包 Seedance 视频生成
 */
async function generateDoubao(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const apiKey = API_KEYS['doubao'];
  
  // ⚠️ 参数内嵌到 prompt 中
  let promptText = request.prompt;
  const params: string[] = [];
  
  if (request.aspectRatio) {
    params.push(`--ratio ${request.aspectRatio}`);
  }
  if (request.duration) {
    params.push(`--dur ${request.duration}`); // ⚠️ 使用 --dur，不是 --duration
  }
  if (request.camerafixed !== undefined) {
    params.push(`--camerafixed ${request.camerafixed}`);
  }
  if (request.watermark !== undefined) {
    params.push(`--watermark ${request.watermark}`);
  }
  
  if (params.length > 0) {
    promptText = `${promptText} ${params.join(' ')}`;
  }

  const content: any[] = [
    {
      type: 'text',
      text: promptText,
    },
  ];

  if (request.referenceImages && request.referenceImages.length > 0) {
    content.push({
      type: 'image_url',
      image_url: {
        url: request.referenceImages[0], // Base64 Data URI
      },
    });
  }

  const payload = {
    model: 'doubao-seedance-1-5-pro-251215',
    content,
  };

  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    taskId: data.id || data.platform_id,
    status: 'queued',
  };
}

/**
 * 统一的视频生成接口
 */
export async function generateVideoByProvider(
  request: VideoGenerationRequest
): Promise<VideoGenerationResult> {
  switch (request.provider) {
    case 'kling':
      return generateKling(request);
    case 'vidu':
      return generateVidu(request);
    case 'doubao':
      return generateDoubao(request);
    default:
      throw new Error(`不支持的供应商: ${request.provider}`);
  }
}

/**
 * 查询任务状态（各供应商）
 */
export async function queryVideoTask(
  provider: VideoProvider,
  taskId: string
): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string }> {
  const apiKey = API_KEYS[provider];

  switch (provider) {
    case 'kling': {
      // 需要判断是文生还是图生，这里简化处理
      const response = await fetch(
        `https://models.kapon.cloud/kling/v1/videos/text2video/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );
      const data = await response.json();
      if (data.data?.task_status === 'succeed') {
        return {
          status: 'succeeded',
          videoUrl: data.data.task_result?.videos?.[0]?.url,
        };
      }
      return { status: data.data?.task_status || 'processing' };
    }

    case 'vidu': {
      const response = await fetch(
        `https://models.kapon.cloud/vidu/ent/v2/tasks/${taskId}/creations`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );
      const data = await response.json();
      if (data.state === 'success') {
        return {
          status: 'succeeded',
          videoUrl: data.creations?.[0]?.url,
        };
      }
      return { status: data.state || 'processing' };
    }

    case 'doubao': {
      const response = await fetch(
        `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );
      const data = await response.json();
      if (data.status === 'succeeded') {
        return {
          status: 'succeeded',
          videoUrl: data.content?.video_url,
        };
      }
      return { status: data.status || 'queued' };
    }

    default:
      throw new Error(`不支持的供应商: ${provider}`);
  }
}
