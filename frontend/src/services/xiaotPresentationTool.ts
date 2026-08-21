import { DEFAULT_NODE_HANDLES } from "./agentCanvasProtocol.ts";
import {
  createHtmlPptSlide,
  type HtmlPptDeck,
  type HtmlPptSlideTemplateKey,
} from "../utils/htmlPptDeck.ts";
import {
  getHtmlPptStylePreset,
  type HtmlPptStylePresetKey,
} from "../utils/htmlPptStylePresets.ts";
import {
  getHtmlPptBoldTemplate,
  type HtmlPptBoldTemplateSlug,
} from "../utils/htmlPptBoldTemplates.ts";
import { FLOW_AUTO_LAYOUT_EVENT } from "../utils/canvasAutoLayout.ts";

const MAX_SLIDES = 24;
const MAX_IMAGE_INPUTS = 6;
const MAX_TEXT_INPUTS = 1;

export type XiaotPresentationStyle =
  | "tanva"
  | "architectural"
  | "editorial"
  | "professional"
  | "bold";

export type XiaotPresentationScope = "slide" | "deck";

export type FlowSnapshot = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

export type CreatePresentationArguments = {
  title?: unknown;
  instruction?: unknown;
  audience?: unknown;
  purpose?: unknown;
  slideCount?: unknown;
  aspectRatio?: unknown;
  style?: unknown;
  outline?: unknown;
  assetNodeIds?: unknown;
  autoRun?: unknown;
};

export type EditPresentationArguments = {
  nodeId?: unknown;
  instruction?: unknown;
  scope?: unknown;
  slideId?: unknown;
  assetNodeIds?: unknown;
  autoRun?: unknown;
};

export type NormalizedCreatePresentation = {
  title: string;
  instruction: string;
  audience: string;
  purpose: string;
  slideCount: number;
  aspectRatio: "16:9" | "4:3";
  style: XiaotPresentationStyle;
  outline: string[];
  assetNodeIds: string[];
  autoRun: boolean;
  architectureMode: boolean;
};

export type XiaotPresentationResult = {
  nodeId: string;
  title: string;
  slideCount: number;
  aspectRatio: "16:9" | "4:3";
  status: "ready" | "succeeded";
  connectedImageCount: number;
  connectedTextCount: number;
  deck: HtmlPptDeck;
};

const readString = (value: unknown, maxLength: number): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const readStringList = (
  value: unknown,
  maxItems: number,
  maxItemLength: number
): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => readString(item, maxItemLength))
        .filter(Boolean)
        .slice(0, maxItems)
    )
  );
};

const normalizeSlideCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(3, Math.min(MAX_SLIDES, Math.round(parsed)));
};

const normalizeStyle = (value: unknown): XiaotPresentationStyle => {
  const style = readString(value, 32).toLowerCase();
  return style === "architectural" ||
    style === "editorial" ||
    style === "professional" ||
    style === "bold"
    ? style
    : "tanva";
};

const ARCHITECTURE_RE =
  /建筑|室内|景观|城市|规划|空间|体量|平面图|剖面图|立面图|总平面|architecture|architectural|interior|landscape|urban|massing|floor plan|section|elevation/i;

export function normalizeCreatePresentationArguments(
  raw: CreatePresentationArguments,
  fallbackPrompt: string
): NormalizedCreatePresentation {
  const instruction = readString(raw.instruction, 8000) || readString(fallbackPrompt, 8000);
  const title = readString(raw.title, 120) || "Tanva Presentation";
  const audience = readString(raw.audience, 300);
  const purpose = readString(raw.purpose, 500);
  const style = normalizeStyle(raw.style);
  const combined = [title, instruction, audience, purpose].join("\n");
  return {
    title,
    instruction,
    audience,
    purpose,
    slideCount: normalizeSlideCount(raw.slideCount),
    aspectRatio: raw.aspectRatio === "4:3" ? "4:3" : "16:9",
    style,
    outline: readStringList(raw.outline, MAX_SLIDES, 160),
    assetNodeIds: readStringList(raw.assetNodeIds, 12, 160),
    autoRun: raw.autoRun !== false,
    architectureMode: style === "architectural" || ARCHITECTURE_RE.test(combined),
  };
}

