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

// 节点默认连线 handle（与 manifest nodeSpecs 同源；用于 agent 连线缺 handle 时补全）
export const DEFAULT_NODE_HANDLES: Record<
  string,
  { textOut?: string; textIn?: string; imageIn?: string; imageOut?: string; videoOut?: string }
> = {
  textPrompt: { textOut: "text" },
  textChat: { textOut: "text" },
  textNote: { textOut: "text-right-out" },
  generate: { textIn: "text", imageOut: "img", imageIn: "img" },
  generate4: { textIn: "text", imageOut: "img", imageIn: "img" },
  generatePro: { textIn: "text", imageOut: "img", imageIn: "img" },
  generatePro4: { textIn: "text", imageOut: "img", imageIn: "img" },
  generateRef: { textIn: "text", imageOut: "img" },
  nano2: { textIn: "text", imageOut: "img", imageIn: "img" },
  gptImage2: { textIn: "text", imageOut: "img", imageIn: "img" },
  seedream5: { textIn: "prompt", imageOut: "img", imageIn: "img" },
  image: { imageOut: "img" },
  // 视频节点：文本入 text，图入 image，视频出 video
  seedance20Video: { textIn: "text", imageIn: "image", videoOut: "video" },
  sora2Video: { textIn: "text", imageIn: "image", videoOut: "video" },
  kling26Video: { textIn: "text", imageIn: "image", videoOut: "video" },
  wan27Video: { textIn: "text", imageIn: "image", videoOut: "video" },
  viduQ3: { textIn: "text", imageIn: "image", videoOut: "video" },
  doubaoVideo: { textIn: "text", imageIn: "image", videoOut: "video" },
  // 扩展节点（部分 handle 如 audio/prompt/多输出无法用现有字段表达，
  // 仅补常用 text/image/video 补全；连线仍以 manifest inputs/outputs 为准）
  midjourneyV7: { textIn: "text", imageIn: "img", imageOut: "img" },
  niji7: { textIn: "text", imageIn: "img", imageOut: "img" },
  analysis: { textIn: "text", imageIn: "img", textOut: "prompt" },
  promptOptimize: { textIn: "text", textOut: "text" },
  imagePro: { imageIn: "img", imageOut: "img" },
  imageCompress: { imageIn: "img", imageOut: "img" },
  imageGrid: { imageIn: "images", imageOut: "img" },
  imageSplit: { imageIn: "img" },
  audioStudio: { textIn: "text" },
  storyboardSplit: { textIn: "text" },
  videoCompose: { videoOut: "video" },
};

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
      type: "textPrompt",
      label: "提示词",
      purpose: "生成类节点的提示词载体：data.text 写提示词，输出连到生成节点的 text 输入",
      params: { text: { type: "string", description: "提示词正文" } },
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
      purpose: "即梦 Seedance2.0：仅图生视频，4个模式(reference_images/首尾帧/首帧/智能帧)全部需要≥1张图，无纯文生模式。用它必须先有图节点连入 image 输入。纯文本生视频请改用支持文生的模型。",
      params: {
        seedanceMode: { type: "string", enum: ["reference_images", "start_end", "first_frame", "smart_frames"], description: "全部模式均需≥1张图：reference_images(参考图)/start_end(首尾帧,需首+尾)/first_frame(首帧)/smart_frames(智能帧)" },
        resolution: { type: "string", enum: ["720P", "1080P"] },
        aspectRatio: { type: "string", enum: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], description: "缺省 16:9" },
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
      type: "nano2",
      label: "Nano Banana 2",
      purpose: "单图生成（banana-3.1 家族）；需连 text 边供提示词",
      params: { presetPrompt: { type: "string", description: "前缀提示词（可选）" } },
      inputs: [{ handle: "text" }, { handle: "img", accepts: "image" }],
      outputs: [{ handle: "img", emits: "image" }],
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
    {
      type: "audioStudio",
      label: "音频工作台",
      purpose: "按 mode 生成语音/音乐/配音：mode 决定输入 handle 与必填参数",
      params: {
        mode: { type: "string", enum: ["seed-audio", "minimax-speech", "minimax-music", "tencent-dub", "upload"], description: "seed-audio=火山语音(text必填,可连参考图/音频);minimax-speech=TTS;minimax-music=音乐(text=歌词/风格);tencent-dub=视频译制配音(需连video);upload=导入" },
        text: { type: "string" },
      },
      inputs: [{ handle: "text" }, { handle: "video", accepts: "video" }, { handle: "audio", accepts: "audio" }, { handle: "image", accepts: "image" }],
      outputs: [{ handle: "audio", emits: "audio" }, { handle: "video", emits: "video" }],
      constraints: ["seed-audio/speech/music 连 text→出 audio；tencent-dub 需连 video→出 audio+video；建节点必须在 data 指定 mode"],
    },
    {
      type: "midjourneyV7",
      label: "Midjourney V7",
      purpose: "MJ V7 文/图生图",
      params: {
        aspectRatio: { type: "string", enum: ["1:1", "16:9", "9:16", "2:3", "3:2", "4:5"] },
        stylize: { type: "string", description: "风格化强度默认100" },
        chaos: { type: "string" },
        quality: { type: "string", enum: ["1", "2", "4"] },
        speedMode: { type: "string", enum: ["draft", "fast", "turbo"] },
      },
      inputs: [{ handle: "img", accepts: "image" }, { handle: "omniImage", accepts: "image" }, { handle: "text" }],
      outputs: [{ handle: "img", emits: "image" }],
      constraints: ["可纯文生图或连参考图到 img/omniImage"],
    },
    {
      type: "niji7",
      label: "Niji 7 二次元",
      purpose: "MJ Niji 引擎二次元风格生图；参数同 MidjourneyV7（aspectRatio/stylize/chaos/speedMode）但恒 niji 引擎、无 quality",
      inputs: [{ handle: "img", accepts: "image" }, { handle: "omniImage", accepts: "image" }, { handle: "text" }],
      outputs: [{ handle: "img", emits: "image" }],
      constraints: ["可纯文生图或连参考图到 img/omniImage"],
    },
    {
      type: "storyboardSplit",
      label: "分镜拆分",
      purpose: "把一段剧本文本拆成多个分镜提示词（单节点多输出）",
      params: { outputCount: { type: "number", description: "分镜数默认9" } },
      inputs: [{ handle: "text" }],
      outputs: [{ handle: "prompt1", emits: "text" }],
      constraints: ["输入连文本源；输出 prompt1..N（按 outputCount 动态）各接一个生图/生视频节点的提示词——是多镜头编排入口"],
    },
    {
      type: "videoCompose",
      label: "视频合成",
      purpose: "浏览器端把多段视频拼成成片（不扣积分）",
      inputs: [{ handle: "video", accepts: "video" }, { handle: "audio", accepts: "audio" }],
      outputs: [{ handle: "video", emits: "video" }],
      constraints: ["video 是单 handle 接多条连线：把≥2段生成好的视频的 video 输出都连到这个 video 输入；audio 可选连 audioStudio"],
    },
    {
      type: "analysis",
      label: "图像分析",
      purpose: "看图/反推提示词/图像理解（需连图到 img，输出 prompt）",
      params: { analysisSkillId: { type: "string", enum: ["prompt", "json", "promptOnly", "custom"] } },
      inputs: [{ handle: "img", accepts: "image" }, { handle: "text" }],
      outputs: [{ handle: "prompt", emits: "text" }],
    },
    {
      type: "promptOptimize",
      label: "提示词优化",
      purpose: "扩写/优化简短提示词(text→text)",
      inputs: [{ handle: "text" }],
      outputs: [{ handle: "text", emits: "text" }],
    },
    {
      type: "imagePro",
      label: "图片Pro",
      purpose: "承载图片(可调宽度,等价image)",
      inputs: [{ handle: "img", accepts: "image" }],
      outputs: [{ handle: "img", emits: "image" }],
    },
    {
      type: "imageCompress",
      label: "图片压缩",
      purpose: "压缩图片体积(需连1图)",
      params: { level: { type: "string", enum: ["light", "balanced", "strong"] } },
      inputs: [{ handle: "img", accepts: "image" }],
      outputs: [{ handle: "img", emits: "image" }],
    },
    {
      type: "imageGrid",
      label: "图片拼合",
      purpose: "多图拼成网格图(images单handle连多图)",
      inputs: [{ handle: "images", accepts: "image" }],
      outputs: [{ handle: "img", emits: "image" }],
    },
    {
      type: "imageSplit",
      label: "图片分割",
      purpose: "一张图分割成多张(需连1图,动态输出image1..N)",
      params: { splitMode: { type: "string", enum: ["smart", "customGrid"] }, outputCount: { type: "number" } },
      inputs: [{ handle: "img", accepts: "image" }],
      outputs: [{ handle: "image1", emits: "image" }],
    },
    // ── 第二层：stub（只报型号，参数走节点默认值）──
    { type: "generate", purpose: "单图生成，需连 text 边供提示词（presetPrompt 仅作前缀）" },
    { type: "generate4", purpose: "四宫格生成，需连 text 边供提示词" },
    { type: "generateRef", purpose: "参考图重绘" },
    { type: "gptImage2", purpose: "GPT 生图" },
    { type: "klingVideo", purpose: "可灵2.1 视频" },
    { type: "kling30Video", purpose: "可灵3.0 视频" },
    { type: "viduVideo", purpose: "Vidu Q2 视频" },
    { type: "viduQ3", purpose: "Vidu Q3 Pro 视频" },
    { type: "doubaoVideo", purpose: "Seedance 1.5 Pro（旧版；用户未指定模型时不要选它，用 seedance20Video）" },
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
    "生成类节点（除 generatePro/Pro4）的提示词必须由 textPrompt 节点承载：创建生成节点时必须同步创建 textPrompt（data.text 写提示词）并 connectEdge {sourceHandle:'text', targetHandle:'text'}（seedream5 的 targetHandle 是 'prompt'）——即使用户说先不运行也要完成连线",
    "用户未指定视频模型/参数时，默认创建 seedance20Video（Seedance 2.0），resolution 720P、aspectRatio 16:9",
    "textChat 输出 handle 是 text；textNote 输出 handle 是 text-right-out（一般不要用 textNote 做提示词源，用 textPrompt）",
    "视频节点输出统一为 video handle；生图输出统一为 img handle；第二层清单只列了型号名，参数走节点默认值，需要精细控制时优先用第一层节点",
    "视频生成两条路径：①【纯文本→视频】用支持文生的模型（sora2Video 等），只需建 textPrompt 连到 text 输入，一步到位；②【图生视频/高质量】先建图片生成节点(generatePro)+textPrompt+runNode 出关键帧图，再建视频节点(图生模式)+把图连进 image 输入。选图生视频模式却不给图会报错。",
    "seedance20Video 只支持路径②；纯文本任务默认走路径①的文生模型。",
    "音频：audioStudio 建节点必须在 data 指定 mode；tencent-dub 需连视频，其余连文本",
    "视频合成：videoCompose 的 video 输入单 handle 接多条——把多段视频输出都连进去；先各自生成视频再合成",
    "分镜编排：storyboardSplit 输入剧本文本、输出多个 promptN，每个 promptN 接一个生成节点，是多镜头 TVC 的编排入口",
    "图像处理链：analysis 需连图才能分析；imageGrid 连多图；imageSplit/imageGrid 输出可接后续生成",
  ],
};

