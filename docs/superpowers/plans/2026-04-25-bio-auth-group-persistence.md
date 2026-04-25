# Bio-Auth Group 持久化与历史复用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 持久化生物认证的 LivenessFace GroupId，让用户在 Modal 中选择历史认证 Group 直接上传素材，跳过 H5 活体流程；同时将 assetId 回传前端，关闭现有断层。

**Architecture:** 后端新增 `BioAuthGroup` Prisma 模型存储 userId/groupId/imageUrl；扩展现有 status 接口返回 assetId+groupId；新增 `GET /groups` 和 `POST /asset` 接口。前端 `BioAuthModal` 新增 `history`（历史选择）和 `waiting`（无二维码等待）两个步骤；`useBioAuthPolling` 扩展回调传递 assetId/groupId；`ImageNode.onSuccess` 同时写入 `volcAssetId`。

**Tech Stack:** NestJS + Prisma (PostgreSQL) / React + TypeScript

---

## 文件地图

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/prisma/schema.prisma` | 修改 | 新增 `BioAuthGroup` 模型 |
| `backend/src/bio-auth/bio-auth.dto.ts` | 修改 | 新增 DTO，扩展 StatusResponse |
| `backend/src/bio-auth/bio-auth.service.ts` | 修改 | 注入 Prisma，持久化 group，新增两个方法，更新 getStatus |
| `backend/src/bio-auth/bio-auth.module.ts` | 修改 | 导入 PrismaModule |
| `backend/src/bio-auth/bio-auth.controller.ts` | 修改 | 新增两个路由 |
| `frontend/src/services/bioAuthAPI.ts` | 修改 | 新增两个 API 函数 |
| `frontend/src/hooks/useBioAuthPolling.ts` | 修改 | onUpdate 回调携带 assetId/groupId |
| `frontend/src/components/flow/nodes/BioAuthModal.tsx` | 修改 | 新增 history/waiting 步，更新 onSuccess 签名 |
| `frontend/src/components/flow/nodes/ImageNode.tsx` | 修改 | onSuccess 写入 volcAssetId |

---

## Task 1: 添加 BioAuthGroup Prisma 模型并迁移

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: 在 schema.prisma 末尾（`postgres_log` 模型之前）添加模型**

```prisma
model BioAuthGroup {
  id        String   @id @default(uuid())
  userId    String
  groupId   String   @unique
  imageUrl  String
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}
```

- [ ] **Step 2: 生成并执行迁移**

```bash
cd backend
npx prisma migrate dev --name add_bio_auth_group
```

Expected: 控制台输出 `Your database is now in sync with your schema.`，`prisma/migrations/` 下出现新目录。

- [ ] **Step 3: 验证 Prisma Client 已更新**

```bash
npx prisma generate
```

Expected: 无报错，`node_modules/.prisma/client` 更新。

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(bio-auth): add BioAuthGroup prisma model"
```

---

## Task 2: 扩展 bio-auth DTO

**Files:**
- Modify: `backend/src/bio-auth/bio-auth.dto.ts`

