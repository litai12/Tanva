# 火山方舟 Seedance 2.0 私域素材库接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 ImageNode 加"审核"图标触发火山方舟 `CreateAsset` 上传；sd2/sd2-fast 生成时，已 `Active` 的 asset 自动替换 `image_url.url` 为 `asset://<id>`。

**Architecture:** 后端新增 `volc-asset` NestJS 模块（VolcSign V4 签名 + 3 个 Volc 调用 + 2 个 HTTP 端点）；前端 `ImageNode.tsx` 挂 icon + 4 态，轮询 hook 拉状态；sd2 请求 payload 从 `string[]` 升级为 `Array<{url, volcAssetId?, volcAssetStatus?}>`，后端在拼 `image_url` 时做替换。

**Tech Stack:** NestJS / Prisma 环境、React + reactflow、lucide-react 图标库、crypto 标准库（VolcSign HMAC-SHA256）。

**约定：** 本仓库无 jest/vitest 测试设施，采用**类型检查 + 手动 smoke test** 验证。所有任务步骤须可独立完成并通过 `tsc` 编译；集成验证集中在 Task 10。

**Spec 引用：** `docs/superpowers/specs/2026-04-21-volc-asset-library-integration-design.md`

---

## File Structure

### 后端新建
- `backend/src/volc-asset/volc-asset.module.ts` — NestJS 模块
- `backend/src/volc-asset/volc-asset.service.ts` — Volc 调用 & Group 缓存
- `backend/src/volc-asset/volc-asset.controller.ts` — HTTP 端点
- `backend/src/volc-asset/volc-asset.dto.ts` — 请求/响应 DTO
- `backend/src/volc-asset/volc-sign.util.ts` — VolcSign V4 签名

### 后端修改
- `backend/src/app.module.ts` — 注册 `VolcAssetModule`
- `backend/src/ai/dto/video-provider.dto.ts` — 升级 `referenceImages` 类型
- `backend/src/ai/services/video-provider.service.ts` — sd2 `image_url` 替换
- `backend/.env` — 你已填 2 条，再加 3 条默认值

### 前端新建
- `frontend/src/services/volcAssetAPI.ts` — 前端 API 客户端
- `frontend/src/hooks/useVolcAssetPolling.ts` — 轮询 hook

### 前端修改
- `frontend/src/components/flow/nodes/ImageNode.tsx` — 审核 icon + 4 态
- `frontend/src/components/flow/FlowOverlay.tsx:14261-14295` — referenceImages 组装处升级 payload

---

## Task 1: 后端 env 补齐

**Files:**
- Modify: `backend/.env`（你手动填）
- 无代码改动

- [ ] **Step 1: 在 `backend/.env` 里追加 3 条默认值**

```env
VOLC_ARK_ACCESS_KEY=<your-volc-access-key>   # 已填
VOLC_ARK_SECRET_KEY=<your-volc-secret-key>   # 已填
VOLC_ARK_REGION=cn-beijing
VOLC_ARK_PROJECT_NAME=default
VOLC_ARK_API_HOST=open.volcengineapi.com
```

- [ ] **Step 2: 确认 `VOLC_ARK_PROJECT_NAME` 与现有 `ARK_API_KEY` 所在 Project 一致**

