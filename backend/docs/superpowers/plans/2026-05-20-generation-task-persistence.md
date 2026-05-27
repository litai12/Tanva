# Generation Task Persistence & Batch Node Query

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 image/video 生成任务统一持久化到数据库，前端刷新/重启后可通过批量接口 `POST /ai/tasks/by-nodes` 按画布节点 ID 恢复任务状态。

**Architecture:**
- `ImageTask` 已持久化到 DB，补加 `nodeId` 字段。
- Video/3D 任务目前只在内存 (`async-video-task.store.ts`)，新建 `VideoTask` Prisma 模型接管持久化；内存 Map 保留作高速轮询缓存。
- 新建 `GenerationTaskService`（NestJS Injectable），统一封装创建/更新/查询，并在 `onModuleInit` 时清理卡死任务。
- 新增 `POST /ai/tasks/by-nodes` 批量接口，同时查 `ImageTask` 和 `VideoTask` 表，按 nodeId 返回最新一条。

**Tech Stack:** NestJS, Prisma (PostgreSQL), TypeScript

---

## File Map

| 动作 | 文件 |
|------|------|
| Modify | `backend/prisma/schema.prisma` |
| Create | `backend/prisma/migrations/202605200001_add_video_task_and_node_id/migration.sql` |
| Create | `backend/src/ai/services/generation-task.service.ts` |
| Modify | `backend/src/ai/services/image-task.service.ts` |
| Modify | `backend/src/ai/dto/image-generation.dto.ts` |
| Modify | `backend/src/ai/dto/video-generation.dto.ts` |
| Modify | `backend/src/ai/ai.module.ts` |
| Modify | `backend/src/ai/ai.controller.ts` |

---

## Task 1: Prisma Schema — 加 VideoTask 模型 + ImageTask.nodeId

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/202605200001_add_video_task_and_node_id/migration.sql`

- [ ] **Step 1: 修改 schema.prisma**

在 `model ImageTask` 的 `aiProvider` 字段下面加一行：

```prisma
// model ImageTask 中，在 aiProvider String? 后加：
  nodeId       String?

// 同时在 model ImageTask 的 @@ 索引块最后加：
  @@index([nodeId])
```

完整改动后 `model ImageTask` 结尾变为：

```prisma
  aiProvider   String?
  nodeId       String?
  retryCount   Int       @default(0)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  completedAt  DateTime?

  @@index([userId, createdAt])
  @@index([status, createdAt])
  @@index([nodeId])
}
```

在 `model ImageTask` 结束花括号后新增：

```prisma
model VideoTask {
  id          String    @id
  userId      String
  nodeId      String?
  status      String    @default("queued")
  taskType    String
  prompt      String?   @db.Text
  result      Json?
  error       String?   @db.Text
  metadata    Json?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  completedAt DateTime?

  @@index([nodeId])
  @@index([userId, createdAt])
  @@index([status, updatedAt])
}
```

- [ ] **Step 2: 创建 migration SQL**

创建文件 `backend/prisma/migrations/202605200001_add_video_task_and_node_id/migration.sql`：

```sql
-- Add nodeId to ImageTask
ALTER TABLE "ImageTask" ADD COLUMN IF NOT EXISTS "nodeId" TEXT;
CREATE INDEX IF NOT EXISTS "ImageTask_nodeId_idx" ON "ImageTask"("nodeId");