- [ ] **Step 1: 替换文件内容**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartBioAuthDto {
  @ApiProperty({ description: '用于人脸比对的基准图片 URL', maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageUrl!: string;
}

export class CreateAssetInGroupDto {
  @ApiProperty({ description: '已认证的 LivenessFace GroupId' })
  @IsString()
  @IsNotEmpty()
  groupId!: string;

  @ApiProperty({ description: '素材图片 URL', maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageUrl!: string;
}

export type BioAuthStatus = 'processing' | 'active' | 'failed';

export interface StartBioAuthResponse {
  taskId: string;
  h5Link: string;
}

export interface BioAuthStatusResponse {
  status: BioAuthStatus;
  errorMessage?: string;
  assetId?: string;
  groupId?: string;
}

export interface BioAuthGroupItem {
  groupId: string;
  imageUrl: string;
  createdAt: string;
}

export interface ListGroupsResponse {
  groups: BioAuthGroupItem[];
}

export interface CreateAssetInGroupResponse {
  taskId: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/bio-auth/bio-auth.dto.ts
git commit -m "feat(bio-auth): extend DTOs for group persistence and asset-in-group"
```

---

## Task 3: 更新 BioAuthService

**Files:**
- Modify: `backend/src/bio-auth/bio-auth.service.ts`

- [ ] **Step 1: 在文件顶部添加 PrismaService 导入**

找到现有 import 行：
```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signVolcRequest } from '../volc-asset/volc-sign.util';
import type { BioAuthStatus, BioAuthStatusResponse, StartBioAuthResponse } from './bio-auth.dto';
```

替换为：
```ts
import { Injectable, Logger, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { signVolcRequest } from '../volc-asset/volc-sign.util';
import type {
  BioAuthStatus,
  BioAuthStatusResponse,
  StartBioAuthResponse,
  BioAuthGroupItem,
  ListGroupsResponse,
  CreateAssetInGroupResponse,
} from './bio-auth.dto';
```

- [ ] **Step 2: 为 TaskRecord 添加 groupId 字段**

找到：
```ts
interface TaskRecord {
  taskId: string;
  imageUrl: string;
  userId: string;
  status: BioAuthStatus;
  assetId?: string;
  errorMessage?: string;
  createdAt: number;
}
```

替换为：
```ts
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
```

- [ ] **Step 3: 在 constructor 中注入 PrismaService**

找到：
```ts
  constructor(private readonly config: ConfigService) {}
```

替换为：
```ts
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}
```

- [ ] **Step 4: 在 handleCallback 中持久化 GroupId**

找到 `handleCallback` 方法中：
```ts
      const groupId = validateResult?.GroupId;
      if (!groupId) throw new Error('GetVisualValidateResult: missing GroupId');

      const assetResp = await this.call<{ Id?: string }>('CreateAsset', {
```

替换为：
```ts
      const groupId = validateResult?.GroupId;
      if (!groupId) throw new Error('GetVisualValidateResult: missing GroupId');

      await this.prisma.bioAuthGroup.upsert({
        where: { groupId },
        create: { userId: task.userId, groupId, imageUrl: task.imageUrl },
        update: {},
      });
      task.groupId = groupId;

      const assetResp = await this.call<{ Id?: string }>('CreateAsset', {
```

- [ ] **Step 5: 更新 pollAsset 在 Active 时记录 groupId 到 task（已由 Step 4 写入，只需确认 task.assetId 赋值正常）**

检查 `pollAsset` 中以下代码存在（无需修改）：
```ts
        if (s === 'active') {
          task.status = 'active';
          this.logger.log(`bio-auth asset active: ${assetId}`);
```

确认 `task.assetId` 在 `handleCallback` 中已被赋值（`task.assetId = assetResp.Id`）。

- [ ] **Step 6: 更新 getStatus 返回 assetId 和 groupId**

找到：
```ts
  getStatus(taskId: string): BioAuthStatusResponse {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { status: 'failed', errorMessage: '任务不存在或已过期' };
    }
    return { status: task.status, errorMessage: task.errorMessage };
  }
```

替换为：
```ts
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
```

- [ ] **Step 7: 添加 listGroups 方法（在 getStatus 之后）**

```ts
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
```

- [ ] **Step 8: 添加 createAssetInGroup 方法（在 listGroups 之后）**

```ts
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
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, record);
    this.logger.log(`bio-auth createAssetInGroup: assetId=${taskId.slice(0, 20)}… group=${groupId.slice(0, 20)}…`);
    this.pollAsset(taskId, taskId);
    return { taskId };
  }
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/bio-auth/bio-auth.service.ts
git commit -m "feat(bio-auth): persist group, expose assetId/groupId, add listGroups/createAssetInGroup"
```

---

## Task 4: 更新 BioAuthModule 和 BioAuthController

**Files:**
- Modify: `backend/src/bio-auth/bio-auth.module.ts`
- Modify: `backend/src/bio-auth/bio-auth.controller.ts`

- [ ] **Step 1: 在 bio-auth.module.ts 中导入 PrismaModule**

将文件替换为：
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BioAuthController } from './bio-auth.controller';
import { BioAuthService } from './bio-auth.service';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule],
  providers: [BioAuthService],
  controllers: [BioAuthController],
})
export class BioAuthModule {}
```

- [ ] **Step 2: 在 bio-auth.controller.ts 中新增两个路由**

找到现有 import 行：
```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { BioAuthService } from './bio-auth.service';
import { StartBioAuthDto } from './bio-auth.dto';
```

替换为：
```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { BioAuthService } from './bio-auth.service';
import { StartBioAuthDto, CreateAssetInGroupDto } from './bio-auth.dto';
```

- [ ] **Step 3: 在 controller 中添加两个新路由（在 callback 路由之前）**

找到：
```ts
  // 火山引擎活体检测回调（无需认证，由火山引擎服务器调用）
  @Get('callback')
```

在其之前插入：
```ts
  @UseGuards(ApiKeyOrJwtGuard)
  @Get('groups')
  async groups(@Req() req: any) {
    const userId = this.resolveUserId(req);
    return this.svc.listGroups(userId);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Post('asset')
  async createAsset(@Req() req: any, @Body() dto: CreateAssetInGroupDto) {
    const userId = this.resolveUserId(req);
    this.logger.log(`bio-auth createAsset: user=${userId} groupId=${dto.groupId.slice(0, 20)}…`);
    return this.svc.createAssetInGroup(userId, dto.groupId, dto.imageUrl);
  }

```

- [ ] **Step 4: 验证后端编译**

```bash
cd backend
npx tsc -p tsconfig.build.json --noEmit
```

Expected: 无 TypeScript 错误。

- [ ] **Step 5: Commit**

```bash
git add backend/src/bio-auth/bio-auth.module.ts backend/src/bio-auth/bio-auth.controller.ts
git commit -m "feat(bio-auth): add GET /groups and POST /asset endpoints"
```

---

## Task 5: 更新前端 bioAuthAPI.ts

**Files:**
- Modify: `frontend/src/services/bioAuthAPI.ts`

- [ ] **Step 1: 将文件替换为以下内容**

```ts
import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type BioAuthStatus = "processing" | "active" | "failed";

export interface StartBioAuthResult {
  taskId: string;
  h5Link: string;
}

export interface BioAuthStatusResult {
  status: BioAuthStatus;
  errorMessage?: string;
  assetId?: string;
  groupId?: string;
}

export interface BioAuthGroupItem {
  groupId: string;
  imageUrl: string;
  createdAt: string;
}

export interface ListGroupsResult {
  groups: BioAuthGroupItem[];
}

export interface CreateAssetInGroupResult {
  taskId: string;
}

export async function startBioAuth(imageUrl: string): Promise<StartBioAuthResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/bio-auth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function getBioAuthStatus(taskId: string): Promise<BioAuthStatusResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/bio-auth/${encodeURIComponent(taskId)}/status`
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function listBioAuthGroups(): Promise<ListGroupsResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/bio-auth/groups`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function createAssetInGroup(
  groupId: string,
  imageUrl: string,
): Promise<CreateAssetInGroupResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/bio-auth/asset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId, imageUrl }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/bioAuthAPI.ts
git commit -m "feat(bio-auth): add listBioAuthGroups and createAssetInGroup API functions"
```

---

## Task 6: 扩展 useBioAuthPolling Hook

**Files:**
- Modify: `frontend/src/hooks/useBioAuthPolling.ts`

- [ ] **Step 1: 将文件替换为以下内容**

```ts
import React from "react";
import { getBioAuthStatus, type BioAuthStatus } from "../services/bioAuthAPI";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export interface BioAuthPollUpdate {
  status: BioAuthStatus;
  errorMessage?: string;
  assetId?: string;
  groupId?: string;
}

export interface BioAuthPollingOptions {
  taskId?: string;
  status?: BioAuthStatus;
  onUpdate: (next: BioAuthPollUpdate) => void;
}

export function useBioAuthPolling({ taskId, status, onUpdate }: BioAuthPollingOptions) {
  const onUpdateRef = React.useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  React.useEffect(() => {
    if (!taskId || status !== "processing") return;
    let cancelled = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await getBioAuthStatus(taskId);
        if (cancelled) return;
        if (result.status === "processing") {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            onUpdateRef.current({ status: "failed", errorMessage: "认证超时，请重试" });
            return;
          }
          setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          onUpdateRef.current({
            status: result.status,
            errorMessage: result.errorMessage,
            assetId: result.assetId,
            groupId: result.groupId,
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        onUpdateRef.current({ status: "failed", errorMessage: err?.message || "轮询失败" });
      }
    };

    const t = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [taskId, status]);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useBioAuthPolling.ts
git commit -m "feat(bio-auth): extend polling hook to pass assetId/groupId on success"
```

---

## Task 7: 重写 BioAuthModal（新增 history/waiting 步）

**Files:**
- Modify: `frontend/src/components/flow/nodes/BioAuthModal.tsx`

- [ ] **Step 1: 将文件替换为以下内容**

```tsx
import React from "react";
import { X, UserRound, Smartphone, ShieldCheck, ShieldAlert, Loader2, Copy, Check, ChevronRight, Clock } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { startBioAuth, listBioAuthGroups, createAssetInGroup } from "@/services/bioAuthAPI";
import { useBioAuthPolling } from "@/hooks/useBioAuthPolling";
import type { BioAuthStatus, BioAuthGroupItem } from "@/services/bioAuthAPI";

export interface BioAuthModalProps {
  isOpen: boolean;
  imageUrl: string;
  onClose: () => void;
  onStart?: (taskId: string) => void;
  onSuccess: (taskId: string, assetId: string, groupId: string) => void;
  onFail: (errorMessage?: string) => void;
}

type WizardStep = "loading" | "history" | "consent" | "verifying" | "waiting" | "result";

export function BioAuthModal({ isOpen, imageUrl, onClose, onStart, onSuccess, onFail }: BioAuthModalProps) {
  const [step, setStep] = React.useState<WizardStep>("loading");
  const [taskId, setTaskId] = React.useState<string | undefined>(undefined);
  const [h5Link, setH5Link] = React.useState<string | undefined>(undefined);
  const [pollStatus, setPollStatus] = React.useState<BioAuthStatus | undefined>(undefined);
  const [pollError, setPollError] = React.useState<string | undefined>(undefined);
  const [authError, setAuthError] = React.useState<string | undefined>(undefined);
  const [groups, setGroups] = React.useState<BioAuthGroupItem[]>([]);
  const [resultAssetId, setResultAssetId] = React.useState<string | undefined>(undefined);
  const [resultGroupId, setResultGroupId] = React.useState<string | undefined>(undefined);

  useBioAuthPolling({
    taskId,
    status: (step === "verifying" || step === "waiting") ? pollStatus : undefined,
    onUpdate: ({ status, errorMessage, assetId, groupId }) => {
      setPollStatus(status);
      if (status === "active") {
        setResultAssetId(assetId);
        setResultGroupId(groupId);
        setStep("result");
        onSuccess(taskId!, assetId!, groupId!);
      } else if (status === "failed") {
        setPollError(errorMessage);
        setStep("result");
        onFail(errorMessage);
      }
    },
  });

  React.useEffect(() => {
    if (!isOpen) return;
    setStep("loading");
    setTaskId(undefined);
    setH5Link(undefined);
    setPollStatus(undefined);
    setPollError(undefined);
    setAuthError(undefined);
    setResultAssetId(undefined);
    setResultGroupId(undefined);
    listBioAuthGroups()
      .then(({ groups: g }) => {
        if (g.length > 0) {
          setGroups(g);
          setStep("history");
        } else {
          setStep("consent");
        }
      })
      .catch(() => {
        setStep("consent");
      });
  }, [isOpen]);

  const startAuth = React.useCallback(async () => {
    setAuthError(undefined);
    setStep("verifying");
    try {
      const result = await startBioAuth(imageUrl);
      setTaskId(result.taskId);
      setH5Link(result.h5Link);
      setPollStatus("processing");
      onStart?.(result.taskId);
    } catch (err: any) {
      const msg = err?.message || "启动认证失败";
      setAuthError(msg);
      setStep("result");
      onFail(msg);
    }
  }, [imageUrl, onFail, onStart]);

  const selectGroup = React.useCallback(async (groupId: string) => {
    setStep("waiting");
    setPollStatus("processing");
    try {
      const result = await createAssetInGroup(groupId, imageUrl);
      setTaskId(result.taskId);
      onStart?.(result.taskId);
    } catch (err: any) {
      const msg = err?.message || "上传素材失败";
      setAuthError(msg);
      setStep("result");
      onFail(msg);
    }
  }, [imageUrl, onFail, onStart]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 420,
          maxWidth: "90vw",
          padding: 28,
          position: "relative",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9ca3af",
            padding: 4,
          }}
        >
          <X size={18} />
        </button>

        {step === "loading" && <LoadingStep />}
        {step === "history" && (
          <HistoryStep
            groups={groups}
            onSelect={selectGroup}
            onNewAuth={() => setStep("consent")}
          />
        )}
        {step === "consent" && <ConsentStep onStart={startAuth} onCancel={onClose} />}
        {step === "verifying" && (
          <VerifyingStep
            h5Link={h5Link}
            authError={authError}
            onRetry={startAuth}
            onCancel={onClose}
          />
        )}
        {step === "waiting" && <WaitingStep />}
        {step === "result" && (
          <ResultStep
            success={pollStatus === "active"}
            errorMessage={pollError || authError}
            onRetry={startAuth}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function LoadingStep() {
  return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <Loader2 size={28} className="animate-spin" style={{ color: "#6366f1", margin: "0 auto" }} />
    </div>
  );
}

function HistoryStep({
  groups,
  onSelect,
  onNewAuth,
}: {
  groups: BioAuthGroupItem[];
  onSelect: (groupId: string) => void;
  onNewAuth: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <UserRound size={22} style={{ color: "#6366f1" }} />
        <span style={{ fontWeight: 700, fontSize: 17 }}>选择已认证身份</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {groups.map((g) => {
          const date = new Date(g.createdAt);
          const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
          return (
            <button
              key={g.groupId}
              onClick={() => onSelect(g.groupId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <img
                src={g.imageUrl}
                alt=""
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  objectFit: "cover",
                  flexShrink: 0,
                  background: "#f3f4f6",
                }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#6b7280" }}>
                  <Clock size={11} />
                  {label}
                </div>
              </div>
              <ChevronRight size={16} style={{ color: "#9ca3af" }} />
            </button>
          );
        })}
      </div>

      <button
        onClick={onNewAuth}
        style={{
          width: "100%",
          padding: "9px 0",
          borderRadius: 8,
          border: "1px dashed #d1d5db",
          background: "#fff",
          cursor: "pointer",
          fontSize: 13,
          color: "#6b7280",
        }}
      >
        重新认证 →
      </button>
    </div>
  );
}

function WaitingStep() {
  return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <Loader2 size={32} className="animate-spin" style={{ color: "#6366f1", margin: "0 auto 16px" }} />
      <p style={{ fontSize: 14, color: "#6b7280" }}>素材审核中，请稍候…</p>
    </div>
  );
}

function ConsentStep({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <UserRound size={22} style={{ color: "#6366f1" }} />
        <span style={{ fontWeight: 700, fontSize: 17 }}>真人素材授权认证</span>
      </div>
      <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.7, marginBottom: 12 }}>
        即将对此图片进行生物认证，以确认您是图片中的本人，并授权将此图像用于 AI 内容生成。
      </p>
      <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, marginBottom: 8 }}>
        认证流程：
      </p>
      <ol style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.8, marginBottom: 20, paddingLeft: 20 }}>
        <li>系统生成专属验证链接</li>
        <li>用手机扫描二维码完成活体检测</li>
        <li>系统自动完成授权认证（约 1 分钟）</li>
      </ol>
      <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 24 }}>
        认证信息仅用于授权验证，认证有效期 <strong>30 天</strong>。
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 14, color: "#374151" }}
        >
          取消
        </button>
        <button
          onClick={onStart}
          style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
        >
          开始认证 →
        </button>
      </div>
    </div>
  );
}

function VerifyingStep({
  h5Link,
  authError,
  onRetry,
  onCancel,
}: {
  h5Link?: string;
  authError?: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const copyLink = React.useCallback(() => {
    if (!h5Link) return;
    navigator.clipboard.writeText(h5Link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [h5Link]);

  if (authError) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Smartphone size={20} style={{ color: "#6366f1" }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>启动认证</span>
        </div>
        <p style={{ fontSize: 13, color: "#ef4444", marginBottom: 16 }}>{authError}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13 }}>取消</button>
          <button onClick={onRetry} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 13 }}>重试</button>
        </div>
      </div>
    );
  }

  if (!h5Link) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "#6366f1", margin: "0 auto 16px" }} />
        <p style={{ fontSize: 14, color: "#6b7280" }}>正在生成验证链接…</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Smartphone size={20} style={{ color: "#6366f1" }} />
        <span style={{ fontWeight: 700, fontSize: 16 }}>用手机完成活体认证</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <div style={{ padding: 12, background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <QRCodeCanvas value={h5Link} size={180} />
        </div>
      </div>
      <p style={{ fontSize: 13, color: "#374151", textAlign: "center", marginBottom: 14 }}>
        用手机扫码，按提示完成活体检测
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          onClick={copyLink}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151" }}
        >
          {copied ? <Check size={14} style={{ color: "#16a34a" }} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制链接"}
        </button>
        <a
          href={h5Link}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 13, textDecoration: "none" }}
        >
          <Smartphone size={14} />
          在手机上打开
        </a>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6b7280", fontSize: 12, justifyContent: "center" }}>
        <Loader2 size={13} className="animate-spin" />
        等待手机端完成验证，请勿关闭此窗口…
      </div>
    </div>
  );
}

function ResultStep({
  success,
  errorMessage,
  onRetry,
  onClose,
}: {
  success: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const expiryDate = React.useMemo(() => {
    if (!success) return "";
    const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [success]);

  return (
    <div style={{ textAlign: "center", padding: "8px 0" }}>
      {success ? (
        <>
          <ShieldCheck size={48} style={{ color: "#16a34a", margin: "0 auto 16px" }} />
          <p style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>认证成功</p>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>认证有效至 {expiryDate}</p>
          <button onClick={onClose} style={{ padding: "8px 28px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            关闭
          </button>
        </>
      ) : (
        <>
          <ShieldAlert size={48} style={{ color: "#ef4444", margin: "0 auto 16px" }} />
          <p style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>认证失败</p>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>{errorMessage || "请重新尝试"}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 14 }}>取消</button>
            <button onClick={onRetry} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>重试</button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/flow/nodes/BioAuthModal.tsx
git commit -m "feat(bio-auth): add history/waiting steps to BioAuthModal"
```

---

## Task 8: 更新 ImageNode 的 onSuccess 处理

**Files:**
- Modify: `frontend/src/components/flow/nodes/ImageNode.tsx`

- [ ] **Step 1: 找到 onSuccess 回调并更新签名与逻辑**

在 ImageNode.tsx 中找到（约第 1963 行）：
```tsx
        onSuccess={(taskId) => {
          patchNode({
            bioAuthId: taskId,
            bioAuthStatus: "active",
            bioAuthError: undefined,
            bioAuthDate: new Date().toISOString(),
          });
          setBioAuthModalOpen(false);
        }}
```

替换为：
```tsx
        onSuccess={(taskId, assetId, groupId) => {
          patchNode({
            bioAuthId: taskId,
            bioAuthStatus: "active",
            bioAuthError: undefined,
            bioAuthDate: new Date().toISOString(),
            volcAssetId: assetId,
            volcAssetStatus: "active",
            volcReviewDate: new Date().toISOString(),
          });
          setBioAuthModalOpen(false);
        }}
```

- [ ] **Step 2: 更新 ImageNode 中对 useBioAuthPolling onUpdate 的处理（背景轮询）**

在 ImageNode.tsx 中找到（约第 1117 行）：
```ts
  useBioAuthPolling({
    taskId: bioAuthId,
    status: effectiveBioStatus,
    onUpdate: ({ status, errorMessage }) => {
      patchNode({
        bioAuthStatus: status,
        bioAuthError: errorMessage,
        ...(status === "active" ? { bioAuthDate: new Date().toISOString() } : {}),
      });
    },
  });
```

替换为：
```ts
  useBioAuthPolling({
    taskId: bioAuthId,
    status: effectiveBioStatus,
    onUpdate: ({ status, errorMessage, assetId }) => {
      patchNode({
        bioAuthStatus: status,
        bioAuthError: errorMessage,
        ...(status === "active" ? {
          bioAuthDate: new Date().toISOString(),
          volcAssetId: assetId,
          volcAssetStatus: "active",
          volcReviewDate: new Date().toISOString(),
        } : {}),
      });
    },
  });
```

- [ ] **Step 3: 验证前端 TypeScript 编译**

```bash
cd frontend
npx tsc --noEmit
```

Expected: 无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/flow/nodes/ImageNode.tsx
git commit -m "feat(bio-auth): write volcAssetId to node on bio-auth success"
```

---

## Task 9: 端到端手动验证

- [ ] **Step 1: 启动后端**

```bash
cd backend && npm run dev
```

- [ ] **Step 2: 验证新路由已注册**

```bash
curl -s http://localhost:4000/api/bio-auth/groups \
  -H "Authorization: Bearer <valid-jwt>" | jq .
```

Expected: `{ "groups": [] }`（首次无历史）

- [ ] **Step 3: 验证 TypeScript 编译（前端）**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 在浏览器中打开 ImageNode，点击生物认证 badge**

- 首次：无历史 → 直接显示 consent 步（「开始认证 →」按钮）✓
- 有历史后再次点击：显示 history 步，列表中每行有缩略图 + 时间 ✓
- 选择历史 → 显示 waiting 步（spinner）→ 轮询到 active → 结果页 ✓
- 点「重新认证 →」→ 跳到 consent 步 ✓
- bio-auth 成功后，节点上 `volcAssetId` 被写入（可在 React DevTools 确认）✓
