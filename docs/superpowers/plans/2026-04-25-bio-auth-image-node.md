# 真人素材生物认证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `ImageNode` 上追加独立的「生物认证」Badge 与三步向导 Modal，让用户通过摄像头活体检测完成本人授权，认证状态独立于现有 volcAsset 审核流程，有效期 30 天。

**Architecture:** 新增 `bioAuthAPI.ts`（后端代理调用）、`useBioAuthPolling.ts`（轮询 hook）、`BioAuthModal.tsx`（三步向导 + 摄像头管理），最后修改 `ImageNode.tsx` 集成 Badge 和轮询。整体模式完全复用现有 volcAsset 审核的实现惯例。

**Tech Stack:** React 18, TypeScript, lucide-react, reactflow, `window.dispatchEvent("flow:updateNodeData")` 模式

**Spec:** `docs/superpowers/specs/2026-04-25-bio-auth-image-node-design.md`

---

## File Map

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/services/bioAuthAPI.ts` | 封装两个后端 API 调用：启动认证、查询状态 |
| 新建 | `src/hooks/useBioAuthPolling.ts` | 轮询 bioAuth 任务状态至 terminal |
| 新建 | `src/components/flow/nodes/BioAuthModal.tsx` | 三步向导 Modal + 摄像头 stream 管理 |
| 修改 | `src/components/flow/nodes/ImageNode.tsx` | 读取 bioAuth 字段、Badge、轮询集成、图片替换时清空 |

---

## Task 1: bioAuthAPI.ts

**Files:**
- Create: `frontend/src/services/bioAuthAPI.ts`

- [ ] **Step 1: 创建服务文件**

```typescript
// frontend/src/services/bioAuthAPI.ts
import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type BioAuthStatus = "processing" | "active" | "failed";

export interface StartBioAuthResult {
  taskId: string;
}

