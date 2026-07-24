// 积分定价配置
export const CREDIT_PRICING_CONFIG = {
  // Gemini 图像服务
  'gemini-3-pro-image': {
    serviceName: 'Nano banana Pro 生图',
    provider: 'gemini',
    creditsPerCall: 40,
    description: '使用 Nano banana Pro 模型生成高质量图像',
    // 按分辨率定价：Pro模式支持1K/2K/4K（普通通道，非腾讯通道）
    resolutionPricing: {
      '1K': 40,
      '2K': 60,
      '4K': 80,
    },
  },
  'gemini-3.1-image': {
    serviceName: 'Nano banana 2 生图',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana 2 模型生成高质量图像',
    // 按分辨率定价：Ultra模式支持0.5K/1K/2K/4K（普通通道，非腾讯通道）
    resolutionPricing: {
      '0.5K': 30,
      '1K': 30,
      '2K': 40,
      '4K': 50,
    },
  },
  'gemini-2.5-image': {
    serviceName: 'Nano banana 生图',
    provider: 'gemini',
    creditsPerCall: 20,
    description: '使用 Nano banana 模型生成图像',
    // 按分辨率定价：Fast模式仅支持1K（普通通道，非腾讯通道）
    resolutionPricing: {
      '1K': 20,
    },
  },
  'gpt-image-2': {
    serviceName: 'GPT Image 2',
    provider: 'openai',
    creditsPerCall: 40,
    description: '使用 GPT Image 2 生成图像',
    resolutionPricing: {
      '1K': 20,
      '2K': 30,
      '4K': 40,
    },
  },
  'gemini-image-edit': {
    serviceName: 'Nano banana Pro 图像编辑（Pro）',
    provider: 'gemini',
    creditsPerCall: 40,
    description: '使用 Nano banana Pro 编辑图像',
    resolutionPricing: {
      '1K': 40,
      '2K': 60,
      '4K': 80,
    },
  },
  'gemini-3.1-image-edit': {
    serviceName: 'Nano banana 2 图像编辑（Ultra）',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana 2 编辑图像',
    resolutionPricing: {
      '0.5K': 30,
      '1K': 30,
      '2K': 40,
      '4K': 50,
    },
  },
  'gemini-2.5-image-edit': {
    serviceName: 'Nano banana-2.5 图像编辑',
    provider: 'gemini',
    creditsPerCall: 20,
    description: '使用 Nano banana-2.5 编辑图像',
  },
  'gemini-image-blend': {
    serviceName: 'Nano banana Pro 融合（Pro）',
    provider: 'gemini',
    creditsPerCall: 40,
    description: '使用 Nano banana Pro 融合多张图像',
    resolutionPricing: {
      '1K': 40,
      '2K': 60,
      '4K': 80,
    },
  },
  'gemini-3.1-image-blend': {
    serviceName: 'Nano banana 2 融合（Ultra）',
    provider: 'gemini',
    creditsPerCall: 30,
    description: '使用 Nano banana 2 融合多张图像',
    resolutionPricing: {
      '0.5K': 30,
      '1K': 30,
      '2K': 40,
      '4K': 50,
    },
  },
  'gemini-2.5-image-blend': {
    serviceName: 'Nano banana-2.5 融合',
    provider: 'gemini',
    creditsPerCall: 20,
    description: '使用 Nano banana-2.5 融合',
  },
  'gemini-image-analyze': {
    serviceName: 'Gemini 3.5 图像分析',
    provider: 'new-api',
    creditsPerCall: 10,
    description: '使用 Gemini 3.5 Flash 分析图像内容',
  },
  'gemini-3.1-image-analyze': {
    serviceName: 'Gemini 3.1 图像分析',
    provider: 'new-api',
    creditsPerCall: 10,
    description: '使用 Gemini 3.1 Pro 分析图像内容',
  },
  'gemini-2.5-image-analyze': {
    serviceName: 'Gemini 2.5 图像分析',
    provider: 'new-api',
    creditsPerCall: 10,
    description: '使用 Gemini 2.5 Flash 分析图像内容',
  },

  // ── 极速通道（beqlee 官方代理，官方价 ×1.1）────────────────────────────────
  // 注意：resolutionPricing 仅作 fallback，实际定价由 credits.service.ts
  //       BANANA_ULTRA_RESOLUTION_PRICING 路由感知逻辑覆盖。
  'gemini-3-pro-image-ultra': {
    serviceName: 'Nano banana Pro 生图（极速）',
    provider: 'gemini',
    creditsPerCall: 100,
    description: '使用 beqlee 极速代理生成高质量图像（Pro）',
    resolutionPricing: {
      '0.5K': 100,
      '1K': 100,
      '2K': 100,
      '4K': 179,
    },
  },
  'gemini-3.1-image-ultra': {
    serviceName: 'Nano banana 2 生图（极速）',
    provider: 'gemini',
    creditsPerCall: 50,
    description: '使用 beqlee 极速代理生成图像（Banana2）',
    resolutionPricing: {
      '0.5K': 50,
      '1K': 50,
      '2K': 75,
      '4K': 113,
    },
  },
  'gemini-image-blend-ultra': {
    serviceName: 'Nano banana Pro 融合（极速）',
    provider: 'gemini',
    creditsPerCall: 100,
    description: '使用 beqlee 极速代理融合图像（Pro）',
    resolutionPricing: {
      '0.5K': 100,
      '1K': 100,
      '2K': 100,
      '4K': 179,
    },
  },
  'gemini-3.1-image-blend-ultra': {
    serviceName: 'Nano banana 2 融合（极速）',
    provider: 'gemini',
    creditsPerCall: 50,
    description: '使用 beqlee 极速代理融合图像（Banana2）',
    resolutionPricing: {
      '0.5K': 50,
      '1K': 50,
      '2K': 75,
      '4K': 113,
    },
  },

  // GPT 文字服务（统一经 new-api 网关）
  'gemini-text': {
    serviceName: 'GPT-5.4 文字对话',
    provider: 'new-api',
    creditsPerCall: 5,
    description: '通过 new-api 使用 GPT-5.4 进行文字对话',
    maxInputTokens: 8000,
    maxContextLength: 32000,
  },
  'gemini-prompt-optimize': {
    serviceName: 'GPT-5.4 提示词优化',
    provider: 'new-api',
    creditsPerCall: 5,
    description: '通过 new-api 使用 GPT-5.4 优化提示词',
    maxInputTokens: 8000,
    maxContextLength: 32000,
  },
  'gemini-tool-selection': {
    serviceName: 'GPT-5.4 工具选择',
    provider: 'new-api',
    creditsPerCall: 0,
    description: '通过 new-api 使用 GPT-5.4 进行智能工具选择',
  },
  'gemini-paperjs': {
    serviceName: 'GPT-5.6 Paper.js 生成',
    provider: 'new-api',
    creditsPerCall: 10,
    description: '通过 new-api 使用 GPT-5.6 生成 Paper.js 矢量代码',
  },
  'gemini-img2vector': {
    serviceName: 'GPT-5.6 图像转矢量',
    provider: 'new-api',
    creditsPerCall: 16,
    description: '通过 new-api 使用 GPT-5.6 将图像转换为 Paper.js 矢量代码',
  },
  'gemini-video-analyze': {
    serviceName: '视频分析',
    provider: 'gemini',
    creditsPerCall: 60,
    description: '按模型档位和渠道分析视频内容',
  },

  // Sora 视频服务
  'sora-sd': {
    serviceName: 'Sora2 视频生成',
    provider: 'sora',
    creditsPerCall: 200,
    description: '使用 Sora2 生成视频（按模型计费）',
    modelPricing: {
      'sora-2': { creditsPerCall: 200, description: 'Sora2 标准模型' },
      'sora-2-vip': { creditsPerCall: 200, description: 'Sora2 VIP 模型' },
      'sora-2-pro': { creditsPerCall: 750, description: 'Sora2 Pro 专业模型' },
    },
  },
  'sora-hd': {
    serviceName: 'Sora2 高清视频',
    provider: 'sora',
    creditsPerCall: 200,
    description: '使用 Sora2 生成高清视频（按模型计费）',
    modelPricing: {
      'sora-2': { creditsPerCall: 200, description: 'Sora2 标准模型' },
      'sora-2-vip': { creditsPerCall: 200, description: 'Sora2 VIP 模型' },
      'sora-2-pro': { creditsPerCall: 750, description: 'Sora2 Pro 专业模型' },
    },
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
  'happyhorse-r2v-video': {
    serviceName: '快乐马多图参考',
    provider: 'dashscope',
    creditsPerCall: 600, // fallback：5s × 120 credits/s（720P，节点默认）
    description: '使用 HappyHorse 1.0 R2V 多图参考生成视频',
    dynamicPricing: {
      perSecondByResolution: { '720P': 120, '1080P': 200 },
    },
  },

  // Midjourney 服务
  'midjourney-imagine': {
    serviceName: 'Midjourney 生图',
    provider: 'midjourney',
    creditsPerCall: 50,
    description: '使用 Midjourney 生成图像',
  },
  'midjourney-variation': {
    serviceName: 'Midjourney 变体',
    provider: 'midjourney',
    creditsPerCall: 25,
    description: '生成 Midjourney 图像变体',
  },
  'midjourney-upscale': {
    serviceName: 'Midjourney 放大',
    provider: 'midjourney',
    creditsPerCall: 25,
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
    provider: 'hunyuan-3d',
    creditsPerCall: 200,
    description: '使用腾讯混元 3D 将 2D 图像转换为 3D 模型',
  },
  'volc-enhance-video': {
    serviceName: '视频画质增强',
    provider: 'volc',
    creditsPerCall: 0,
    description: '视频增强（后端按平台价动态计费）',
  },

  // 更多视频服务
  'kling-video': {
    serviceName: '可灵 Kling 视频',
    provider: 'kling',
    creditsPerCall: 600,
    description: '使用可灵 Kling 生成视频',
  },
  'kling-2.6-video': {
    serviceName: '可灵 Kling 2.6 视频',
    provider: 'kling',
    creditsPerCall: 150,
    description: '使用可灵 Kling 2.6 生成视频',
    dynamicPricing: {
      noSound: {
        std: { '5': 150, '10': 300 },
        pro: { '5': 300, '10': 500 },
      },
      withSound: {
        std: { '5': 500, '10': 1000 },
        pro: { '5': 600, '10': 1200 },
      },
    },
  },
  'kling-3.0-video': {
    serviceName: '可灵 Kling 3.0 视频',
    provider: 'kling',
    creditsPerCall: 300,
    description: '使用可灵 Kling 3.0 生成视频',
    dynamicPricing: {
      noSound: {
        std: { '5': 300, '10': 600 },
        pro: { '5': 400, '10': 800 },
      },
      withSound: {
        std: { '5': 450, '10': 900 },
        pro: { '5': 600, '10': 1200 },
      },
    },
  },
  'kling-o3-video': {
    serviceName: '可灵 Kling O3 视频',
    provider: 'kling',
    creditsPerCall: 600,
    description: '使用可灵 Kling O3 (Omni Video) 生成视频',
  },
  'vidu-video': {
    serviceName: 'Vidu 视频',
    provider: 'vidu',
    creditsPerCall: 600,
    description: '使用 Vidu 生成视频',
  },
  'viduq3-pro-video': {
    serviceName: 'Vidu Q3 Pro 视频',
    provider: 'viduq3-pro',
    creditsPerCall: 600,
    description: '使用 Vidu Q3 Pro 生成视频',
  },
  'doubao-video': {
    serviceName: 'Seedance 1.5 Pro 视频',
    provider: 'doubao',
    creditsPerCall: 600,
    description: '使用Seedance 1.5 Pro 生成视频',
  },
  'video-to-gif': {
    serviceName: '视频转GIF',
    provider: 'ffmpeg',
    creditsPerCall: 30,
    description: '将视频转换为 GIF',
  },
  'minimax-speech': {
    serviceName: 'MiniMax 语音合成',
    provider: 'minimax',
    creditsPerCall: 10,
    description: '使用 MiniMax 进行文本转语音合成',
  },
  'minimax-music': {
    serviceName: 'MiniMax 音乐生成',
    provider: 'minimax',
    creditsPerCall: 30,
    description: '使用 MiniMax 进行音乐生成',
  },
  'tencent-speech': {
    serviceName: '腾讯语音合成',
    provider: 'tencent',
    creditsPerCall: 10,
    description: '使用腾讯 MPS AI 配音接口进行语音生成',
  },
  'doubao-seedream-5-0-260128': {
    serviceName: 'Seedream 5.0 图像生成',
    provider: 'seedream5',
    creditsPerCall: 30,
    description: '使用 Seedream 5.0 生成图像',
    resolutionPricing: {
      '1K': 30,
      '2K': 30,
      '4K': 60,
    },
  },
  'doubao-seedream-5-0-pro-260628': {
    serviceName: 'Seedream 5.0 Pro 图像生成',
    provider: 'seedream5',
    creditsPerCall: 90,
    description: '使用 Seedream 5.0 Pro 生成图像',
    resolutionPricing: {
      '1K': 50,
      '2K': 90,
    },
  },
} as const;

export type ServiceType = string;

// 每日登录奖励积分
export const DAILY_LOGIN_REWARD_CREDITS = 50;

// 连续签到7天额外奖励积分
export const CONSECUTIVE_7_DAY_BONUS_CREDITS = 150;
