# 旧画布过期拦截保存 + 强制刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当画布本地版本号落后于服务器最新版本时，非协作场景（含个人多 tab）阻止写回、强制刷新，从根上避免旧画布覆盖新内容。

**Architecture:** 判据唯一 = 版本号（本地 `version < 服务器 contentVersion` 即过期）。三层：① 后端护栏——落后且非协作（`allowMerge=false`）时不写入、返回 `{ stale:true }`（串行锁内，无竞态）；② 同浏览器跨 tab 广播——`BroadcastChannel` 让落后 tab 即时冻结；③ 前端 `staleContent` kill-switch + 全屏强制刷新弹窗。活跃实时协作（`collabCanvasBridge.connected`）落后仍走现有并集合并，逐字不动。

**Tech Stack:** NestJS + Prisma（后端）、React + Zustand + Vite（前端）、`BroadcastChannel`、Tailwind、lucide-react。

**测试说明：** 本仓库后端 `package.json` 无 `test` 脚本、前端无测试运行器，既有代码对 projects 服务与前端 store 均无单测。遵循既有模式，本计划不引入新测试框架；每个任务用 `tsc`/`build` 验证类型与编译，功能验收用**两 tab 手动 E2E**（Task 9）——这才是本特性的权威回归测试。

---

## File Structure

后端：
- `backend/src/projects/dto/update-project-content.dto.ts` — 保存 DTO 增 `allowMerge?: boolean`
- `backend/src/projects/projects.controller.ts` — 透传 `allowMerge`
- `backend/src/projects/projects.service.ts` — `updateContent` 落后分支按 `allowMerge` 分流：拒绝或合并

前端：
- `frontend/src/stores/projectContentStore.ts` — 新增 `staleContent` 状态 + `setStaleContent`
- `frontend/src/services/projectApi.ts` — `saveContent` 发送 `allowMerge`、解析 `stale`
- `frontend/src/services/projectVersionChannel.ts` —（新增）跨 tab 版本广播
- `frontend/src/hooks/useProjectAutosave.ts` — 发送 `allowMerge`、处理 `stale`、gating 补 `!staleContent`、保存成功后广播
- `frontend/src/components/autosave/ManualSaveButton.tsx` — 同上（手动保存路径）
- `frontend/src/components/autosave/ProjectAutosaveManager.tsx` — 加载期落后检测置 `staleContent`；订阅跨 tab 广播
- `frontend/src/components/collab/ProjectContentStaleModal.tsx` —（新增）全屏强制刷新弹窗
- `frontend/src/pages/Canvas.tsx` — 挂载弹窗

---

## Task 1: 后端 DTO 增加 allowMerge

**Files:**
- Modify: `backend/src/projects/dto/update-project-content.dto.ts`

- [ ] **Step 1: 在 UpdateProjectContentDto 增加可选布尔字段**

在 `version?: number;` 之后、`createWorkflowHistory?` 之前插入：

```ts
  @ApiProperty({ required: false, description: '是否允许在版本落后时做并集合并（仅活跃实时协作端为 true）。缺省/ false 时落后保存将被拒绝，避免旧画布覆盖新内容。' })
  @IsOptional()
  @IsBoolean()
  allowMerge?: boolean;
```

（`IsBoolean` 已在文件顶部 import，无需改 import。）

- [ ] **Step 2: 编译验证**

Run: `cd backend && npx tsc -p tsconfig.build.json --noEmit`
Expected: 无与本文件相关的类型错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/projects/dto/update-project-content.dto.ts
git commit -m "feat(save): DTO 增加 allowMerge，为落后保存拒绝/合并分流做准备"
```

---

## Task 2: 后端 controller 透传 allowMerge

**Files:**
- Modify: `backend/src/projects/projects.controller.ts:62-66`

- [ ] **Step 1: 把 dto.allowMerge 传入 updateContent 的 options**

把 `@Put(':id/content')` 里的调用改为：

```ts
      return await this.projects.updateContent(req.user.sub, id, dto.content, dto.version, {
        createWorkflowHistory: dto.createWorkflowHistory,
        workflowHistoryMeta: dto.workflowHistoryMeta,
        allowMerge: dto.allowMerge,
      }, req.user.role);
