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

// 暴露给小T的节点能力清单（分层：第一层完整 spec，第二层 stub 只报型号；
// type 必须存在于 FlowOverlay rawNodeTypes）
export const TANVA_CAPABILITY_MANIFEST = {
  protocol_version: "1" as const,
  host: "tanva",
  patchOps: [...AGENT_PATCH_OPS],
  // 富格式 UI 能力声明（协议 v1.1；TapCanvas 侧旧 schema 会安全忽略该字段）
  ui: ["choices", "suggestions", "media"],
  nodeSpecs: [
    // ── 第一层：完整 spec ──
    {
      type: "textNote",
      label: "便签",
      purpose: "画布上的纯文本便签，用于备注/说明",
      params: { text: { type: "string", description: "便签内容" } },
    },
    {
      type: "textChat",
      label: "文本对话",
      purpose: "调用 LLM 生成/改写文本；data.prompt 为输入；也是给生成类节点供 prompt 的文本源（输出 handle text）",
      params: { prompt: { type: "string" } },
      outputs: [{ handle: "text", emits: "text" }],
    },
    {
      type: "image",
      label: "图片",
      purpose: "承载一张已有图片的画布节点（可连线；用 addNode 创建并在 data.imageUrl 给图）",
      params: { imageUrl: { type: "string" }, label: { type: "string" } },
      outputs: [{ handle: "image", emits: "image" }],
    },
    {
      type: "generatePro",
      label: "Agent图像生成(Pro)",
      purpose: "首选生图节点：data.prompts 数组即本地提示词，无需连文本边即可 runNode；可联网",
      params: {
        prompts: { type: "array", items: { type: "string" } },
        modelProvider: { type: "string", enum: ["banana-2.5", "banana", "banana-3.1"], description: "Fast/Pro/Ultra 三档" },
        enableWebSearch: { type: "boolean" },
      },
      inputs: [{ handle: "text" }, { handle: "img", accepts: "image" }],
      outputs: [{ handle: "img", emits: "image" }],
    },
    {
      type: "generatePro4",
      label: "Agent图像生成(Pro)四宫格",
      purpose: "同 generatePro 但一次出四张图（data.prompts 自足，无需连文本边）",
      params: {
        prompts: { type: "array", items: { type: "string" } },
        modelProvider: { type: "string", enum: ["banana-2.5", "banana", "banana-3.1"], description: "Fast/Pro/Ultra 三档" },
        enableWebSearch: { type: "boolean" },
      },
      inputs: [{ handle: "text" }, { handle: "img", accepts: "image" }],
      outputs: [
        { handle: "img1", emits: "image" },
        { handle: "img2", emits: "image" },
        { handle: "img3", emits: "image" },
        { handle: "img4", emits: "image" },
      ],
    },
    {
      type: "seedream5",
      label: "Seedream 生图",
      purpose: "火山 Seedream 生图，支持批量",
      params: {
        modelVersion: { type: "string", enum: ["4.0", "4.5", "5.0", "5.0-pro"] },
        size: { type: "string", enum: ["1K", "2K", "4K"] },
        batchMode: { type: "boolean" },
        batchCount: { type: "number" },
      },
      inputs: [{ handle: "prompt" }, { handle: "img", accepts: "image" }],
      outputs: [{ handle: "img", emits: "image" }],
    },
    {
      type: "sora2Video",
      label: "Sora2 视频",
      purpose: "OpenAI Sora2 文/图生视频",
      params: {
        model: { type: "string", enum: ["sora-2", "sora-2-pro"] },
        aspectRatio: { type: "string" },
        clipDuration: { type: "number", description: "秒" },
      },
      inputs: [
        { handle: "text" },
        { handle: "image", accepts: "image" },
        { handle: "video", accepts: "video" },
      ],
      outputs: [{ handle: "video", emits: "video" }],
    },
    {
      type: "seedance20Video",
      label: "Seedance2.0 视频",
      purpose: "即梦 Seedance2.0：参考图/首尾帧/智能帧全能，可生成音频",
      params: {
        seedanceMode: { type: "string", enum: ["reference_images", "start_end", "first_frame", "smart_frames"] },
        resolution: { type: "string", enum: ["720P", "1080P"] },
        generateAudio: { type: "boolean" },
      },
      inputs: [
        { handle: "text" },
        { handle: "image", accepts: "image" },
        { handle: "video", accepts: "video" },
        { handle: "audio", accepts: "audio" },
      ],
      outputs: [{ handle: "video", emits: "video" }],
    },
    {
      type: "kling26Video",
      label: "可灵2.6 视频",
      purpose: "可灵2.6：首尾帧（image-2 为尾帧）",
      params: {
        mode: { type: "string", enum: ["std", "pro"] },
        clipDuration: { type: "number" },
        aspectRatio: { type: "string" },
      },
      inputs: [
        { handle: "text" },
        { handle: "image", accepts: "image" },
        { handle: "image-2", accepts: "image" },
        { handle: "video", accepts: "video" },
      ],
      outputs: [{ handle: "video", emits: "video" }],
    },
    {
      type: "wan27Video",
      label: "Wan2.7 视频",
      purpose: "阿里 Wan2.7：首帧图+音频驱动",
      params: {
        resolution: { type: "string", enum: ["720P", "1080P"] },
        duration: { type: "number", description: "2-15秒" },
      },
      inputs: [
        { handle: "text" },
        { handle: "image", accepts: "image" },
        { handle: "audio", accepts: "audio" },
      ],
      outputs: [{ handle: "video", emits: "video" }],
    },
    // ── 第二层：stub（只报型号，参数走节点默认值）──
    { type: "generate", purpose: "单图生成，需连 text 边供提示词（presetPrompt 仅作前缀）" },
    { type: "generate4", purpose: "四宫格生成，需连 text 边供提示词" },
    { type: "generateRef", purpose: "参考图重绘" },
    { type: "nano2", purpose: "Nano Banana2 单图生成" },
    { type: "gptImage2", purpose: "GPT 生图" },
    { type: "klingVideo", purpose: "可灵2.1 视频" },
    { type: "kling30Video", purpose: "可灵3.0 视频" },
    { type: "viduVideo", purpose: "Vidu Q2 视频" },
    { type: "viduQ3", purpose: "Vidu Q3 Pro 视频" },
    { type: "doubaoVideo", purpose: "Seedance1.5 Pro 视频" },
    { type: "seedVideo", purpose: "Seed2.0 Lite 视频" },
    { type: "wan26", purpose: "Wan2.6 视频" },
    { type: "wan2R2V", purpose: "Wan2 参考图生视频" },
    { type: "happyhorseR2V", purpose: "Happyhorse 多参考图生视频（1-9张）" },
    { type: "omniFlashExtVideo", purpose: "Omni 视频扩展（延长已有视频）" },
    { type: "klingO1Video", purpose: "可灵O3 分镜视频" },
  ],
  notes: [
    "canvas_context.nodes 里的 id 是真实节点 id，操作已有节点必须用它",
    "addNode 的 position 缺省时宿主会自动排布",
    "connectEdge 必须同时提供 sourceHandle 与 targetHandle（用节点清单中 inputs/outputs 声明的 handle 名），缺失会被画布拒绝",
    "placeImage 会把图片放到画布绘图层（非节点、不可连线）；需要可连线的图片节点请用 addNode {type:'image', data:{imageUrl}}",
    "操作已有节点时 id 必须来自 canvas_context.nodes（真实 id）；你此前轮次自造的节点 id 仅在同一聊天会话内有效",
    "生图节点 data.modelProvider 三档 banana-2.5/banana/banana-3.1（Fast/Pro/Ultra），参考图上限分别 3/11/14",
    "除 generatePro/generatePro4（用 data.prompts 自足）外，其余生图与全部视频节点必须先建文本节点（textChat 或 textNote）并 connectEdge 其 text 输出到目标节点的 text 输入（seedream5 的文本输入 handle 名是 prompt），再 runNode",
    "视频节点输出统一为 video handle；生图输出统一为 img handle；第二层清单只列了型号名，参数走节点默认值，需要精细控制时优先用第一层节点",
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