// 小T「优选图片/优选视频」模型选项（用户偏好，随请求作为动态 note 注入，
// 优先级高于画布惯性——canvas_context 里已有其他生成节点时也不跟随）。
// nodeType 必须存在于上方 nodeSpecs；图片的 extra 是 generatePro 的 modelProvider 值。
export interface XiaotPreferredModelOption {
  value: string;
  label: string;
  short: string;
  nodeType: string;
  extra?: string;
  // 视频专属：该节点默认模式能否无图纯文生（现场核实各 Node 默认模式的 visibleHandles）
  textToVideo?: boolean;
  // textToVideo=false 时，纯文本场景回退到的文生节点 type
  textFallback?: string;
}

export const XIAOT_PREFERRED_IMAGE_MODELS = [
  { value: "banana-fast", label: "Nano Banana Fast", short: "Fast", nodeType: "generatePro", extra: "banana-2.5" },
  { value: "banana-pro", label: "Nano Banana Pro", short: "Pro", nodeType: "generatePro", extra: "banana" },
  { value: "banana-ultra", label: "Nano Banana2 Ultra", short: "Ultra", nodeType: "generatePro", extra: "banana-3.1" },
  { value: "seedream5", label: "Seedream", short: "Seedream", nodeType: "seedream5", extra: undefined },
  { value: "gptImage2", label: "GPT Image", short: "GPT", nodeType: "gptImage2", extra: undefined },
] as const;
export type XiaotPreferredImageModel =
  (typeof XIAOT_PREFERRED_IMAGE_MODELS)[number]["value"];