```

- [ ] **Step 2: 编译验证**

Run: `cd backend && npx tsc -p tsconfig.build.json --noEmit`
Expected: 报错 `updateContent` 的 options 类型不含 `allowMerge`（下一任务补上）。此报错预期存在，Task 3 修复后消失。

- [ ] **Step 3: Commit**

```bash
git add backend/src/projects/projects.controller.ts
git commit -m "feat(save): controller 透传 allowMerge 到 updateContent"
```

---

## Task 3: 后端 service 落后分支按 allowMerge 分流（核心止血）

**Files:**
- Modify: `backend/src/projects/projects.service.ts`（`updateContent` 的 options 类型 ~316-323，落后合并分支 ~386-407）

- [ ] **Step 1: 给 updateContent 的 options 类型加 allowMerge**

把 `updateContent` 签名里的 options 类型：

```ts
    options?: {
      createWorkflowHistory?: boolean;
      workflowHistoryMeta?: {
        restoredFromUpdatedAt?: string;
        restoredFromVersion?: number;
      };
    },
```

改为（新增 `allowMerge?`）：

```ts
    options?: {
      createWorkflowHistory?: boolean;
      workflowHistoryMeta?: {
        restoredFromUpdatedAt?: string;
        restoredFromVersion?: number;
      };
      allowMerge?: boolean;
    },
