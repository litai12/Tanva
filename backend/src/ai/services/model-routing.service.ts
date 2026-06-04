import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ManagedPricingBook } from './model-pricing-resolver';
import {
  SEEDANCE20_DISCOUNT_CREDITS,
  SEEDANCE20_DISCOUNT_PRICE_YUAN,
  createSeedance20DiscountPricingTemplate,
  normalizeSeedance20DiscountPricing,
} from './seedance20-pricing';

export const MODEL_PROVIDER_MAPPING_SETTING_KEY = 'model_provider_mapping_v2';

type ModelVendorRouteType = 'legacy' | 'tencent_vod';

export interface ManagedVendorPlatformConfig {
  platformKey: string;
  platformName?: string;
  enabled?: boolean;
  route?: ModelVendorRouteType;
  provider?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface ManagedModelVendorConfig {
  vendorKey: string;
  platformKey?: string;
  label?: string;
  enabled?: boolean;
  route?: ModelVendorRouteType;
  provider?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  modelName?: string;
  modelVersion?: string;
  pricing?: ManagedPricingBook;
  metadata?: Record<string, any>;
}

export interface ManagedModelConfig {
  modelKey: string;
  modelName?: string;
  taskType?: string;
  enabled?: boolean;
  defaultVendor?: string;
  vendors?: ManagedModelVendorConfig[];
  metadata?: Record<string, any>;
}

export interface ModelProviderMappingV2 {
  version?: string;
  platforms?: ManagedVendorPlatformConfig[];
  models?: ManagedModelConfig[];
}

export interface ResolvedManagedModelRoute {
  model: ManagedModelConfig;
  vendor: ManagedModelVendorConfig;
  route: ModelVendorRouteType;
}

const DEFAULT_TENCENT_VOD_PLATFORM_METADATA = {
  service: 'tencent_vod',
  endpoint: 'https://vod.tencentcloudapi.com/',
  upstreamDomain: 'vod.tencentcloudapi.com',
  apiVersion: '2018-07-17',
  createTask: {
    method: 'POST',
    action: 'CreateAigcVideoTask',
    url: 'https://vod.tencentcloudapi.com/',
  },
  queryTask: {
    method: 'POST',
    action: 'DescribeTaskDetail',
    url: 'https://vod.tencentcloudapi.com/',
  },
  polling: {
    strategy: 'describe_task_detail',
    successStatuses: ['FINISH', 'SUCCESS', 'SUCCEEDED', 'COMPLETED'],
    processingStatuses: ['WAITING', 'PROCESSING', 'RUNNING', 'QUEUED', 'PENDING'],
    failedStatuses: ['FAIL', 'FAILED', 'ERROR', 'CANCELED', 'CANCELLED'],
  },
  responseMapping: {
    taskId: ['Response.TaskId'],
    status: ['Response.Status', 'Response.TaskStatus'],
    fileId: ['Response.FileId', 'Response.MediaInfo.FileId'],
    fileUrl: ['Response.FileUrl', 'Response.MediaUrl', 'Response.PlayUrl'],
    message: ['Response.Message', 'Response.Error.Message'],
    requestId: ['Response.RequestId'],
  },
} as const;

const DEFAULT_SEEDANCE20_V2_VENDOR_METADATA = {
  executionBranch: 'v2_request_profile',
  requestProfile: {
    enabled: true,
    version: 'v2',
    create: {
      method: 'POST',
      path: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
      headers: {
        Authorization: '{{auth.bearer}}',
        'Content-Type': 'application/json',
      },
      body: {
        model: '{{request.seedanceUpstreamModelId}}',
        content: '{{request.content}}',
        video_mode: '{{request.videoMode}}',
        generate_audio: '{{request.generateAudio}}',
        ratio: '{{request.aspectRatio}}',
        duration: '{{request.duration}}',
        resolution: '{{request.resolution}}',
        watermark: '{{request.watermark}}',
      },
      responseMapping: {
        taskId: ['id', 'platform_id'],
        status: ['status'],
      },
    },
    query: {
      method: 'GET',
      path: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{{task.id}}',
      headers: {
        Authorization: '{{auth.bearer}}',
      },
      responseMapping: {
        status: ['status'],
        videoUrl: ['content.video_url'],
        error: ['error.message', 'reason'],
      },
    },
  },
} as const;

const DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA = {
  executionBranch: 'v2_request_profile',
  requestProfile: {
    enabled: true,
    version: 'v2',
    transport: 'tencent_vod_aigc_video',
    create: {
      body: {
        modelName: '{{vendor.modelName}}',
        modelVersion: '{{vendor.modelVersion}}',
        prompt: '{{vod.prompt}}',
        fileInfos: '{{vod.fileInfos}}',
        lastFrameUrl: '{{vod.lastFrameUrl}}',
        aspectRatio: '{{vod.aspectRatio}}',
        duration: '{{vod.duration}}',
        resolution: '{{vod.resolution}}',
        storageMode: '{{vod.storageMode}}',
        enhancePrompt: '{{vod.enhancePrompt}}',
      },
      responseMapping: {
        taskId: ['taskId'],
        requestId: ['requestId'],
      },
    },
    query: {
      responseMapping: {
        status: ['status'],
        videoUrl: ['videoUrl'],
        fileId: ['fileId'],
        requestId: ['requestId'],
      },
    },
  },
} as const;

const DEFAULT_TENCENT_VOD_SEEDANCE15_V2_VENDOR_METADATA = {
  executionBranch: 'v2_request_profile',
  requestProfile: {
    enabled: true,
    version: 'v2',
    transport: 'tencent_vod_aigc_video',
    create: {
      body: {
        modelName: '{{vendor.modelName}}',
        modelVersion: '{{vendor.modelVersion}}',
        prompt: '{{vod.prompt}}',
        fileInfos: '{{vod.fileInfos}}',
        aspectRatio: '{{vod.aspectRatio}}',
        duration: '{{vod.duration}}',
        resolution: '{{vod.resolution}}',
        audioGeneration: '{{vod.audioGeneration}}',
        storageMode: '{{vod.storageMode}}',
        enhancePrompt: '{{vod.enhancePrompt}}',
      },
      responseMapping: {
        taskId: ['taskId'],
        requestId: ['requestId'],
      },
    },
    query: {
      responseMapping: {
        status: ['status'],
        videoUrl: ['videoUrl'],
        fileId: ['fileId'],
        requestId: ['requestId'],
      },
    },
  },
} as const;

const createKling26PricingTemplate = (): ManagedPricingBook => ({
  version: 'v2',
  dimensions: [
    {
      key: 'generationMode',
      label: '生成方式',
      type: 'enum',
      required: true,
      options: [{ value: 'i2v', label: '图生视频' }],
    },
    {
      key: 'hasAudio',
      label: '是否带音频',
      type: 'boolean',
      required: true,
      options: [
        { value: false, label: '无声' },
        { value: true, label: '有声' },
      ],
    },
    {
      key: 'qualityMode',
      label: '质量档位',
      type: 'enum',
      required: true,
      options: [
        { value: 'std', label: '标准（std）' },
        { value: 'pro', label: '高品质（pro）' },
      ],
    },
    {
      key: 'durationSec',
      label: '时长（秒）',
      type: 'enum',
      required: true,
      options: [
        { value: 5, label: '5 秒' },
        { value: 10, label: '10 秒' },
      ],
    },
  ],
  matchingRules: [
    {
      ruleKey: 'kling26_i2v_rule',
      label: 'Kling 2.6 图生视频价格矩阵',
      enabled: true,
      priority: 100,
      evaluatorKey: 'kling26_matrix',
      conditions: {
        all: [{ field: 'generationMode', op: 'eq', value: 'i2v' }],
        any: [],
      },
    },
  ],
  evaluators: {
    kling26_matrix: {
      type: 'lookup_matrix',
      axes: ['hasAudio', 'qualityMode', 'durationSec'],
      matrix: {
        false: {
          std: { '5': 1.5, '10': 3 },
          pro: { '5': 3, '10': 5 },
        },
        true: {
          std: { '5': 5, '10': 10 },
          pro: { '5': 6, '10': 12 },
        },
      },
    },
  },
  displayConfig: {
    specAxes: ['hasAudio', 'qualityMode', 'durationSec'],
    labels: {
      'generationMode.i2v': '图生视频',
      'hasAudio.false': '无声',
      'hasAudio.true': '有声',
      'qualityMode.std': '标准（std）',
      'qualityMode.pro': '高品质（pro）',
      'durationSec.5': '5 秒',
      'durationSec.10': '10 秒',
    },
    defaultSelections: {
      generationMode: 'i2v',
      hasAudio: false,
      qualityMode: 'std',
      durationSec: 5,
    },
    presets: [
      { generationMode: 'i2v', hasAudio: false, qualityMode: 'std', durationSec: 5 },
      { generationMode: 'i2v', hasAudio: false, qualityMode: 'pro', durationSec: 5 },
      { generationMode: 'i2v', hasAudio: true, qualityMode: 'std', durationSec: 5 },
      { generationMode: 'i2v', hasAudio: true, qualityMode: 'pro', durationSec: 5 },
      { generationMode: 'i2v', hasAudio: false, qualityMode: 'std', durationSec: 10 },
      { generationMode: 'i2v', hasAudio: false, qualityMode: 'pro', durationSec: 10 },
      { generationMode: 'i2v', hasAudio: true, qualityMode: 'std', durationSec: 10 },
      { generationMode: 'i2v', hasAudio: true, qualityMode: 'pro', durationSec: 10 },
    ],
  },
});

const createKling30PricingTemplate = (): ManagedPricingBook => ({
  version: 'v2',
  dimensions: [
    {
      key: 'generationMode',
      label: '生成方式',
      type: 'enum',
      required: true,
      options: [
        { value: 't2v', label: '文生视频' },
        { value: 'i2v', label: '图生视频' },
        { value: 'start_end_frame', label: '首尾帧' },
      ],
    },
    {
      key: 'hasAudio',
      label: '是否带音频',
      type: 'boolean',
      required: true,
      options: [
        { value: false, label: '无声' },
        { value: true, label: '有声' },
      ],
    },
    {
      key: 'qualityMode',
      label: '质量档位',
      type: 'enum',
      required: true,
      options: [
        { value: 'std', label: '标准（720P）' },
        { value: 'pro', label: '高品质（1080P）' },
      ],
    },
    {
      key: 'durationSec',
      label: '时长（秒）',
      type: 'enum',
      required: true,
      options: [
        { value: 5, label: '5 秒' },
        { value: 10, label: '10 秒' },
      ],
    },
  ],
  matchingRules: [
    {
      ruleKey: 'kling30_common_rule',
      label: 'Kling 3.0 通用价格矩阵',
      enabled: true,
      priority: 100,
      evaluatorKey: 'kling30_matrix',
      conditions: {
        all: [{ field: 'generationMode', op: 'in', value: ['t2v', 'i2v', 'start_end_frame'] }],
        any: [],
      },
    },
  ],
  evaluators: {
    kling30_matrix: {
      type: 'lookup_matrix',
      axes: ['hasAudio', 'qualityMode', 'durationSec'],
      matrix: {
        false: {
          std: { '5': 3, '10': 6 },
          pro: { '5': 4, '10': 8 },
        },
        true: {
          std: { '5': 4.5, '10': 9 },
          pro: { '5': 6, '10': 12 },
        },
      },
    },
  },
  displayConfig: {
    specAxes: ['generationMode', 'hasAudio', 'qualityMode', 'durationSec'],
    labels: {
      'generationMode.t2v': '文生视频',
      'generationMode.i2v': '图生视频',
      'generationMode.start_end_frame': '首尾帧',
      'hasAudio.false': '无声',
      'hasAudio.true': '有声',
      'qualityMode.std': '标准（720P）',
      'qualityMode.pro': '高品质（1080P）',
      'durationSec.5': '5 秒',
      'durationSec.10': '10 秒',
    },
    defaultSelections: {
      generationMode: 't2v',
      hasAudio: false,
      qualityMode: 'std',
      durationSec: 5,
    },
    presets: [
      { generationMode: 't2v', hasAudio: false, qualityMode: 'std', durationSec: 5 },
      { generationMode: 't2v', hasAudio: false, qualityMode: 'pro', durationSec: 5 },
      { generationMode: 'i2v', hasAudio: false, qualityMode: 'std', durationSec: 5 },
      { generationMode: 'i2v', hasAudio: true, qualityMode: 'std', durationSec: 5 },
      { generationMode: 'start_end_frame', hasAudio: false, qualityMode: 'std', durationSec: 5 },
      { generationMode: 't2v', hasAudio: false, qualityMode: 'std', durationSec: 10 },
      { generationMode: 't2v', hasAudio: true, qualityMode: 'std', durationSec: 10 },
      { generationMode: 'i2v', hasAudio: true, qualityMode: 'pro', durationSec: 10 },
    ],
  },
});

const createQ3TurboPricingTemplate = (): ManagedPricingBook => ({
  version: 'v2',
  dimensions: [
    {
      key: 'generationMode',
      label: '生成方式',
      type: 'enum',
      required: true,
      options: [
        { value: 't2v', label: '文生视频' },
        { value: 'i2v', label: '图生视频' },
        { value: 'start_end_frame', label: '首尾帧' },
      ],
    },
    {
      key: 'resolution',
      label: '分辨率',
      type: 'enum',
      required: true,
      options: [
        { value: '540P', label: '540P' },
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' },
      ],
    },
    {
      key: 'durationSec',
      label: '时长（秒）',
      type: 'number',
      required: true,
    },
  ],
  matchingRules: [
    {
      ruleKey: 'q3_turbo_540p_rule',
      label: 'Q3 Turbo 540P 线性计费',
      enabled: true,
      priority: 100,
      evaluatorKey: 'q3_turbo_540p_linear',
      conditions: {
        all: [
          { field: 'generationMode', op: 'in', value: ['t2v', 'i2v', 'start_end_frame'] },
          { field: 'resolution', op: 'eq', value: '540P' },
        ],
        any: [],
      },
    },
    {
      ruleKey: 'q3_turbo_720p_rule',
      label: 'Q3 Turbo 720P 线性计费',
      enabled: true,
      priority: 110,
      evaluatorKey: 'q3_turbo_720p_linear',
      conditions: {
        all: [
          { field: 'generationMode', op: 'in', value: ['t2v', 'i2v', 'start_end_frame'] },
          { field: 'resolution', op: 'eq', value: '720P' },
        ],
        any: [],
      },
    },
    {
      ruleKey: 'q3_turbo_1080p_rule',
      label: 'Q3 Turbo 1080P 线性计费',
      enabled: true,
      priority: 120,
      evaluatorKey: 'q3_turbo_1080p_linear',
      conditions: {
        all: [
          { field: 'generationMode', op: 'in', value: ['t2v', 'i2v', 'start_end_frame'] },
          { field: 'resolution', op: 'eq', value: '1080P' },
        ],
        any: [],
      },
    },
  ],
  evaluators: {
    q3_turbo_540p_linear: { type: 'linear', unitField: 'durationSec', unitPriceYuan: 0.25 },
    q3_turbo_720p_linear: { type: 'linear', unitField: 'durationSec', unitPriceYuan: 0.375 },
    q3_turbo_1080p_linear: { type: 'linear', unitField: 'durationSec', unitPriceYuan: 0.5 },
  },
  displayConfig: {
    specAxes: ['generationMode', 'resolution', 'durationSec'],
    labels: {
      'generationMode.t2v': '文生视频',
      'generationMode.i2v': '图生视频',
      'generationMode.start_end_frame': '首尾帧',
      'resolution.540P': '540P',
      'resolution.720P': '720P',
      'resolution.1080P': '1080P',
    },
    defaultSelections: {
      generationMode: 't2v',
      resolution: '540P',
      durationSec: 5,
    },
    presets: [
      { generationMode: 't2v', resolution: '540P', durationSec: 5 },
      { generationMode: 't2v', resolution: '720P', durationSec: 5 },
      { generationMode: 't2v', resolution: '1080P', durationSec: 5 },
      { generationMode: 'i2v', resolution: '540P', durationSec: 5 },
      { generationMode: 'i2v', resolution: '720P', durationSec: 10 },
      { generationMode: 'start_end_frame', resolution: '1080P', durationSec: 10 },
    ],
  },
});

const DEFAULT_MODEL_PROVIDER_MAPPING_V2: ModelProviderMappingV2 = {
  version: 'v2',
  platforms: [
    {
      platformKey: 'legacy',
      platformName: '旧链路(Kapon)',
      enabled: true,
      route: 'legacy',
      description: '保留当前默认老链路，未切厂商时回退使用',
    },
    {
      platformKey: 'tencent_vod',
      platformName: '腾讯 VOD',
      enabled: true,
      route: 'tencent_vod',
      description: '腾讯云 VOD AIGC 视频生成',
      metadata: DEFAULT_TENCENT_VOD_PLATFORM_METADATA,
    },
    {
      platformKey: 'vidu_api',
      platformName: 'Vidu API',
      enabled: true,
      route: 'legacy',
      provider: 'vidu',
      description: 'Vidu 官方或兼容 API 渠道',
    },
    {
      platformKey: 'sora2_api',
      platformName: 'Sora 2 API',
      enabled: true,
      route: 'legacy',
      provider: 'sora2',
      description: 'Sora 2 视频生成渠道占位',
    },
    {
      platformKey: 'seedance_api',
      platformName: 'Seedance API',
      enabled: true,
      route: 'legacy',
      provider: 'doubao',
      description: 'Seedance 视频生成渠道占位',
    },
    {
      platformKey: 'new_api',
      platformName: 'New API',
      enabled: true,
      route: 'legacy',
      provider: 'new-api',
      description: 'New API 兼容渠道（Gemini / GPT-Image 图像模型）',
    },
  ],
  models: [
    {
      modelKey: 'kling-2.6',
      modelName: 'Kling 2.6',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'legacy',
      vendors: [
        {
          vendorKey: 'legacy',
          platformKey: 'legacy',
          label: '旧链路(Kapon)',
          enabled: true,
          route: 'legacy',
          provider: 'kling-2.6',
          modelName: 'Kling',
          modelVersion: '2.6',
        },
      ],
    },
    {
      modelKey: 'kling-3.0',
      modelName: 'Kling 3.0',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'legacy',
      vendors: [
        {
          vendorKey: 'legacy',
          platformKey: 'legacy',
          label: '旧链路(Kapon)',
          enabled: true,
          route: 'legacy',
          provider: 'kling-o3',
          modelName: 'Kling',
          modelVersion: '3.0',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'kling-o3',
          modelName: 'Kling',
          modelVersion: '3.0',
        },
      ],
    },
    {
      modelKey: 'kling-o3',
      modelName: 'Kling 3.0-Omni',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'legacy',
          platformKey: 'legacy',
          label: '旧链路(Kapon)',
          enabled: true,
          route: 'legacy',
          provider: 'kling-o3',
          modelName: 'Kling',
          modelVersion: '3.0-Omni',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'kling-o3',
          modelName: 'Kling',
          modelVersion: '3.0-Omni',
        },
      ],
    },
    {
      modelKey: 'vidu-q2',
      modelName: 'Vidu Q2',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'vidu_api',
          platformKey: 'vidu_api',
          label: 'Vidu API',
          enabled: true,
          route: 'legacy',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'Q2',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'q2',
          metadata: DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA,
        },
      ],
    },
    {
      modelKey: 'vidu-q3',
      modelName: 'Vidu Q3',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'vidu_api',
          platformKey: 'vidu_api',
          label: 'Vidu API',
          enabled: true,
          route: 'legacy',
          provider: 'viduq3-pro',
          modelName: 'Vidu',
          modelVersion: 'Q3',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'q3',
          metadata: DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA,
        },
      ],
    },
    {
      modelKey: 'sora-2',
      modelName: 'Sora 2',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'sora2_api',
          platformKey: 'sora2_api',
          label: 'Sora 2 API',
          enabled: true,
          route: 'legacy',
          provider: 'sora2',
          modelName: 'Sora',
          modelVersion: '2.0',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'sora2',
          modelName: 'OS',
          modelVersion: '2.0',
        },
      ],
    },
    {
      modelKey: 'seedance-1.5',
      modelName: 'Seedance 1.5',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'seedance_api',
          platformKey: 'seedance_api',
          label: 'Seedance API',
          enabled: true,
          route: 'legacy',
          provider: 'doubao',
          modelName: 'Seedance',
          modelVersion: '1.5',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'doubao',
          modelName: 'Seedance',
          modelVersion: '1.5-pro',
          metadata: DEFAULT_TENCENT_VOD_SEEDANCE15_V2_VENDOR_METADATA,
        },
      ],
    },
    {
      modelKey: 'seedance-2.0',
      modelName: 'Seedance 2.0',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'seedance_api',
      vendors: [
        {
          vendorKey: 'seedance_api',
          platformKey: 'seedance_api',
          label: 'Seedance API',
          enabled: true,
          route: 'legacy',
          provider: 'doubao',
          modelName: 'Seedance',
          modelVersion: '2.0',
          creditsPerCall: SEEDANCE20_DISCOUNT_CREDITS,
          priceYuan: SEEDANCE20_DISCOUNT_PRICE_YUAN,
          pricing: createSeedance20DiscountPricingTemplate(),
          metadata: DEFAULT_SEEDANCE20_V2_VENDOR_METADATA,
        },
      ],
    },
    // ---------- 图像模型 ----------
    {
      modelKey: 'gemini-2.5-image',
      modelName: 'Gemini 2.5 Flash Image',
      taskType: 'image',
      enabled: true,
      defaultVendor: 'new_api',
      vendors: [
        {
          vendorKey: 'new_api',
          platformKey: 'new_api',
          label: 'New API',
          enabled: true,
          route: 'legacy',
          provider: 'new-api',
          modelName: 'gemini-2.5-flash-image-preview',
          creditsPerCall: 20,
          priceYuan: 0.2,
        },
      ],
    },
    {
      modelKey: 'gemini-3-pro-image',
      modelName: 'Gemini 3 Pro Image',
      taskType: 'image',
      enabled: true,
      defaultVendor: 'new_api',
      vendors: [
        {
          vendorKey: 'new_api',
          platformKey: 'new_api',
          label: 'New API',
          enabled: true,
          route: 'legacy',
          provider: 'new-api',
          modelName: 'gemini-3-pro',
          creditsPerCall: 40,
          priceYuan: 0.4,
        },
      ],
    },
    {
      modelKey: 'gemini-image-blend',
      modelName: 'Gemini Image Blend',
      taskType: 'image',
      enabled: true,
      defaultVendor: 'new_api',
      vendors: [
        {
          vendorKey: 'new_api',
          platformKey: 'new_api',
          label: 'New API',
          enabled: true,
          route: 'legacy',
          provider: 'new-api',
          modelName: 'gemini-2.5-flash-image-preview',
          creditsPerCall: 40,
          priceYuan: 0.4,
        },
      ],
    },
    {
      modelKey: 'gemini-2.5-image-analyze',
      modelName: 'Gemini 2.5 Image Analyze',
      taskType: 'image',
      enabled: true,
      defaultVendor: 'new_api',
      vendors: [
        {
          vendorKey: 'new_api',
          platformKey: 'new_api',
          label: 'New API',
          enabled: true,
          route: 'legacy',
          provider: 'new-api',
          modelName: 'gemini-2.5-pro',
          creditsPerCall: 10,
          priceYuan: 0.1,
        },
      ],
    },
    {
      modelKey: 'gpt-image-2',
      modelName: 'GPT-Image-2',
      taskType: 'image',
      enabled: true,
      defaultVendor: 'new_api',
      vendors: [
        {
          vendorKey: 'new_api',
          platformKey: 'new_api',
          label: 'New API',
          enabled: true,
          route: 'legacy',
          provider: 'new-api',
          modelName: 'gpt-image-2',
          creditsPerCall: 40,
          priceYuan: 0.4,
        },
      ],
    },
  ],
};