export const XIAOT_PREFERRED_VIDEO_MODELS = [
  // textToVideo 现场核实：seedance20Video/wan27Video 默认模式需≥1图(false)，
  // sora2Video/kling26Video/viduQ3 默认模式可纯文生(true)；false 者纯文本回退 sora2Video
  { value: "seedance20Video", label: "Seedance 2.0", short: "SD2", nodeType: "seedance20Video", textToVideo: false, textFallback: "sora2Video" },
  { value: "kling26Video", label: "可灵2.6", short: "可灵2.6", nodeType: "kling26Video", textToVideo: true },
  { value: "sora2Video", label: "Sora 2", short: "Sora2", nodeType: "sora2Video", textToVideo: true },
  { value: "wan27Video", label: "Wan 2.7", short: "Wan2.7", nodeType: "wan27Video", textToVideo: false, textFallback: "sora2Video" },
  { value: "viduQ3", label: "Vidu Q3", short: "ViduQ3", nodeType: "viduQ3", textToVideo: true },
] as const;
export type XiaotPreferredVideoModel =
  (typeof XIAOT_PREFERRED_VIDEO_MODELS)[number]["value"];

// 画布已知的视频生成节点类型全集（与 nodeSpecs 第一/二层的视频节点对齐）
export const VIDEO_NODE_TYPES = new Set([
  "sora2Video",
  "seedance20Video",
  "kling26Video",
  "wan27Video",
  "klingVideo",
  "kling30Video",
  "viduVideo",
  "viduQ3",
  "doubaoVideo",
  "seedVideo",
  "wan26",
  "wan2R2V",
  "happyhorseR2V",
  "omniFlashExtVideo",
  "klingO1Video",
]);