进 [方舟控制台 → API Key 管理](https://console.volcengine.com/ark/region:ark+cn-beijing/apikey) 看 `ARK_API_KEY` 归属的 Project 名称。若不是 `default`，把 `VOLC_ARK_PROJECT_NAME` 改成对应值。

- [ ] **Step 3: 不 commit**（env 不入库）。

---

## Task 2: VolcSign V4 签名工具

**Files:**
- Create: `backend/src/volc-asset/volc-sign.util.ts`

**参考：** 火山引擎 API 签名算法 V4：[https://www.volcengine.com/docs/6369/67269](https://www.volcengine.com/docs/6369/67269)，与 AWS SigV4 类似，区别在 `x-date` 头格式和 credential scope。

- [ ] **Step 1: 创建签名工具文件**

```ts
// backend/src/volc-asset/volc-sign.util.ts
import * as crypto from 'crypto';

export interface VolcSignInput {
  accessKey: string;
  secretKey: string;
  region: string;          // e.g. "cn-beijing"
  service: string;         // "ark"
  host: string;            // "open.volcengineapi.com"
  method: 'GET' | 'POST';
  action: string;          // e.g. "CreateAsset"
  version: string;         // "2024-01-01"
  body: string;            // JSON stringified; "" if no body
  date?: Date;
}

export interface VolcSignOutput {
  url: string;
  headers: Record<string, string>;
}

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function formatDate(d: Date): { iso: string; short: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return {
    iso: `${y}${m}${day}T${h}${mi}${s}Z`,
    short: `${y}${m}${day}`,
  };
}

export function signVolcRequest(input: VolcSignInput): VolcSignOutput {
  const { accessKey, secretKey, region, service, host, method, action, version, body } = input;
  const date = input.date ?? new Date();
  const { iso, short } = formatDate(date);

  const canonicalQuery = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(version)}`;
  const bodyHash = sha256Hex(body || '');
  const contentType = 'application/json; charset=utf-8';

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-content-sha256:${bodyHash}\n` +
    `x-date:${iso}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';

  const canonicalRequest = [
    method,
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');

  const credentialScope = `${short}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    iso,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(secretKey, short);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}/?${canonicalQuery}`,
    headers: {
      'Content-Type': contentType,
      Host: host,
      'X-Date': iso,
      'X-Content-Sha256': bodyHash,
      Authorization: authorization,
    },
  };
}
```

- [ ] **Step 2: 编译检查**

```bash
cd backend && npx tsc -p tsconfig.build.json --noEmit
```

Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add backend/src/volc-asset/volc-sign.util.ts
git commit -m "feat(volc-asset): add VolcSign V4 signing util"
```

---

## Task 3: VolcAsset DTO

**Files:**
- Create: `backend/src/volc-asset/volc-asset.dto.ts`

- [ ] **Step 1: 定义 DTO**

```ts
// backend/src/volc-asset/volc-asset.dto.ts
import { IsIn, IsString, MaxLength } from 'class-validator';

export class UploadAssetDto {
  @IsString()
  @MaxLength(2048)
  sourceUrl!: string;

  @IsIn(['image'])
  assetType!: 'image';
}

export type VolcAssetStatus = 'processing' | 'active' | 'failed';

export interface UploadAssetResponse {
  assetId: string;
  status: VolcAssetStatus;
  errorMessage?: string;
}

export interface AssetStatusResponse {
  status: VolcAssetStatus;
  errorMessage?: string;
}
```

- [ ] **Step 2: 编译检查**

```bash
cd backend && npx tsc -p tsconfig.build.json --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/volc-asset/volc-asset.dto.ts
git commit -m "feat(volc-asset): add request/response DTOs"
```

---

## Task 4: VolcAssetService（核心逻辑）

**Files:**
- Create: `backend/src/volc-asset/volc-asset.service.ts`

- [ ] **Step 1: 实现 service**

```ts
// backend/src/volc-asset/volc-asset.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signVolcRequest } from './volc-sign.util';
import type { VolcAssetStatus } from './volc-asset.dto';

interface VolcEnv {
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  host: string;
  projectName: string;
  version: string;
}

interface CreateAssetGroupResp {
  Id?: string;
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}
interface CreateAssetResp {
  Id?: string;
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}
interface GetAssetResp {
  Status?: 'Processing' | 'Active' | 'Failed';
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}

@Injectable()
export class VolcAssetService implements OnModuleInit {
  private readonly logger = new Logger(VolcAssetService.name);
  private env!: VolcEnv;
  private readonly groupCache = new Map<string, string>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.env = {
      accessKey: (this.config.get<string>('VOLC_ARK_ACCESS_KEY') || '').trim(),
      secretKey: (this.config.get<string>('VOLC_ARK_SECRET_KEY') || '').trim(),
      region: (this.config.get<string>('VOLC_ARK_REGION') || 'cn-beijing').trim(),
      service: 'ark',
      host: (this.config.get<string>('VOLC_ARK_API_HOST') || 'open.volcengineapi.com').trim(),
      projectName: (this.config.get<string>('VOLC_ARK_PROJECT_NAME') || 'default').trim(),
      version: '2024-01-01',
    };
    if (!this.env.accessKey || !this.env.secretKey) {
      this.logger.warn(
        'VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，VolcAsset 能力不可用。',
      );
    }
  }

  private normalizeStatus(s?: string): VolcAssetStatus {
    const u = (s || '').toLowerCase();
    if (u === 'active') return 'active';
    if (u === 'failed') return 'failed';
    return 'processing';
  }

  private async call<T>(action: string, body: Record<string, any>): Promise<T> {
    if (!this.env.accessKey || !this.env.secretKey) {
      throw new Error('Volc asset access key not configured');
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
    const resp = await fetch(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: jsonBody,
    });
    const text = await resp.text();
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
    return parsed as T;
  }

  async ensureUserGroup(userId: string): Promise<string> {
    const cached = this.groupCache.get(userId);
    if (cached) return cached;
    const resp = await this.call<CreateAssetGroupResp>('CreateAssetGroup', {
      Name: `tanva-user-${userId}`,
      Description: `Auto-created group for Tanva user ${userId}`,
      GroupType: 'AIGC',
      ProjectName: this.env.projectName,
    });
    const groupId = resp?.Id;
    if (!groupId) throw new Error('Volc CreateAssetGroup: empty Id');
    this.groupCache.set(userId, groupId);
    return groupId;
  }

  invalidateUserGroup(userId: string) {
    this.groupCache.delete(userId);
  }

  async uploadAsset(
    userId: string,
    sourceUrl: string,
    assetType: 'image',
  ): Promise<{ assetId: string; status: VolcAssetStatus; errorMessage?: string }> {
    const groupId = await this.ensureUserGroup(userId);
    const resp = await this.call<CreateAssetResp>('CreateAsset', {
      GroupId: groupId,
      URL: sourceUrl,
      AssetType: assetType === 'image' ? 'Image' : 'Image',
      ProjectName: this.env.projectName,
    });
    if (!resp?.Id) throw new Error('Volc CreateAsset: empty Id');
    const initial = await this.getAssetStatus(resp.Id).catch(() => ({
      status: 'processing' as VolcAssetStatus,
    }));
    return { assetId: resp.Id, status: initial.status, errorMessage: initial.errorMessage };
  }

  async getAssetStatus(
    assetId: string,
  ): Promise<{ status: VolcAssetStatus; errorMessage?: string }> {
    const resp = await this.call<GetAssetResp>('GetAsset', {
      Id: assetId,
      ProjectName: this.env.projectName,
    });
    return {
      status: this.normalizeStatus(resp?.Status),
      errorMessage: undefined,
    };
  }
}
```

- [ ] **Step 2: 编译检查**

```bash
cd backend && npx tsc -p tsconfig.build.json --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/volc-asset/volc-asset.service.ts
git commit -m "feat(volc-asset): add service with group cache and CreateAsset/GetAsset calls"
```

---

## Task 5: VolcAssetController

**Files:**
- Create: `backend/src/volc-asset/volc-asset.controller.ts`

- [ ] **Step 1: 实现 controller**

```ts
// backend/src/volc-asset/volc-asset.controller.ts
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { VolcAssetService } from './volc-asset.service';
import { UploadAssetDto } from './volc-asset.dto';

@ApiTags('volc-asset')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('volc-asset')
export class VolcAssetController {
  private readonly logger = new Logger(VolcAssetController.name);
  constructor(private readonly svc: VolcAssetService) {}

  private resolveUserId(req: any): string {
    const uid = req?.user?.userId || req?.user?.id || req?.user?.sub;
    if (!uid) throw new BadRequestException('Missing user id in request');
    return String(uid);
  }

  @Post('upload')
  async upload(@Req() req: any, @Body() dto: UploadAssetDto) {
    const userId = this.resolveUserId(req);
    try {
      const result = await this.svc.uploadAsset(userId, dto.sourceUrl, dto.assetType);
      return result;
    } catch (err: any) {
      const msg = err?.message || 'Volc upload failed';
      if (/Group not found/i.test(msg)) {
        this.svc.invalidateUserGroup(userId);
      }
      this.logger.error(`upload failed for user ${userId}: ${msg}`);
      throw new BadGatewayException(msg);
    }
  }

  @Get(':assetId/status')
  async status(@Param('assetId') assetId: string) {
    try {
      return await this.svc.getAssetStatus(assetId);
    } catch (err: any) {
      const msg = err?.message || 'Volc status fetch failed';
      this.logger.error(`status failed for ${assetId}: ${msg}`);
      throw new BadGatewayException(msg);
    }
  }
}
```

- [ ] **Step 2: 编译检查**

```bash
cd backend && npx tsc -p tsconfig.build.json --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/volc-asset/volc-asset.controller.ts
git commit -m "feat(volc-asset): add HTTP controller (upload, status)"
```

---

## Task 6: VolcAssetModule + 注册到 AppModule

**Files:**
- Create: `backend/src/volc-asset/volc-asset.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: 创建模块**

```ts
// backend/src/volc-asset/volc-asset.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { VolcAssetController } from './volc-asset.controller';
import { VolcAssetService } from './volc-asset.service';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [VolcAssetService],
  controllers: [VolcAssetController],
  exports: [VolcAssetService],
})
export class VolcAssetModule {}
```

- [ ] **Step 2: 在 `app.module.ts` 的 `imports` 数组末尾加 `VolcAssetModule`**

打开 `backend/src/app.module.ts`，在文件顶部 import：

```ts
import { VolcAssetModule } from './volc-asset/volc-asset.module';
```

在 `@Module({ imports: [...] })` 的 `imports` 数组追加 `VolcAssetModule`（位置在其他业务 Module 旁边，保持现有分组风格）。

- [ ] **Step 3: 启动验证**

```bash
cd backend && npm run start:dev
```

Expected: 启动日志里有 `VolcAssetController {/volc-asset}` 路由注册；无 DI 报错。`Ctrl+C` 停止。

- [ ] **Step 4: smoke test（可选但强烈建议）**

拿到一个本地 JWT（从浏览器 DevTools → Application → localStorage 里 copy `authToken`），然后：

```bash
curl -X POST http://localhost:3000/api/volc-asset/upload \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"sourceUrl":"https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg","assetType":"image"}'
```

Expected 响应形如：`{"assetId":"asset-2026...-xxxxx","status":"processing"}`。

若报 `BadGatewayException`，检查 `.env` 的 AK/SK、ProjectName、打开后端控制台错误日志。

- [ ] **Step 5: Commit**

```bash
git add backend/src/volc-asset/volc-asset.module.ts backend/src/app.module.ts
git commit -m "feat(volc-asset): register module into app"
```

---

## Task 7: 升级 sd2 请求 referenceImages 类型 + 替换逻辑

**Files:**
- Modify: `backend/src/ai/dto/video-provider.dto.ts`
- Modify: `backend/src/ai/services/video-provider.service.ts` 约第 1100–1115 行

- [ ] **Step 1: 扩展 DTO**

打开 `backend/src/ai/dto/video-provider.dto.ts`，找到 `referenceImages?: string[]`（约 line 23），替换为：

```ts
export type ReferenceImageItem =
  | string
  | {
      url: string;
      volcAssetId?: string;
      volcAssetStatus?: 'processing' | 'active' | 'failed';
    };

