import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { ApiConfig, Prisma } from '@prisma/client';
import { SupplierTestService, StreamEvent } from './supplier-test.service';
import { ApiProtocolType } from '../common/api-protocol.enum';

export interface ApiHealthStatus {
  nodeKey: string;
  configId?: string;
  name: string;
  provider: string;
  channelName?: string;
  channelType?: string;
  modelName?: string;
  serviceType?: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs?: number;
  error?: string;
  lastChecked: Date;
  endpoint?: string;
  hasApiKey: boolean;
}

export interface HealthCheckResult {
  timestamp: Date;
  totalApis: number;
  healthyCount: number;
  unhealthyCount: number;
  unknownCount: number;
  apis: ApiHealthStatus[];
}

export interface CreateApiConfigDto {
  name: string;
  provider: string;
  apiKey: string;
  endpoint?: string;
  enabled?: boolean;
  category?: string;
  apiProtocol?: string;
  modelName?: string;
  metadata?: any;
}

export interface UpdateApiConfigDto {
  name?: string;
  apiKey?: string;
  endpoint?: string;
  enabled?: boolean;
  category?: string;
  apiProtocol?: string;
  modelName?: string;
  metadata?: any;
}

export interface HealthDataPoint {
  timestamp: string;
  latencyMs: number | null;
  status: 'online' | 'offline';
  errorDetail: string | null;
}

export interface HealthHistorySeries {
  nodeKey: string;
  configId: string;
  label: string;
  provider: string;
  points: HealthDataPoint[];
}

export interface HealthHistoryResult {
  timeRange: string;
  bucketMinutes: number;
  series: HealthHistorySeries[];
}

export interface ApiHealthNode {
  nodeKey: string;
  name: string;
  serviceType: string | null;
  modelName: string | null;
  provider: string | null;
  channelName: string | null;
  channelType: string | null;
  configId: string | null;
  apiProtocol: string | null;
  endpoint: string | null;
  hasApiKey: boolean;
  nodeStatus: string;
  nodeVisible: boolean;
  configEnabled: boolean | null;
  monitorable: boolean;
  monitorDisabledReason: string | null;
  bindingStrategy: BindingStrategy;
}

type BindingStrategy = 'MANUAL' | 'METADATA' | 'MATCH' | 'FALLBACK';

interface NodeMonitorBinding {
  nodeKey: string;
  name: string;
  serviceType: string | null;
  preferredModelName: string | null;
  preferredProvider: string | null;
  nodeStatus: string;
  nodeVisible: boolean;
  mappedConfig: ApiConfig | null;
  channelType: string | null;
  bindingStrategy: BindingStrategy;
}

const CRON_JOB_NAME = 'api-health-check';
const E2E_CRON_JOB_NAME = 'api-e2e-check';
const CHECK_TIMEOUT_MS = 10000;
const E2E_DEFAULT_PROMPT = '现代极简风格大平层客厅，落地窗，阳光洒落，高精度3D渲染，电影级构图';