```

- [ ] **Step 2: 在落后分支入口按 allowMerge 分流**

定位落后判断（当前为）：

```ts
      const currentContentVersion = project.contentVersion ?? 0;
      let mergedFromConflict = false;
      if (typeof version === 'number' && version > 0 && version < currentContentVersion) {
```

在 `if (...) {` 之后、`let remoteContent` 之前插入拒绝逻辑：

```ts
        // 版本落后且非活跃实时协作（前端只在 collab 长连接时传 allowMerge=true）：
        // 直接拒绝、不写入，返回 stale 让前端冻结并强制刷新。串行锁内执行，无竞态，
        // 落后写入永远落不了地——这是「旧画布覆盖新内容」的根治点。
        // 缺省/false 一律按非协作拒绝（旧缓存 JS 不带该字段会被强制刷新加载新版本，自愈）。
        if (options?.allowMerge !== true) {
          // eslint-disable-next-line no-console
          console.warn('[ProjectSaveStale]', JSON.stringify({
            projectId: id,
            userId,
            baseVersion: version,
            currentVersion: currentContentVersion,
          }));
          return {
            stale: true as const,
            version: currentContentVersion,
            latestVersion: currentContentVersion,
            updatedAt: project.updatedAt,
            mainUrl: project.mainKey ? this.oss.publicUrl(project.mainKey) : undefined,
            thumbnailUrl: this.extractThumbnail(project) || undefined,
          };
        }
```

其后原有的 `let remoteContent ... mergeProjectSnapshots ...` 合并逻辑保持不变——只有 `allowMerge===true`（协作）才会走到。

- [ ] **Step 3: 编译验证**

Run: `cd backend && npx tsc -p tsconfig.build.json --noEmit`
Expected: 无类型错误（Task 2 的报错此时消失）。

- [ ] **Step 4: 全量构建验证**

Run: `cd backend && npm run build`
Expected: 构建成功，`dist/` 生成。

- [ ] **Step 5: Commit**

```bash
git add backend/src/projects/projects.service.ts
git commit -m "feat(save): 落后且非协作(allowMerge!=true)的保存直接拒绝并返回 stale，止血旧画布覆盖"
```

---

## Task 4: 前端 store 增加 staleContent kill-switch

**Files:**
- Modify: `frontend/src/stores/projectContentStore.ts`

- [ ] **Step 1: 类型里增加字段与 setter**

在 `type ProjectContentState` 中，`cacheValidationPending: boolean;` 之后加：

```ts
  staleContent: boolean;
```

在 setter 区，`setCacheValidationPending: (pending: boolean) => void;` 之后加：

```ts
  setStaleContent: (stale: boolean) => void;
```

- [ ] **Step 2: 初始状态里增加 staleContent**

在 `createInitialState()` 的返回对象里，`cacheValidationPending: false,` 之后加：

```ts
  staleContent: false,
```

并把 `createInitialState` 的 `Omit<ProjectContentState, ...>` 联合字符串里追加 `| 'setStaleContent'`（与其它 setter 并列），保持类型一致。

- [ ] **Step 3: 实现 setStaleContent，并让 hydrate 清除 staleContent**

在 `setCacheValidationPending: (cacheValidationPending) => set({ cacheValidationPending }),` 之后加：

```ts
  setStaleContent: (staleContent) => set({ staleContent }),
```

在 `hydrate` 的 `set((state) => ({ ...` 返回对象里（与 `lastError: null,` 并列）加一行，确保重新加载最新内容后复位：

```ts
      staleContent: false,
```

- [ ] **Step 4: 编译验证**

Run: `cd frontend && npx tsc -b`
Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/projectContentStore.ts
git commit -m "feat(save): store 增加 staleContent kill-switch（hydrate 时复位）"
```

---

## Task 5: 前端 projectApi.saveContent 发送 allowMerge、解析 stale

**Files:**
- Modify: `frontend/src/services/projectApi.ts`（`saveContent` ~171-225）

- [ ] **Step 1: payload 增加 allowMerge，返回类型增加 stale/latestVersion**

把 `saveContent` 的 `payload` 类型加一个可选字段（在 `version?: number;` 后）：

```ts
      allowMerge?: boolean;
```

把返回 Promise 的类型追加两个可选字段（与 `merged?`、`content?` 并列）：

```ts
    /** 服务端判定本地 baseVersion 落后且非协作，拒绝写入。此时前端应冻结并强制刷新。 */
    stale?: boolean;
    latestVersion?: number;
```

- [ ] **Step 2: 请求体带上 allowMerge**

把 `body: JSON.stringify({ ... })` 里的对象补一行：

```ts
        allowMerge: payload.allowMerge,
```

- [ ] **Step 3: 解析响应里的 stale/latestVersion**

把 `const data = await json<{ ... }>(res);` 的泛型与随后的 `return {...}` 都补上 `stale`、`latestVersion`。改成：

```ts
    const data = await json<{
      version: number;
      updatedAt: string | null;
      thumbnailUrl?: string;
      merged?: boolean;
      content?: ProjectContentSnapshot;
      stale?: boolean;
      latestVersion?: number;
    }>(res);
    return {
      version: data.version,
      updatedAt: data.updatedAt,
      thumbnailUrl: data.thumbnailUrl,
      merged: data.merged,
      content: data.content,
      stale: data.stale,
      latestVersion: data.latestVersion,
    };
```

（保留其上已有的 409 legacy 分支不动。）

- [ ] **Step 4: 编译验证**

Run: `cd frontend && npx tsc -b`
Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/projectApi.ts
git commit -m "feat(save): saveContent 发送 allowMerge 并解析 stale/latestVersion"
```

---

## Task 6: 前端跨 tab 版本广播服务

**Files:**
- Create: `frontend/src/services/projectVersionChannel.ts`

- [ ] **Step 1: 写 BroadcastChannel 封装**

```ts
// 同浏览器跨 tab 的项目版本广播：某 tab 保存成功后广播其新版本号，
// 其它落后 tab 据此即时冻结（不必等自己保存被后端拒绝）。
// 仅覆盖同源同浏览器多 tab（本特性主场景）；跨设备/跨浏览器由后端护栏在保存时兜底。
// BroadcastChannel 不可用时静默降级，不影响后端护栏与前端 staleContent 逻辑。

export type ProjectVersionMessage = { projectId: string; version: number };

const CHANNEL_NAME = 'tanva:project-version';
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

export const projectVersionChannel = {
  /** 本 tab 保存成功后调用，广播新版本号给其它 tab。 */
  postSaved(projectId: string, version: number): void {
    const c = getChannel();
    if (!c) return;
    try {
      c.postMessage({ projectId, version } as ProjectVersionMessage);
    } catch {
      // noop
    }
  },
  /** 订阅其它 tab 的保存广播；返回取消订阅函数。 */
  onRemoteSaved(cb: (msg: ProjectVersionMessage) => void): () => void {
    const c = getChannel();
    if (!c) return () => {};
    const handler = (e: MessageEvent) => {
      const data = e.data as ProjectVersionMessage | undefined;
      if (data && typeof data.projectId === 'string' && typeof data.version === 'number') {
        cb(data);
      }
    };
    c.addEventListener('message', handler);
    return () => c.removeEventListener('message', handler);
  },
};
```

- [ ] **Step 2: 编译验证**

Run: `cd frontend && npx tsc -b`
Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/projectVersionChannel.ts
git commit -m "feat(save): 新增跨 tab 版本广播服务 projectVersionChannel"
```

---

## Task 7: 自动保存路径接入（allowMerge / stale / 冻结门 / 广播）

**Files:**
- Modify: `frontend/src/hooks/useProjectAutosave.ts`

- [ ] **Step 1: 顶部 import 依赖**

在文件已有 import 区加入（若已存在则跳过）：

```ts
import { collabCanvasBridge } from '@/collab/collabCanvasBridge';
import { projectVersionChannel } from '@/services/projectVersionChannel';
```

- [ ] **Step 2: performSave 入口拦截 staleContent**

在 `performSave` 开头、`if (useProjectContentStore.getState().cacheValidationPending) {...}` 之前插入：

```ts
    if (useProjectContentStore.getState().staleContent) {
      return;
    }
```

- [ ] **Step 3: 保存请求带 allowMerge，并在 markSaved 前拦截 stale**

把：

```ts
      setSaving(true);
      const result = await projectApi.saveContent(currentProjectId, {
        content: contentForCloudSave,
        version: versionToSave,
      });

      markSaved(result.version, result.updatedAt ?? new Date().toISOString(), counterToSave);
```

改为：

```ts
      setSaving(true);
      const result = await projectApi.saveContent(currentProjectId, {
        content: contentForCloudSave,
        version: versionToSave,
        allowMerge: collabCanvasBridge.connected,
      });

      // 服务端判定本地版本落后且非协作 → 拒绝写入。冻结自动/手动保存并强制刷新，
      // 绝不 markSaved（那会把本地旧内容的版本对齐成最新，误以为已保存）。
      if (result.stale) {
        useProjectContentStore.getState().setStaleContent(true);
        saveMonitor.push(currentProjectId, 'save_stale_blocked', {
          baseVersion: versionToSave,
          latestVersion: result.latestVersion,
          attempt,
        });
        return;
      }

      markSaved(result.version, result.updatedAt ?? new Date().toISOString(), counterToSave);
      // 保存成功：广播新版本，让同浏览器其它落后 tab 即时冻结。
      projectVersionChannel.postSaved(currentProjectId, result.version);
```

- [ ] **Step 4: 三处 re-entrant gating 补 !staleContent**

文件内有三处形如
`store.projectId === ... && store.dirty && !store.saving && !store.cacheValidationPending && store.content`
的判断（min-interval 定时器回调、retry 定时器回调、interval sweep）。给这三处各追加 `&& !store.staleContent`。例如：

```ts
        if (store.projectId === currentProjectId && store.dirty && !store.saving && !store.cacheValidationPending && !store.staleContent && store.content) {
```

interval sweep 处（`store.projectId === projectId && ...`）同样追加 `&& !store.staleContent`。

- [ ] **Step 5: debounce effect 增加 staleContent 依赖与短路**

把 debounce 的 `useEffect`：

```ts
  useEffect(() => {
    if (!projectId || !dirty || !content || cacheValidationPending) return undefined;
```

改为（从 store 读取 staleContent 并短路）：

```ts
  useEffect(() => {
    if (!projectId || !dirty || !content || cacheValidationPending) return undefined;
    if (useProjectContentStore.getState().staleContent) return undefined;
```

并在其内部 `setTimeout` 回调的 gating 追加 `&& !store.staleContent`（同 Step 4）。

- [ ] **Step 6: 编译验证**

Run: `cd frontend && npx tsc -b`
Expected: 无类型错误。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useProjectAutosave.ts
git commit -m "feat(save): 自动保存带 allowMerge、处理 stale 冻结、补 !staleContent 门与保存成功广播"
```

---

## Task 8: 手动保存路径接入（allowMerge / stale / 广播）

**Files:**
- Modify: `frontend/src/components/autosave/ManualSaveButton.tsx`

- [ ] **Step 1: 顶部 import 依赖**

```ts
import { collabCanvasBridge } from '@/collab/collabCanvasBridge';
import { projectVersionChannel } from '@/services/projectVersionChannel';
```

- [ ] **Step 2: handleSave 入口拦截 staleContent**

在 `handleSave` 开头 `if (!storeBefore.projectId || storeBefore.saving || storeBefore.manualSaving) { return; }` 之后插入：

```ts
    if (storeBefore.staleContent) {
      return;
    }
```

- [ ] **Step 3: 请求带 allowMerge，markSaved 前拦截 stale，成功后广播**

把：

```ts
      const result = await projectApi.saveContent(currentProjectId, { content: contentForCloudSave, version, createWorkflowHistory: true });

      markSaved(result.version, result.updatedAt ?? new Date().toISOString(), counterAtSave);
```

改为：

```ts
      const result = await projectApi.saveContent(currentProjectId, { content: contentForCloudSave, version, createWorkflowHistory: true, allowMerge: collabCanvasBridge.connected });

      if (result.stale) {
        useProjectContentStore.getState().setStaleContent(true);
        try { saveMonitor.push(currentProjectId, 'manual_save_stale_blocked', { baseVersion: version, latestVersion: result.latestVersion }); } catch {}
        return;
      }

      markSaved(result.version, result.updatedAt ?? new Date().toISOString(), counterAtSave);
      projectVersionChannel.postSaved(currentProjectId, result.version);
```

- [ ] **Step 4: 按钮 disabled 也纳入 staleContent**

在组件顶部已有 `const cacheValidationPending = useProjectContentStore((state) => state.cacheValidationPending);` 之后加：

```ts
  const staleContent = useProjectContentStore((state) => state.staleContent);
```

把按钮的 `disabled={!projectId || manualSaving || cacheValidationPending}` 改为：

```ts
      disabled={!projectId || manualSaving || cacheValidationPending || staleContent}
```

- [ ] **Step 5: 编译验证**

Run: `cd frontend && npx tsc -b`
Expected: 无类型错误。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/autosave/ManualSaveButton.tsx
git commit -m "feat(save): 手动保存带 allowMerge、处理 stale 冻结、成功后广播，按钮 stale 禁用"
```

---

## Task 9: 加载期落后检测置 staleContent + 订阅跨 tab 广播

**Files:**
- Modify: `frontend/src/components/autosave/ProjectAutosaveManager.tsx`（加载期检测 ~458-475；新增订阅 effect）

- [ ] **Step 1: 顶部 import（若缺）**

确认已 import（文件已用 `collabCanvasBridge`，通常已在）：

```ts
import { collabCanvasBridge } from '@/collab/collabCanvasBridge';
import { projectVersionChannel } from '@/services/projectVersionChannel';
```

`useProjectContentStore` 已在文件中使用，无需新增。

- [ ] **Step 2: 加载期「远端更新+本地已改」分支同时置 staleContent**

把该分支：

```ts
          if (hasLocalChangesAfterCache && data.version > cached.version) {
            setWarning('远端项目已有更新，且你已基于本地缓存做了修改；为避免覆盖远端版本，自动保存已暂停。请重新打开项目加载最新版本后再修改。');
            setCacheValidationPending(true);
```

改为（追加一行，触发强制刷新弹窗；保留原有 warning/cacheValidationPending 作双保险）：

```ts
          if (hasLocalChangesAfterCache && data.version > cached.version) {
            setWarning('远端项目已有更新，且你已基于本地缓存做了修改；为避免覆盖远端版本，自动保存已暂停。请重新打开项目加载最新版本后再修改。');
            setCacheValidationPending(true);
            useProjectContentStore.getState().setStaleContent(true);
```

- [ ] **Step 3: 新增跨 tab 广播订阅 effect**

在 `useProjectAutosave(projectId);` 之前插入一个 effect：

```ts
  // 同浏览器另一个 tab 保存推进版本后，落后的本 tab 即时冻结并强制刷新。
  // 活跃实时协作（长连接）下运行时由 patch 收敛、不算落后，跳过。
  useEffect(() => {
    if (!projectId) return undefined;
    return projectVersionChannel.onRemoteSaved(({ projectId: pid, version }) => {
      if (collabCanvasBridge.connected) return;
      const store = useProjectContentStore.getState();
      if (store.projectId === pid && version > store.version) {
        store.setStaleContent(true);
      }
    });
  }, [projectId]);
```

- [ ] **Step 4: 编译验证**

Run: `cd frontend && npx tsc -b`
Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/autosave/ProjectAutosaveManager.tsx
git commit -m "feat(save): 加载期落后置 staleContent + 订阅跨 tab 广播即时冻结"
```

---

## Task 10: 全屏强制刷新弹窗组件 + 挂载

**Files:**
- Create: `frontend/src/components/collab/ProjectContentStaleModal.tsx`
- Modify: `frontend/src/pages/Canvas.tsx`（import + 挂载，参照 `CurrentProjectDeletedModal`）

- [ ] **Step 1: 写弹窗组件（截图风格：暗色卡片 + 橙色警告 + 蓝色按钮，唯一出口刷新）**

```tsx
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle } from 'lucide-react';
import { useProjectContentStore } from '@/stores/projectContentStore';

/**
 * 「项目内容已过期」强制刷新弹窗。
 * 触发：本地版本号落后于服务器最新版本（个人多 tab / 旧标签页），store.staleContent=true。
 * 交互：全屏毛玻璃蒙层阻断，唯一出口是「刷新页面」——刷新即重建 store、加载最新内容。
 * 不做关闭 / 遮罩点击关闭 / ESC，避免用户继续在过期画布上编辑造成覆盖。
 */
const ProjectContentStaleModal: React.FC = () => {
  const staleContent = useProjectContentStore((state) => state.staleContent);
  if (!staleContent) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="w-[380px] rounded-2xl bg-[#1f2329] shadow-[0_20px_60px_rgba(0,0,0,0.5)] px-8 py-9 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full border-[3px] border-amber-500 flex items-center justify-center mb-5">
          <AlertCircle className="w-9 h-9 text-amber-500" strokeWidth={2.2} />
        </div>
        <h3 className="text-xl font-semibold text-white mb-4">项目内容已过期</h3>
        <p className="text-sm text-slate-400 leading-7">此项目已在其他标签页打开</p>
        <p className="text-sm text-slate-400 leading-7 mb-7">请刷新页面以继续编辑</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full h-11 rounded-lg bg-blue-600 text-white text-base font-medium hover:bg-blue-700 transition-colors"
        >
          刷新页面
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default ProjectContentStaleModal;
```

- [ ] **Step 2: 在 Canvas.tsx 挂载**

在 `frontend/src/pages/Canvas.tsx` 顶部 import 区、`CurrentProjectDeletedModal` 那行之后加：

```tsx
import ProjectContentStaleModal from '@/components/collab/ProjectContentStaleModal';
```

在 JSX 里 `<CurrentProjectDeletedModal />`（约 165 行）之后加：

```tsx
            <ProjectContentStaleModal />
```

- [ ] **Step 3: 编译 + 构建验证**

Run: `cd frontend && npx tsc -b && npm run build`
Expected: 类型检查与 vite 构建均成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/collab/ProjectContentStaleModal.tsx frontend/src/pages/Canvas.tsx
git commit -m "feat(save): 新增项目内容过期强制刷新弹窗并挂载到画布页"
```

---

## Task 11: 两 tab 手动 E2E 验收（权威回归）

**Files:** 无（手动验证）

- [ ] **Step 1: 起后端 + 前端**

Run: `cd backend && npm run build && npm run start`（另开终端）`cd frontend && npm run dev`
Expected: 前后端正常起。

- [ ] **Step 2: 个人多 tab 覆盖场景**

1. 同一浏览器登录，开同一项目于 tab A、tab B。
2. 在 tab A 改动并保存（手动或等自动保存），版本推进（后端日志 `[ProjectSave] version:N+1`）。
3. **预期**：tab B **立即**弹「项目内容已过期 / 此项目已在其他标签页打开 / 请刷新页面以继续编辑」，自动保存与「保存」按钮均冻结（Layer 3 广播）。
4. 即使 tab B 未收到广播、强行触发保存：后端日志出现 `[ProjectSaveStale]`，**不出现** tab B 内容覆盖（Layer 1）；tab B 弹同一弹窗。
5. tab B 点「刷新页面」→ 重新加载最新内容，弹窗消失，恢复正常编辑。

- [ ] **Step 3: 协作不回归（若有团队协作环境）**

两端进入同一项目的实时协作（`collabCanvasBridge.connected`）。并发编辑与保存：**预期**仍走并集合并（后端日志 `merged:true`），不弹过期弹窗、不冻结。

- [ ] **Step 4: 确认无回归**

单 tab 正常编辑保存、切换项目、加载缓存项目，均无误弹弹窗、无冻结。

- [ ] **Step 5: 收尾 commit（如有微调）**

```bash
git add -A && git commit -m "test(save): 两 tab E2E 验收旧画布过期拦截与协作不回归"
```

---

## Self-Review 结论

- **Spec 覆盖**：目标 1（不写回）→ Task 3；目标 2（冻结+弹窗）→ Task 4/7/8/10；目标 3（多 tab 即时冻结）→ Task 6/9；目标 4（不破坏协作）→ Task 3 仅改非协作分支 + Task 9 订阅处 `connected` 跳过。加载期检测 → Task 9 Step 2。
- **命名一致**：`allowMerge`、`staleContent`、`setStaleContent`、`projectVersionChannel.postSaved/onRemoteSaved`、`stale`/`latestVersion` 全程一致。
- **无占位符**：每个改动都给出完整代码与确切位置。