const slideTemplateForIndex = (
  index: number,
  total: number
): HtmlPptSlideTemplateKey => {
  if (index === 0) return "cover";
  if (index === 1 && total >= 6) return "agenda";
  if (index === total - 1) return "closing";
  if (index === Math.max(2, total - 3) && total >= 7) return "compare";
  if (index === Math.max(3, total - 2) && total >= 8) return "metrics";
  return "content";
};

const resolveStyle = (style: XiaotPresentationStyle): {
  themeCss: string;
  stylePresetKey?: HtmlPptStylePresetKey;
  boldTemplateSlug?: HtmlPptBoldTemplateSlug;
} => {
  if (style === "professional") {
    const template = getHtmlPptBoldTemplate("blue-professional");
    return { themeCss: template.themeCss, boldTemplateSlug: template.slug };
  }
  if (style === "bold") {
    const template = getHtmlPptBoldTemplate("bold-poster");
    return { themeCss: template.themeCss, boldTemplateSlug: template.slug };
  }
  const presetKey: HtmlPptStylePresetKey =
    style === "editorial" ? "editorial_studio" : "tanva_studio";
  const preset = getHtmlPptStylePreset(presetKey);
  return { themeCss: preset.themeCss, stylePresetKey: preset.key };
};

export function buildPresentationDeck(
  request: NormalizedCreatePresentation
): HtmlPptDeck {
  const style = resolveStyle(request.style);
  const slides = Array.from({ length: request.slideCount }, (_, index) => {
    const slide = createHtmlPptSlide(
      index + 1,
      slideTemplateForIndex(index, request.slideCount)
    );
    const outlineTitle = request.outline[index];
    return outlineTitle ? { ...slide, title: outlineTitle } : slide;
  });
  return {
    version: 1,
    aspectRatio: request.aspectRatio,
    themeCss: style.themeCss,
    slides,
  };
}

export function buildPresentationInstruction(
  request: NormalizedCreatePresentation
): string {
  const sections = [
    request.instruction,
    request.audience ? `目标受众：${request.audience}` : "",
    request.purpose ? `演示目标：${request.purpose}` : "",
    `页数：严格控制为 ${request.slideCount} 页；画幅：${request.aspectRatio}。`,
    request.outline.length
      ? `用户要求的页面顺序：\n${request.outline
          .map((item, index) => `${index + 1}. ${item}`)
          .join("\n")}`
      : "请先建立累积推进的叙事结构，再完成每页内容。",
    "每页只承担一个叙事任务，标题直接表达结论；优先使用大图、图纸和关键证据，减少低价值文字与组件化卡片堆叠。封面保持克制，结尾必须回应开场并给出明确结论或下一步。",
    "连接到本节点的远程图片都是可用素材：先理解其内容与构图，再分配到最合适的页面；不要只描述图片或生成占位框。",
    request.architectureMode
      ? "建筑/空间设计约束：用户提供的图纸、面积、法规和工程指标是唯一权威；不得虚构容积率、面积、结构、造价、日照或报批结论。AI 生成或无法验证的视觉必须按‘概念示意’表达，不得冒充施工图。优先采用建筑事务所式网格、图纸证据、体量演变、功能/流线/气候策略与材料逻辑。"
      : "",
  ];
  return sections.filter(Boolean).join("\n\n").slice(0, 12000);
}