// ... 在 VideoProviderRequestDto 内
referenceImages?: ReferenceImageItem[]; // 字符串向前兼容；对象形态用于 sd2/fast
```

导出 `ReferenceImageItem` 供 service 使用。

- [ ] **Step 2: 修改 video-provider.service.ts 替换逻辑**

找到 `for (const imageUrl of referenceImages) {` 块（约 line 1105）。

先在文件顶部 import 新类型：

```ts
import type { ReferenceImageItem } from '../dto/video-provider.dto';
```

把循环替换成：

```ts
const isSeedance20 = modelKey === 'seedance-2.0' || modelKey === 'seedance-2.0-fast';

for (const item of referenceImages as ReferenceImageItem[]) {
  let url: string;
  if (typeof item === 'string') {
    url = item;
  } else if (
    isSeedance20 &&
    item.volcAssetStatus === 'active' &&
    item.volcAssetId
  ) {
    url = `asset://${item.volcAssetId}`;
  } else {
    url = item.url;
  }
  content.push({
    type: 'image_url',
    image_url: { url },
    role: 'reference_image',
  });
}
```

⚠️ 同时检查 `normalizeManagedV2ReferenceImages`（service 内部、若存在）是否也按 `string[]` 写的，若是要把它升级为返回 `ReferenceImageItem[]`。

- [ ] **Step 3: 也要升级另一处 image_url 注入位置（约 line 2168）**

搜索 `type: "image_url",\n          image_url: { url: imageUrl }`。那处如果也是 sd2 路径，套同样逻辑。若是其他模型（非 sd2/fast），留纯 url 原样。

- [ ] **Step 4: 编译检查**

```bash
cd backend && npx tsc -p tsconfig.build.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/ai/dto/video-provider.dto.ts backend/src/ai/services/video-provider.service.ts
git commit -m "feat(sd2): substitute image_url with asset:// when volc asset is active"
```

---

## Task 8: 前端 VolcAsset API 客户端

**Files:**
- Create: `frontend/src/services/volcAssetAPI.ts`

- [ ] **Step 1: 参考现有 API 客户端的 baseURL/认证写法**

先看 `frontend/src/services/videoProviderAPI.ts` 顶部 10 行，拿到它的 baseUrl / Authorization header 拼接方式；按同样风格写 VolcAsset 的 client。

- [ ] **Step 2: 创建 client**

```ts
// frontend/src/services/volcAssetAPI.ts
import { API_BASE_URL } from './apiBase'; // ← 按现有 apiBase 入口调整，若不存在就照 videoProviderAPI 的写法

export type VolcAssetStatus = 'processing' | 'active' | 'failed';

export interface UploadAssetResult {
  assetId: string;
  status: VolcAssetStatus;
  errorMessage?: string;
}

export interface AssetStatusResult {
  status: VolcAssetStatus;
  errorMessage?: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('authToken') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function uploadVolcAsset(sourceUrl: string): Promise<UploadAssetResult> {
  const resp = await fetch(`${API_BASE_URL}/volc-asset/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sourceUrl, assetType: 'image' }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export async function getVolcAssetStatus(assetId: string): Promise<AssetStatusResult> {
  const resp = await fetch(`${API_BASE_URL}/volc-asset/${encodeURIComponent(assetId)}/status`, {
    headers: authHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Status fetch failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}
```

⚠️ 如果项目里没有 `apiBase.ts`，照 `videoProviderAPI.ts` 的写法用 `import.meta.env.VITE_API_BASE_URL` 或实际的现有常量。

- [ ] **Step 3: 编译检查**

```bash
cd frontend && npx tsc -b --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/volcAssetAPI.ts
git commit -m "feat(volc-asset): frontend API client"
```

---

## Task 9: 前端轮询 hook

**Files:**
- Create: `frontend/src/hooks/useVolcAssetPolling.ts`

- [ ] **Step 1: 实现 hook**

```ts
// frontend/src/hooks/useVolcAssetPolling.ts
import { useEffect, useRef } from 'react';
import { getVolcAssetStatus, type VolcAssetStatus } from '../services/volcAssetAPI';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export interface VolcAssetPollingOptions {
  assetId?: string;
  status?: VolcAssetStatus;
  onUpdate: (next: { status: VolcAssetStatus; errorMessage?: string }) => void;
}

/**
 * status === 'processing' 时自动轮询至 terminal；其他状态不工作。
 * 超时强制置 failed。
 */
export function useVolcAssetPolling({ assetId, status, onUpdate }: VolcAssetPollingOptions) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!assetId || status !== 'processing') return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await getVolcAssetStatus(assetId);
        if (cancelled) return;
        if (result.status === 'processing') {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            onUpdateRef.current({ status: 'failed', errorMessage: '审核超时，请重试' });
            return;
          }
          setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          onUpdateRef.current({ status: result.status, errorMessage: result.errorMessage });
        }
      } catch (err: any) {
        if (cancelled) return;
        onUpdateRef.current({ status: 'failed', errorMessage: err?.message || '轮询失败' });
      }
    };
    const t = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assetId, status]);
}
```

- [ ] **Step 2: 编译检查**

```bash
cd frontend && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useVolcAssetPolling.ts
git commit -m "feat(volc-asset): polling hook for processing → terminal state"
```

---

## Task 10: ImageNode 加审核 icon + 4 态

**Files:**
- Modify: `frontend/src/components/flow/nodes/ImageNode.tsx`

- [ ] **Step 1: 先用 Read 把 ImageNode.tsx 读一遍，找到：**
  1. 现有 Send icon 的渲染位置（文件内搜索 `SendIcon`）
  2. 节点 data 更新的模式（应该有 `flow:updateNodeData` 或类似 CustomEvent / setNodes 调用）
  3. 节点 data 里当前图像 URL 存储字段名（可能是 `imageUrl` / `src` / `url` 等）

记下这三项。

- [ ] **Step 2: 顶部 import 追加**

```tsx
import {
  Send as SendIcon,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { uploadVolcAsset, type VolcAssetStatus } from '@/services/volcAssetAPI';
import { useVolcAssetPolling } from '@/hooks/useVolcAssetPolling';
```

- [ ] **Step 3: 在组件内部（顶层 hooks 区）加 state 绑定 + 轮询订阅**

```tsx
const volcAssetId: string | undefined = data?.volcAssetId;
const volcAssetStatus: VolcAssetStatus | undefined = data?.volcAssetStatus;
const volcAssetError: string | undefined = data?.volcAssetError;

const patchNode = React.useCallback((patch: Record<string, any>) => {
  window.dispatchEvent(
    new CustomEvent('flow:updateNodeData', {
      detail: { id, patch },
    })
  );
}, [id]);

useVolcAssetPolling({
  assetId: volcAssetId,
  status: volcAssetStatus,
  onUpdate: ({ status, errorMessage }) => {
    patchNode({ volcAssetStatus: status, volcAssetError: errorMessage });
  },
});

const handleReviewClick = React.useCallback(async () => {
  // 源 URL 取节点里已有的图片 URL 字段名 —— Step 1 查到的真实字段
  const sourceUrl: string | undefined = data?.imageUrl || data?.src || data?.url;
  if (!sourceUrl) {
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { type: 'warning', message: '没有可上传的图片' },
    }));
    return;
  }
  if (volcAssetStatus === 'processing' || volcAssetStatus === 'active') return;
  // optimistic
  patchNode({ volcAssetStatus: 'processing', volcAssetError: undefined });
  try {
    const r = await uploadVolcAsset(sourceUrl);
    patchNode({
      volcAssetId: r.assetId,
      volcAssetStatus: r.status,
      volcAssetError: r.errorMessage,
    });
  } catch (err: any) {
    patchNode({
      volcAssetId: undefined,
      volcAssetStatus: 'failed',
      volcAssetError: err?.message || '上传失败',
    });
  }
}, [data, volcAssetStatus, patchNode]);
```

⚠️ **把 Step 1 查到的真实字段名替换进 `const sourceUrl`**。

- [ ] **Step 4: 源 URL 变化清状态**

找到节点里监听 image URL 变化的 `useEffect`。若没有，直接加：

```tsx
React.useEffect(() => {
  // 当源 URL 变化，清掉旧 asset 关联（asset 绑死旧图）
  if (volcAssetId && data?._prevSourceUrl && data._prevSourceUrl !== data?.imageUrl) {
    patchNode({ volcAssetId: undefined, volcAssetStatus: undefined, volcAssetError: undefined });
  }
  patchNode({ _prevSourceUrl: data?.imageUrl });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [data?.imageUrl]);
```

**更简洁的替代方案**（推荐）：在真正替换图片源的那段调用处，主动带上清理 patch，就不需要 `_prevSourceUrl`。Step 1 若发现节点已有"替换图片"/"重新上传"handler，在那里直接 `{ imageUrl: newUrl, volcAssetId: undefined, volcAssetStatus: undefined, volcAssetError: undefined }`。

- [ ] **Step 5: 在 Send icon 旁渲染审核图标**

找到 Send icon 的 JSX，旁边加：

```tsx
<button
  type="button"
  onClick={handleReviewClick}
  title={
    volcAssetStatus === 'active' ? '已通过审核，sd2 将使用 asset://'
    : volcAssetStatus === 'processing' ? '审核中…'
    : volcAssetStatus === 'failed' ? (volcAssetError || '审核失败，点击重试')
    : '点击上传到方舟素材库'
  }
  disabled={volcAssetStatus === 'processing' || volcAssetStatus === 'active'}
  className="inline-flex items-center justify-center p-1 rounded hover:bg-black/5 disabled:cursor-default"
  style={{ pointerEvents: 'auto' }}
>
  {volcAssetStatus === 'active' ? <ShieldCheck size={14} className="text-green-600" />
   : volcAssetStatus === 'processing' ? <Loader2 size={14} className="animate-spin text-amber-500" />
   : volcAssetStatus === 'failed' ? <ShieldAlert size={14} className="text-red-500" />
   : <Shield size={14} className="text-gray-400" />}
</button>
```

⚠️ 按现有 SendIcon 的容器样式微调 className 保持视觉一致。

- [ ] **Step 6: 编译检查**

```bash
cd frontend && npx tsc -b --noEmit
```

- [ ] **Step 7: 本地联调**

```bash
cd frontend && npm run dev
```

在画板放一个 ImageNode，上传图，点审核图标 → 5s 内看到变绿/变红。若变红看报错，打开后端日志排查。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/flow/nodes/ImageNode.tsx
git commit -m "feat(image-node): add review icon with 4 states (idle/processing/active/failed)"
```

---

## Task 11: 前端 referenceImages payload 升级

**Files:**
- Modify: `frontend/src/components/flow/FlowOverlay.tsx:14261-14295`（sd2 分支）

**上下文：** 该行附近是"解析 image edges → referenceImages: string[]"逻辑；需改成 sd2 时带 volcAssetId/Status。

- [ ] **Step 1: 读 14230-14310 这段代码**

```bash
# 用 Read tool 打开 FlowOverlay.tsx offset=14230 limit=100
```

找到：
- 如何从 edges 取到 source nodes 的 `data`（应该有 `nodes.find(...)` 或类似）
- 当前组装 `referenceImages` 的行

- [ ] **Step 2: 改造组装逻辑**

大致形态（按实际代码结构调整）：

```ts
// 改前：
const referenceImages = await resolveEdgesAsDataUrls(imageEdges);

// 改后：
const rawUrls = await resolveEdgesAsDataUrls(imageEdges); // 仍返回 string[]
const isSeedance20 = seedanceModel === 'seedance-2.0' || seedanceModel === 'seedance-2.0-fast';
const sourceNodes = imageEdges
  .map((e) => nodes.find((n) => n.id === e.source))
  .filter(Boolean);

const referenceImages = isSeedance20
  ? rawUrls.map((url, idx) => ({
      url,
      volcAssetId: sourceNodes[idx]?.data?.volcAssetId,
      volcAssetStatus: sourceNodes[idx]?.data?.volcAssetStatus,
    }))
  : rawUrls;
```

⚠️ `resolveEdgesAsDataUrls` 的返回顺序需与 `imageEdges` 的顺序对齐，若实现里排过序则按相同逻辑也对 sourceNodes 排序。Step 1 阅读时确认。

- [ ] **Step 3: 另一段 Sora2 路径（14261 附近）不要改**

Sora2 不是 sd2，保持 `string[]`。只改被 sd2 路径经过的 referenceImages 组装。

- [ ] **Step 4: 编译检查**

```bash
cd frontend && npx tsc -b --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/flow/FlowOverlay.tsx
git commit -m "feat(sd2): forward volcAssetId/Status from image node data to generation request"
```

---

## Task 12: 端到端 smoke test（手动）

**Files:** 无

- [ ] **Step 1: 启动前后端**

```bash
# terminal 1
cd backend && npm run start:dev
# terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: 测试用例 A — 单图审核 + sd2 生成**

  1. 画板加 ImageNode，上传一张图
  2. 点审核图标 → 等待 10–60s 变绿
  3. 连 Seedance 2.0 视频节点，prompt 填"图片1里的人物走路"
  4. 触发生成
  5. 后端日志确认 `image_url.url` 是 `asset://asset-...`（搜索 `asset://`）
  6. 视频生成成功

- [ ] **Step 3: 测试用例 B — sd2-fast 同样流程**

Seedance 模型切 `seedance-2.0-fast`，重复 A.4–6。

- [ ] **Step 4: 测试用例 C — 未审核图走 fallback**

新 ImageNode，上传图，**不点审核**，连 sd2 节点生成。后端日志里 `image_url.url` 应是 HTTPS URL；视频生成成功。

- [ ] **Step 5: 测试用例 D — 失败图走 fallback**

造一个 failure 场景：上传一张明显不合规的图触发审核失败（或把 `VOLC_ARK_ACCESS_KEY` 故意改错再重启后端，让上传 failed）。连 sd2 生成，image_url 应为 HTTPS URL。

完成后改回正确 key。

- [ ] **Step 6: 测试用例 E — 多图混合状态**

一个 sd2 节点连 3 张图：A 已 active / B 审核中 / C 未审核。触发生成，日志里 3 行 `image_url`：A=`asset://...`, B=https, C=https。

- [ ] **Step 7: 测试用例 F — 非 sd2 节点不替换**

已 active 的图连 Kling 节点，生成。日志 `image_url` 应是 HTTPS URL（Kling 不识别 asset://）。

- [ ] **Step 8: 测试用例 G — 刷新恢复轮询**

点审核进入 processing 态，立刻浏览器刷新。进入页面应自动恢复轮询，几秒后变绿/变红。

- [ ] **Step 9: 测试用例 H — 替换图清状态**

已 active 的 ImageNode，替换图（重新上传新图）。审核图标应变回灰色（未审核）。

- [ ] **Step 10: 无 Commit**（纯手工验证）

---

## 风险检查

- 若 Task 7 发现 `normalizeManagedV2ReferenceImages` 还需升级但当前步骤没覆盖，补一个"Task 7.5"并放同一个 commit。
- 若 Task 11 的 `FlowOverlay.tsx` 代码结构跟描述差距大，停下来读 30–50 行周围，不要靠猜改。
- 如果 smoke test C/D/F 任何一项失败，优先检查后端 `video-provider.service.ts` 的 `isSeedance20` 判定逻辑是否命中。

---

## 回滚

1. `git revert` 所有 volc-asset 相关 commit
2. 或单独：
   - 前端：注释掉 ImageNode 中的审核按钮渲染
   - 后端：把 Task 7 的 `for (const item of referenceImages)` 改回 `for (const imageUrl of referenceImages)`（纯 string[]）
3. `.env` 里的 VOLC_ARK_* 保留（不影响现有功能）