export interface BioAuthStatusResult {
  status: BioAuthStatus;
  errorMessage?: string;
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
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep bioAuthAPI
```

期望：无报错输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/bioAuthAPI.ts
git commit -m "feat: add bioAuthAPI service (startBioAuth + getBioAuthStatus)"
```

---

## Task 2: useBioAuthPolling.ts

**Files:**
- Create: `frontend/src/hooks/useBioAuthPolling.ts`
- Reference: `frontend/src/hooks/useVolcAssetPolling.ts`（完全对齐的模式）

- [ ] **Step 1: 创建轮询 hook**

```typescript
// frontend/src/hooks/useBioAuthPolling.ts
import React from "react";
import { getBioAuthStatus, type BioAuthStatus } from "../services/bioAuthAPI";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export interface BioAuthPollingOptions {
  taskId?: string;
  status?: BioAuthStatus;
  onUpdate: (next: { status: BioAuthStatus; errorMessage?: string }) => void;
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
          onUpdateRef.current({ status: result.status, errorMessage: result.errorMessage });
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

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep useBioAuthPolling
```

期望：无报错输出。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useBioAuthPolling.ts
git commit -m "feat: add useBioAuthPolling hook"
```

---

## Task 3: BioAuthModal.tsx

**Files:**
- Create: `frontend/src/components/flow/nodes/BioAuthModal.tsx`

三步向导状态：`'consent'`（授权说明）→ `'detecting'`（摄像头活体检测）→ `'result'`（结果反馈）

- [ ] **Step 1: 创建 Modal 文件（骨架 + 类型定义）**

```typescript
// frontend/src/components/flow/nodes/BioAuthModal.tsx
import React from "react";
import { X, UserRound, Camera, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { startBioAuth } from "@/services/bioAuthAPI";
import { useBioAuthPolling } from "@/hooks/useBioAuthPolling";
import type { BioAuthStatus } from "@/services/bioAuthAPI";

export interface BioAuthModalProps {
  isOpen: boolean;
  imageUrl: string;
  onClose: () => void;
  onSuccess: (taskId: string) => void;
  onFail: (errorMessage?: string) => void;
}

type WizardStep = "consent" | "detecting" | "result";
```

- [ ] **Step 2: 实现 Modal 主体**

在同一文件中接着写：

```typescript
export function BioAuthModal({ isOpen, imageUrl, onClose, onSuccess, onFail }: BioAuthModalProps) {
  const [step, setStep] = React.useState<WizardStep>("consent");
  const [taskId, setTaskId] = React.useState<string | undefined>(undefined);
  const [pollStatus, setPollStatus] = React.useState<BioAuthStatus | undefined>(undefined);
  const [pollError, setPollError] = React.useState<string | undefined>(undefined);
  const [cameraError, setCameraError] = React.useState<string | undefined>(undefined);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  // 轮询：只在 detecting 步骤且有 taskId 时激活
  useBioAuthPolling({
    taskId,
    status: step === "detecting" ? pollStatus : undefined,
    onUpdate: ({ status, errorMessage }) => {
      setPollStatus(status);
      if (status === "active") {
        stopCamera();
        setStep("result");
        onSuccess(taskId!);
      } else if (status === "failed") {
        stopCamera();
        setPollError(errorMessage);
        setStep("result");
        onFail(errorMessage);
      }
    },
  });

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Modal 关闭或卸载时释放摄像头
  React.useEffect(() => {
    if (!isOpen) stopCamera();
    return () => stopCamera();
  }, [isOpen, stopCamera]);

  // 重置 wizard 状态（每次打开时）
  React.useEffect(() => {
    if (isOpen) {
      setStep("consent");
      setTaskId(undefined);
      setPollStatus(undefined);
      setPollError(undefined);
      setCameraError(undefined);
    }
  }, [isOpen]);

  const startDetecting = React.useCallback(async () => {
    setCameraError(undefined);
    setStep("detecting");
    // 启动摄像头
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch {
      setCameraError("请在浏览器设置中允许摄像头访问，然后重试");
      return;
    }
    // 启动后端活体检测任务
    try {
      const result = await startBioAuth(imageUrl);
      setTaskId(result.taskId);
      setPollStatus("processing");
    } catch (err: any) {
      stopCamera();
      setPollError(err?.message || "启动认证失败");
      setStep("result");
      onFail(err?.message);
    }
  }, [imageUrl, onFail, stopCamera]);

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
        {/* 关闭按钮 */}
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

        {/* Step 1: 授权说明 */}
        {step === "consent" && (
          <ConsentStep onStart={startDetecting} onCancel={onClose} />
        )}

        {/* Step 2: 摄像头活体检测 */}
        {step === "detecting" && (
          <DetectingStep
            videoRef={videoRef}
            cameraError={cameraError}
            onRetry={startDetecting}
            onCancel={onClose}
          />
        )}

        {/* Step 3: 结果 */}
        {step === "result" && (
          <ResultStep
            success={pollStatus === "active"}
            errorMessage={pollError}
            onRetry={() => startDetecting()}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 实现三个子步骤组件**

在同一文件末尾追加：

```typescript
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
      <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, marginBottom: 24 }}>
        认证信息仅用于授权验证，不会存储您的人脸数据。认证有效期 <strong>30 天</strong>。
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 18px", borderRadius: 8, border: "1px solid #e5e7eb",
            background: "#fff", cursor: "pointer", fontSize: 14, color: "#374151",
          }}
        >
          取消
        </button>
        <button
          onClick={onStart}
          style={{
            padding: "8px 18px", borderRadius: 8, border: "none",
            background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}
        >
          开始认证 →
        </button>
      </div>
    </div>
  );
}

function DetectingStep({
  videoRef,
  cameraError,
  onRetry,
  onCancel,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  cameraError?: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Camera size={20} style={{ color: "#6366f1" }} />
        <span style={{ fontWeight: 700, fontSize: 16 }}>请正视摄像头，按提示完成动作</span>
      </div>
      {cameraError ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: "#ef4444", marginBottom: 12 }}>{cameraError}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onCancel} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13 }}>
              取消
            </button>
            <button onClick={onRetry} style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 13 }}>
              重试
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", marginBottom: 14, aspectRatio: "4/3" }}>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            <div style={{
              position: "absolute", bottom: 12, left: 0, right: 0,
              textAlign: "center", color: "#fff", fontSize: 13, fontWeight: 500,
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            }}>
              请缓慢左右转头
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6b7280", fontSize: 13 }}>
            <Loader2 size={14} className="animate-spin" />
            认证中，请勿关闭窗口…
          </div>
        </>
      )}
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
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
            认证有效至 {expiryDate}
          </p>
          <button
            onClick={onClose}
            style={{ padding: "8px 28px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
          >
            关闭
          </button>
        </>
      ) : (
        <>
          <ShieldAlert size={48} style={{ color: "#ef4444", margin: "0 auto 16px" }} />
          <p style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>认证失败</p>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
            {errorMessage || "请检查光线或重新尝试"}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              onClick={onClose}
              style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 14 }}
            >
              取消
            </button>
            <button
              onClick={onRetry}
              style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
            >
              重试
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep BioAuthModal
```

期望：无报错输出。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/flow/nodes/BioAuthModal.tsx
git commit -m "feat: add BioAuthModal three-step wizard with camera liveness detection"
```

---

## Task 4: ImageNode.tsx 集成

**Files:**
- Modify: `frontend/src/components/flow/nodes/ImageNode.tsx:32-33`（imports）
- Modify: `frontend/src/components/flow/nodes/ImageNode.tsx:1011-1091`（bioAuth state block，紧跟 volcAsset 块之后）
- Modify: `frontend/src/components/flow/nodes/ImageNode.tsx:1462-1477`（图片替换时清空 bioAuth 字段）
- Modify: `frontend/src/components/flow/nodes/ImageNode.tsx:1637`（Badge 区域追加 BioAuthBadge）

### Step 1: 追加 imports

- [ ] 在 `ImageNode.tsx` 第 33 行（`import { useVolcAssetPolling }` 之后）追加：

```typescript
import { useBioAuthPolling } from "@/hooks/useBioAuthPolling";
import type { BioAuthStatus } from "@/services/bioAuthAPI";
import { BioAuthModal } from "./BioAuthModal";
```

同时在第 6 行 lucide-react 导入中追加 `UserRound`（如果尚未存在）：

```typescript
import { Send as SendIcon, Shield, ShieldCheck, ShieldAlert, Loader2, UserRound } from "lucide-react";
```

### Step 2: 在 volcAsset 块之后插入 bioAuth state 块

- [ ] 在 `ImageNode.tsx` 第 1091 行（`// ──────────────────…` 分隔线之前）插入以下代码块：

```typescript
  // ── Bio Auth state ────────────────────────────────────────────────────────
  const bioAuthId: string | undefined = (data as any)?.bioAuthId;
  const bioAuthStatus: BioAuthStatus | undefined = (data as any)?.bioAuthStatus;
  const bioAuthDate: string | undefined = (data as any)?.bioAuthDate;
  const bioAuthError: string | undefined = (data as any)?.bioAuthError;

  const BIO_AUTH_VALID_DAYS = 30;
  const isBioAuthExpired = React.useMemo(() => {
    if (bioAuthStatus !== "active" || !bioAuthDate) return false;
    const expiresAt = new Date(bioAuthDate).getTime() + BIO_AUTH_VALID_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() > expiresAt;
  }, [bioAuthStatus, bioAuthDate]);

  const effectiveBioStatus: BioAuthStatus | undefined = isBioAuthExpired ? undefined : bioAuthStatus;

  const bioAuthDaysLeft = React.useMemo(() => {
    if (effectiveBioStatus !== "active" || !bioAuthDate) return 0;
    const expiresAt = new Date(bioAuthDate).getTime() + BIO_AUTH_VALID_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  }, [effectiveBioStatus, bioAuthDate]);

  const [bioAuthModalOpen, setBioAuthModalOpen] = React.useState(false);

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

  // 恢复中断的 processing 状态（无 taskId 说明请求被中断）
  React.useEffect(() => {
    if (bioAuthStatus === "processing" && !bioAuthId) {
      patchNode({ bioAuthStatus: "failed", bioAuthError: "认证中断，请重试" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ─────────────────────────────────────────────────────────────────────────
```

### Step 3: 图片替换时清空 bioAuth 字段

- [ ] 在 `ImageNode.tsx` 第 1472-1473 行（`volcReviewDate: undefined,` 之后）追加：

```typescript
              // Clear bio auth state when source image changes
              bioAuthId: undefined,
              bioAuthStatus: undefined,
              bioAuthError: undefined,
              bioAuthDate: undefined,
```

确保整个 patch 对象变为：

```typescript
patch: {
  imageUrl: persistedDisplayRef,
  imageData: undefined,
  thumbnail: undefined,
  uploading: false,
  uploadError: undefined,
  uploadToken: undefined,
  volcAssetId: undefined,
  volcAssetStatus: undefined,
  volcAssetError: undefined,
  volcReviewDate: undefined,
  bioAuthId: undefined,
  bioAuthStatus: undefined,
  bioAuthError: undefined,
  bioAuthDate: undefined,
},
```

### Step 4: Badge 区域追加 BioAuthBadge

- [ ] 在 `ImageNode.tsx` 第 1637 行 `<div style={{ display: "flex", gap: 6 }}>` 内，找到 volcAsset `<button>` 结束后（`</button>` 后面），追加：

```tsx
          {/* Bio Auth Badge */}
          {(() => {
            const bioTitle =
              isBioAuthExpired ? "认证已过期，点击重新认证"
              : effectiveBioStatus === "active" ? `已认证（${bioAuthDaysLeft} 天后过期，点击重新认证）`
              : effectiveBioStatus === "processing" ? "认证中…"
              : effectiveBioStatus === "failed" ? (bioAuthError || "认证失败，点击重试")
              : "点击进行生物认证";
            return (
              <button
                type="button"
                onClick={() => {
                  if (!data.imageUrl) {
                    window.dispatchEvent(new CustomEvent("toast", {
                      detail: { message: "请先上传图片再认证", type: "warning" },
                    }));
                    return;
                  }
                  setBioAuthModalOpen(true);
                }}
                title={bioTitle}
                aria-label={bioTitle}
                disabled={effectiveBioStatus === "processing"}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  cursor: effectiveBioStatus === "processing" ? "not-allowed" : "pointer",
                }}
              >
                {isBioAuthExpired ? <ShieldAlert size={14} className="text-orange-400" />
                 : effectiveBioStatus === "active" ? <UserRound size={14} className="text-green-600" />
                 : effectiveBioStatus === "processing" ? <Loader2 size={14} className="animate-spin text-blue-500" />
                 : effectiveBioStatus === "failed" ? <ShieldAlert size={14} className="text-red-500" />
                 : <UserRound size={14} className="text-gray-400" />}
              </button>
            );
          })()}
```

### Step 5: 渲染 BioAuthModal

- [ ] 在 `ImageNode.tsx` 渲染的最末尾（紧接在 `</div>` 闭合根节点之前）添加：

```tsx
      {/* Bio Auth Modal */}
      <BioAuthModal
        isOpen={bioAuthModalOpen}
        imageUrl={data.imageUrl || ""}
        onClose={() => setBioAuthModalOpen(false)}
        onSuccess={(taskId) => {
          patchNode({
            bioAuthId: taskId,
            bioAuthStatus: "processing",
            bioAuthError: undefined,
            bioAuthDate: undefined,
          });
          setBioAuthModalOpen(false);
        }}
        onFail={() => setBioAuthModalOpen(false)}
      />
```

### Step 6: 验证 TypeScript 编译

- [ ] 运行：

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

期望：0 errors。若有报错，修复后再继续。

### Step 7: 手动功能验证

- [ ] 启动开发服务器：`cd frontend && npm run dev`（或 `pnpm dev`）
- [ ] 打开画布，拖入一个 `ImageNode`，上传任意图片
- [ ] 确认节点顶部 Badge 区域出现第二个灰色 `UserRound` 图标
- [ ] 点击图标，确认 `BioAuthModal` 弹出并显示 Step 1（授权说明）
- [ ] 点击「开始认证 →」，确认摄像头权限请求弹出
  - 拒绝权限 → 显示摄像头错误提示和重试按钮 ✓
  - 允许权限 → 显示摄像头实时画面和「认证中」提示 ✓
- [ ] 关闭 Modal，确认节点 Badge 变为蓝色旋转（processing 状态）
- [ ] 后端返回 active 后，确认 Badge 变为绿色 `UserRound` + 显示天数
- [ ] 替换图片，确认 bioAuth 字段被清空（Badge 回到灰色未认证状态）

### Step 8: Commit

- [ ] 

```bash
git add frontend/src/components/flow/nodes/ImageNode.tsx
git commit -m "feat: integrate bio auth badge and modal into ImageNode"
```

---

## 自审检查

**Spec coverage:**
- ✅ 数据模型：Task 4 Step 2 添加 bioAuth* 字段
- ✅ 状态机（5 种状态）：Task 4 Step 4 Badge 渲染
- ✅ 有效期 30 天 + 过期判断：Task 4 Step 2 `isBioAuthExpired`
- ✅ Badge 入口 + 点击打开 Modal：Task 4 Step 4-5
- ✅ Step 1 授权说明：Task 3 `ConsentStep`
- ✅ Step 2 摄像头 + 摄像头权限错误处理：Task 3 `DetectingStep`
- ✅ Step 3 成功/失败结果：Task 3 `ResultStep`
- ✅ 摄像头 stream 卸载时释放：Task 3 `stopCamera + useEffect`
- ✅ Modal 关闭不中断轮询：Task 4 Step 5 `onClose` 只关 Modal，轮询继续
- ✅ 中断 processing 恢复 failed：Task 4 Step 2 `useEffect([], [])`
- ✅ 图片替换时清空 bioAuth 字段：Task 4 Step 3
- ✅ 后端 API 约定：Task 1 两个函数签名