export async function requestFlowSnapshot(
  timeoutMs = 1000,
  options: { includePresentationDecks?: boolean } = {}
): Promise<FlowSnapshot> {
  if (typeof window === "undefined") return { nodes: [], edges: [] };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (snapshot: FlowSnapshot) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("flow:nodes-snapshot", handler);
      resolve(snapshot);
    };
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Partial<FlowSnapshot>>).detail;
      finish({
        nodes: Array.isArray(detail?.nodes) ? detail.nodes : [],
        edges: Array.isArray(detail?.edges) ? detail.edges : [],
      });
    };
    const timer = window.setTimeout(() => finish({ nodes: [], edges: [] }), timeoutMs);
    window.addEventListener("flow:nodes-snapshot", handler);
    window.dispatchEvent(
      new CustomEvent("flow:request-nodes-snapshot", { detail: options })
    );
  });
}

const presentationDeckFromNode = (
  node: Record<string, unknown> | undefined,
  fallback: HtmlPptDeck
): HtmlPptDeck => {
  const value = node?.deck;
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<HtmlPptDeck>;
  if (!Array.isArray(candidate.slides) || candidate.slides.length === 0) return fallback;
  return {
    version: 1,
    aspectRatio: candidate.aspectRatio === "4:3" ? "4:3" : "16:9",
    themeCss: typeof candidate.themeCss === "string" ? candidate.themeCss : fallback.themeCss,
    slides: candidate.slides,
  };
};

const waitForFlowPaint = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      window.setTimeout(resolve, 80);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const addFlowNode = async (
  type: string,
  data: Record<string, unknown>
): Promise<string> => {
  const nodeId = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`创建 ${type} 节点超时。`)),
      5000
    );
    window.dispatchEvent(
      new CustomEvent("flow:agent-add-node", {
        detail: {
          type,
          data,
          done: (createdId: string | null) => {
            window.clearTimeout(timer);
            if (createdId) resolve(createdId);
            else reject(new Error(`节点类型不可用：${type}`));
          },
        },
      })
    );
  });
  await waitForFlowPaint();
  return nodeId;
};

const connectFlowNodes = async (options: {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: "text" | "img";
}): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`素材连线超时：${options.source} → ${options.target}`)),
      6000
    );
    window.dispatchEvent(
      new CustomEvent("flow:agent-connect-edge", {
        detail: {
          ...options,
          done: (result?: { ok: boolean; error?: string }) => {
            window.clearTimeout(timer);
            if (result?.ok) resolve();
            else reject(new Error(result?.error || "素材连线失败。"));
          },
        },
      })
    );
  });
};

const runPresentationNode = async (nodeId: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("PPT 生成超时，请在节点内继续运行。")),
      5 * 60 * 1000
    );
    window.dispatchEvent(
      new CustomEvent("flow:run-node", {
        detail: {
          id: nodeId,
          done: (ok?: boolean, error?: string) => {
            window.clearTimeout(timer);
            if (ok) resolve();
            else reject(new Error(error || "PPT 节点生成失败。"));
          },
        },
      })
    );
  });
};

const isTextNode = (node: Record<string, unknown>): boolean => {
  const type = String(node.type || "");
  const handles = DEFAULT_NODE_HANDLES[type];
  return Boolean(handles?.textOut) || type === "textPrompt" || type === "textChat";
};

const isImageNode = (node: Record<string, unknown>): boolean => {
  const type = String(node.type || "");
  const handles = DEFAULT_NODE_HANDLES[type];
  return Boolean(handles?.imageOut) ||
    [
      "image",
      "imagePro",
      "generate",
      "generate4",
      "generatePro",
      "generatePro4",
      "generateRef",
      "imageGrid",
      "imageSplit",
      "midjourneyV7",
      "niji7",
      "nano2",
      "gptImage2",
      "seedream5",
    ].includes(type);
};

const sourceHandleForNode = (
  node: Record<string, unknown>,
  kind: "text" | "image"
): string => {
  const type = String(node.type || "");
  const handles = DEFAULT_NODE_HANDLES[type];
  if (kind === "text") return handles?.textOut || (type === "textNote" ? "text-right-out" : "text");
  if (handles?.imageOut) return handles.imageOut;
  if (type === "generate4" || type === "generatePro4") return "img1";
  if (type === "imageSplit") return "image1";
  return "img";
};

