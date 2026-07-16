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
  // 四宫格输出 handle 是 img1..img4（非 "img"），不给 imageOut：强制小T按
  // manifest outputs 显式给 sourceHandle，避免缺省补成无效的 "img" 静默失败
  generate4: { textIn: "text", imageIn: "img" },
  generatePro: { textIn: "text", imageOut: "img", imageIn: "img" },
  generatePro4: { textIn: "text", imageIn: "img" },
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
      purpose: "首选生图节点：提示词由 textPrompt 节点承载（连 text 输入）；可联网",
      params: {
        modelProvider: { type: "string", enum: ["banana-2.5", "banana", "banana-3.1"], description: "Fast/Pro/Ultra 三档" },
        enableWebSearch: { type: "boolean" },
      },
      inputs: [{ handle: "text" }, { handle: "img", accepts: "image" }],
      outputs: [{ handle: "img", emits: "image" }],
    },
    {
      type: "generatePro4",
      label: "Agent图像生成(Pro)四宫格",
      purpose: "同 generatePro 但一次出四张图（提示词同样由 textPrompt 承载）",
      params: {
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
    "所有生成类节点（含 generatePro/Pro4、全部视频节点）的提示词一律由 textPrompt 节点承载：创建生成节点时必须同步创建 textPrompt（data.text 写提示词）并 connectEdge {sourceHandle:'text', targetHandle:'text'}（seedream5 的 targetHandle 是 'prompt'）——即使用户说先不运行也要完成连线；不要把提示词写进生成节点 data（宿主会强制抽出改为 textPrompt 承载）；后续改提示词用 updateNodeData 改对应 textPrompt 节点的 data.text，而非改生成节点",
    "用户未指定视频模型/参数时，默认创建 seedance20Video（Seedance 2.0），resolution 720P、aspectRatio 16:9",
    "textChat 输出 handle 是 text；textNote 输出 handle 是 text-right-out（一般不要用 textNote 做提示词源，用 textPrompt）",
    "视频节点输出统一为 video handle；生图输出统一为 img handle；第二层清单只列了型号名，参数走节点默认值，需要精细控制时优先用第一层节点",
    "视频生成两条路径：①【纯文本→视频】用支持文生的模型（sora2Video 等），只需建 textPrompt 连到 text 输入，一步到位；②【图生视频/高质量】先建图片生成节点(generatePro)+textPrompt+runNode 出关键帧图，再建视频节点(图生模式)+把图连进 image 输入。选图生视频模式却不给图会报错。",
    "seedance20Video 只支持路径②；纯文本任务默认走路径①的文生模型。",
    "音频：audioStudio 建节点必须在 data 指定 mode；tencent-dub 需连视频，其余连文本",
    "视频合成：videoCompose 的 video 输入单 handle 接多条——把多段视频输出都连进去；先各自生成视频再合成",
    "分镜编排：storyboardSplit 输入剧本文本、输出多个 promptN，每个 promptN 接一个生成节点，是多镜头 TVC 的编排入口",
    "图像处理链：analysis 需连图才能分析；imageGrid 连多图；imageSplit/imageGrid 输出可接后续生成",
    "视频时长：用户说的时长（如15s）建节点时设到 clipDuration（wan 系是 duration）；单条上限 Seedance/Wan 15秒、可灵约10秒、Sora2 最长25秒、ViduQ3 约16秒，超上限需用 storyboardSplit 分多镜头再 videoCompose 合成",
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
  /可灵|kling|sora|wan|万相|vidu|doubao|即梦|seedance|seed\s*[12]|happyhorse|omni\s*flash|1\.5|2\.6|3\.0/i;

export function mentionsVideoModel(text: string): boolean {
  return VIDEO_MODEL_MENTION_RE.test(text);
}

// 用户是否明确要求"先出参考图/基于图"的图生视频编排（走路径②）。命中则不强改
// 视频节点类型，保留小T的 seedance2.0 图生流程编排。
// 注意：只保留真图生工作流词，不含"高质量/电影级"——它们是通用形容词、无图生
// 意图（"给我高质量的视频"应能走纯文本回退，不该被抑制到缺图 seedance）。
const VIDEO_IMAGE_WORKFLOW_RE =
  /参考图|先出图|先生成图|关键帧|首帧|基于.*图|图生视频|imagetovideo|image.to.video/i;

export function detectVideoImageWorkflow(text: string): boolean {
  return VIDEO_IMAGE_WORKFLOW_RE.test(text);
}

// 从用户消息提取视频时长秒数（如 15s/15秒/15 秒/时长15/15-second）。
// 要求后缀 s/秒/second，故不会误伤分辨率数字（720p/1080P 不含该后缀）。
// 取第一个合理值（1-60 秒），越界返 null。
export function detectVideoDuration(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*(?:s\b|秒|-?second)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 60) return n;
  }
  return null;
}