// 用户消息是否显式提到某个视频模型（泛泛说"视频"不算）。
// 显式点名时尊重用户选择，不做优选改写。
const VIDEO_MODEL_MENTION_RE =
  /可灵|kling|sora|wan\s*2|vidu|doubao|即梦|seedance|seed\s*[12]|happyhorse|omni\s*flash|1\.5|2\.6|3\.0/i;

export function mentionsVideoModel(text: string): boolean {
  return VIDEO_MODEL_MENTION_RE.test(text);
}

// 用户是否明确要求"先出参考图/高质量/基于图"的图生视频编排（走路径②）。
// 命中则不强改视频节点类型，保留小T的 seedance2.0 图生流程编排。
const VIDEO_IMAGE_WORKFLOW_RE =
  /参考图|先出图|先生成图|关键帧|首帧|高质量|电影级|基于.*图|图生视频|imagetovideo|image.to.video/i;

export function detectVideoImageWorkflow(text: string): boolean {
  return VIDEO_IMAGE_WORKFLOW_RE.test(text);
}

// 用户显式点名的视频模型 → nodeType（没点名返 null）。点名=最高优先级，
// 强制对齐（压过小T选择与优选偏好，防止小T建错版本，如说 seedance-2 却建
// doubaoVideo/1.5-Pro）。注意 seedance-2 与 seedance-1.5 都含"seedance"，
// 必须先判 1.5 再判 2 做互斥区分。规则按数组顺序短路。
const REQUESTED_VIDEO_MODEL_RULES: Array<[RegExp, string]> = [
  // seedance / 即梦 1.5（含 1.5-pro）→ doubaoVideo（先判，避免被 2 规则误吞）
  [/seedance[\s\-]?1\.?5|即梦[\s\-]?1\.?5|1\.5[\s\-]?pro/i, "doubaoVideo"],
  // seedance / 即梦 2.0 → seedance20Video
  [/seedance[\s\-]?2(\.0)?|即梦[\s\-]?2|seedance20/i, "seedance20Video"],
  // 可灵 / kling 2.6 → kling26Video（先于泛 kling3 之外的规则）
  [/可灵[\s\-]?2\.?6|kling[\s\-]?2\.?6|kling26/i, "kling26Video"],
  // 可灵 / kling 3 → kling30Video
  [/可灵[\s\-]?3|kling[\s\-]?3|kling30/i, "kling30Video"],
  // wan / 万相 2.7 → wan27Video
  [/wan[\s\-]?2\.?7|万相[\s\-]?2\.?7/i, "wan27Video"],
  // vidu(q3) → viduQ3
  [/vidu[\s\-]?q?3|vidu/i, "viduQ3"],
  // sora(2) → sora2Video
  [/sora[\s\-]?2?/i, "sora2Video"],
];

