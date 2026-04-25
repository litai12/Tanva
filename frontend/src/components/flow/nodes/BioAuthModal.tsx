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
          width: 470,
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
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151", whiteSpace: "nowrap" }}
        >
          {copied ? <Check size={14} style={{ color: "#16a34a" }} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制链接"}
        </button>
        <a
          href={h5Link}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 13, textDecoration: "none", whiteSpace: "nowrap" }}
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