// 各视频模型单条时长上限（秒）。注入时 clamp：min(detected, 上限 ?? 15)。
// 核实自各 Node 时长选择器上限（GenericVideoNode getDurationOptions）：
// seedance2.0/seed=15、doubao(1.5-pro默认)=12、sora2=25、kling系=10、
// wan27=15、viduQ3=16。查不准的 stub 给保守值。
export const VIDEO_MAX_DURATION: Record<string, number> = {
  seedance20Video: 15,
  seedVideo: 15,
  doubaoVideo: 12,
  sora2Video: 25,
  kling26Video: 10,
  klingVideo: 10,
  kling30Video: 10,
  klingO1Video: 10,
  wan27Video: 15,
  wan26: 15,
  viduQ3: 16,
  viduVideo: 8,
};

// 各视频模型承载时长的 data 字段名：仅 Wan27 是标准节点用 duration，其余
// (Seedance/Doubao/Seed/Kling/Vidu 都走 GenericVideoNode) 用 clipDuration。缺省 clipDuration。
export const VIDEO_DURATION_FIELD: Record<string, string> = {
  wan27Video: "duration",
};

export function videoDurationField(nodeType: string): string {
  return VIDEO_DURATION_FIELD[nodeType] ?? "clipDuration";
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

// 硬覆盖：版本/显示名钉死（防小T给错版本、防共用组件标题误导），覆盖 agent 给的 data。
// seedance 系列被画布归一到 doubaoVideo 节点，版本靠 data.seedanceModel 区分
// （不注入默认 seedance-1.5-pro → 建成 1.5）。midjourneyV7/niji7 共用 MidjourneyNode，
// 靠 modelVersion 区分（niji7 不注入，保持 undefined 走 niji 引擎默认；标题按 type 自判无需注入）。
// nodeConfigNameZh/En：共用组件节点缺省会显示错/笼统的标题（gptImage2 共用 Nano2Node
// 默认显示"Nano2"；seedance20Video/doubaoVideo 共用 GenericVideoNode 都显示笼统"Seedance"），
// 注入正确显示名。model 判定另有依据（gptImage2 靠 nodeConfigKey/type，seedance 靠 seedanceModel），
// 标题注入不影响模型。
export const NODE_FORCED_DATA: Record<string, Record<string, string>> = {
  seedance20Video: {
    seedanceModel: "seedance-2.0",
    nodeConfigNameZh: "Seedance 2.0",
    nodeConfigNameEn: "Seedance 2.0",
  },
  seedVideo: { seedanceModel: "seedance-2.0" },
  doubaoVideo: {
    seedanceModel: "seedance-1.5-pro",
    nodeConfigNameZh: "Seedance 1.5 Pro",
    nodeConfigNameEn: "Seedance 1.5 Pro",
  },
  midjourneyV7: { modelVersion: "v7" },
  gptImage2: { nodeConfigNameZh: "GPT Image", nodeConfigNameEn: "GPT Image" },
};

// 缺省填充：仅当 node.data 没有该键时填（agent 给了就用 agent 的，保留用户意图）。
// seedanceMode 不能硬钉：用户说"seedance2.0 首尾帧"时小T会给 start_end，硬覆盖
// 成 first_frame 会丢意图；缺 mode 时才填 first_frame（最通用图生模式）。
// 注意：audioStudio 的 mode 也由小T按任务在 data 指定，不放缺省。
export const NODE_DEFAULT_DATA: Record<string, Record<string, string>> = {
  seedance20Video: { seedanceMode: "first_frame" },
  seedVideo: { seedanceMode: "first_frame" },
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

// 生成节点 data 里可能携带的内联提示词键（小T旧习惯/改写残留）。这些键
// 生成节点自身并不消费（generatePro 系历史上消费 prompts，现统一外置；
// gptImage2/视频节点从来只认外接 text 边），一律抽出改为 textPrompt 承载。
// presetPrompt 是 generate/nano2 的真实前缀字段，不在此列。
export const INLINE_PROMPT_KEYS = ["prompts", "prompt", "text"] as const;

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
  "duration", // wan 系时长字段，改写时保留
  // 保留用户的 seedance 模式意图（首尾帧/智能帧等）；对齐后 applier 缺省填充
  // 只在此键缺失时才补 first_frame，故保留它不会被误覆盖
  "seedanceMode",
  // 内联提示词键：改写时保留，随后由 externalizeInlinePrompt 抽出改为
  // textPrompt 节点承载（生成节点自身不消费这些键）
  ...INLINE_PROMPT_KEYS,
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

// ── 图片优选：与视频对称的确定性改写 ──
// 生图节点类型全集（imagePro 是承载/展示、非生成，不含）
export const IMAGE_GEN_NODE_TYPES = new Set([
  "generate",
  "generate4",
  "generatePro",
  "generatePro4",
  "generateRef",
  "nano2",
  "gptImage2",
  "seedream5",
  "midjourneyV7",
  "niji7",
]);

// 用户消息点名的图片模型 → nodeType（没点名返 null）。nano banana 家族统一
// 落 generatePro（档位由 modelProvider 区分，此处不细分）。
const REQUESTED_IMAGE_MODEL_RULES: Array<[RegExp, string]> = [
  [/nano\s*banana|banana/i, "generatePro"],
  [/midjourney/i, "midjourneyV7"],
  [/niji/i, "niji7"],
  [/seedream/i, "seedream5"],
  // 图片语境下 gpt 一律指 GPT Image（含"gpt生图"裸 gpt，match 用户点名意图）
  [/gpt/i, "gptImage2"],
];

export function detectRequestedImageModel(text: string): string | null {
  for (const [re, nodeType] of REQUESTED_IMAGE_MODEL_RULES) {
    if (re.test(text)) return nodeType;
  }
  return null;
}

// data 白名单：改写图片节点时只保留通用键，厂商专属参数丢弃防污染。
// 内联提示词键保留，随后由 externalizeInlinePrompt 抽出改为 textPrompt 承载
// （否则 generatePro→gptImage2 改写会静默丢提示词，节点报「缺少提示词输入」）。
const IMAGE_REWRITE_DATA_WHITELIST = [
  "label",
  "aspectRatio",
  "presetPrompt",
  ...INLINE_PROMPT_KEYS,
] as const;

// 把 addNode 的图片生成节点强制改写成 targetType（用户优选/点名）。
// generatePro 系（generatePro/generatePro4）且给了 modelProvider 则写入 data.modelProvider
// （banana 档位 Fast/Pro/Ultra）。非生图节点/同类型/非 addNode 原样返回。
const GENERATE_PRO_TYPES = new Set(["generatePro", "generatePro4"]);
export function rewritePatchToImageType(
  patch: AgentFlowPatch,
  targetType: string,
  modelProvider?: string
): AgentFlowPatch {
  if (patch.op !== "addNode") return patch;
  const node = patch.node;
  if (
    !node ||
    !IMAGE_GEN_NODE_TYPES.has(node.type) ||
    node.type === targetType
  ) {
    return patch;
  }
  const data = (
    node.data && typeof node.data === "object" ? node.data : {}
  ) as Record<string, unknown>;
  const keptData: Record<string, unknown> = {};
  for (const key of IMAGE_REWRITE_DATA_WHITELIST) {
    if (data[key] !== undefined) keptData[key] = data[key];
  }
  if (modelProvider && GENERATE_PRO_TYPES.has(targetType)) {
    keptData.modelProvider = modelProvider;
  }
  return {
    ...patch,
    node: { ...node, type: targetType, data: keptData },
  };
}

// ── 提示词强制外置（确定性根治）──
// 所有图/视频生成节点的提示词一律由 textPrompt 节点承载：addNode 落画布前，
// 把 data 里的内联提示词（INLINE_PROMPT_KEYS）抽出，展开成
// [textPrompt addNode, 剥离后的生成节点 addNode, connectEdge] 三个 patch。
// 动机：①优选改写（如 generatePro4→gptImage2）后目标节点不消费 data.prompts，
// 提示词静默丢失、节点报「缺少提示词输入」；②统一画布形态——提示词永远
// 可见可编辑地挂在节点旁。运行语义不变：generatePro 系运行时本地 prompts
// 与外接提示词本就 join 合并（FlowOverlay handleGenerate）。
// 无内联提示词/非生成节点原样返回单元素数组。
export function externalizeInlinePrompt(patch: AgentFlowPatch): AgentFlowPatch[] {
  if (patch.op !== "addNode" || !patch.node) return [patch];
  const node = patch.node;
  if (!IMAGE_GEN_NODE_TYPES.has(node.type) && !VIDEO_NODE_TYPES.has(node.type)) {
    return [patch];
  }
  const data = (
    node.data && typeof node.data === "object" ? node.data : {}
  ) as Record<string, unknown>;
  const pieces: string[] = [];
  if (Array.isArray(data.prompts)) {
    for (const p of data.prompts) {
      if (typeof p === "string" && p.trim()) pieces.push(p.trim());
    }
  }
  for (const key of ["prompt", "text"] as const) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) pieces.push(v.trim());
  }
  if (pieces.length === 0) return [patch];
  const strippedData: Record<string, unknown> = { ...data };
  for (const key of INLINE_PROMPT_KEYS) delete strippedData[key];
  // 合成 textPrompt：id 挂在生成节点 agent id 下（idMap 登记后 connectEdge 可解析）；
  // 生成节点给了 position 时放到其左侧，否则交给宿主自动排布
  const promptId = `${node.id}__prompt`;
  const promptNode: AgentFlowPatch = {
    op: "addNode",
    node: {
      id: promptId,
      type: "textPrompt",
      data: { text: pieces.join("\n\n") },
      ...(node.position
        ? { position: { x: node.position.x - 360, y: node.position.y } }
        : {}),
    },
  };
  const edge: AgentFlowPatch = {
    op: "connectEdge",
    source: promptId,
    target: node.id,
    sourceHandle: "text",
    targetHandle: DEFAULT_NODE_HANDLES[node.type]?.textIn ?? "text",
  };
  return [promptNode, { ...patch, node: { ...node, data: strippedData } }, edge];
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
