// 积分定价配置
export const CREDIT_PRICING_CONFIG = {
  // Gemini 图像服务
  'gemini-3-pro-image': {
    serviceName: 'Nano banana Pro 生图',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana Pro 模型生成高质量图像',
  },
  'gemini-2.5-image': {
    serviceName: 'Nano banana 生图',
    provider: 'gemini',
    creditsPerCall: 10,
    description: '使用 Nano banana 模型生成图像',
  },
  'gemini-image-edit': {
    serviceName: 'Nano banana Pro 图像编辑',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana Pro 编辑图像',
  },
  'gemini-2.5-image-edit': {
    serviceName: 'Nano banana-2.5 图像编辑',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana-2.5 编辑图像',
  },
  'gemini-image-blend': {
    serviceName: 'Nano banana Pro 融合',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana Pro 融合多张图像',
  },
  'gemini-2.5-image-blend': {
    serviceName: 'Nano banana-2.5 融合',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana-2.5 融合多张图像',
  },
  'gemini-image-analyze': {
    serviceName: 'Gemini 图像分析',
    provider: 'gemini',
    creditsPerCall: 6,
    description: '使用 Gemini 分析图像内容',
  },

  // Gemini 文字服务
  'gemini-text': {
    serviceName: 'Gemini 文字对话',
    provider: 'gemini',
    creditsPerCall: 2,
    description: '使用 Gemini 进行文字对话',
    maxInputTokens: 8000,
    maxContextLength: 32000,
  },
  'gemini-tool-selection': {
    serviceName: 'Gemini 工具选择',
    provider: 'gemini',
    creditsPerCall: 2,
    description: '使用 Gemini 进行智能工具选择',
  },
  'gemini-paperjs': {
    serviceName: 'Gemini Paper.js 生成',
    provider: 'gemini',
    creditsPerCall: 10,
    description: '使用 Gemini 生成 Paper.js 矢量代码',
  },
  'gemini-img2vector': {
    serviceName: 'Gemini 图像转矢量',
    provider: 'gemini',
    creditsPerCall: 16,
    description: '使用 Gemini 将图像转换为 Paper.js 矢量代码',
  },
  'gemini-video-analyze': {
    serviceName: 'Gemini-3.0-flash 视频分析',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Gemini-3.0-flash 分析视频内容',
  },

  // Sora 视频服务
  'sora-sd': {
    serviceName: 'Sora 普清视频',
    provider: 'sora',
    creditsPerCall: 40,
    description: '使用 Sora 生成普清视频',
  },
  'sora-hd': {
    serviceName: 'Sora 高清视频',
    provider: 'sora',
    creditsPerCall: 400,
    description: '使用 Sora 生成高清视频',
  },

  // Wan2.6 视频服务
  'wan26-video': {
    serviceName: 'Wan2.6 生成视频',
    provider: 'dashscope',
    creditsPerCall: 600,
    description: '使用 Wan2.6 生成视频（T2V/I2V）',
  },
  'wan26-r2v': {
    serviceName: 'Wan2.6 参考视频',
    provider: 'dashscope',
    creditsPerCall: 600,
    description: '使用 Wan2.6 参考视频生成视频',
  },

  // Midjourney 服务
  'midjourney-imagine': {
    serviceName: 'Midjourney 生图',
    provider: 'midjourney',
    creditsPerCall: 20,
    description: '使用 Midjourney 生成图像',
  },
  'midjourney-variation': {
    serviceName: 'Midjourney 变体',
    provider: 'midjourney',
    creditsPerCall: 10,
    description: '生成 Midjourney 图像变体',
  },
  'midjourney-upscale': {
    serviceName: 'Midjourney 放大',
    provider: 'midjourney',
    creditsPerCall: 6,
    description: '放大 Midjourney 图像',
  },

  // 其他服务
  'background-removal': {
    serviceName: '背景移除',
    provider: 'imgly',
    creditsPerCall: 4,
    description: '移除图像背景',
  },
  'expand-image': {
    serviceName: '图像扩展',
    provider: 'gemini',
    creditsPerCall: 16,
    description: '扩展图像边界',
  },
  'convert-2d-to-3d': {
    serviceName: '2D转3D',
    provider: 'runninghub',
    creditsPerCall: 30,
    description: '将2D图像转换为3D模型',
  },

  // 更多视频服务
  'kling-video': {
    serviceName: '可灵 Kling 视频',
    provider: 'kling',
    creditsPerCall: 60,
    description: '使用可灵 Kling 生成视频',
  },
  'kling-2.6-video': {
    serviceName: '可灵 Kling 2.6 视频',
    provider: 'kling',
    creditsPerCall: 100,
    description: '使用可灵 Kling 2.6 生成视频',
  },
  'kling-o1-video': {
    serviceName: '可灵 Kling O1 视频',
    provider: 'kling',
    creditsPerCall: 100,
    description: '使用可灵 Kling O1 (Omni Video) 生成视频',
  },
  'vidu-video': {
    serviceName: 'Vidu 视频',
    provider: 'vidu',
    creditsPerCall: 60,
    description: '使用 Vidu 生成视频',
  },
  'doubao-video': {
    serviceName: '豆包 Seedance 视频',
    provider: 'doubao',
    creditsPerCall: 60,
    description: '使用豆包 Seedance 生成视频',
  },
} as const;

export type ServiceType = keyof typeof CREDIT_PRICING_CONFIG;

// 默认新用户赠送积分
export const DEFAULT_NEW_USER_CREDITS = 1000;

// 每日登录奖励积分
export const DAILY_LOGIN_REWARD_CREDITS = 100;