export function detectRequestedVideoModel(text: string): string | null {
  for (const [re, nodeType] of REQUESTED_VIDEO_MODEL_RULES) {
    if (re.test(text)) return nodeType;
  }
  return null;
}

// 视频 nodeType → 展示名（toast 用；覆盖 detect 可能返回的全部类型）
const VIDEO_TYPE_LABELS: Record<string, string> = {
  seedance20Video: "Seedance 2.0",
  doubaoVideo: "Seedance 1.5 Pro",
  kling26Video: "可灵2.6",
  kling30Video: "可灵3.0",
  sora2Video: "Sora 2",
  wan27Video: "Wan 2.7",
  viduQ3: "Vidu Q3",
};

export function getVideoModelLabel(nodeType: string): string {
  return VIDEO_TYPE_LABELS[nodeType] ?? nodeType;
}

// agent 建这些 type 时强制注入版本/模式 data（applier 查表覆盖，防小T给错版本）。
// seedance 系列被画布归一到 doubaoVideo 节点，版本靠 data.seedanceModel 区分
// （不注入默认 seedance-1.5-pro → 建成 1.5）；first_frame=首帧图驱动，2.0 四模式
// 里最通用的图生模式。midjourneyV7/niji7 共用 MidjourneyNode，靠 modelVersion 区分
// （niji7 不注入，保持 undefined 走 niji 引擎默认）。
// 注意：audioStudio 的 mode 不钉死（由小T按任务在 addNode 的 data 里指定）。
export const NODE_FORCED_DATA: Record<string, Record<string, string>> = {
  seedance20Video: { seedanceModel: "seedance-2.0", seedanceMode: "first_frame" },
  seedVideo: { seedanceModel: "seedance-2.0", seedanceMode: "first_frame" },
  doubaoVideo: { seedanceModel: "seedance-1.5-pro" },
  midjourneyV7: { modelVersion: "v7" },
};

// 纯图生视频节点类型：默认模式必须有≥1张图、无纯文生模式。缺图对账用。
// 现场核实：seedance20Video/wan27Video 默认模式需图；wan2R2V/happyhorseR2V
// 是参考图生视频（型号即图生）。
export const VIDEO_TYPES_REQUIRE_IMAGE = new Set([
  "seedance20Video",
  "wan27Video",
  "wan2R2V",
  "happyhorseR2V",
]);

// 确定性兜底：manifest 的优选 note 只是提示级约束（大 manifest+画布惯性下
// 小T仍可能跟随画布已有节点选别的视频模型）。addNode 落画布前把非优选的
// 视频节点类型改写为优选类型；data 只保留通用白名单键，厂商专属参数丢弃
// 防污染。改写只影响本地落画布不回传小T：小T后续 connectEdge/runNode 用的
// 是它自造的 agent id，idMap 以 agent id 为键（node.id 不变），不受 type
// 改写影响。
const VIDEO_REWRITE_DATA_WHITELIST = [
  "label",
  "aspectRatio",
  "resolution",
  "clipDuration",
] as const;

export function rewritePatchForPreferredVideo(
  patch: AgentFlowPatch,
  preferredType: string
): AgentFlowPatch {
  if (patch.op !== "addNode") return patch;
  const node = patch.node;
  if (
    !node ||
    !VIDEO_NODE_TYPES.has(node.type) ||
    node.type === preferredType
  ) {
    return patch;
  }
  const data = (
    node.data && typeof node.data === "object" ? node.data : {}
  ) as Record<string, unknown>;
  const keptData: Record<string, unknown> = {};
  for (const key of VIDEO_REWRITE_DATA_WHITELIST) {
    if (data[key] !== undefined) keptData[key] = data[key];
  }
  return {
    ...patch,
    node: { ...node, type: preferredType, data: keptData },
  };
}

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
