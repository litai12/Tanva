// 积分定价配置
export const CREDIT_PRICING_CONFIG = {
  // Gemini 图像服务
  'gemini-3-pro-image': {
    serviceName: 'Gemini 3 Pro 生图',
    provider: 'gemini',
    creditsPerCall: 15,
    description: '使用 Gemini 3 Pro 模型生成高质量图像',
  },
  'gemini-2.5-image': {
    serviceName: 'Gemini 2.5 生图',
    provider: 'gemini',
    creditsPerCall: 5,
    description: '使用 Gemini 2.5 模型生成图像',
  },
  'gemini-image-edit': {
    serviceName: 'Gemini 图像编辑',
    provider: 'gemini',
    creditsPerCall: 10,
    description: '使用 Gemini 编辑图像',
  },
  'gemini-image-blend': {
    serviceName: 'Gemini 图像融合',
    provider: 'gemini',
    creditsPerCall: 12,
    description: '使用 Gemini 融合多张图像',
  },
  'gemini-image-analyze': {
    serviceName: 'Gemini 图像分析',
    provider: 'gemini',
    creditsPerCall: 3,
    description: '使用 Gemini 分析图像内容',
  },

  // Gemini 文字服务
  'gemini-text': {
    serviceName: 'Gemini 文字对话',
    provider: 'gemini',
    creditsPerCall: 1,
    description: '使用 Gemini 进行文字对话',
    maxInputTokens: 8000,
    maxContextLength: 32000,
  },
  'gemini-paperjs': {
    serviceName: 'Gemini Paper.js 生成',
    provider: 'gemini',
    creditsPerCall: 5,
    description: '使用 Gemini 生成 Paper.js 矢量代码',
  },

  // Sora 视频服务
  'sora-sd': {
    serviceName: 'Sora 普清视频',
    provider: 'sora',
    creditsPerCall: 20,
    description: '使用 Sora 生成普清视频',
  },
  'sora-hd': {
    serviceName: 'Sora 高清视频',
    provider: 'sora',
    creditsPerCall: 200,
    description: '使用 Sora 生成高清视频',
  },

  // Midjourney 服务
  'midjourney-imagine': {
    serviceName: 'Midjourney 生图',
    provider: 'midjourney',
    creditsPerCall: 10,
    description: '使用 Midjourney 生成图像',
  },
  'midjourney-variation': {
    serviceName: 'Midjourney 变体',
    provider: 'midjourney',
    creditsPerCall: 5,
    description: '生成 Midjourney 图像变体',
  },
  'midjourney-upscale': {
    serviceName: 'Midjourney 放大',
    provider: 'midjourney',
    creditsPerCall: 3,
    description: '放大 Midjourney 图像',
  },

  // 其他服务
  'background-removal': {
    serviceName: '背景移除',
    provider: 'imgly',
    creditsPerCall: 2,
    description: '移除图像背景',
  },
  'expand-image': {
    serviceName: '图像扩展',
    provider: 'gemini',
    creditsPerCall: 8,
    description: '扩展图像边界',
  },
  'convert-2d-to-3d': {
    serviceName: '2D转3D',
    provider: 'runninghub',
    creditsPerCall: 15,
    description: '将2D图像转换为3D模型',
  },
} as const;

export type ServiceType = keyof typeof CREDIT_PRICING_CONFIG;

// 默认新用户赠送积分
export const DEFAULT_NEW_USER_CREDITS = 1000;