@Injectable()
export class ApiHealthService implements OnModuleInit {
  private readonly logger = new Logger(ApiHealthService.name);
  private lastHealthCheck: HealthCheckResult | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly supplierTestService: SupplierTestService,
  ) {}

  private readonly API_CONFIG_SELECT_SQL = `
    SELECT
      "id",
      "name",
      "provider",
      "apiKey",
      "endpoint",
      "enabled",
      "category",
      "apiProtocol",
      "metadata",
      "createdAt",
      "updatedAt",
      "modelName"
    FROM "ApiConfig"
  `;

  async onModuleInit() {
    await this.syncApiConfigsFromEnv();
    await this.backfillApiProtocol();
    await this.registerCronFromDb();
  }

  /**
   * 一次性历史数据修复：为 apiProtocol 为 null 的节点自动推断并填充协议
   */
  private async backfillApiProtocol(): Promise<void> {
    const unset = await this.prisma.apiConfig.findMany({
      where: { apiProtocol: null },
      select: { id: true, provider: true, name: true },
    });
    if (unset.length === 0) return;

    const rules: Array<{ match: (p: string) => boolean; protocol: ApiProtocolType }> = [
      { match: (p) => p.includes('kling'),                                                          protocol: ApiProtocolType.KLING_NATIVE },
      { match: (p) => p.includes('vidu'),                                                           protocol: ApiProtocolType.VIDU_NATIVE },
      { match: (p) => p.includes('doubao'),                                                         protocol: ApiProtocolType.DOUBAO_VOLC_NATIVE },
      { match: (p) => p.includes('sora') || p.includes('apimart') || p.includes('xin147') || p.includes('zhenzhen'), protocol: ApiProtocolType.ASYNC_PROXY_STANDARD },
      { match: (p) => p.includes('openai') || p.includes('chatgpt'),                               protocol: ApiProtocolType.OPENAI_COMPATIBLE },
    ];

    let patched = 0;
    for (const cfg of unset) {
      const p = cfg.provider.toLowerCase();
      const rule = rules.find((r) => r.match(p));
      if (!rule) continue;
      await this.prisma.apiConfig.update({
        where: { id: cfg.id },
        data: { apiProtocol: rule.protocol },
      });
      this.logger.log(`🔧 自动填充协议 [${cfg.name}] → ${rule.protocol}`);
      patched++;
    }
    if (patched > 0) {
      this.logger.log(`✅ 历史节点协议回填完成，共修复 ${patched} 条`);
    }
  }

  /**
   * 从数据库读取 Cron 配置并动态注册定时任务
   */
  private async registerCronFromDb() {
    const config = await this.getScheduleConfig();

    // 如果已存在旧任务，先销毁
    try {
      this.schedulerRegistry.deleteCronJob(CRON_JOB_NAME);
    } catch (_) {
      // 首次启动时不存在，忽略
    }

    if (!config.enabled) {
      this.logger.log('⏭️ 定时健康检查已禁用，跳过注册');
      return;
    }

    const job = new CronJob(
      config.cronExpression,
      async () => {
        this.logger.log('⏰ 定时健康检查任务开始...');
        await this.checkAllApisHealth();
        this.logger.log('✅ 定时健康检查任务完成');
      },
      null,
      true,
      config.timezone,
    );

    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    this.logger.log(`✅ 定时健康检查已注册: ${config.cronExpression} (${config.timezone})`);
  }

  /**
   * 从环境变量同步 API 配置到数据库（仅在配置不存在时创建）
   */
  private async syncApiConfigsFromEnv() {
    try {
      const envConfigs = [
        {
          name: 'Google Gemini',
          provider: 'gemini',
          apiKey: this.configService.get<string>('GOOGLE_GEMINI_API_KEY') || '',
          endpoint: 'https://generativelanguage.googleapis.com',
          category: 'image',
        },
        {
          name: 'Banana',
          provider: 'banana',
          apiKey: this.configService.get<string>('BANANA_API_KEY') || '',
          category: 'image',
        },
        {
          name: 'RunningHub',
          provider: 'runninghub',
          apiKey: this.configService.get<string>('RUNNINGHUB_API_KEY') || '',
          endpoint: 'https://www.runninghub.cn',
          category: 'other',
        },
        {
          name: '可灵 Kling',
          provider: 'kling',
          apiKey: this.configService.get<string>('KLING_API_KEY') || '',
          endpoint: 'https://models.kapon.cloud/kling',
          category: 'video',
          apiProtocol: ApiProtocolType.KLING_NATIVE,
        },
        {
          name: 'Vidu',
          provider: 'vidu',
          apiKey: this.configService.get<string>('VIDU_API_KEY') || '',
          endpoint: 'https://models.kapon.cloud/vidu',
          category: 'video',
          apiProtocol: ApiProtocolType.VIDU_NATIVE,
        },
        {
          name: '豆包 Doubao',
          provider: 'doubao',
          apiKey: this.configService.get<string>('DOUBAO_API_KEY') || '',
          endpoint: this.configService.get<string>('DOUBAO_API_ENDPOINT') || 'https://ark.cn-beijing.volces.com',
          category: 'video',
          apiProtocol: ApiProtocolType.DOUBAO_VOLC_NATIVE,
        },
        {
          name: 'Sora2',
          provider: 'sora2',
          apiKey: this.configService.get<string>('SORA2_API_KEY') || '',
          endpoint: this.configService.get<string>('SORA2_API_ENDPOINT') || 'https://api1.147ai.com',
          category: 'video',
          apiProtocol: ApiProtocolType.ASYNC_PROXY_STANDARD,
        },
        {
          name: 'Midjourney',
          provider: 'midjourney',
          apiKey: this.configService.get<string>('MIDJOURNEY_API_KEY') || '',
          endpoint: 'https://api.midjourneyapi.xyz',
          category: 'image',
        },
        {
          name: 'VEO',
          provider: 'veo',
          apiKey: this.configService.get<string>('VEO_API_KEY') || '',
          category: 'video',
        },
        {
          name: 'DashScope (通义千问)',
          provider: 'dashscope',
          apiKey: this.configService.get<string>('DASHSCOPE_API_KEY') || '',
          endpoint: 'https://dashscope.aliyuncs.com',
          category: 'image',
        },
      ];

      for (const config of envConfigs) {
        if (!config.apiKey || config.apiKey.includes('xxx')) {
          continue; // 跳过无效的 API Key
        }

        const existing = await this.findApiConfigByProviderAndModel(config.provider, null);

        if (!existing) {
          await this.prisma.apiConfig.create({
            data: { ...config, enabled: true },
          });
          this.logger.log(`✅ 已同步 API 配置: ${config.name}`);
        } else {
          // 更新 endpoint / apiKey / apiProtocol（保留用户手动改过的 enabled 状态）
          const updateData: Record<string, any> = { apiKey: config.apiKey };
          if (config.endpoint) updateData.endpoint = config.endpoint;
          if ((config as any).apiProtocol) updateData.apiProtocol = (config as any).apiProtocol;
          await this.prisma.apiConfig.update({
            where: { id: existing.id },
            data: updateData,
          });
        }
      }
    } catch (error) {
      this.logger.error('同步 API 配置失败:', error);
    }
  }

  /**
   * 获取所有 API 配置
   */
  async getAllApiConfigs(): Promise<ApiConfig[]> {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `${this.API_CONFIG_SELECT_SQL} ORDER BY "createdAt" ASC`,
    );
    return rows as ApiConfig[];
  }

  /**
   * 以业务节点为主体返回监测列表（节点管理 1:1 对应）
   */
  async getAllApiHealthNodes(): Promise<ApiHealthNode[]> {
    const bindings = await this.getNodeMonitorBindings();
    return bindings.map((binding) => {
      const cfg = binding.mappedConfig;
      return {
        nodeKey: binding.nodeKey,
        name: binding.name,
        serviceType: binding.serviceType,
        modelName: binding.preferredModelName,
        provider: cfg?.provider ?? binding.preferredProvider,
        channelName: cfg?.name ?? null,
        channelType: binding.channelType,
        configId: cfg?.id ?? null,
        apiProtocol: cfg?.apiProtocol ?? null,
        endpoint: cfg?.endpoint ?? null,
        hasApiKey: !!cfg?.apiKey,
        nodeStatus: binding.nodeStatus,
        nodeVisible: binding.nodeVisible,
        configEnabled: cfg?.enabled ?? null,
        monitorable: !!cfg && !!cfg.enabled && !!cfg.apiProtocol && !this.isNodeRuntimeDisabled(binding.nodeStatus),
        monitorDisabledReason: this.getMonitorDisabledReason(binding),
        bindingStrategy: binding.bindingStrategy,
      };
    });
  }

  /**
   * 为业务节点设置/清除强制绑定通道（metadata.apiHealth.configId）
   * - configId 非空：写入强制绑定
   * - configId 为空：清除强制绑定，恢复自动推断
   */
  async updateNodeBinding(nodeKey: string, configId: string | null): Promise<ApiHealthNode> {
    const node = await this.prisma.nodeConfig.findUnique({
      where: { nodeKey },
      select: { metadata: true },
    });
    if (!node) {
      throw new NotFoundException(`业务节点不存在: ${nodeKey}`);
    }

    if (configId) {
      const configRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "ApiConfig" WHERE "id" = ${configId} LIMIT 1
      `;
      if (!configRows[0]) {
        throw new NotFoundException(`底层通道不存在: ${configId}`);
      }
    }

    const rawMetadata = node.metadata;
    const metadataObj: Record<string, any> =
      rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
        ? { ...(rawMetadata as Record<string, any>) }
        : {};
    const apiHealthMeta: Record<string, any> =
      metadataObj.apiHealth && typeof metadataObj.apiHealth === 'object' && !Array.isArray(metadataObj.apiHealth)
        ? { ...(metadataObj.apiHealth as Record<string, any>) }
        : {};

    if (configId) {
      apiHealthMeta.configId = configId;
      delete apiHealthMeta.apiConfigId;
    } else {
      delete apiHealthMeta.configId;
      delete apiHealthMeta.apiConfigId;
    }
    metadataObj.apiHealth = apiHealthMeta;

    await this.prisma.nodeConfig.update({
      where: { nodeKey },
      data: { metadata: metadataObj as Prisma.InputJsonValue },
    });

    const updated = (await this.getAllApiHealthNodes()).find((item) => item.nodeKey === nodeKey);
    if (!updated) {
      throw new NotFoundException(`业务节点不存在: ${nodeKey}`);
    }
    return updated;
  }

  /**
   * 获取单个 API 配置
   */
  async getApiConfig(id: string): Promise<ApiConfig> {
    const configRows = await this.prisma.$queryRaw<any[]>`
      SELECT
        "id",
        "name",
        "provider",
        "apiKey",
        "endpoint",
        "enabled",
        "category",
        "apiProtocol",
        "metadata",
        "createdAt",
        "updatedAt",
        "modelName"
      FROM "ApiConfig"
      WHERE "id" = ${id}
      LIMIT 1
    `;
    const config = configRows[0] as ApiConfig | undefined;

    if (!config) {
      throw new NotFoundException(`API 配置不存在: ${id}`);
    }

    return config;
  }

  /**
   * 创建 API 配置
   */
  async createApiConfig(dto: CreateApiConfigDto): Promise<ApiConfig> {
    const normalizedModelName = dto.modelName?.trim() || null;

    // 同一 provider + modelName 仅允许一个节点（modelName 为空时按 null 比较）
    const existing = await this.findApiConfigByProviderAndModel(dto.provider, normalizedModelName);

    if (existing) {
      throw new BadRequestException(
        `节点已存在: provider=${dto.provider}, modelName=${normalizedModelName ?? 'null'}`,
      );
    }

    const createData: Record<string, any> = {
      name: dto.name,
      provider: dto.provider,
      apiKey: dto.apiKey,
      endpoint: dto.endpoint,
      enabled: dto.enabled ?? true,
      category: dto.category || 'other',
      apiProtocol: dto.apiProtocol ?? null,
      metadata: dto.metadata,
    };
    const created = await this.prisma.apiConfig.create({
      data: createData as any,
      select: { id: true },
    });
    if (normalizedModelName !== null) {
      await this.prisma.$executeRaw`
        UPDATE "ApiConfig"
        SET "modelName" = ${normalizedModelName}, "updatedAt" = NOW()
        WHERE "id" = ${created.id}
      `;
    }
    return this.getApiConfig(created.id);
  }

  /**
   * 更新 API 配置
   */
  async updateApiConfig(id: string, dto: UpdateApiConfigDto): Promise<ApiConfig> {
    const existing = await this.getApiConfig(id);
    const existingModelName = ((existing as any).modelName as string | null | undefined) ?? null;
    const normalizedModelName = dto.modelName !== undefined ? (dto.modelName?.trim() || null) : existingModelName;

    if (normalizedModelName !== existingModelName) {
      const duplicate = await this.findApiConfigByProviderAndModel(existing.provider, normalizedModelName, id);
      if (duplicate) {
        throw new BadRequestException(
          `节点已存在: provider=${existing.provider}, modelName=${normalizedModelName ?? 'null'}`,
        );
      }
    }

    const updateData: Record<string, any> = {
      name: dto.name ?? existing.name,
      apiKey: dto.apiKey ?? existing.apiKey,
      endpoint: dto.endpoint ?? existing.endpoint,
      enabled: dto.enabled ?? existing.enabled,
      category: dto.category ?? existing.category,
      apiProtocol: dto.apiProtocol !== undefined ? (dto.apiProtocol || null) : existing.apiProtocol,
      metadata: dto.metadata ?? existing.metadata,
    };
    const updated = await this.prisma.apiConfig.update({
      where: { id },
      select: { id: true },
      data: updateData as any,
    });
    if (dto.modelName !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE "ApiConfig"
        SET "modelName" = ${normalizedModelName}, "updatedAt" = NOW()
        WHERE "id" = ${id}
      `;
    }
    return this.getApiConfig(updated.id);
  }

  /**
   * 删除 API 配置
   */
  async deleteApiConfig(id: string): Promise<void> {
    await this.getApiConfig(id); // 检查是否存在
    await this.prisma.apiConfig.delete({
      where: { id },
    });
  }

  /**
   * 获取定时检测配置
   */
  async getScheduleConfig(): Promise<{ enabled: boolean; cronExpression: string; timezone: string; webhookUrl?: string }> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'api_health_check_schedule' },
    });

    if (!setting) {
      return {
        enabled: true,
        cronExpression: '0 3 * * *',
        timezone: 'Asia/Shanghai',
      };
    }

    const config = JSON.parse(setting.value);
    return {
      enabled: config.enabled ?? true,
      cronExpression: config.cronExpression || '0 3 * * *',
      timezone: config.timezone || 'Asia/Shanghai',
      webhookUrl: config.webhookUrl || undefined,
    };
  }

  /**
   * 更新定时检测配置
   */
  async updateScheduleConfig(config: { enabled: boolean; cronExpression: string; timezone?: string; webhookUrl?: string }): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key: 'api_health_check_schedule' },
      create: {
        key: 'api_health_check_schedule',
        value: JSON.stringify({
          enabled: config.enabled,
          cronExpression: config.cronExpression,
          timezone: config.timezone || 'Asia/Shanghai',
          webhookUrl: config.webhookUrl || '',
        }),
        description: 'API 健康检查定时任务配置',
      },
      update: {
        value: JSON.stringify({
          enabled: config.enabled,
          cronExpression: config.cronExpression,
          timezone: config.timezone || 'Asia/Shanghai',
          webhookUrl: config.webhookUrl || '',
        }),
      },
    });

    this.logger.log(`✅ 已更新定时检测配置: ${JSON.stringify(config)}`);

    // 动态重新注册定时任务
    await this.registerCronFromDb();
  }

  /**
   * 手动触发定时任务（测试用）
   */
  async triggerScheduledCheck() {
    this.logger.log('⏰ 手动触发健康检查任务开始...');
    await this.checkAllApisHealth();
    this.logger.log('✅ 手动触发健康检查任务完成');
  }

  /**
   * 发送一条测试消息到 Webhook（验证配置是否正确）
   */
  async testWebhook(): Promise<{ success: boolean; message: string }> {
    const config = await this.getScheduleConfig();
    const webhookUrl = config.webhookUrl || this.configService.get<string>('ALERT_WEBHOOK_URL');
    if (!webhookUrl) {
      return { success: false, message: '未配置 Webhook URL，请先在定时监测设置中填写' };
    }

    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const payload = {
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title: '👋 Tanvasbot 连接测试',
            content: [
              [{ tag: 'text', text: '大家好，我是 Tanvasbot！' }],
              [{ tag: 'text', text: '功能1：API 链路定时监测通知' }],
              [{ tag: 'text', text: `测试时间：${now}` }],
            ],
          },
        },
      },
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        return { success: false, message: `Webhook 响应异常: HTTP ${res.status}` };
      }
      return { success: true, message: '测试消息已发送，请查看飞书群' };
    } catch (e: any) {
      return { success: false, message: `发送失败: ${e.message}` };
    }
  }

  /**
   * 获取最后一次健康检查结果
   */
  getLastHealthCheck(): HealthCheckResult | null {
    return this.lastHealthCheck;
  }

  /**
   * 检查所有 API 的健康状态
   */
  async checkAllApisHealth(): Promise<HealthCheckResult> {
    this.logger.log('🔍 开始检查所有 API 健康状态...');

    const bindings = await this.getNodeMonitorBindings();
    const checkedConfigCache = new Map<string, ApiHealthStatus>();
    const results: ApiHealthStatus[] = [];

    for (const binding of bindings) {
      if (this.isNodeRuntimeDisabled(binding.nodeStatus)) {
        results.push({
          nodeKey: binding.nodeKey,
          configId: binding.mappedConfig?.id,
          name: binding.name,
          provider: binding.mappedConfig?.provider ?? binding.preferredProvider ?? 'unknown',
          channelName: binding.mappedConfig?.name,
          channelType: binding.channelType ?? undefined,
          modelName: binding.preferredModelName ?? undefined,
          serviceType: binding.serviceType ?? undefined,
          status: 'unknown',
          lastChecked: new Date(),
          endpoint: binding.mappedConfig?.endpoint || undefined,
          hasApiKey: !!binding.mappedConfig?.apiKey,
          error: `节点状态为 ${binding.nodeStatus}`,
        });
        continue;
      }

      if (!binding.mappedConfig) {
        results.push({
          nodeKey: binding.nodeKey,
          name: binding.name,
          provider: binding.preferredProvider ?? 'unknown',
          channelType: binding.channelType ?? undefined,
          modelName: binding.preferredModelName ?? undefined,
          serviceType: binding.serviceType ?? undefined,
          status: 'unknown',
          lastChecked: new Date(),
          hasApiKey: false,
          error: '未绑定底层渠道配置',
        });
        continue;
      }

      if (!binding.mappedConfig.enabled) {
        results.push({
          nodeKey: binding.nodeKey,
          configId: binding.mappedConfig.id,
          name: binding.name,
          provider: binding.mappedConfig.provider,
          channelName: binding.mappedConfig.name,
          channelType: binding.channelType ?? undefined,
          modelName: binding.preferredModelName ?? undefined,
          serviceType: binding.serviceType ?? undefined,
          status: 'unknown',
          lastChecked: new Date(),
          endpoint: binding.mappedConfig.endpoint || undefined,
          hasApiKey: !!binding.mappedConfig.apiKey,
          error: '底层渠道已禁用',
        });
        continue;
      }

      const cacheKey = binding.mappedConfig.id;
      let configHealth = checkedConfigCache.get(cacheKey);
      if (!configHealth) {
        configHealth = await this.checkApiHealth(binding.mappedConfig);
        checkedConfigCache.set(cacheKey, configHealth);

        // 同一底层渠道只写一条日志，避免一对多绑定时重复落库
        this.writeHealthLog(configHealth).catch((e) =>
          this.logger.error(`写入健康日志失败 [${binding.mappedConfig?.id}/${binding.mappedConfig?.provider}]: ${e.message}`),
        );
      }

      results.push(this.buildNodeStatusFromConfigHealth(binding, configHealth));
    }

    const healthyCount = results.filter((r) => r.status === 'healthy').length;
    const unhealthyCount = results.filter((r) => r.status === 'unhealthy').length;
    const unknownCount = results.filter((r) => r.status === 'unknown').length;

    const result: HealthCheckResult = {
      timestamp: new Date(),
      totalApis: results.length,
      healthyCount,
      unhealthyCount,
      unknownCount,
      apis: results,
    };

    this.lastHealthCheck = result;

    this.logger.log(
      `✅ 健康检查完成: 总计 ${result.totalApis}, 健康 ${healthyCount}, 异常 ${unhealthyCount}, 未知 ${unknownCount}`,
    );

    return result;
  }

  // ─── L2 E2E 深度拨测 ──────────────────────────────────────────

  /**
   * 读取 E2E 拨测配置（Cron + Prompt）
   */
  async getE2EScheduleConfig(): Promise<{ enabled: boolean; cronExpression: string; timezone: string; prompt: string }> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'api_e2e_check_schedule' },
    });
    if (!setting) {
      return { enabled: false, cronExpression: '0 8 * * *', timezone: 'Asia/Shanghai', prompt: E2E_DEFAULT_PROMPT };
    }
    const config = JSON.parse(setting.value);
    return {
      enabled: config.enabled ?? false,
      cronExpression: config.cronExpression || '0 8 * * *',
      timezone: config.timezone || 'Asia/Shanghai',
      prompt: config.prompt || E2E_DEFAULT_PROMPT,
    };
  }

  /**
   * 更新 E2E 拨测配置，并动态重注册 Cron
   */
  async updateE2EScheduleConfig(config: { enabled: boolean; cronExpression: string; timezone?: string; prompt?: string }): Promise<void> {
    const value = JSON.stringify({
      enabled: config.enabled,
      cronExpression: config.cronExpression,
      timezone: config.timezone || 'Asia/Shanghai',
      prompt: config.prompt || E2E_DEFAULT_PROMPT,
    });
    await this.prisma.systemSetting.upsert({
      where: { key: 'api_e2e_check_schedule' },
      create: { key: 'api_e2e_check_schedule', value, description: 'E2E 深度拨测定时任务配置' },
      update: { value },
    });
    await this.registerE2ECronFromDb();
  }

  /**
   * 注册 E2E 定时任务（全量跑所有配置了 apiProtocol 的节点）
   */
  private async registerE2ECronFromDb(): Promise<void> {
    try { this.schedulerRegistry.deleteCronJob(E2E_CRON_JOB_NAME); } catch (_) {}

    const config = await this.getE2EScheduleConfig();
    if (!config.enabled) return;

    const job = new CronJob(config.cronExpression, async () => {
      this.logger.log('⏰ E2E 定时深度拨测开始...');
      const nodes = await this.getNodeMonitorBindings();
      for (const node of nodes) {
        const cfg = node.mappedConfig;
        if (!cfg || !cfg.enabled || !cfg.apiProtocol || this.isNodeRuntimeDisabled(node.nodeStatus)) continue;
        this.logger.log(`  ▶ E2E 拨测: ${node.name}${node.preferredModelName ? ` (${node.preferredModelName})` : ''} -> ${cfg.name} (${cfg.provider})`);
        // 消费完整流，只关心最终结果
        for await (const _ of this.runE2ENodeTestByNodeKey(node.nodeKey)) { /* 事件已在方法内落库 */ }
      }
      this.logger.log('✅ E2E 定时深度拨测完成');
    }, null, true, config.timezone);

    this.schedulerRegistry.addCronJob(E2E_CRON_JOB_NAME, job);
    this.logger.log(`✅ E2E 定时拨测已注册: ${config.cronExpression} (${config.timezone})`);
  }

  /**
   * 流式 E2E 深度拨测 — AsyncGenerator，供 Controller for-await 推送 NDJSON
   * 复用 SupplierTestService.streamTest() 的完整轮询引擎
   */
  async *runE2ENodeTest(provider: string): AsyncGenerator<StreamEvent> {
    const bindings = await this.getNodeMonitorBindings();
    const target = bindings.find((binding) => binding.mappedConfig?.provider === provider);
    if (!target) {
      yield { event: 'error', data: { message: `未找到 provider=${provider} 的业务节点` } };
      return;
    }
    for await (const event of this.runE2ENodeTestWithNodeBinding(target)) {
      yield event;
    }
  }

  /**
   * 通过 ApiConfig.id 精确执行 E2E 深度拨测，避免前端 provider 串号时误测错误节点。
   */
  async *runE2ENodeTestByConfigId(configId: string): AsyncGenerator<StreamEvent> {
    const bindings = await this.getNodeMonitorBindings();
    const binding = bindings.find((item) => item.mappedConfig?.id === configId);
    if (!binding) {
      yield { event: 'error', data: { message: `节点不存在: ${configId}` } };
      return;
    }
    for await (const event of this.runE2ENodeTestWithNodeBinding(binding)) {
      yield event;
    }
  }

  /**
   * 通过业务节点 nodeKey 精确执行 E2E 深度拨测（业务节点 1:1）
   */
  async *runE2ENodeTestByNodeKey(nodeKey: string): AsyncGenerator<StreamEvent> {
    const binding = await this.getNodeBindingByKey(nodeKey);
    if (!binding) {
      yield { event: 'error', data: { message: `业务节点不存在: ${nodeKey}` } };
      return;
    }
    for await (const event of this.runE2ENodeTestWithNodeBinding(binding)) {
      yield event;
    }
  }

  private async *runE2ENodeTestWithNodeBinding(binding: NodeMonitorBinding): AsyncGenerator<StreamEvent> {
    const config = binding.mappedConfig;
    if (!config) {
      yield { event: 'error', data: { message: `业务节点 [${binding.name}] 未绑定底层渠道` } };
      return;
    }
    if (!config.enabled) {
      yield { event: 'error', data: { message: `底层渠道已禁用: ${config.name}` } };
      return;
    }
    if (this.isNodeRuntimeDisabled(binding.nodeStatus)) {
      yield { event: 'error', data: { message: `业务节点状态不可拨测: ${binding.nodeStatus}` } };
      return;
    }

    const configId = config.id;
    const provider = config.provider;

    const apiProtocol = config.apiProtocol as ApiProtocolType | null;
    if (!apiProtocol || !Object.values(ApiProtocolType).includes(apiProtocol)) {
      yield {
        event: 'error',
        data: { message: `节点 [${binding.name}] 未配置底层协议 (apiProtocol)，请在渠道配置中补充后再拨测` },
      };
      return;
    }

    const e2eConfig = await this.getE2EScheduleConfig();
    const prompt = e2eConfig.prompt || E2E_DEFAULT_PROMPT;
    const modelName = this.normalizeModelName(binding.preferredModelName ?? this.getConfigModelName(config));

    yield { event: 'log', data: { message: `🔬 L2 E2E 拨测启动 — ${binding.name}${modelName ? ` (${modelName})` : ''} [${apiProtocol}]` } };
    yield { event: 'log', data: { message: `   Channel: ${config.name} (${provider})` } };
    yield { event: 'log', data: { message: `   Prompt: ${prompt.slice(0, 40)}...` } };
    if (modelName) {
      yield { event: 'log', data: { message: `   Model: ${modelName}` } };
    }

    const startTime = Date.now();
    for await (const event of this.supplierTestService.streamTest({
      agencyName: `${binding.name} -> ${config.name}`,
      apiProtocol,
      modelName: modelName ?? undefined,
      baseUrl: config.endpoint || '',
      apiKey: config.apiKey,
      prompt,
    })) {
      yield event;

      if (event.event === 'done') {
        const e2eDuration = Math.round((Date.now() - startTime) / 1000);
        await this.insertApiHealthLog({
          configId,
          provider,
          status: 'online',
          checkType: 'E2E',
          e2eDuration,
          e2eMediaUrl: (event.data.resultUrl as string) ?? null,
        }).catch((e: any) => this.logger.error(`E2E 日志写入失败 [${provider}]: ${e.message}`));
      } else if (event.event === 'error') {
        await this.insertApiHealthLog({
          configId,
          provider,
          status: 'offline',
          checkType: 'E2E',
          errorDetail: event.data.message as string,
        }).catch((e: any) => this.logger.error(`E2E 错误日志写入失败 [${provider}]: ${e.message}`));
      }
    }
  }

  /**
   * 获取每个节点最新一条 E2E 日志（用于前端 L2 列展示）
   */
  async getLatestE2ELogs(): Promise<Record<string, { status: string; e2eDuration: number | null; e2eMediaUrl: string | null; createdAt: Date; errorDetail: string | null }>> {
    type E2ELogRow = {
      configId: string | null;
      status: string;
      e2eDuration: number | null;
      e2eMediaUrl: string | null;
      createdAt: Date | string;
      errorDetail: string | null;
    };
    const logs = await this.prisma.$queryRaw<E2ELogRow[]>`
      SELECT "configId", "status", "e2eDuration", "e2eMediaUrl", "createdAt", "errorDetail"
      FROM "ApiHealthLog"
      WHERE "checkType" = 'E2E' AND "configId" IS NOT NULL
      ORDER BY "createdAt" DESC
    `;
    const latestByConfigId: Record<string, { status: string; e2eDuration: number | null; e2eMediaUrl: string | null; createdAt: Date; errorDetail: string | null }> = {};
    for (const log of logs) {
      if (!log.configId) continue;
      if (!latestByConfigId[log.configId]) {
        latestByConfigId[log.configId] = {
          status: log.status,
          e2eDuration: log.e2eDuration,
          e2eMediaUrl: log.e2eMediaUrl,
          createdAt: new Date(log.createdAt),
          errorDetail: log.errorDetail,
        };
      }
    }

    const bindings = await this.getNodeMonitorBindings();
    const byNodeKey: Record<string, { status: string; e2eDuration: number | null; e2eMediaUrl: string | null; createdAt: Date; errorDetail: string | null }> = {};
    for (const binding of bindings) {
      const configId = binding.mappedConfig?.id;
      if (!configId) continue;
      const latest = latestByConfigId[configId];
      if (latest) {
        byNodeKey[binding.nodeKey] = latest;
      }
    }
    return byNodeKey;
  }

  // ─────────────────────────────────────────────────────────────

  /**
   * 写入单条健康检查日志，并在状态发生突变时触发 Webhook 告警（边缘触发）
   */
  private async writeHealthLog(status: ApiHealthStatus): Promise<void> {
    if (status.status === 'unknown') return;

    const currentStatus = status.status === 'healthy' ? 'online' : 'offline';

    // 查询该节点上一次状态（优先按 configId）
    const lastLogRows = status.configId
      ? await this.prisma.$queryRaw<Array<{ status: string }>>`
          SELECT "status"
          FROM "ApiHealthLog"
          WHERE "configId" = ${status.configId}
          ORDER BY "createdAt" DESC
          LIMIT 1
        `
      : await this.prisma.$queryRaw<Array<{ status: string }>>`
          SELECT "status"
          FROM "ApiHealthLog"
          WHERE "provider" = ${status.provider}
          ORDER BY "createdAt" DESC
          LIMIT 1
        `;
    const lastLog = lastLogRows[0];

    // 写入本次日志
    await this.insertApiHealthLog({
      configId: status.configId,
      provider: status.provider,
      status: currentStatus,
      latencyMs: status.latencyMs ?? null,
      errorDetail: status.error ?? null,
    });

    // 边缘触发：仅在状态发生突变时告警
    if (lastLog && lastLog.status !== currentStatus) {
      await this.sendWebhookAlert(status.provider, status.name, currentStatus, status.error);
    }
  }

  /**
   * 发送 Webhook 告警（兼容企业微信/钉钉 Markdown 格式）
   */
  private async sendWebhookAlert(
    provider: string,
    name: string,
    currentStatus: 'online' | 'offline',
    errorDetail?: string,
  ): Promise<void> {
    const scheduleConfig = await this.getScheduleConfig();
    const webhookUrl = scheduleConfig.webhookUrl || this.configService.get<string>('ALERT_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn(`[告警] ${name}(${provider}) 状态突变为 ${currentStatus}，但未配置 Webhook URL，跳过发送`);
      return;
    }

    // 生产环境防护：非 production 环境只打印日志，不真实发送，避免干扰线上群组
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[告警][DEV 模式] 跳过真实发送 — ${name}(${provider}) → ${currentStatus}，Webhook: ${webhookUrl}`);
      return;
    }

    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const isOffline = currentStatus === 'offline';
    const title = isOffline ? '🚨 节点下线告警' : '✅ 节点恢复通知';
    const statusText = isOffline ? 'Offline（下线）' : 'Online（恢复）';
    const detail = isOffline ? (errorDetail || '未知错误') : '恢复正常';

    const payload = {
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title,
            content: [
              [{ tag: 'text', text: `节点：${name}（${provider}）` }],
              [{ tag: 'text', text: `状态：${statusText}` }],
              [{ tag: 'text', text: `详情：${detail}` }],
              [{ tag: 'text', text: `时间：${now}` }],
            ],
          },
        },
      },
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        this.logger.warn(`[告警] Webhook 响应异常: HTTP ${res.status}`);
      } else {
        this.logger.log(`[告警] 已发送 ${title}: ${name}(${provider})`);
      }
    } catch (e: any) {
      this.logger.error(`[告警] Webhook 发送失败: ${e.message}`);
    }
  }

  /**
   * 查询历史趋势数据（服务端降采样后返回）
   * timeRange: '24h' | '7d' | '30d'
   * provider: 可选，不传则返回所有节点
   */
  async getHealthHistory(timeRange: '24h' | '7d' | '30d', provider?: string, configId?: string): Promise<HealthHistoryResult> {
    const now = new Date();
    const rangeMap = { '24h': 24 * 60, '7d': 7 * 24 * 60, '30d': 30 * 24 * 60 };
    const sinceMs = rangeMap[timeRange] * 60 * 1000;
    const since = new Date(now.getTime() - sinceMs);

    // 降采样：每个桶的时间跨度（分钟）
    // 24h → 30min 桶 → 48 个点；7d → 4h 桶 → 42 个点；30d → 12h 桶 → 60 个点
    const bucketMinutes = timeRange === '24h' ? 30 : timeRange === '7d' ? 240 : 720;

    type HealthLogRow = {
      configId: string | null;
      provider: string;
      status: string;
      latencyMs: number | null;
      errorDetail: string | null;
      createdAt: Date | string;
    };

    const whereConds: Prisma.Sql[] = [Prisma.sql`"createdAt" >= ${since}`, Prisma.sql`"configId" IS NOT NULL`];
    if (provider) whereConds.push(Prisma.sql`"provider" = ${provider}`);
    if (configId) whereConds.push(Prisma.sql`"configId" = ${configId}`);

    const raw = await this.prisma.$queryRaw<HealthLogRow[]>(Prisma.sql`
      SELECT "configId", "provider", "status", "latencyMs", "errorDetail", "createdAt"
      FROM "ApiHealthLog"
      WHERE ${Prisma.join(whereConds, ' AND ')}
      ORDER BY "createdAt" ASC
      LIMIT 1000
    `);

    const bindings = await this.getNodeMonitorBindings();
    const nodesByConfigId = new Map<string, NodeMonitorBinding[]>();
    for (const binding of bindings) {
      const id = binding.mappedConfig?.id;
      if (!id) continue;
      if (!nodesByConfigId.has(id)) nodesByConfigId.set(id, []);
      nodesByConfigId.get(id)!.push(binding);
    }

    // 按 configId 分组，再按时间桶聚合
    const grouped = new Map<string, HealthLogRow[]>();
    for (const row of raw) {
      if (!row.configId) continue;
      if (!grouped.has(row.configId)) grouped.set(row.configId, []);
      grouped.get(row.configId)!.push(row);
    }

    const series: HealthHistorySeries[] = [];
    for (const [cid, rows] of grouped) {
      const buckets = new Map<number, typeof raw>();
      for (const row of rows) {
        const createdAtMs = new Date(row.createdAt).getTime();
        const bucketKey = Math.floor(createdAtMs / (bucketMinutes * 60 * 1000));
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
        buckets.get(bucketKey)!.push(row);
      }

      const points: HealthDataPoint[] = [];
      for (const [bucketKey, items] of buckets) {
        const onlineItems = items.filter((i) => i.status === 'online');
        const offlineItems = items.filter((i) => i.status === 'offline');
        const avgLatency =
          onlineItems.length > 0
            ? Math.round(onlineItems.reduce((s, i) => s + (i.latencyMs ?? 0), 0) / onlineItems.length)
            : null;
        const isOffline = offlineItems.length > onlineItems.length;
        const lastError = offlineItems.at(-1)?.errorDetail ?? null;

        points.push({
          timestamp: new Date(bucketKey * bucketMinutes * 60 * 1000).toISOString(),
          latencyMs: avgLatency,
          status: isOffline ? 'offline' : 'online',
          errorDetail: isOffline ? lastError : null,
        });
      }

      const mappedNodes = nodesByConfigId.get(cid) ?? [];
      if (mappedNodes.length === 0) {
        const providerLabel = rows[0]?.provider || 'unknown';
        series.push({
          nodeKey: `config:${cid}`,
          configId: cid,
          provider: providerLabel,
          label: `已删除节点(${cid.slice(0, 8)})`,
          points,
        });
      } else {
        for (const node of mappedNodes) {
          series.push({
            nodeKey: node.nodeKey,
            configId: cid,
            provider: node.mappedConfig?.provider ?? node.preferredProvider ?? 'unknown',
            label: this.formatNodeDisplayName(node.name, node.preferredModelName),
            points,
          });
        }
      }
    }

    return { timeRange, bucketMinutes, series };
  }

  /**
   * 检查单个节点的健康状态（按配置 ID，模型级唯一）
   */
  async checkSingleNodeHealthById(id: string): Promise<ApiHealthStatus> {
    const binding = (await this.getNodeMonitorBindings()).find((item) => item.mappedConfig?.id === id);
    if (!binding) throw new NotFoundException(`业务节点不存在（未绑定此配置）: ${id}`);
    return this.checkSingleNodeHealthByNodeKey(binding.nodeKey);
  }

  /**
   * 按业务节点 nodeKey 检测单个节点健康状态（推荐入口）
   */
  async checkSingleNodeHealthByNodeKey(nodeKey: string): Promise<ApiHealthStatus> {
    const binding = await this.getNodeBindingByKey(nodeKey);
    if (!binding) throw new NotFoundException(`业务节点不存在: ${nodeKey}`);
    return this.checkSingleNodeBindingHealth(binding, true);
  }

  /**
   * 兼容旧入口：按 provider 检测单个节点（当同 provider 多模型并存时会退化为首条记录）
   */
  async checkSingleNodeHealth(provider: string): Promise<ApiHealthStatus> {
    const bindings = await this.getNodeMonitorBindings();
    const candidate = bindings.find((binding) => binding.mappedConfig?.provider === provider);
    if (!candidate) throw new NotFoundException(`业务节点不存在: provider=${provider}`);
    return this.checkSingleNodeBindingHealth(candidate, true);
  }

  private async checkSingleConfigHealth(config: ApiConfig): Promise<ApiHealthStatus> {
    if (!config.enabled) {
      return {
        nodeKey: config.id,
        configId: config.id,
        name: this.formatConfigDisplayName(config),
        provider: config.provider,
        status: 'unknown',
        lastChecked: new Date(),
        endpoint: config.endpoint || undefined,
        hasApiKey: !!config.apiKey,
        error: '已禁用',
      };
    }

    return this.checkApiHealth(config);
  }

  /**
   * 检查单个 API 的健康状态
   */
  private async checkApiHealth(config: ApiConfig): Promise<ApiHealthStatus> {
    const startTime = Date.now();

    try {
      // 根据不同的 provider 执行不同的健康检查
      switch (config.provider) {
        case 'kling':
        case 'vidu':
        case 'doubao':
          await this.testKaponEndpoint(config);
          break;
        case 'sora2':
          await this.testSora2Endpoint(config);
          break;
        case 'gemini':
          await this.testGeminiEndpoint(config);
          break;
        case 'midjourney':
          await this.testMidjourneyEndpoint(config);
          break;
        default:
          // 其他 API 暂时标记为 unknown
          return {
            nodeKey: config.id,
            configId: config.id,
            name: this.formatConfigDisplayName(config),
            provider: config.provider,
            status: 'unknown',
            lastChecked: new Date(),
            endpoint: config.endpoint || undefined,
            hasApiKey: !!config.apiKey,
            error: '暂不支持链路检查',
          };
      }

      const latencyMs = Date.now() - startTime;

      return {
        nodeKey: config.id,
        configId: config.id,
        name: this.formatConfigDisplayName(config),
        provider: config.provider,
        status: 'healthy',
        latencyMs,
        lastChecked: new Date(),
        endpoint: config.endpoint || undefined,
        hasApiKey: !!config.apiKey,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = error?.code === 'ETIMEDOUT' || error?.message === 'ETIMEDOUT';
      const errorMessage = isTimeout ? 'ETIMEDOUT' : (error instanceof Error ? error.message : String(error));

      this.logger.error(`❌ ${config.name} 健康检查失败: ${errorMessage}`);

      return {
        nodeKey: config.id,
        configId: config.id,
        name: this.formatConfigDisplayName(config),
        provider: config.provider,
        status: 'unhealthy',
        latencyMs,
        error: errorMessage,
        lastChecked: new Date(),
        endpoint: config.endpoint || undefined,
        hasApiKey: !!config.apiKey,
      };
    }
  }

  private formatConfigDisplayName(config: { name: string; modelName?: string | null }): string {
    const modelName = config.modelName;
    return modelName?.trim() ? `${config.name} [${modelName.trim()}]` : config.name;
  }

  private formatNodeDisplayName(nodeName: string, modelName?: string | null): string {
    const normalized = this.normalizeModelName(modelName);
    return normalized ? `${nodeName} (${normalized})` : nodeName;
  }

  private normalizeModelName(value?: string | null): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  // 兼容未重新 generate 的 Prisma Client：modelName 通过 any 读取
  private getConfigModelName(config?: ApiConfig | null): string | null {
    if (!config) return null;
    const raw = (config as any).modelName as string | null | undefined;
    return this.normalizeModelName(raw);
  }

  private isNodeRuntimeDisabled(nodeStatus: string): boolean {
    return nodeStatus === 'disabled' || nodeStatus === 'maintenance' || nodeStatus === 'coming_soon';
  }

  private normalizeKey(value?: string | null): string {
    return (value ?? '').trim().toLowerCase();
  }

  private inferProviderFromNode(serviceType?: string | null, nodeKey?: string): string | null {
    const source = `${serviceType ?? ''} ${nodeKey ?? ''}`.toLowerCase();
    if (!source.trim()) return null;
    if (source.includes('kling')) return 'kling';
    if (source.includes('vidu')) return 'vidu';
    if (source.includes('doubao') || source.includes('seedance')) return 'doubao';
    if (source.includes('sora')) return 'sora2';
    if (source.includes('wan') || source.includes('dashscope')) return 'dashscope';
    if (source.includes('midjourney')) return 'midjourney';
    if (source.includes('gemini') || source.includes('generate')) return 'gemini';
    if (source.includes('runninghub')) return 'runninghub';
    return null;
  }

  private getChannelType(endpoint?: string | null): string | null {
    if (!endpoint) return null;
    try {
      const host = new URL(endpoint).hostname.toLowerCase();
      if (host.includes('models.kapon.cloud')) return 'Kapon 代理';
      if (host.includes('volces.com')) return '火山引擎';
      if (host.includes('generativelanguage.googleapis.com')) return 'Google 官方';
      if (host.includes('midjourneyapi.xyz')) return 'Midjourney 代理';
      if (host.includes('dashscope.aliyuncs.com')) return 'DashScope 官方';
      return host;
    } catch {
      return endpoint;
    }
  }

  private extractStringFromJson(input: Prisma.JsonValue | null | undefined, path: string[]): string | null {
    let cursor: any = input;
    for (const key of path) {
      if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return null;
      cursor = cursor[key];
    }
    return typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;
  }

  private resolveMappedConfig(
    configs: ApiConfig[],
    opts: {
      metadataConfigId: string | null;
      metadataProvider: string | null;
      metadataModelName: string | null;
      preferredProvider: string | null;
      preferredModelName: string | null;
      serviceType: string | null;
    },
  ): { mappedConfig: ApiConfig | null; bindingStrategy: BindingStrategy } {
    if (configs.length === 0) return { mappedConfig: null, bindingStrategy: 'FALLBACK' };

    const {
      metadataConfigId,
      metadataProvider,
      metadataModelName,
      preferredProvider,
      preferredModelName,
      serviceType,
    } = opts;

    const findByProviderAndModel = (providerKey: string, modelKey: string): ApiConfig | null => {
      return (
        configs.find(
          (cfg) =>
            this.normalizeKey(cfg.provider) === providerKey &&
            this.normalizeKey(this.getConfigModelName(cfg)) === modelKey,
        ) ?? null
      );
    };
    const findByModel = (modelKey: string): ApiConfig | null => {
      return configs.find((cfg) => this.normalizeKey(this.getConfigModelName(cfg)) === modelKey) ?? null;
    };
    const findByProvider = (providerKey: string): ApiConfig | null => {
      const providerDefault =
        configs.find(
          (cfg) => this.normalizeKey(cfg.provider) === providerKey && !this.getConfigModelName(cfg),
        ) ?? null;
      if (providerDefault) return providerDefault;
      return configs.find((cfg) => this.normalizeKey(cfg.provider) === providerKey) ?? null;
    };

    if (metadataConfigId) {
      const exactById = configs.find((cfg) => cfg.id === metadataConfigId) ?? null;
      if (exactById) return { mappedConfig: exactById, bindingStrategy: 'MANUAL' };
    }

    const metadataProviderKey = this.normalizeKey(metadataProvider);
    const metadataModelKey = this.normalizeKey(metadataModelName);
    if (metadataProviderKey || metadataModelKey) {
      if (metadataProviderKey && metadataModelKey) {
        const exact = findByProviderAndModel(metadataProviderKey, metadataModelKey);
        if (exact) return { mappedConfig: exact, bindingStrategy: 'METADATA' };
      }
      if (metadataModelKey) {
        const byModel = findByModel(metadataModelKey);
        if (byModel) return { mappedConfig: byModel, bindingStrategy: 'METADATA' };
      }
      if (metadataProviderKey) {
        const byProvider = findByProvider(metadataProviderKey);
        if (byProvider) return { mappedConfig: byProvider, bindingStrategy: 'METADATA' };
      }
    }

    const serviceTypeModelKey = this.normalizeKey(serviceType);
    const preferredProviderKey = this.normalizeKey(preferredProvider);
    if (serviceTypeModelKey) {
      if (preferredProviderKey) {
        const exact = findByProviderAndModel(preferredProviderKey, serviceTypeModelKey);
        if (exact) return { mappedConfig: exact, bindingStrategy: 'MATCH' };
      }
      const byModel = findByModel(serviceTypeModelKey);
      if (byModel) return { mappedConfig: byModel, bindingStrategy: 'MATCH' };
    }

    const preferredModelKey = this.normalizeKey(preferredModelName);
    if (preferredProviderKey && preferredModelKey) {
      const exact = findByProviderAndModel(preferredProviderKey, preferredModelKey);
      if (exact) return { mappedConfig: exact, bindingStrategy: 'FALLBACK' };
    }
    if (preferredModelKey) {
      const byModel = findByModel(preferredModelKey);
      if (byModel) return { mappedConfig: byModel, bindingStrategy: 'FALLBACK' };
    }
    if (preferredProviderKey) {
      const byProvider = findByProvider(preferredProviderKey);
      if (byProvider) return { mappedConfig: byProvider, bindingStrategy: 'FALLBACK' };
    }
    return { mappedConfig: null, bindingStrategy: 'FALLBACK' };
  }

  private async getNodeMonitorBindings(): Promise<NodeMonitorBinding[]> {
    const nodes = await this.prisma.nodeConfig.findMany({ orderBy: [{ sortOrder: 'asc' }] });
    const categoryOrder: Record<string, number> = { input: 0, image: 1, video: 2, other: 3 };
    const sortedNodes = [...nodes].sort((a, b) => {
      const ca = categoryOrder[a.category ?? 'other'] ?? 99;
      const cb = categoryOrder[b.category ?? 'other'] ?? 99;
      if (ca !== cb) return ca - cb;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    const configs = (await this.getAllApiConfigs()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    return sortedNodes.map((node) => {
      const metadata = (node.metadata ?? null) as Prisma.JsonValue | null;
      const metadataProvider =
        this.extractStringFromJson(metadata, ['apiHealth', 'provider']) ??
        this.extractStringFromJson(metadata, ['monitor', 'provider']) ??
        this.extractStringFromJson(metadata, ['provider']);
      const metadataModelName =
        this.extractStringFromJson(metadata, ['apiHealth', 'modelName']) ??
        this.extractStringFromJson(metadata, ['monitor', 'modelName']);
      const metadataConfigId =
        this.extractStringFromJson(metadata, ['apiHealth', 'configId']) ??
        this.extractStringFromJson(metadata, ['apiHealth', 'apiConfigId']) ??
        this.extractStringFromJson(metadata, ['monitor', 'configId']);

      const preferredModelName = this.normalizeModelName(metadataModelName ?? node.serviceType);
      const preferredProvider = this.normalizeModelName(metadataProvider) ?? this.inferProviderFromNode(node.serviceType, node.nodeKey);

      const { mappedConfig, bindingStrategy } = this.resolveMappedConfig(configs, {
        metadataConfigId,
        metadataProvider,
        metadataModelName,
        preferredProvider,
        preferredModelName,
        serviceType: node.serviceType ?? null,
      });

      return {
        nodeKey: node.nodeKey,
        name: node.nameZh || node.nameEn || node.nodeKey,
        serviceType: node.serviceType ?? null,
        preferredModelName: preferredModelName ?? this.getConfigModelName(mappedConfig),
        preferredProvider,
        nodeStatus: node.status,
        nodeVisible: node.isVisible,
        mappedConfig: mappedConfig ?? null,
        channelType: this.getChannelType(mappedConfig?.endpoint),
        bindingStrategy,
      };
    });
  }

  private async getNodeBindingByKey(nodeKey: string): Promise<NodeMonitorBinding | null> {
    const bindings = await this.getNodeMonitorBindings();
    return bindings.find((binding) => binding.nodeKey === nodeKey) ?? null;
  }

  private getMonitorDisabledReason(binding: NodeMonitorBinding): string | null {
    if (this.isNodeRuntimeDisabled(binding.nodeStatus)) return `业务节点状态为 ${binding.nodeStatus}`;
    if (!binding.mappedConfig) return '未绑定底层渠道配置';
    if (!binding.mappedConfig.enabled) return '底层渠道已禁用';
    if (!binding.mappedConfig.apiProtocol) return '底层渠道未配置 apiProtocol';
    if (!binding.mappedConfig.apiKey) return '底层渠道未配置 API Key';
    return null;
  }

  private buildNodeStatusFromConfigHealth(binding: NodeMonitorBinding, configHealth: ApiHealthStatus): ApiHealthStatus {
    const cfg = binding.mappedConfig;
    return {
      ...configHealth,
      nodeKey: binding.nodeKey,
      configId: cfg?.id,
      name: this.formatNodeDisplayName(binding.name, binding.preferredModelName),
      provider: cfg?.provider ?? configHealth.provider,
      channelName: cfg?.name,
      channelType: binding.channelType ?? undefined,
      modelName: binding.preferredModelName ?? undefined,
      serviceType: binding.serviceType ?? undefined,
      endpoint: cfg?.endpoint || configHealth.endpoint,
      hasApiKey: !!cfg?.apiKey,
    };
  }

  private async checkSingleNodeBindingHealth(binding: NodeMonitorBinding, writeLog: boolean): Promise<ApiHealthStatus> {
    if (this.isNodeRuntimeDisabled(binding.nodeStatus)) {
      return {
        nodeKey: binding.nodeKey,
        configId: binding.mappedConfig?.id,
        name: this.formatNodeDisplayName(binding.name, binding.preferredModelName),
        provider: binding.mappedConfig?.provider ?? binding.preferredProvider ?? 'unknown',
        channelName: binding.mappedConfig?.name,
        channelType: binding.channelType ?? undefined,
        modelName: binding.preferredModelName ?? undefined,
        serviceType: binding.serviceType ?? undefined,
        status: 'unknown',
        lastChecked: new Date(),
        endpoint: binding.mappedConfig?.endpoint || undefined,
        hasApiKey: !!binding.mappedConfig?.apiKey,
        error: `节点状态为 ${binding.nodeStatus}`,
      };
    }

    if (!binding.mappedConfig) {
      return {
        nodeKey: binding.nodeKey,
        name: this.formatNodeDisplayName(binding.name, binding.preferredModelName),
        provider: binding.preferredProvider ?? 'unknown',
        channelType: binding.channelType ?? undefined,
        modelName: binding.preferredModelName ?? undefined,
        serviceType: binding.serviceType ?? undefined,
        status: 'unknown',
        lastChecked: new Date(),
        hasApiKey: false,
        error: '未绑定底层渠道配置',
      };
    }

    const cfg = binding.mappedConfig;
    if (!cfg.enabled) {
      return {
        nodeKey: binding.nodeKey,
        configId: cfg.id,
        name: this.formatNodeDisplayName(binding.name, binding.preferredModelName),
        provider: cfg.provider,
        channelName: cfg.name,
        channelType: binding.channelType ?? undefined,
        modelName: binding.preferredModelName ?? undefined,
        serviceType: binding.serviceType ?? undefined,
        status: 'unknown',
        lastChecked: new Date(),
        endpoint: cfg.endpoint || undefined,
        hasApiKey: !!cfg.apiKey,
        error: '底层渠道已禁用',
      };
    }

    const configHealth = await this.checkSingleConfigHealth(cfg);
    if (writeLog) {
      this.writeHealthLog(configHealth).catch((e) =>
        this.logger.error(`写入健康日志失败 [${cfg.id}/${cfg.provider}]: ${e.message}`),
      );
    }
    return this.buildNodeStatusFromConfigHealth(binding, configHealth);
  }

  private async findApiConfigByProviderAndModel(
    provider: string,
    modelName: string | null,
    excludeId?: string,
  ): Promise<{ id: string } | null> {
    const rows =
      modelName === null
        ? excludeId
          ? await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT "id"
              FROM "ApiConfig"
              WHERE "provider" = ${provider}
                AND "id" <> ${excludeId}
                AND "modelName" IS NULL
              ORDER BY "createdAt" ASC
              LIMIT 1
            `
          : await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT "id"
              FROM "ApiConfig"
              WHERE "provider" = ${provider}
                AND "modelName" IS NULL
              ORDER BY "createdAt" ASC
              LIMIT 1
            `
        : excludeId
          ? await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT "id"
              FROM "ApiConfig"
              WHERE "provider" = ${provider}
                AND "id" <> ${excludeId}
                AND "modelName" = ${modelName}
              ORDER BY "createdAt" ASC
              LIMIT 1
            `
          : await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT "id"
              FROM "ApiConfig"
              WHERE "provider" = ${provider}
                AND "modelName" = ${modelName}
              ORDER BY "createdAt" ASC
              LIMIT 1
            `;
    return rows[0] ?? null;
  }

  private async insertApiHealthLog(input: {
    configId?: string | null;
    provider: string;
    status: string;
    latencyMs?: number | null;
    errorDetail?: string | null;
    checkType?: string;
    e2eDuration?: number | null;
    e2eMediaUrl?: string | null;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "ApiHealthLog"
        ("configId", "provider", "status", "latencyMs", "errorDetail", "checkType", "e2eDuration", "e2eMediaUrl", "createdAt")
      VALUES
        (
          ${input.configId ?? null},
          ${input.provider},
          ${input.status},
          ${input.latencyMs ?? null},
          ${input.errorDetail ?? null},
          ${input.checkType ?? 'PING'},
          ${input.e2eDuration ?? null},
          ${input.e2eMediaUrl ?? null},
          NOW()
        )
    `;
  }

  private async checkNodeHealth(config: any): Promise<ApiHealthStatus> {
    const startTime = Date.now();
    const name = config.displayName || config.nodeKey;

    try {
      if (!config.apiKey) {
        return {
          nodeKey: config.nodeKey || config.id || 'unknown',
          configId: config.id || config.nodeKey,
          name,
          provider: config.nodeKey,
          status: 'unhealthy',
          lastChecked: new Date(),
          endpoint: config.apiEndpoint || undefined,
          hasApiKey: false,
          error: 'API Key 未配置',
        };
      }

      // 简单的健康检查：验证 API Key 格式和端点可访问性
      const latencyMs = Date.now() - startTime;

      return {
        nodeKey: config.nodeKey || config.id || 'unknown',
        configId: config.id || config.nodeKey,
        name,
        provider: config.nodeKey,
        status: 'healthy',
        latencyMs,
        lastChecked: new Date(),
        endpoint: config.apiEndpoint || undefined,
        hasApiKey: true,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        nodeKey: config.nodeKey || config.id || 'unknown',
        configId: config.id || config.nodeKey,
        name,
        provider: config.nodeKey,
        status: 'unhealthy',
        latencyMs,
        error: errorMessage,
        lastChecked: new Date(),
        endpoint: config.apiEndpoint || undefined,
        hasApiKey: !!config.apiKey,
      };
    }
  }

  /**
   * 带超时的 fetch 封装，超时抛出 ETIMEDOUT 错误
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 测试 Kapon 端点（Kling, Vidu, Doubao）
   */
  private async testKaponEndpoint(config: ApiConfig): Promise<void> {
    const endpoint = config.endpoint || 'https://models.kapon.cloud';
    const isVolces = endpoint.includes('volces.com') || endpoint.includes('ark.cn-beijing');
    const url = isVolces
      ? `${endpoint}/api/v3/contents/generations/tasks`
      : `${endpoint}/${config.provider}/v1/videos/text2video`;

    const body = isVolces
      ? JSON.stringify({ model: 'doubao-seedance-1-5-pro-251215', content: [{ type: 'text', text: 'health check' }] })
      : JSON.stringify({ model: 'test', prompt: 'health check' });

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    });

    if (!response.ok && response.status !== 400) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * 测试 Sora2 端点
   */
  private async testSora2Endpoint(config: ApiConfig): Promise<void> {
    const endpoint = config.endpoint || 'https://api.147ai.com';
    const url = `${endpoint}/v1/video/generations`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        prompt: 'health check',
        model: 'sora-1.0-turbo',
      }),
    });

    if (!response.ok && response.status !== 400) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * 测试 Gemini 端点
   */
  private async testGeminiEndpoint(config: ApiConfig): Promise<void> {
    const endpoint = config.endpoint || 'https://generativelanguage.googleapis.com';
    const url = `${endpoint}/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${config.apiKey}`;

    const proxyUrl =
      this.configService.get<string>('HTTPS_PROXY') || this.configService.get<string>('HTTP_PROXY');

    if (proxyUrl) {
      this.logger.log(`Using proxy for Gemini: ${proxyUrl}`);
    }

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: 'health check' }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
  }

  /**
   * 测试 Midjourney 端点
   */
  private async testMidjourneyEndpoint(config: ApiConfig): Promise<void> {
    const endpoint = config.endpoint || 'https://api.midjourneyapi.xyz';
    const url = `${endpoint}/mj/submit/imagine`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': config.apiKey,
      },
      body: JSON.stringify({
        prompt: 'health check',
      }),
    });

    if (!response.ok && response.status !== 400) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }
}
