import React from "react";
import { Handle, Position } from "reactflow";
import { AlertTriangle, UserRound } from "lucide-react";

type CharacterItem = {
  id?: string;
  displayName?: string;
  username?: string;
  profilePictureUrl?: string;
};

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    error?: string;
    onRun?: (id: string) => void;
    model?: "sora-2" | "sora-2-pro";
    timestamps?: string;
    fromTask?: string;
    taskId?: string;
    progress?: number;
    characters?: CharacterItem[];
  };
  selected?: boolean;
};

function Sora2CharacterNodeInner({ id, data, selected }: Props) {
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  const [hover, setHover] = React.useState<string | null>(null);

  const status = data.status || "idle";
  const model = data.model === "sora-2" || data.model === "sora-2-pro" ? data.model : "sora-2-pro";
  const timestamps = typeof data.timestamps === "string" ? data.timestamps : "1,3";
  const fromTask = typeof data.fromTask === "string" ? data.fromTask : "";
  const taskId = typeof data.taskId === "string" ? data.taskId : "";
  const progress = typeof data.progress === "number" ? data.progress : undefined;
  const characters = Array.isArray(data.characters) ? data.characters : [];

  const onRun = React.useCallback(() => data.onRun?.(id), [data, id]);

  const updatePatch = React.useCallback((patch: Record<string, any>) => {
    window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch } }));
  }, [id]);

  const handleModelChange = React.useCallback((value: "sora-2" | "sora-2-pro") => {
    updatePatch({ model: value });
  }, [updatePatch]);

  const handleTimestampsChange = React.useCallback((value: string) => {
    updatePatch({ timestamps: value.trim() || undefined });
  }, [updatePatch]);

  const handleFromTaskChange = React.useCallback((value: string) => {
    updatePatch({ fromTask: value.trim() || undefined });
  }, [updatePatch]);

  const handleButtonMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      style={{
        width: 300,
        padding: 10,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow,
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: "42%" }}
        onMouseEnter={() => setHover("video-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="character"
        style={{ top: "42%" }}
        onMouseEnter={() => setHover("character-out")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "video-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "42%", transform: "translate(-100%, -50%)" }}>
          video
        </div>
      )}
      {hover === "character-out" && (
        <div className="flow-tooltip" style={{ right: -8, top: "42%", transform: "translate(100%, -50%)" }}>
          character
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <UserRound size={18} />
          <span>Sora2 Character</span>
        </div>
        <button
          onClick={onRun}
          onMouseDown={handleButtonMouseDown}
          disabled={status === "running"}
          style={{
            height: 30,
            padding: "0 10px",
            borderRadius: 8,
            border: "none",
            background: status === "running" ? "#e5e7eb" : "#111827",
            color: "#fff",
            cursor: status === "running" ? "not-allowed" : "pointer",
            fontSize: 12,
            opacity: status === "running" ? 0.6 : 1,
          }}
        >
          {status === "running" ? "运行中" : "Run"}
        </button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>模型</div>
        <select
          className="nodrag"
          value={model}
          onChange={(event) => handleModelChange(event.target.value as "sora-2" | "sora-2-pro")}
          style={{
            width: "100%",
            height: 32,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: "0 10px",
            fontSize: 12,
            background: "#fff",
          }}
        >
          <option value="sora-2-pro">sora-2-pro</option>
          <option value="sora-2">sora-2</option>
        </select>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>角色时间戳</div>
        <input
          className="nodrag"
          value={timestamps}
          onChange={(event) => handleTimestampsChange(event.target.value)}
          placeholder="1,3"
          style={{
            width: "100%",
            height: 32,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: "0 10px",
            fontSize: 12,
          }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>from_task（可选）</div>
        <input
          className="nodrag"
          value={fromTask}
          onChange={(event) => handleFromTaskChange(event.target.value)}
          placeholder="task_xxx"
          style={{
            width: "100%",
            height: 32,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: "0 10px",
            fontSize: 12,
          }}
        />
      </div>

      <div
        style={{
          padding: "6px 8px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
          fontSize: 11,
          color: "#334155",
          marginBottom: 8,
        }}
      >
        <div>状态: {status}</div>
        {typeof progress === "number" && <div>进度: {progress}%</div>}
        {taskId && <div>任务ID: {taskId}</div>}
      </div>

      {characters.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#0f172a", fontWeight: 600 }}>角色结果</div>
          {characters.map((item, index) => (
            <div
              key={`${item.id || "character"}-${index}`}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "6px 8px",
                background: "#fff",
                fontSize: 11,
                color: "#334155",
              }}
            >
              <div>ID: {item.id || "-"}</div>
              <div>名称: {item.displayName || "-"}</div>
              <div>@{item.username || "-"}</div>
            </div>
          ))}
        </div>
      )}

      {data.error && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 8px",
            background: "#fef2f2",
            border: "1px solid #fecdd3",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 12,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <AlertTriangle size={14} />
          <span>{data.error}</span>
        </div>
      )}
    </div>
  );
}

export default React.memo(Sora2CharacterNodeInner);

