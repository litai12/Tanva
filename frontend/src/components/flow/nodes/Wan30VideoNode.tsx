import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Video } from "lucide-react";
import GenerationProgressBar from "./GenerationProgressBar";
import NodeSelect from "./NodeSelect";
import RunCreditBadge from "./RunCreditBadge";
import { useBackendCreditsPreview } from "../hooks/useBackendCreditsPreview";
import { useLocaleText } from "@/utils/localeText";

type Props = {
  id: string;
  selected?: boolean;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    resolution?: string;
    duration?: number;
    videoUrl?: string;
    error?: string;
    progressStartedAt?: number | string | null;
    onRun?: (id: string) => void;
    history?: Array<{ id: string; videoUrl: string; prompt: string }>;
  };
};

function Wan30VideoNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const resolution = data.resolution ?? "480P";
  const duration = data.duration ?? 5;
  const running = data.status === "running";
  const update = (patch: Record<string, unknown>) => window.dispatchEvent(
    new CustomEvent("flow:updateNodeData", { detail: { id, patch } }),
  );
  const { credits } = useBackendCreditsPreview({
    serviceType: "wan30-video", model: "wan3.0-video",
    requestParams: {
      managedModelKey: "wan-3.0", modelKey: "wan-3.0",
      vendorKey: "new_api", platformKey: "new_api", aiProvider: "new-api",
      generationMode: "t2v", resolution, duration, durationSec: duration,
    }, enabled: true,
  });
  return <div style={{ width: 300, padding: 12, borderRadius: 10, background: "#fff", border: `1px solid ${selected ? "#2563eb" : "#e5e7eb"}` }}>
    <Handle type="target" position={Position.Left} id="text" title={lt("提示词输入", "Prompt input")} />
    <Handle type="source" position={Position.Right} id="video" title={lt("视频输出", "Video output")} />
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <strong style={{ display: "flex", alignItems: "center", gap: 6 }}><Video size={18} />Wan3.0</strong>
      <button className="nodrag" disabled={running} onClick={() => data.onRun?.(id)}
        style={{ border: 0, borderRadius: 6, padding: "6px 10px", background: "#111827", color: "white", opacity: running ? 0.5 : 1 }}>
        {running ? lt("生成中", "Generating") : <><span>{lt("运行", "Run")}</span><RunCreditBadge credits={credits} inline /></>}
      </button>
    </div>
    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>{lt("连接提示词生成视频 · 自适应画幅", "Connect a prompt · Adaptive aspect ratio")}</div>
    <div className="nodrag nowheel" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
      <label style={{ fontSize: 12 }}>{lt("分辨率", "Resolution")}
        <NodeSelect value={resolution} options={["480P", "720P", "1080P"].map((value) => ({ value, label: value }))}
          onChange={(value) => update({ resolution: value })} menuLabel={lt("分辨率", "Resolution")} />
      </label>
      <label style={{ fontSize: 12 }}>{lt("时长", "Duration")}
        <NodeSelect value={String(duration)} options={[5, 10, 15, 20, 25, 30].map((value) => ({ value: String(value), label: `${value}s` }))}
          onChange={(value) => update({ duration: Number(value) })} menuLabel={lt("时长", "Duration")} />
      </label>
    </div>
    <div style={{ minHeight: 155, background: "#f8fafc", borderRadius: 6, display: "grid", placeItems: "center" }}>
      {data.videoUrl ? <video className="nodrag nowheel" src={data.videoUrl} controls style={{ width: "100%", maxHeight: 300 }} />
        : <span style={{ color: "#94a3b8", fontSize: 12 }}>{lt("等待生成视频", "Waiting for video")}</span>}
    </div>
    {data.videoUrl && <a className="nodrag" href={data.videoUrl} download target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{lt("下载视频", "Download video")}</a>}
    <GenerationProgressBar status={data.status ?? "idle"} startedAt={data.progressStartedAt} runKey={id} />
    {!!data.history?.length && <details className="nodrag nowheel" style={{ fontSize: 12, marginTop: 8 }}>
      <summary>{lt("历史记录", "History")} ({data.history.length})</summary>
      {data.history.map((item, index) => <div key={item.id} style={{ marginTop: 6 }}>
        <a href={item.videoUrl} target="_blank" rel="noreferrer">{index + 1}. {item.prompt || lt("视频", "Video")}</a>
        {!running && <button onClick={() => update({ videoUrl: item.videoUrl })}>{lt("设为当前", "Use this video")}</button>}
      </div>)}
    </details>}
    {data.error && <div role="alert" style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{data.error}</div>}
  </div>;
}
export default React.memo(Wan30VideoNode);
