// frontend/src/services/agentCanvasProtocol.ts
// 小T画布宿主协议（v1）：Tanva 的能力清单 + flow_patch 操作校验。
// 与设计文档 docs/superpowers/specs/2026-07-13-xiaot-agent-integration-design.md 对齐。

export const AGENT_PATCH_OPS = [
  "addNode",
  "updateNodeData",
  "connectEdge",
  "focusNode",
  "placeImage",
  "runNode",
] as const;
export type AgentPatchOp = (typeof AGENT_PATCH_OPS)[number];

export interface AgentFlowPatch {
  op: AgentPatchOp;
  node?: { id: string; type: string; data?: Record<string, unknown>; position?: { x: number; y: number } };
  id?: string;
  patch?: Record<string, unknown>;
  source?: string;
  target?: string;
  sourceHandle?: string;
  targetHandle?: string;
  url?: string;
  name?: string;
}

export function parseAgentFlowPatch(raw: unknown): AgentFlowPatch | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const p = obj as AgentFlowPatch;
  if (!(AGENT_PATCH_OPS as readonly string[]).includes(p.op)) return null;
  if (p.op === "addNode" && (!p.node?.id || !p.node?.type)) return null;
  if (p.op === "updateNodeData" && (!p.id || !p.patch)) return null;
  if (p.op === "connectEdge" && (!p.source || !p.target)) return null;
  if ((p.op === "focusNode" || p.op === "runNode") && !p.id) return null;
  if (p.op === "placeImage" && !p.url) return null;
  return p;
}

// 一期暴露给小T的节点能力清单（保守起步；type 必须存在于 FlowOverlay rawNodeTypes）
export const TANVA_CAPABILITY_MANIFEST = {
  protocol_version: "1" as const,
  host: "tanva",
  patchOps: [...AGENT_PATCH_OPS],
  nodeSpecs: [
    {
      type: "textNote",
      label: "便签",
      purpose: "画布上的纯文本便签，用于备注/说明",
      params: { text: { type: "string", description: "便签内容" } },
    },
    {
      type: "textChat",
      label: "文本对话",
      purpose: "调用 LLM 生成/改写文本；data.prompt 为输入",
      params: { prompt: { type: "string" } },
      outputs: [{ handle: "text", emits: "text" }],
    },
    {
      type: "generate",
      label: "图像生成",
      purpose: "按 prompt 生成图片；可连入参考图；创建后用 runNode 触发生成（由宿主计费执行）",
      params: {
        prompt: { type: "string", description: "生图提示词" },
        label: { type: "string" },
      },
      inputs: [{ handle: "image", accepts: "image" }],
      outputs: [{ handle: "image", emits: "image" }],
      constraints: ["生成异步完成，结果直接落节点，你无需等待"],
    },
    {
      type: "image",
      label: "图片",
      purpose: "承载一张已有图片的画布节点（可连线；用 addNode 创建并在 data.imageUrl 给图）",
      params: { imageUrl: { type: "string" }, label: { type: "string" } },
      outputs: [{ handle: "image", emits: "image" }],
    },
  ],
  notes: [
    "canvas_context.nodes 里的 id 是真实节点 id，操作已有节点必须用它",
    "addNode 的 position 缺省时宿主会自动排布",
    "connectEdge 必须同时提供 sourceHandle 与 targetHandle（用节点清单中 inputs/outputs 声明的 handle 名），缺失会被画布拒绝",
    "placeImage 会把图片放到画布绘图层（非节点、不可连线）；需要可连线的图片节点请用 addNode {type:'image', data:{imageUrl}}",
    "操作已有节点时 id 必须来自 canvas_context.nodes（真实 id）；你此前轮次自造的节点 id 仅在同一聊天会话内有效",
  ],
};

export function buildManifestSystemMessage(): string {
  return `<capability_manifest>${JSON.stringify(TANVA_CAPABILITY_MANIFEST)}</capability_manifest>`;
}

export interface AgentCanvasSnapshot {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

export function buildCanvasContextSystemMessage(snapshot: AgentCanvasSnapshot): string {
  return `<canvas_context>${JSON.stringify(snapshot)}</canvas_context>`;
}