-- Create VideoTask table
CREATE TABLE IF NOT EXISTS "VideoTask" (
  "id"          TEXT        NOT NULL,
  "userId"      TEXT        NOT NULL,
  "nodeId"      TEXT,
  "status"      TEXT        NOT NULL DEFAULT 'queued',
  "taskType"    TEXT        NOT NULL,
  "prompt"      TEXT,
  "result"      JSONB,
  "error"       TEXT,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "VideoTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VideoTask_nodeId_idx"       ON "VideoTask"("nodeId");
CREATE INDEX IF NOT EXISTS "VideoTask_userId_createdAt_idx" ON "VideoTask"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "VideoTask_status_updatedAt_idx" ON "VideoTask"("status", "updatedAt");

-- Auto-update updatedAt trigger
CREATE OR REPLACE FUNCTION update_video_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS video_task_updated_at ON "VideoTask";
CREATE TRIGGER video_task_updated_at
  BEFORE UPDATE ON "VideoTask"
  FOR EACH ROW EXECUTE FUNCTION update_video_task_updated_at();
```

- [ ] **Step 3: 将 migration 标记为已应用（仅当手动管理 migration 时）**

检查是否使用 `prisma migrate dev` 或手动 SQL。如果是手动 SQL（参考 patches 目录），则直接在 docker-compose 或部署时执行该 SQL 文件即可，schema.prisma 的修改用于 Prisma Client 类型生成。

运行：
```bash
cd /Users/libiqiang/business/Tanva/backend
npx prisma generate
```

期望输出：包含 `videoTask` 和 `imageTask` 的 Prisma Client 重新生成成功，无报错。

---

## Task 2: GenerationTaskService — 统一视频任务持久化 + 批量查询

**Files:**
- Create: `backend/src/ai/services/generation-task.service.ts`

- [ ] **Step 1: 创建 generation-task.service.ts**

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createAsyncTask,
  updateAsyncTask,
  getAsyncTaskResult,
} from './async-video-task.store';

export interface CreateVideoTaskParams {
  taskId: string;
  userId: string;
  nodeId?: string;
  taskType: string;
  prompt?: string;
  metadata?: Record<string, any>;
}

export interface UpdateVideoTaskParams {
  status?: 'queued' | 'processing' | 'succeeded' | 'failed';
  result?: Record<string, any>;
  error?: string;
  completedAt?: Date;
}

export interface GenerationTaskRecord {
  taskId: string;
  nodeId: string | null;
  category: 'image' | 'video';
  taskType: string;
  status: string;
  result: Record<string, any> | null;
  error: string | null;
  updatedAt: Date;
}

// Tasks stuck in processing longer than this are considered orphaned
const STUCK_TASK_TIMEOUT_MS = 40 * 60 * 1000; // 40 minutes

@Injectable()
export class GenerationTaskService implements OnModuleInit {
  private readonly logger = new Logger(GenerationTaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileStuckVideoTasks();
  }

  /**
   * Creates a VideoTask record in DB and memory store.
   * Supersedes previous queued/processing tasks for the same nodeId.
   */
  async createVideoTask(params: CreateVideoTaskParams): Promise<void> {
    const { taskId, userId, nodeId, taskType, prompt, metadata } = params;

    createAsyncTask(taskId);

    await this.prisma.videoTask.create({
      data: {
        id: taskId,
        userId,
        nodeId: nodeId ?? null,
        status: 'queued',
        taskType,
        prompt: prompt ?? null,
        metadata: metadata ?? undefined,
      },
    });

    if (nodeId) {
      await this.prisma.videoTask.updateMany({
        where: {
          nodeId,
          userId,
          id: { not: taskId },
          status: { in: ['queued', 'processing'] },
        },
        data: { status: 'failed', error: 'superseded by newer task' },
      });
    }
  }

  /**
   * Updates VideoTask in both DB and memory store.
   */
  async updateVideoTask(taskId: string, update: UpdateVideoTaskParams): Promise<void> {
    const memoryStatus =
      update.status === 'succeeded' ? 'completed' : update.status;

    updateAsyncTask(taskId, {
      status: memoryStatus as any,
      result: update.result as any,
      error: update.error,
    });

    await this.prisma.videoTask.update({
      where: { id: taskId },
      data: {
        ...(update.status !== undefined && { status: update.status }),
        ...(update.result !== undefined && { result: update.result }),
        ...(update.error !== undefined && { error: update.error }),
        ...(update.status === 'succeeded' || update.status === 'failed'
          ? { completedAt: update.completedAt ?? new Date() }
          : {}),
      },
    }).catch((err: Error) => {
      this.logger.warn(`VideoTask update failed for ${taskId}: ${err.message}`);
    });
  }

  /**
   * Queries both ImageTask and VideoTask tables by nodeIds.
   * Returns latest task per nodeId (max 50 nodeIds).
   * Memory store is checked last for in-flight video tasks to surface real-time status.
   */
  async batchQueryByNodeIds(
    nodeIds: string[],
    userId: string,
  ): Promise<Record<string, GenerationTaskRecord | null>> {
    const limited = nodeIds.slice(0, 50);
    const result: Record<string, GenerationTaskRecord | null> = {};
    for (const id of limited) result[id] = null;

    const [videoTasks, imageTasks] = await Promise.all([
      this.prisma.videoTask.findMany({
        where: { nodeId: { in: limited }, userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.imageTask.findMany({
        where: { nodeId: { in: limited }, userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    for (const t of videoTasks) {
      if (!t.nodeId || result[t.nodeId] !== null) continue;
      const memTask = getAsyncTaskResult(t.id);
      const liveStatus =
        memTask?.status === 'completed'
          ? 'succeeded'
          : memTask?.status === 'failed'
          ? 'failed'
          : memTask?.status === 'processing'
          ? 'processing'
          : t.status;

      result[t.nodeId] = {
        taskId: t.id,
        nodeId: t.nodeId,
        category: 'video',
        taskType: t.taskType,
        status: liveStatus,
        result: (memTask?.status === 'completed' ? memTask.result : t.result) as Record<string, any> | null,
        error: memTask?.error ?? t.error,
        updatedAt: t.updatedAt,
      };
    }

    for (const t of imageTasks) {
      if (!t.nodeId || result[t.nodeId] !== null) continue;
      result[t.nodeId] = {
        taskId: t.id,
        nodeId: t.nodeId,
        category: 'image',
        taskType: t.type,
        status: t.status === 'succeeded' ? 'succeeded' : t.status,
        result: t.imageUrl
          ? { imageUrl: t.imageUrl, thumbnailUrl: t.thumbnailUrl, textResponse: t.textResponse }
          : null,
        error: t.error,
        updatedAt: t.updatedAt,
      };
    }

    return result;
  }

  /**
   * On startup: mark VideoTask rows stuck in processing for too long as failed.
   * Also marks stuck ImageTask rows.
   */
  private async reconcileStuckVideoTasks(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_TASK_TIMEOUT_MS);
    try {
      const { count: vCount } = await this.prisma.videoTask.updateMany({
        where: { status: { in: ['queued', 'processing'] }, updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      const { count: iCount } = await this.prisma.imageTask.updateMany({
        where: { status: { in: ['queued', 'processing'] }, updatedAt: { lt: cutoff } },
        data: { status: 'failed', error: 'task orphaned after backend restart' },
      });
      if (vCount + iCount > 0) {
        this.logger.warn(`Reconciled ${vCount} orphaned video tasks and ${iCount} orphaned image tasks`);
      }
    } catch (err) {
      this.logger.error('Failed to reconcile stuck tasks on startup', err);
    }
  }
}
```

- [ ] **Step 2: 验证文件语法**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "generation-task"
```

期望：无报错（或只有与其他文件相关的错误，没有 generation-task.service.ts 的报错）。

---

## Task 3: 更新 DTOs — 加 nodeId 字段

**Files:**
- Modify: `backend/src/ai/dto/image-generation.dto.ts`
- Modify: `backend/src/ai/dto/video-generation.dto.ts`

- [ ] **Step 1: 在 GenerateImageDto 末尾加 nodeId**

在 `GenerateImageDto` 类的最后一个字段（`billingTitleSource`）之后、闭合括号之前加：

```typescript
  @IsOptional()
  @IsString()
  nodeId?: string;
```

对 `EditImageDto` 和 `BlendImagesDto` 做同样处理（各自的 `billingTitleSource` 字段之后）。

对 `Convert2Dto3DDto` 的 `projectId` 字段之后加：

```typescript
  @IsOptional()
  @IsString()
  nodeId?: string;
```

- [ ] **Step 2: 在 GenerateVideoDto 末尾加 nodeId**

在 `GenerateVideoDto` 类的 `characterTaskId` 字段之后加：

```typescript
  @ApiProperty({ description: '画布节点 ID，用于页面刷新后恢复任务状态', required: false })
  @IsOptional()
  @IsString()
  nodeId?: string;
```

- [ ] **Step 3: 验证**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit 2>&1 | grep -E "dto" | head -10
```

期望：无与 DTO 文件相关的类型错误。

---

## Task 4: 更新 ImageTaskService — 透传 nodeId

**Files:**
- Modify: `backend/src/ai/services/image-task.service.ts`

- [ ] **Step 1: 修改 createTask 签名，加 nodeId 参数**

定位 `async createTask(` 方法（line 433），修改签名和 `prisma.imageTask.create` 调用：

```typescript
async createTask(
  userId: string,
  type: ImageTaskType,
  prompt: string,
  requestData: Record<string, any>,
  aiProvider?: string,
  traceContext?: PersistedTraceContext,
  nodeId?: string,          // ← 新增
) {
  // ... 现有的 persistedTraceContext 逻辑不变 ...

  const task = await this.prisma.imageTask.create({
    data: {
      userId,
      type,
      prompt,
      requestData: requestPayload,
      aiProvider,
      status: 'queued',
      retryCount: 0,
      nodeId: nodeId ?? null,   // ← 新增
    },
  });
  // ... 以下不变 ...
```

注意：`nodeId` 是最后一个可选参数，不影响现有调用方。

- [ ] **Step 2: 验证**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit 2>&1 | grep "image-task" | head -10
```

期望：无与 image-task.service.ts 相关的类型错误。

---

## Task 5: 注册 GenerationTaskService 到 AiModule

**Files:**
- Modify: `backend/src/ai/ai.module.ts`

- [ ] **Step 1: 在 ai.module.ts 中 import 并注册**

在 `ai.module.ts` 顶部 import 区加：

```typescript
import { GenerationTaskService } from './services/generation-task.service';
```

在 `providers` 数组中，在 `ImageTaskService` 之后加：

```typescript
GenerationTaskService,
```

在 `exports` 数组中加（供未来其他模块使用）：

```typescript
GenerationTaskService,
```

- [ ] **Step 2: 验证**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit 2>&1 | grep "ai.module" | head -5
```

期望：无报错。

---

## Task 6: 更新 Controller — 视频任务接入 GenerationTaskService

**Files:**
- Modify: `backend/src/ai/ai.controller.ts`

controller 共 6930 行，改动集中在：注入服务、`generateVideoAsync`、`convertSeed3DAsync`、`querySora2VideoTask`、`querySeed3DAsyncTask`、新增批量接口。

- [ ] **Step 1: 在 controller 顶部 import GenerationTaskService**

在现有 import 区（`async-video-task.store` 同行附近）加：

```typescript
import { GenerationTaskService } from './services/generation-task.service';
```

- [ ] **Step 2: 在 constructor 注入 GenerationTaskService**

找到 constructor 中 `@Optional() private readonly imageTaskService?: ImageTaskService` 这行，在其后加：

```typescript
@Optional() private readonly generationTaskService?: GenerationTaskService,
```

- [ ] **Step 3: 更新 generateVideoAsync（约 line 4493）**

将 `createAsyncTask(taskId)` 那块替换为通过 service 创建：

```typescript
// 原来:
const taskId = `async-sora2-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
createAsyncTask(taskId);

// 替换为:
const taskId = `async-sora2-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
if (this.generationTaskService) {
  await this.generationTaskService.createVideoTask({
    taskId,
    userId: this.getUserId(req),
    nodeId: dto.nodeId,
    taskType: selectedSoraModel,
    prompt: dto.prompt,
    metadata: { quality, aspectRatio: dto.aspectRatio, duration: dto.duration },
  });
} else {
  createAsyncTask(taskId);
}
```

- [ ] **Step 4: 更新 processVideoGenerationTask 中的 updateAsyncTask 调用**

在 `processVideoGenerationTask` 内（约 line 4636 开始），找到所有直接调用 `updateAsyncTask(taskId, ...)` 的地方，在其后加 DB 同步：

```typescript
// 将原来:
updateAsyncTask(taskId, { status: 'processing' });

// 改为:
updateAsyncTask(taskId, { status: 'processing' });
void this.generationTaskService?.updateVideoTask(taskId, { status: 'processing' });
```

同理对 `completed` 和 `failed` 状态的 `updateAsyncTask` 调用，在后面各自添加：

```typescript
// completed（约 line 4728）:
void this.generationTaskService?.updateVideoTask(taskId, {
  status: 'succeeded',
  result: { videoUrl: ..., thumbnailUrl: ..., videoUrlRaw: ... },
  completedAt: new Date(),
});

// failed（约 line 4753）:
void this.generationTaskService?.updateVideoTask(taskId, {
  status: 'failed',
  error: errorMessage,
  completedAt: new Date(),
});
```

具体 result 字段从 `updateAsyncTask` 的同一 `update` 对象里取。

- [ ] **Step 5: 更新 convertSeed3DAsync（约 line 4136）**

```typescript
// 原来:
const taskId = `async-seed3d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
createAsyncTask(taskId);
this.executeSeed3DTaskAsync(taskId, dto, req);

// 替换为:
const taskId = `async-seed3d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
if (this.generationTaskService) {
  await this.generationTaskService.createVideoTask({
    taskId,
    userId: this.getUserId(req),
    nodeId: dto.nodeId,
    taskType: 'seed3d',
    prompt: dto.prompt,
  });
} else {
  createAsyncTask(taskId);
}
this.executeSeed3DTaskAsync(taskId, dto, req);
```

对 `processSeed3DTaskAsync` 中的 `updateAsyncTask` 调用同样加 DB 同步（模式与 Step 4 相同）。

- [ ] **Step 6: 更新 querySora2VideoTask — DB 兜底**

在约 line 4816 `const asyncTask = getAsyncTaskResult(trimmedTaskId);` 之后，当 `asyncTask` 为 null 时增加 DB 查询：

```typescript
const asyncTask = getAsyncTaskResult(trimmedTaskId);
if (!asyncTask) {
  // Memory miss — fall back to DB
  const dbTask = await this.generationTaskService?.findVideoTaskById(trimmedTaskId);
  if (!dbTask) {
    return this.normalizeVideoTaskResponse({ id: trimmedTaskId, status: 'failed', error: '任务不存在或已过期' });
  }
  return this.normalizeVideoTaskResponse({
    id: trimmedTaskId,
    status: dbTask.status,
    videoUrl: (dbTask.result as any)?.videoUrl,
    thumbnailUrl: (dbTask.result as any)?.thumbnailUrl,
    raw: dbTask.result as any,
    error: dbTask.error ?? undefined,
  });
}
```

同时在 `GenerationTaskService` 中加一个 `findVideoTaskById` 方法（在 Task 2 的文件中追加）：

```typescript
async findVideoTaskById(taskId: string) {
  return this.prisma.videoTask.findUnique({ where: { id: taskId } });
}
```

- [ ] **Step 7: 新增 POST /ai/tasks/by-nodes 批量接口**

在 `getImageTaskStatus` 方法（约 line 6840）之前加：

```typescript
@Post('tasks/by-nodes')
async batchQueryTasksByNodes(
  @Body() body: { nodeIds: string[] },
  @Req() req: any,
) {
  if (!this.generationTaskService) {
    throw new ServiceUnavailableException('任务服务未启用');
  }
  const nodeIds: string[] = Array.isArray(body?.nodeIds) ? body.nodeIds : [];
  if (nodeIds.length === 0) return {};
  const userId = this.getUserId(req);
  return this.generationTaskService.batchQueryByNodeIds(nodeIds, userId);
}
```

- [ ] **Step 8: 更新 image task 接口透传 nodeId**

在 `generateImageAsync`（约 line 6748）的 `createTask` 调用中加 `nodeId`：

```typescript
const task = await this.imageTaskService.createTask(
  userId,
  'generate',
  dto.prompt,
  { ...dto, model },
  providerName || 'gemini',
  { traceId, parentRequestId },
  dto.nodeId,              // ← 新增最后一个参数
);
```

对 `editImageAsync`（line 6784）和 `blendImagesAsync`（line 6822）做同样处理。

- [ ] **Step 9: 全量类型检查**

```bash
cd /Users/libiqiang/business/Tanva/backend
npx tsc --noEmit 2>&1 | head -30
```

期望：0 个类型错误，或只有与本次修改无关的已有错误。

---

## Task 7: 执行 migration 并端到端验证

- [ ] **Step 1: 在数据库执行 migration SQL**

确认 Docker 数据库运行中：

```bash
cd /Users/libiqiang/business/Tanva/backend
docker-compose ps | grep postgres
```

执行 migration：

```bash
docker-compose exec postgres psql -U postgres -d tanva -f /dev/stdin < prisma/migrations/202605200001_add_video_task_and_node_id/migration.sql
```

或者通过 patch 机制（如果项目使用 new-api patches 目录统一管理）：复制到对应日期目录下。

- [ ] **Step 2: 验证表结构**

```bash
docker-compose exec postgres psql -U postgres -d tanva -c "\d \"VideoTask\""
docker-compose exec postgres psql -U postgres -d tanva -c "\d \"ImageTask\"" | grep nodeId
```

期望输出：`VideoTask` 有 id/userId/nodeId/status 等字段；`ImageTask` 有 `nodeId text` 列。

- [ ] **Step 3: 启动后端，验证无启动错误**

```bash
cd /Users/libiqiang/business/Tanva/backend
npm run start:dev 2>&1 | head -30
```

期望：`Reconciled 0 orphaned video tasks` 日志（或无孤儿任务日志），无 crash。

- [ ] **Step 4: 端到端冒烟测试 — 提交任务**

```bash
# 提交视频任务（需要有效 Bearer token）
curl -X POST http://localhost:3000/ai/generate-video-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"prompt":"test video","nodeId":"test-node-001","quality":"sd"}'
```

期望：返回 `{ taskId: "async-sora2-...", status: "pending" }`。

- [ ] **Step 5: 端到端冒烟测试 — 批量查询**

```bash
curl -X POST http://localhost:3000/ai/tasks/by-nodes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"nodeIds":["test-node-001"]}'
```

期望：返回 `{ "test-node-001": { taskId: "async-sora2-...", status: "queued", category: "video", ... } }`。

- [ ] **Step 6: 提交**

```bash
cd /Users/libiqiang/business/Tanva/backend
git add prisma/schema.prisma \
  prisma/migrations/202605200001_add_video_task_and_node_id/ \
  src/ai/services/generation-task.service.ts \
  src/ai/services/image-task.service.ts \
  src/ai/dto/image-generation.dto.ts \
  src/ai/dto/video-generation.dto.ts \
  src/ai/ai.module.ts \
  src/ai/ai.controller.ts
git commit -m "feat: persist generation tasks to DB with nodeId for canvas recovery

- Add VideoTask Prisma model (video/3D tasks were memory-only)
- Add nodeId field to ImageTask for canvas node association
- Add GenerationTaskService with batchQueryByNodeIds and startup reconciliation
- New POST /ai/tasks/by-nodes endpoint for frontend canvas recovery
- Thread nodeId through all async task creation DTOs and handlers"
```

---

## 设计约束备忘

- `batchQueryByNodeIds` 最多接受 50 个 nodeId，超出部分静默截断。
- video task 状态值：`queued / processing / succeeded / failed`（与 ImageTask 对齐）；内存 store 保持原来的 `pending / processing / completed / failed`，在 service 层做映射。
- character_task（APIMart 代理）本期不纳入持久化，因为后端不控制其生命周期；前端对该类型任务继续走轮询 new-api 的现有逻辑。
- `updatedAt` 由 PostgreSQL trigger 自动维护，无需 Prisma `@updatedAt` 指令（已在 migration SQL 中创建 trigger）。