@Injectable()
export class ModelRoutingService {
  private readonly logger = new Logger(ModelRoutingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private mergeMetadataWithFallback<T extends Record<string, any>>(
    fallback: T,
    current?: Record<string, any> | null,
  ): T {
    const merge = (baseValue: any, currentValue: any): any => {
      if (Array.isArray(baseValue)) {
        return Array.isArray(currentValue) ? currentValue : baseValue;
      }

      if (
        baseValue &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue)
      ) {
        const next: Record<string, any> = {
          ...baseValue,
        };

        if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
          for (const [key, value] of Object.entries(currentValue)) {
            next[key] = merge(baseValue[key], value);
          }
        }

        return next;
      }

      return currentValue === undefined ? baseValue : currentValue;
    };

    return merge(fallback, current || {}) as T;
  }

  private applyPricingFallback(
    modelKey: string | undefined,
    vendor: ManagedModelVendorConfig,
  ): ManagedModelVendorConfig {
    const normalized = String(modelKey || '').trim().toLowerCase();
    const fallback =
      normalized === 'kling-2.6'
        ? { pricing: createKling26PricingTemplate(), priceYuan: 1.5, creditsPerCall: 150 }
        : normalized === 'kling-3.0'
        ? { pricing: createKling30PricingTemplate(), priceYuan: 3, creditsPerCall: 300 }
        : normalized === 'vidu-q3'
        ? { pricing: createQ3TurboPricingTemplate(), priceYuan: 1.25, creditsPerCall: 125 }
        : null;

    if (!fallback) return vendor;

    return {
      ...vendor,
      pricing:
        vendor.pricing && typeof vendor.pricing === 'object'
          ? this.mergeMetadataWithFallback(
              fallback.pricing as Record<string, any>,
              vendor.pricing as Record<string, any>,
            )
          : fallback.pricing,
      priceYuan:
        typeof vendor.priceYuan === 'number' && Number.isFinite(vendor.priceYuan)
          ? vendor.priceYuan
          : fallback.priceYuan,
      creditsPerCall:
        typeof vendor.creditsPerCall === 'number' && Number.isFinite(vendor.creditsPerCall)
          ? vendor.creditsPerCall
          : fallback.creditsPerCall,
    };
  }

  getDefaultConfig(): ModelProviderMappingV2 {
    return JSON.parse(JSON.stringify(DEFAULT_MODEL_PROVIDER_MAPPING_V2));
  }

  private ensureModelDefaultVendor(model: ManagedModelConfig): ManagedModelConfig {
    const vendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
    if (!vendors.length) {
      return model;
    }

    const existingDefaultVendor =
      typeof model.defaultVendor === 'string' ? model.defaultVendor.trim() : '';
    const resolvedDefaultVendor =
      (existingDefaultVendor && vendors.some((vendor) => vendor.vendorKey === existingDefaultVendor)
        ? existingDefaultVendor
        : '') ||
      vendors.find((vendor) => vendor.enabled !== false)?.vendorKey ||
      vendors[0]?.vendorKey ||
      '';

    return {
      ...model,
      defaultVendor: resolvedDefaultVendor,
      vendors: vendors.map((vendor) => ({
        ...vendor,
        enabled:
          vendor.vendorKey === resolvedDefaultVendor ? true : vendor.enabled !== false,
      })),
    };
  }

  private mergeWithDefaultConfig(input: ModelProviderMappingV2): ModelProviderMappingV2 {
    const fallback = this.getDefaultConfig();
    const existingPlatforms = Array.isArray(input.platforms) ? input.platforms.filter(Boolean) : [];
    const existingPlatformKeys = new Set(
      existingPlatforms.map((item) => (typeof item?.platformKey === 'string' ? item.platformKey : '')).filter(Boolean),
    );
    const mergedPlatforms = [
      ...existingPlatforms.map((platform) => {
        const fallbackPlatform =
          (fallback.platforms || []).find((item) => item.platformKey === platform.platformKey) || null;
        return {
          ...fallbackPlatform,
          ...platform,
          metadata: {
            ...(fallbackPlatform?.metadata && typeof fallbackPlatform.metadata === 'object'
              ? fallbackPlatform.metadata
              : {}),
            ...(platform.metadata && typeof platform.metadata === 'object' ? platform.metadata : {}),
          },
        };
      }),
      ...(fallback.platforms || []).filter(
        (item) => item && typeof item.platformKey === 'string' && !existingPlatformKeys.has(item.platformKey),
      ),
    ];

    const mergedModels = Array.isArray(input.models) ? input.models.filter(Boolean) : fallback.models || [];

    return this.normalizeSpecialCases({
      version: input.version || fallback.version || 'v2',
      platforms: mergedPlatforms,
      models: mergedModels,
    });
  }

  private normalizeSpecialCases(input: ModelProviderMappingV2): ModelProviderMappingV2 {
    const models = (Array.isArray(input.models) ? input.models : []).map((model) => {
      if (!model) {
        return model;
      }

      if (model.modelKey === 'vidu-q2' || model.modelKey === 'vidu-q3') {
        const isQ3 = model.modelKey === 'vidu-q3';
        const existingVendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
        const legacyVendor =
          existingVendors.find((vendor) => vendor.vendorKey === 'vidu_api') || {
            vendorKey: 'vidu_api',
            platformKey: 'vidu_api',
            label: 'Vidu API',
            enabled: true,
            route: 'legacy' as const,
            provider: isQ3 ? 'viduq3-pro' : 'vidu',
            modelName: 'Vidu',
            modelVersion: isQ3 ? 'Q3' : 'Q2',
          };
        const tencentVodVendor =
          existingVendors.find((vendor) => vendor.vendorKey === 'tencent_vod') || {
            vendorKey: 'tencent_vod',
            platformKey: 'tencent_vod',
            label: '腾讯 VOD',
            enabled: false,
            route: 'tencent_vod' as const,
            provider: 'vidu',
            modelName: 'Vidu',
            modelVersion: isQ3 ? 'q3' : 'q2',
          };

        const normalizedLegacyVendor: ManagedModelVendorConfig = {
          ...legacyVendor,
          platformKey: 'vidu_api',
          label: legacyVendor.label || 'Vidu API',
          enabled: legacyVendor.enabled !== false,
          route: 'legacy',
          provider: legacyVendor.provider || (isQ3 ? 'viduq3-pro' : 'vidu'),
          modelName: legacyVendor.modelName || 'Vidu',
          modelVersion: legacyVendor.modelVersion || (isQ3 ? 'Q3' : 'Q2'),
        };
        const normalizedTencentVodVendor: ManagedModelVendorConfig = {
          ...tencentVodVendor,
          platformKey: 'tencent_vod',
          label: tencentVodVendor.label || '腾讯 VOD',
          enabled: tencentVodVendor.enabled === true,
          route: 'tencent_vod',
          provider: tencentVodVendor.provider || 'vidu',
          modelName: tencentVodVendor.modelName || 'Vidu',
          modelVersion: tencentVodVendor.modelVersion || (isQ3 ? 'q3' : 'q2'),
          metadata: this.mergeMetadataWithFallback(
            DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA,
            tencentVodVendor.metadata && typeof tencentVodVendor.metadata === 'object'
              ? tencentVodVendor.metadata
              : undefined,
          ),
        };

        return this.ensureModelDefaultVendor({
          ...model,
          defaultVendor: model.defaultVendor || 'vidu_api',
          vendors: [
            this.applyPricingFallback(model.modelKey, normalizedLegacyVendor),
            this.applyPricingFallback(model.modelKey, normalizedTencentVodVendor),
          ],
        });
      }

      if (model.modelKey === 'kling-2.6' || model.modelKey === 'kling-3.0') {
        return this.ensureModelDefaultVendor({
          ...model,
          vendors: (Array.isArray(model.vendors) ? model.vendors : []).map((vendor) =>
            this.applyPricingFallback(model.modelKey, vendor),
          ),
        });
      }

      if (model.modelKey === 'sora-2') {
        const existingVendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
        const soraApiVendor =
          existingVendors.find((vendor) => vendor.vendorKey === 'sora2_api') || {
            vendorKey: 'sora2_api',
            platformKey: 'sora2_api',
            label: 'Sora 2 API',
            enabled: true,
            route: 'legacy' as const,
            provider: 'sora2',
            modelName: 'Sora',
            modelVersion: '2.0',
          };
        const tencentVodVendor =
          existingVendors.find((vendor) => vendor.vendorKey === 'tencent_vod') || {
            vendorKey: 'tencent_vod',
            platformKey: 'tencent_vod',
            label: '腾讯 VOD',
            enabled: false,
            route: 'tencent_vod' as const,
            provider: 'sora2',
            modelName: 'OS',
            modelVersion: '2.0',
          };

        const normalizedSoraApiVendor: ManagedModelVendorConfig = {
          ...soraApiVendor,
          platformKey: 'sora2_api',
          label: soraApiVendor.label || 'Sora 2 API',
          enabled: soraApiVendor.enabled !== false,
          route: 'legacy',
          provider: soraApiVendor.provider || 'sora2',
          modelName: soraApiVendor.modelName || 'Sora',
          modelVersion: soraApiVendor.modelVersion || '2.0',
        };
        const normalizedTencentVodVendor: ManagedModelVendorConfig = {
          ...tencentVodVendor,
          platformKey: 'tencent_vod',
          label: tencentVodVendor.label || '腾讯 VOD',
          enabled: tencentVodVendor.enabled === true,
          route: 'tencent_vod',
          provider: tencentVodVendor.provider || 'sora2',
          modelName: tencentVodVendor.modelName || 'OS',
          modelVersion: tencentVodVendor.modelVersion || '2.0',
        };

        return this.ensureModelDefaultVendor({
          ...model,
          defaultVendor: model.defaultVendor || 'sora2_api',
          vendors: [normalizedSoraApiVendor, normalizedTencentVodVendor],
        });
      }

      if (model.modelKey === 'seedance-1.5') {
        const existingVendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
        const seedanceVendor =
          existingVendors.find((vendor) => vendor.vendorKey === 'seedance_api') || {
            vendorKey: 'seedance_api',
            platformKey: 'seedance_api',
            label: 'Seedance API',
            enabled: true,
            route: 'legacy' as const,
            provider: 'doubao',
            modelName: 'Seedance',
            modelVersion: '1.5-pro',
          };
        const tencentVodVendor =
          existingVendors.find((vendor) => vendor.vendorKey === 'tencent_vod') || {
            vendorKey: 'tencent_vod',
            platformKey: 'tencent_vod',
            label: '腾讯 VOD',
            enabled: false,
            route: 'tencent_vod' as const,
            provider: 'doubao',
            modelName: 'Seedance',
            modelVersion: '1.5-pro',
          };

        const normalizedSeedanceVendor: ManagedModelVendorConfig = {
          ...seedanceVendor,
          platformKey: 'seedance_api',
          label: seedanceVendor.label || 'Seedance API',
          enabled: seedanceVendor.enabled !== false,
          route: 'legacy',
          provider: seedanceVendor.provider || 'doubao',
          modelName: seedanceVendor.modelName || 'Seedance',
          modelVersion: seedanceVendor.modelVersion || '1.5-pro',
        };
        const normalizedTencentVodVendor: ManagedModelVendorConfig = {
          ...tencentVodVendor,
          platformKey: 'tencent_vod',
          label: tencentVodVendor.label || '腾讯 VOD',
          enabled: tencentVodVendor.enabled === true,
          route: 'tencent_vod',
          provider: tencentVodVendor.provider || 'doubao',
          modelName: tencentVodVendor.modelName || 'Seedance',
          modelVersion: tencentVodVendor.modelVersion || '1.5-pro',
          metadata: this.mergeMetadataWithFallback(
            DEFAULT_TENCENT_VOD_SEEDANCE15_V2_VENDOR_METADATA,
            tencentVodVendor.metadata && typeof tencentVodVendor.metadata === 'object'
              ? tencentVodVendor.metadata
              : undefined,
          ),
        };

        return this.ensureModelDefaultVendor({
          ...model,
          defaultVendor: model.defaultVendor || 'seedance_api',
          vendors: [normalizedSeedanceVendor, normalizedTencentVodVendor],
        });
      }

      if (model.modelKey !== 'seedance-2.0') {
        return model;
      }

      const existingVendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
      const seedanceVendor =
        existingVendors.find((vendor) => vendor.vendorKey === 'seedance_api') || {
          vendorKey: 'seedance_api',
          platformKey: 'seedance_api',
          label: 'Seedance API',
          enabled: true,
          route: 'legacy' as const,
          provider: 'doubao',
          modelName: 'Seedance',
          modelVersion: '2.0',
        };

      const normalizedVendor: ManagedModelVendorConfig = {
        ...seedanceVendor,
        platformKey: 'seedance_api',
        label: seedanceVendor.label || 'Seedance API',
        enabled: seedanceVendor.enabled !== false,
        route: 'legacy',
        provider: 'doubao',
        modelName: seedanceVendor.modelName || 'Seedance',
        modelVersion: '2.0',
        creditsPerCall: SEEDANCE20_DISCOUNT_CREDITS,
        priceYuan: SEEDANCE20_DISCOUNT_PRICE_YUAN,
        pricing: createSeedance20DiscountPricingTemplate(),
        metadata: this.mergeMetadataWithFallback(
          DEFAULT_SEEDANCE20_V2_VENDOR_METADATA,
          seedanceVendor.metadata && typeof seedanceVendor.metadata === 'object'
            ? seedanceVendor.metadata
            : undefined,
        ),
      };

      return this.ensureModelDefaultVendor({
        ...model,
        defaultVendor: 'seedance_api',
        vendors: [normalizedVendor],
      });
    });

    return {
      ...input,
      models: normalizeSeedance20DiscountPricing({
        models: models.map((model) => (model ? this.ensureModelDefaultVendor(model) : model)),
      }).models,
    };
  }

  async getParsedConfig(): Promise<ModelProviderMappingV2> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
      });
      const raw = setting?.value?.trim();
      if (!raw) {
        return this.getDefaultConfig();
      }

      const parsed = JSON.parse(raw) as ModelProviderMappingV2;
      if (!parsed || typeof parsed !== 'object') {
        return this.getDefaultConfig();
      }

      return normalizeSeedance20DiscountPricing(this.mergeWithDefaultConfig(parsed));
    } catch (error) {
      this.logger.warn(
        `读取模型路由配置失败，回退默认配置: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.getDefaultConfig();
    }
  }

  async resolveVideoModel(
    modelKey: string,
    preferredVendorKey?: string,
  ): Promise<ResolvedManagedModelRoute | null> {
    const [selected] = await this.resolveVideoModelCandidates(modelKey, preferredVendorKey);
    return selected || null;
  }

  async resolveVideoModelByVendor(
    modelKey: string,
    vendorKey: string,
    options?: { includeDisabled?: boolean },
  ): Promise<ResolvedManagedModelRoute | null> {
    const normalizedKey = typeof modelKey === 'string' ? modelKey.trim() : '';
    const normalizedVendorKey = typeof vendorKey === 'string' ? vendorKey.trim() : '';
    if (!normalizedKey || !normalizedVendorKey) return null;

    const config = await this.getParsedConfig();
    const models = Array.isArray(config.models) ? config.models : [];
    const platforms = Array.isArray(config.platforms) ? config.platforms.filter(Boolean) : [];
    const platformMap = new Map(
      platforms
        .filter((item) => typeof item.platformKey === 'string' && item.platformKey.trim())
        .map((item) => [item.platformKey.trim(), item] as const),
    );
    const model = models.find(
      (item) =>
        item &&
        item.enabled !== false &&
        typeof item.modelKey === 'string' &&
        item.modelKey.trim() === normalizedKey,
    );
    if (!model) return null;

    const vendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
    const vendor = vendors.find(
      (item) =>
        item &&
        typeof item.vendorKey === 'string' &&
        item.vendorKey.trim() === normalizedVendorKey &&
        (options?.includeDisabled === true || item.enabled !== false),
    );
    if (!vendor) return null;

    const platform =
      vendor.platformKey && platformMap.has(vendor.platformKey)
        ? platformMap.get(vendor.platformKey)
        : null;
    const mergedVendor: ManagedModelVendorConfig = {
      ...vendor,
      label: vendor.label || platform?.platformName || vendor.vendorKey,
      route: vendor.route || platform?.route || 'legacy',
      provider: vendor.provider || platform?.provider || '',
      metadata: {
        ...(platform?.metadata && typeof platform.metadata === 'object' ? platform.metadata : {}),
        ...(vendor.metadata && typeof vendor.metadata === 'object' ? vendor.metadata : {}),
      },
    };

    return {
      model,
      vendor: mergedVendor,
      route: mergedVendor.route === 'tencent_vod' ? 'tencent_vod' : 'legacy',
    };
  }

  async resolveVideoModelCandidates(
    modelKey: string,
    preferredVendorKey?: string,
  ): Promise<ResolvedManagedModelRoute[]> {
    const normalizedKey = typeof modelKey === 'string' ? modelKey.trim() : '';
    if (!normalizedKey) return [];

    const config = await this.getParsedConfig();
    const models = Array.isArray(config.models) ? config.models : [];
    const platforms = Array.isArray(config.platforms) ? config.platforms.filter(Boolean) : [];
    const platformMap = new Map(
      platforms
        .filter((item) => typeof item.platformKey === 'string' && item.platformKey.trim())
        .map((item) => [item.platformKey.trim(), item] as const),
    );
    const model = models.find(
      (item) =>
        item &&
        item.enabled !== false &&
        typeof item.modelKey === 'string' &&
        item.modelKey.trim() === normalizedKey,
    );
    if (!model) return [];

    const vendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
    const enabledVendors = vendors.filter((item) => item.enabled !== false);
    if (!enabledVendors.length) return [];

    const normalizedPreferredVendorKey =
      typeof preferredVendorKey === 'string' ? preferredVendorKey.trim() : '';

    const selected =
      (normalizedPreferredVendorKey
        ? enabledVendors.find(
            (item) =>
              typeof item.vendorKey === 'string' &&
              item.vendorKey.trim() === normalizedPreferredVendorKey,
          )
        : null) ||
      enabledVendors.find(
        (item) =>
          typeof item.vendorKey === 'string' &&
          item.vendorKey.trim() === (model.defaultVendor || '').trim(),
      ) || enabledVendors[0];

    const orderedVendors = [
      selected,
      ...enabledVendors.filter((item) => item.vendorKey !== selected.vendorKey),
    ];

    return orderedVendors.map((vendor) => {
      const platform =
        vendor.platformKey && platformMap.has(vendor.platformKey)
          ? platformMap.get(vendor.platformKey)
          : null;
      const mergedVendor: ManagedModelVendorConfig = {
        ...vendor,
        label: vendor.label || platform?.platformName || vendor.vendorKey,
        route: vendor.route || platform?.route || 'legacy',
        provider: vendor.provider || platform?.provider || '',
        metadata: {
          ...(platform?.metadata && typeof platform.metadata === 'object' ? platform.metadata : {}),
          ...(vendor.metadata && typeof vendor.metadata === 'object' ? vendor.metadata : {}),
        },
      };

      return {
        model,
        vendor: mergedVendor,
        route: mergedVendor.route === 'tencent_vod' ? 'tencent_vod' : 'legacy',
      };
    });
  }
}
