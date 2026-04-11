import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ManagedPricingBook } from './model-pricing-resolver';

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
      enabled: false,
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
          metadata: DEFAULT_SEEDANCE20_V2_VENDOR_METADATA,
        },
      ],
    },
  ],
};

@Injectable()
export class ModelRoutingService {
  private readonly logger = new Logger(ModelRoutingService.name);

  constructor(private readonly prisma: PrismaService) {}

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
          metadata:
            tencentVodVendor.metadata && typeof tencentVodVendor.metadata === 'object'
              ? tencentVodVendor.metadata
              : DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA,
        };

        return this.ensureModelDefaultVendor({
          ...model,
          defaultVendor: model.defaultVendor || 'vidu_api',
          vendors: [normalizedLegacyVendor, normalizedTencentVodVendor],
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
          metadata:
            tencentVodVendor.metadata && typeof tencentVodVendor.metadata === 'object'
              ? tencentVodVendor.metadata
              : DEFAULT_TENCENT_VOD_SEEDANCE15_V2_VENDOR_METADATA,
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
        metadata:
          seedanceVendor.metadata && typeof seedanceVendor.metadata === 'object'
            ? seedanceVendor.metadata
            : DEFAULT_SEEDANCE20_V2_VENDOR_METADATA,
      };

      return this.ensureModelDefaultVendor({
        ...model,
        defaultVendor: 'seedance_api',
        vendors: [normalizedVendor],
      });
    });

    return {
      ...input,
      models: models.map((model) => (model ? this.ensureModelDefaultVendor(model) : model)),
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

      return this.mergeWithDefaultConfig(parsed);
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
