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
  onStart?: (taskId: string) => void;
  onSuccess: (taskId: string) => void;
  onFail: (errorMessage?: string) => void;
}

type WizardStep = "consent" | "detecting" | "result";

export function BioAuthModal({ isOpen, imageUrl, onClose, onStart, onSuccess, onFail }: BioAuthModalProps) {
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
    stopCamera();
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
      onStart?.(result.taskId);
    } catch (err: any) {
      const msg = err?.message || "启动认证失败";
      stopCamera();
      setPollError(msg);
      setStep("result");
      onFail(msg);
    }
  }, [imageUrl, onFail, onStart, stopCamera]);

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
  videoRef: React.RefObject<HTMLVideoElement | null>;
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
