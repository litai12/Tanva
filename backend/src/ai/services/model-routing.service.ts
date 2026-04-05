import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
  modelName?: string;
  modelVersion?: string;
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
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: false,
          route: 'tencent_vod',
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
          enabled: false,
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
          modelVersion: '3.0-Omni',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: false,
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
      defaultVendor: 'vidu_api',
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
          enabled: false,
          route: 'tencent_vod',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'q2',
        },
      ],
    },
    {
      modelKey: 'vidu-q2-turbo',
      modelName: 'Vidu Q2-Turbo',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'q2-turbo',
        },
      ],
    },
    {
      modelKey: 'vidu-q2-pro',
      modelName: 'Vidu Q2-Pro',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'q2-pro',
        },
      ],
    },
    {
      modelKey: 'vidu-q3',
      modelName: 'Vidu Q3',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'vidu_api',
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
          enabled: false,
          route: 'tencent_vod',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'q3',
        },
      ],
    },
    {
      modelKey: 'vidu-q3-mix',
      modelName: 'Vidu Q3-Mix',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'tencent_vod',
      vendors: [
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: true,
          route: 'tencent_vod',
          provider: 'vidu',
          modelName: 'Vidu',
          modelVersion: 'q3-mix',
        },
      ],
    },
    {
      modelKey: 'sora-2',
      modelName: 'Sora 2',
      taskType: 'video',
      enabled: true,
      defaultVendor: 'sora2_api',
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
          enabled: false,
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
          modelVersion: '1.5-pro',
        },
        {
          vendorKey: 'tencent_vod',
          platformKey: 'tencent_vod',
          label: '腾讯 VOD',
          enabled: false,
          route: 'tencent_vod',
          provider: 'doubao',
          modelName: 'Seedance',
          modelVersion: '1.5-pro',
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

  private mergeWithDefaultConfig(input: ModelProviderMappingV2): ModelProviderMappingV2 {
    const fallback = this.getDefaultConfig();
    const existingPlatforms = Array.isArray(input.platforms) ? input.platforms.filter(Boolean) : [];
    const existingPlatformKeys = new Set(
      existingPlatforms.map((item) => (typeof item?.platformKey === 'string' ? item.platformKey : '')).filter(Boolean),
    );
    const mergedPlatforms = [
      ...existingPlatforms,
      ...(fallback.platforms || []).filter(
        (item) => item && typeof item.platformKey === 'string' && !existingPlatformKeys.has(item.platformKey),
      ),
    ];

    const existingModels = Array.isArray(input.models) ? input.models.filter(Boolean) : [];
    const existingModelKeys = new Set(
      existingModels.map((item) => (typeof item?.modelKey === 'string' ? item.modelKey : '')).filter(Boolean),
    );
    const mergedModels = [
      ...existingModels,
      ...(fallback.models || []).filter(
        (item) => item && typeof item.modelKey === 'string' && !existingModelKeys.has(item.modelKey),
      ),
    ];

    return this.normalizeSpecialCases({
      version: input.version || fallback.version || 'v2',
      platforms: mergedPlatforms,
      models: mergedModels,
    });
  }

  private normalizeSpecialCases(input: ModelProviderMappingV2): ModelProviderMappingV2 {
    const models = (Array.isArray(input.models) ? input.models : []).map((model) => {
      if (!model || model.modelKey !== 'seedance-2.0') {
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

      return {
        ...model,
        defaultVendor: 'seedance_api',
        vendors: [
          {
            ...seedanceVendor,
            platformKey: 'seedance_api',
            label: seedanceVendor.label || 'Seedance API',
            enabled: seedanceVendor.enabled !== false,
            route: 'legacy',
            provider: 'doubao',
            modelName: seedanceVendor.modelName || 'Seedance',
            modelVersion: '2.0',
          },
        ],
      };
    });

    return {
      ...input,
      models,
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

  async resolveVideoModel(modelKey: string): Promise<ResolvedManagedModelRoute | null> {
    const normalizedKey = typeof modelKey === 'string' ? modelKey.trim() : '';
    if (!normalizedKey) return null;

    const config = await this.getParsedConfig();
    const models = Array.isArray(config.models) ? config.models : [];
    const model = models.find(
      (item) =>
        item &&
        item.enabled !== false &&
        typeof item.modelKey === 'string' &&
        item.modelKey.trim() === normalizedKey,
    );
    if (!model) return null;

    const vendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
    const enabledVendors = vendors.filter((item) => item.enabled !== false);
    if (!enabledVendors.length) return null;

    const selected =
      enabledVendors.find(
        (item) =>
          typeof item.vendorKey === 'string' &&
          item.vendorKey.trim() === (model.defaultVendor || '').trim(),
      ) || enabledVendors[0];

    const route = selected.route === 'tencent_vod' ? 'tencent_vod' : 'legacy';

    return {
      model,
      vendor: selected,
      route,
    };
  }
}
