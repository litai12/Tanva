/**
 * 视频生成供应商API调用服务
 * 根据文档实现各供应商的正确API调用格式
 */

export type VideoProvider = 
  | 'apimart-sora2'
  | 'xin147-sora2'
  | 'zhenzhen-sora2'
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
  'apimart-sora2': 'sk-AJ1RBapQDAwPNRCf0yJVskkgKMBitWX9NQVcJOiBHnlCmr7w',
  'xin147-sora2': 'sk-NaPeiKlaJrBo9va0GAthlMdq12hqTkqTQTc3pboHUWWj37SQ',
  'zhenzhen-sora2': 'sk-kkDo6VACx403Cz0hSSoi6Ajr3GDbzrDXTeJnj9DFDpfMhMyG',
  'kling': 'sk-T401EAnQ2NsW7YL_RWuLrU7vcI9LxSU-20xuKnBH657_uk-GRn4tm9cOQiM',
  'vidu': 'sk-T401EAnQ2NsW7YL_RWuLrU7vcI9LxSU-20xuKnBH657_uk-GRn4tm9cOQiM',
  'doubao': '04fe24c5-2a7f-40c4-a1a8-2b1bbf1c3548',
};

/**
 * APIMart Sora2 视频生成
 */
async function generateApimartSora2(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const apiKey = API_KEYS['apimart-sora2'];
  const payload: any = {
    model: 'sora-2',
    prompt: request.prompt,
    duration: request.duration || 10,
    aspect_ratio: request.aspectRatio || '16:9',
    private: false,
  };

  if (request.referenceImages && request.referenceImages.length > 0) {
    payload.image_urls = request.referenceImages;
  }

  const response = await fetch('https://api.apimart.ai/v1/videos/generations', {
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
    taskId: data.data?.[0]?.task_id || data.task_id,
    status: data.data?.[0]?.status || 'submitted',
  };
}

/**
 * 新147 Sora2 视频生成
 */
async function generateXin147Sora2(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const apiKey = API_KEYS['xin147-sora2'];
  
  // 根据 duration 和 aspectRatio 动态选择模型
  const getModelName = (): string => {
    const duration = request.duration || 10;
    const isPortrait = request.aspectRatio === '9:16';
    
    if (duration === 10) {
      return isPortrait ? 'sora2-portrait' : 'sora2-landscape';
    } else if (duration === 15) {
      return isPortrait ? 'sora2-portrait-15s' : 'sora2-landscape-15s';
    } else if (duration === 25) {
      return isPortrait ? 'sora2-pro-portrait-25s' : 'sora2-pro-landscape-25s';
    }
    return isPortrait ? 'sora2-portrait' : 'sora2-landscape';
  };

  const model = getModelName();

  // 如果有图片，使用 multipart/form-data
  if (request.referenceImages && request.referenceImages.length > 0) {
    const formData = new FormData();
    formData.append('model', model);
    formData.append('prompt', request.prompt);
    
    // 将 Base64 Data URI 转换为 Blob
    const imageData = request.referenceImages[0];
    let base64Data: string;
    let mimeType = 'image/jpeg';
    
    if (imageData.startsWith('data:')) {
      // 提取 MIME 类型和 Base64 数据
      const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      } else {
        // 如果没有匹配到，尝试直接分割
        base64Data = imageData.split(',')[1] || imageData;
      }
    } else {
      // 已经是纯 Base64
      base64Data = imageData;
    }
    
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    const extension = mimeType.includes('png') ? 'png' : 'jpg';
    formData.append('image', blob, `image.${extension}`);

    const response = await fetch('https://api1.147ai.com/v1/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      taskId: data.task_id || data.id,
      status: data.status || 'submitted',
    };
  } else {
    // 文生视频，使用 JSON
    const payload = {
      model,
      prompt: request.prompt,
    };

    const response = await fetch('https://api1.147ai.com/v1/videos', {
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
      taskId: data.task_id || data.id,
      status: data.status || 'submitted',
    };
  }
}

/**
 * 贞贞 Sora2 视频生成
 */
async function generateZhenzhenSora2(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const apiKey = API_KEYS['zhenzhen-sora2'];
  
  const payload: any = {
    model: 'sora-2',
    prompt: request.prompt,
    duration: String(request.duration || 10), // ⚠️ 字符串类型
    ratio: request.aspectRatio || '16:9', // ⚠️ 使用 ratio 字段
    private: false,
  };

  if (request.referenceImages && request.referenceImages.length > 0) {
    payload.image = request.referenceImages[0]; // ⚠️ 单个字符串，不是数组
  }

  const response = await fetch('https://ai.t8star.cn/v2/videos/generations', {
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
    taskId: data.data?.[0]?.task_id || data.task_id,
    status: data.data?.[0]?.status || 'pending',
  };
}

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
    off_peak: request.offPeak || false,
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
    case 'apimart-sora2':
      return generateApimartSora2(request);
    case 'xin147-sora2':
      return generateXin147Sora2(request);
    case 'zhenzhen-sora2':
      return generateZhenzhenSora2(request);
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
    case 'apimart-sora2': {
      const response = await fetch(`https://api.apimart.ai/v1/tasks/${taskId}?language=zh`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      const data = await response.json();
      if (data.data?.status === 'succeed') {
        return {
          status: 'succeeded',
          videoUrl: data.data.result?.videos?.[0]?.url?.[0],
        };
      }
      return { status: data.data?.status || 'processing' };
    }

    case 'xin147-sora2': {
      const response = await fetch(`https://api1.147ai.com/v1/videos/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      const data = await response.json();
      if (data.status === 'completed' || data.status === 'SUCCESS') {
        return {
          status: 'succeeded',
          videoUrl: data.video_url || data.output || data.result?.video_url,
        };
      }
      return { status: data.status || 'processing' };
    }

    case 'zhenzhen-sora2': {
      const response = await fetch(`https://ai.t8star.cn/v2/videos/generations/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      const data = await response.json();
      if (data.status === 'SUCCESS') {
        return {
          status: 'succeeded',
          videoUrl: data.data?.output,
        };
      }
      return { status: data.status || 'processing' };
    }

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
