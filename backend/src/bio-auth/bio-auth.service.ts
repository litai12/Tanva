import { Injectable, Logger, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { signVolcRequest } from '../volc-asset/volc-sign.util';
import type {
  BioAuthStatus,
  BioAuthStatusResponse,
  StartBioAuthResponse,
  ListGroupsResponse,
  CreateAssetInGroupResponse,
} from './bio-auth.dto';

interface VolcEnv {
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  host: string;
  projectName: string;
  version: string;
  callbackBaseUrl: string;
}

interface TaskRecord {
  taskId: string;
  imageUrl: string;
  userId: string;
  status: BioAuthStatus;
  assetId?: string;
  groupId?: string;
  errorMessage?: string;
  createdAt: number;
}

@Injectable()
export class BioAuthService implements OnModuleInit {
  private readonly logger = new Logger(BioAuthService.name);
  private readonly tasks = new Map<string, TaskRecord>();
  private env!: VolcEnv;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.env = {
      accessKey: (this.config.get<string>('VOLC_ARK_ACCESS_KEY') || '').trim(),
      secretKey: (this.config.get<string>('VOLC_ARK_SECRET_KEY') || '').trim(),
      region: (this.config.get<string>('VOLC_ARK_REGION') || 'cn-beijing').trim(),
      service: 'ark',
      host: (this.config.get<string>('VOLC_ARK_API_HOST') || 'open.volcengineapi.com').trim(),
      projectName: (this.config.get<string>('VOLC_ARK_PROJECT_NAME') || 'default').trim(),
      version: '2024-01-01',
      callbackBaseUrl: (this.config.get<string>('APP_BASE_URL') || 'http://localhost:4000').trim(),
    };
    if (!this.env.accessKey || !this.env.secretKey) {
      this.logger.warn('VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，BioAuth 能力不可用。');
    }
    const cbUrl = `${this.env.callbackBaseUrl}/api/bio-auth/callback`;
    if (this.env.callbackBaseUrl.startsWith('http://localhost')) {
      this.logger.warn(`BioAuth 回调地址为本地地址 (${cbUrl})，火山引擎无法回调。生产环境请配置 APP_BASE_URL。`);
    }
  }

  private async call<T>(action: string, body: Record<string, any>): Promise<T> {
    if (!this.env.accessKey || !this.env.secretKey) {
      throw new Error('Volc access key not configured');
    }
    const jsonBody = JSON.stringify(body);
    const signed = signVolcRequest({
      accessKey: this.env.accessKey,
      secretKey: this.env.secretKey,
      region: this.env.region,
      service: this.env.service,
      host: this.env.host,
      method: 'POST',
      action,
      version: this.env.version,
      body: jsonBody,
    });
    const { Host: _host, ...fetchHeaders } = signed.headers;
    const resp = await fetch(signed.url, {
      method: 'POST',
      headers: fetchHeaders,
      body: jsonBody,
    });
    const text = await resp.text();
    if (!resp.ok) {
      let detail = text.slice(0, 200);
      try {
        const errParsed = JSON.parse(text);
        const code = errParsed?.ResponseMetadata?.Error?.Code;
        const msg = errParsed?.ResponseMetadata?.Error?.Message;
        if (code) detail = `[${code}] ${msg || 'unknown'}`;
      } catch { /* non-JSON */ }
      throw new Error(`Volc ${action} HTTP ${resp.status}: ${detail}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Volc ${action} bad response: ${text.slice(0, 200)}`);
    }
    const err = parsed?.ResponseMetadata?.Error;
    if (err?.Code) {
      throw new Error(`Volc ${action} error [${err.Code}]: ${err.Message || 'unknown'}`);
    }
    const unwrapped =
      parsed && typeof parsed === 'object' && parsed.Result !== undefined
        ? parsed.Result
        : parsed;
    return unwrapped as T;
  }

  async startTask(userId: string, imageUrl: string): Promise<StartBioAuthResponse> {
    const callbackUrl = `${this.env.callbackBaseUrl}/api/bio-auth/callback`;
    const resp = await this.call<{ H5Link?: string; BytedToken?: string }>(
      'CreateVisualValidateSession',
      {
        ProjectName: this.env.projectName,
        CallbackURL: callbackUrl,
      },
    );
    if (!resp?.BytedToken || !resp?.H5Link) {
      throw new Error('CreateVisualValidateSession: missing H5Link or BytedToken');
    }
    const record: TaskRecord = {
      taskId: resp.BytedToken,
      imageUrl,
      userId,
      status: 'processing',
      createdAt: Date.now(),
    };
    this.tasks.set(resp.BytedToken, record);
    this.logger.log(`bio-auth task created: ${resp.BytedToken.slice(0, 20)}… for user ${userId}`);
    return { taskId: resp.BytedToken, h5Link: resp.H5Link };
  }

  async handleCallback(bytedToken: string, resultCode: string): Promise<void> {
    const task = this.tasks.get(bytedToken);
    if (!task) {
      this.logger.warn(`bio-auth callback: unknown taskId ${bytedToken.slice(0, 20)}…`);
      return;
    }
    if (resultCode !== '10000') {
      task.status = 'failed';
      task.errorMessage = `活体检测未通过 (code=${resultCode})`;
      this.logger.warn(`bio-auth callback failed: code=${resultCode}`);
      return;
    }
    try {
      const validateResult = await this.call<{ GroupId?: string }>('GetVisualValidateResult', {
        BytedToken: bytedToken,
        ProjectName: this.env.projectName,
      });
      const groupId = validateResult?.GroupId;
      if (!groupId) throw new Error('GetVisualValidateResult: missing GroupId');

      await this.prisma.bioAuthGroup.upsert({
        where: { groupId },
        create: { userId: task.userId, groupId, imageUrl: task.imageUrl },
        update: {},
      });
      task.groupId = groupId;

      const assetResp = await this.call<{ Id?: string }>('CreateAsset', {
        GroupId: groupId,
        URL: task.imageUrl,
        AssetType: 'Image',
        ProjectName: this.env.projectName,
      });
      if (!assetResp?.Id) throw new Error('CreateAsset: empty Id');
      task.assetId = assetResp.Id;
      this.logger.log(`bio-auth asset created: ${assetResp.Id}`);
      this.pollAsset(bytedToken, assetResp.Id);
    } catch (e: any) {
      task.status = 'failed';
      task.errorMessage = e?.message || '认证处理失败';
      this.logger.error(`bio-auth callback processing failed: ${e?.message}`);
    }
  }

  private pollAsset(taskId: string, assetId: string, attempt = 0): void {
    const MAX_ATTEMPTS = 24; // 2 min at 5s intervals
    if (attempt >= MAX_ATTEMPTS) {
      const task = this.tasks.get(taskId);
      if (task && task.status === 'processing') {
        task.status = 'failed';
        task.errorMessage = '素材审核超时';
      }
      return;
    }
    setTimeout(async () => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'processing') return;
      try {
        const resp = await this.call<{ Status?: string }>('GetAsset', {
          Id: assetId,
          ProjectName: this.env.projectName,
        });
        const s = (resp?.Status || '').toLowerCase();
        if (s === 'active') {
          task.status = 'active';
          task.assetId = assetId;
          this.logger.log(`bio-auth asset active: ${assetId}`);
        } else if (s === 'failed') {
          task.status = 'failed';
          task.errorMessage = '素材审核未通过';
        } else {
          this.pollAsset(taskId, assetId, attempt + 1);
        }
      } catch (e: any) {
        this.logger.error(`bio-auth pollAsset error: ${e?.message}`);
        this.pollAsset(taskId, assetId, attempt + 1);
      }
    }, 5000);
  }

  getStatus(taskId: string): BioAuthStatusResponse {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { status: 'failed', errorMessage: '任务不存在或已过期' };
    }
    return {
      status: task.status,
      errorMessage: task.errorMessage,
      assetId: task.assetId,
      groupId: task.groupId,
    };
  }

  async listGroups(userId: string): Promise<ListGroupsResponse> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.bioAuthGroup.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { groupId: true, imageUrl: true, createdAt: true },
    });
    return {
      groups: rows.map((r) => ({
        groupId: r.groupId,
        imageUrl: r.imageUrl,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async createAssetInGroup(
    userId: string,
    groupId: string,
    imageUrl: string,
  ): Promise<CreateAssetInGroupResponse> {
    const group = await this.prisma.bioAuthGroup.findUnique({ where: { groupId } });
    if (!group || group.userId !== userId) {
      throw new ForbiddenException('GroupId 不属于当前用户');
    }
    const assetResp = await this.call<{ Id?: string }>('CreateAsset', {
      GroupId: groupId,
      URL: imageUrl,
      AssetType: 'Image',
      ProjectName: this.env.projectName,
    });
    if (!assetResp?.Id) throw new Error('CreateAsset: empty Id');
    const taskId = assetResp.Id;
    const record: TaskRecord = {
      taskId,
      imageUrl,
      userId,
      status: 'processing',
      groupId,
      assetId: taskId,
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, record);
    this.logger.log(`bio-auth createAssetInGroup: assetId=${taskId.slice(0, 20)}… group=${groupId.slice(0, 20)}…`);
    this.pollAsset(taskId, taskId);
    return { taskId };
  }
}