const selectAssetNodes = (
  snapshot: FlowSnapshot,
  requestedIds: string[]
): Record<string, unknown>[] => {
  const requested = new Set(requestedIds);
  const selected = snapshot.nodes.filter((node) => node.selected === true);
  const candidates = requested.size
    ? snapshot.nodes.filter((node) => requested.has(String(node.id || "")))
    : selected;
  return Array.from(
    new Map(candidates.map((node) => [String(node.id || ""), node])).values()
  ).filter((node) => String(node.id || ""));
};

const connectPresentationAssets = async (options: {
  targetNodeId: string;
  snapshot: FlowSnapshot;
  assetNodeIds: string[];
  attachmentUrls?: string[];
}): Promise<{ connectedImageCount: number; connectedTextCount: number }> => {
  const candidateNodes = selectAssetNodes(options.snapshot, options.assetNodeIds);
  const candidateImageNodes = candidateNodes
    .filter(isImageNode)
    .slice(0, MAX_IMAGE_INPUTS);
  const attachmentNodes: Record<string, unknown>[] = [];
  const remainingImageSlots = Math.max(
    0,
    MAX_IMAGE_INPUTS - candidateImageNodes.length
  );
  for (const [index, imageUrl] of Array.from(
    new Set(
      (options.attachmentUrls || []).filter((url) => /^https?:\/\//i.test(url))
    )
  )
    .slice(0, remainingImageSlots)
    .entries()) {
    const nodeId = await addFlowNode("image", {
      imageUrl,
      label: `PPT 素材 ${index + 1}`,
    });
    attachmentNodes.push({ id: nodeId, type: "image" });
  }

  const imageNodes = [...candidateImageNodes, ...attachmentNodes];
  const textNodes = candidateNodes.filter(isTextNode).slice(0, MAX_TEXT_INPUTS);

  const connectUnlessPresent = async (connection: {
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: "text" | "img";
  }) => {
    const alreadyConnected = options.snapshot.edges.some(
      (edge) =>
        String(edge.source || "") === connection.source &&
        String(edge.target || "") === connection.target &&
        String(edge.sourceHandle || "") === connection.sourceHandle &&
        String(edge.targetHandle || "") === connection.targetHandle
    );
    if (!alreadyConnected) await connectFlowNodes(connection);
  };

  for (const node of textNodes) {
    await connectUnlessPresent({
      source: String(node.id),
      target: options.targetNodeId,
      sourceHandle: sourceHandleForNode(node, "text"),
      targetHandle: "text",
    });
  }
  for (const node of imageNodes) {
    await connectUnlessPresent({
      source: String(node.id),
      target: options.targetNodeId,
      sourceHandle: sourceHandleForNode(node, "image"),
      targetHandle: "img",
    });
  }
  return {
    connectedImageCount: imageNodes.length,
    connectedTextCount: textNodes.length,
  };
};

const focusPresentation = (nodeId: string) => {
  window.dispatchEvent(new CustomEvent("flow:focus-node", { detail: { id: nodeId } }));
  window.dispatchEvent(
    new CustomEvent(FLOW_AUTO_LAYOUT_EVENT, {
      detail: { source: "xiaot-presentation", focusNodeId: nodeId },
    })
  );
};

export async function createPresentationFromXiaot(options: {
  args: CreatePresentationArguments;
  fallbackPrompt: string;
  snapshot: FlowSnapshot;
  attachmentUrls?: string[];
}): Promise<XiaotPresentationResult> {
  const request = normalizeCreatePresentationArguments(options.args, options.fallbackPrompt);
  const deck = buildPresentationDeck(request);
  const style = resolveStyle(request.style);
  const nodeId = await addFlowNode("htmlPpt", {
    title: request.title,
    status: "idle",
    deck,
    currentSlideId: deck.slides[0]?.id,
    promptDraft: buildPresentationInstruction(request),
    editScope: "deck",
    modelProvider: "banana-3.1",
    stylePresetKey: style.stylePresetKey,
    boldTemplateSlug: style.boldTemplateSlug,
    boxW: 980,
    boxH: 720,
  });
  const connected = await connectPresentationAssets({
    targetNodeId: nodeId,
    snapshot: options.snapshot,
    assetNodeIds: request.assetNodeIds,
    attachmentUrls: options.attachmentUrls,
  });
  if (request.autoRun) await runPresentationNode(nodeId);
  const refreshedSnapshot = await requestFlowSnapshot(1200, {
    includePresentationDecks: true,
  });
  const renderedDeck = presentationDeckFromNode(
    refreshedSnapshot.nodes.find((node) => String(node.id || "") === nodeId),
    deck
  );
  focusPresentation(nodeId);
  return {
    nodeId,
    title: request.title,
    slideCount: request.slideCount,
    aspectRatio: request.aspectRatio,
    status: request.autoRun ? "succeeded" : "ready",
    deck: renderedDeck,
    ...connected,
  };
}

export async function editPresentationFromXiaot(options: {
  args: EditPresentationArguments;
  fallbackPrompt: string;
  snapshot?: FlowSnapshot;
  attachmentUrls?: string[];
}): Promise<XiaotPresentationResult> {
  const snapshot = options.snapshot || (await requestFlowSnapshot());
  const requestedNodeId = readString(options.args.nodeId, 160);
  const target = requestedNodeId
    ? snapshot.nodes.find(
        (node) => String(node.id || "") === requestedNodeId && node.type === "htmlPpt"
      )
    : snapshot.nodes.find((node) => node.type === "htmlPpt" && node.selected === true) ||
      [...snapshot.nodes].reverse().find((node) => node.type === "htmlPpt");
  if (!target) throw new Error("没有找到可修改的 HTML PPT 节点，请先创建演示文稿。");

  const nodeId = String(target.id);
  const instruction =
    readString(options.args.instruction, 8000) || readString(options.fallbackPrompt, 8000);
  if (!instruction) throw new Error("请说明要如何修改演示文稿。");
  const scope: XiaotPresentationScope = options.args.scope === "slide" ? "slide" : "deck";
  const slideId = readString(options.args.slideId, 160);
  const assetNodeIds = readStringList(options.args.assetNodeIds, 12, 160);
  window.dispatchEvent(
    new CustomEvent("flow:updateNodeData", {
      detail: {
        id: nodeId,
        patch: {
          promptDraft: instruction,
          editScope: scope,
          ...(slideId ? { currentSlideId: slideId } : {}),
          status: "idle",
          error: undefined,
        },
      },
    })
  );
  await waitForFlowPaint();
  const connected = await connectPresentationAssets({
    targetNodeId: nodeId,
    snapshot,
    assetNodeIds,
    attachmentUrls: options.attachmentUrls,
  });
  const autoRun = options.args.autoRun !== false;
  if (autoRun) await runPresentationNode(nodeId);
  const refreshedSnapshot = await requestFlowSnapshot(1200, {
    includePresentationDecks: true,
  });
  const fallbackDeck = buildPresentationDeck(
    normalizeCreatePresentationArguments(
      {
        title: readString(target.title, 120) || "HTML PPT",
        slideCount: Math.max(3, Number(target.slideCount) || 3),
        aspectRatio: target.aspectRatio,
      },
      instruction
    )
  );
  const renderedDeck = presentationDeckFromNode(
    refreshedSnapshot.nodes.find((node) => String(node.id || "") === nodeId),
    fallbackDeck
  );
  focusPresentation(nodeId);

  return {
    nodeId,
    title: readString(target.title, 120) || "HTML PPT",
    slideCount: renderedDeck.slides.length,
    aspectRatio: renderedDeck.aspectRatio,
    status: autoRun ? "succeeded" : "ready",
    deck: renderedDeck,
    ...connected,
  };
}
