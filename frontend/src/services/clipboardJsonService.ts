/**
 * Clipboard JSON service for exporting/importing project content and AI chat sessions.
 * Keeps clipboard payloads aligned with Project.contentJson constraints.
 */
import paper from "paper";
import { paperSaveService } from "@/services/paperSaveService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useLayerStore } from "@/stores/layerStore";
import { useAIChatStore } from "@/stores/aiChatStore";
import {
  createEmptyProjectContent,
  type ProjectContentSnapshot,
  type ProjectAssetsSnapshot,
} from "@/types/project";
import type { SerializedConversationContext } from "@/types/context";
import {
  sanitizeProjectContentForCloudSave,
  getNonRemoteImageAssetIds,
} from "@/utils/projectContentValidation";
import { isPersistableImageRef, normalizePersistableImageRef } from "@/utils/imageSource";

type ClipboardJsonEnvelope<T> = {
  type: "tanva.projectContent" | "tanva.aiChatSessions";
  version: 1;
  payload: T;
};

type ChatSessionsPayload = {
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
};

type ImportSummary = {
  imported: {
    layers: number;
    images: number;
    models: number;
    texts: number;
    videos: number;
    flowNodes: number;
    flowEdges: number;
    chatSessions: number;
  };
};

const CLIPBOARD_VERSION = 1;

const createId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const ensureUniqueId = (
  existing: Set<string>,
  preferred: string | undefined | null,
  prefix: string
) => {
  const trimmed = typeof preferred === "string" ? preferred.trim() : "";
  if (trimmed && !existing.has(trimmed)) {
    existing.add(trimmed);
    return trimmed;
  }
  let next = "";
  do {
    next = createId(prefix);
  } while (existing.has(next));
  existing.add(next);
  return next;
};

const ensureUniqueName = (existing: Set<string>, preferred: string, fallback: string) => {
  const base = preferred?.trim() || fallback;
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }
  let index = 2;
  let next = `${base} ${index}`;
  while (existing.has(next)) {
    index += 1;
    next = `${base} ${index}`;
  }
  existing.add(next);
  return next;
};

const writeClipboardText = async (text: string) => {
  if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
};

const readClipboardText = async () => {
  if (typeof navigator !== "undefined" && navigator?.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error("当前环境不支持读取剪贴板");
};

const parseEnvelope = (rawText: string): ClipboardJsonEnvelope<any> | null => {
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
    if (
      (parsed.type === "tanva.projectContent" ||
        parsed.type === "tanva.aiChatSessions") &&
      typeof parsed.version === "number"
    ) {
      return parsed as ClipboardJsonEnvelope<any>;
    }
  }
  return null;
};

const toEnvelope = <T,>(type: ClipboardJsonEnvelope<T>["type"], payload: T) =>
  JSON.stringify({ type, version: CLIPBOARD_VERSION, payload }, null, 2);

const getPersistableAssetRef = (asset: {
  key?: string | null;
  url?: string | null;
  remoteUrl?: string | null;
  src?: string | null;
}) => {
  const candidates = [asset.key, asset.url, asset.remoteUrl, asset.src];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = normalizePersistableImageRef(candidate);
    if (normalized && isPersistableImageRef(normalized)) {
      return normalized;
    }
  }
  return undefined;
};

const buildPersistablePaperJson = (
  content: ProjectContentSnapshot
): string | null => {
  const images = content.assets?.images ?? [];
  const excludeImageIds = getNonRemoteImageAssetIds(content);
  const persistableMap = new Map<string, string>();
  images.forEach((img) => {
    if (!img?.id) return;
    const ref = getPersistableAssetRef(img);
    if (ref) persistableMap.set(img.id, ref);
  });

  return paperSaveService.serializePaperProjectForExport(
    excludeImageIds,
    persistableMap
  );
};

const getProjectContentSnapshot = (): ProjectContentSnapshot => {
  const store = useProjectContentStore.getState();
  return store.content ? { ...store.content } : createEmptyProjectContent();
};

const mergeChatSessions = (
  baseSessions: SerializedConversationContext[],
  incoming: SerializedConversationContext[],
  incomingActive: string | null
) => {
  const existingIds = new Set(baseSessions.map((s) => s.sessionId));
  const sessionIdMap = new Map<string, string>();
  const merged = [...baseSessions];

  incoming.forEach((session) => {
    const nextId = ensureUniqueId(existingIds, session.sessionId, "chat_session");
    sessionIdMap.set(session.sessionId, nextId);
    merged.push({ ...session, sessionId: nextId });
  });

  const active =
    incomingActive && sessionIdMap.has(incomingActive)
      ? sessionIdMap.get(incomingActive) ?? null
      : null;

  return { merged, active };
};

const mapLayerId = (layerIdMap: Map<string, string>, layerId?: string | null) => {
  if (!layerId || typeof layerId !== "string") return null;
  return layerIdMap.get(layerId) ?? null;
};

const updatePaperItemsForImport = (
  layers: paper.Layer[],
  maps: {
    layerIdMap: Map<string, string>;
    imageIdMap: Map<string, string>;
    modelIdMap: Map<string, string>;
    textIdMap: Map<string, string>;
    videoIdMap: Map<string, string>;
  }
) => {
  const walkItems = (items: paper.Item[]) => {
    items.forEach((item) => {
      const data = (item as any)?.data as Record<string, any> | undefined;
      if (data) {
        if (typeof data.layerId === "string" && maps.layerIdMap.has(data.layerId)) {
          data.layerId = maps.layerIdMap.get(data.layerId);
        }
        if (typeof data.imageId === "string" && maps.imageIdMap.has(data.imageId)) {
          data.imageId = maps.imageIdMap.get(data.imageId);
        }
        if (Array.isArray(data.imageIds)) {
          data.imageIds = data.imageIds.map((id: string) =>
            maps.imageIdMap.get(id) ?? id
          );
        }
        if (typeof data.modelId === "string" && maps.modelIdMap.has(data.modelId)) {
          data.modelId = maps.modelIdMap.get(data.modelId);
        }
        if (typeof data.textId === "string" && maps.textIdMap.has(data.textId)) {
          data.textId = maps.textIdMap.get(data.textId);
        }
        if (typeof data.videoId === "string" && maps.videoIdMap.has(data.videoId)) {
          data.videoId = maps.videoIdMap.get(data.videoId);
        }
      }

      const childItems = (item as any)?.children as paper.Item[] | undefined;
      if (childItems && childItems.length > 0) {
        walkItems(childItems);
      }
    });
  };

  layers.forEach((layer) => {
    try {
      const items = layer.getItems
        ? (layer.getItems({ recursive: true }) as paper.Item[])
        : (layer.children as paper.Item[]);
      if (Array.isArray(items)) {
        walkItems(items);
      }
    } catch (error) {
      console.warn("更新导入内容的 item data 失败:", error);
    }
  });
};

const mergeProjectContent = async (
  incoming: ProjectContentSnapshot
): Promise<ImportSummary> => {
  const projectStore = useProjectContentStore.getState();
  const layerStore = useLayerStore.getState();
  const chatStore = useAIChatStore.getState();

  if (!projectStore.projectId) {
    throw new Error("当前未打开项目，无法导入");
  }

  const base = getProjectContentSnapshot();
  const sanitizedIncoming =
    sanitizeProjectContentForCloudSave(incoming)?.sanitized ?? incoming;

  const existingLayerIds = new Set(base.layers.map((l) => l.id));
  const existingLayerNames = new Set(base.layers.map((l) => l.name));
  const layerIdMap = new Map<string, string>();
  const importedLayers: ProjectContentSnapshot["layers"] = [];

  const incomingLayers = Array.isArray(sanitizedIncoming.layers)
    ? sanitizedIncoming.layers
    : [];

  incomingLayers.forEach((layer) => {
    const newId = ensureUniqueId(existingLayerIds, layer.id, "layer");
    const newName = ensureUniqueName(existingLayerNames, layer.name, "导入图层");
    layerIdMap.set(layer.id, newId);
    importedLayers.push({ ...layer, id: newId, name: newName });
  });

  const ensureLayerMetaForPaper = (oldId: string, layer: paper.Layer) => {
    if (layerIdMap.has(oldId)) return layerIdMap.get(oldId)!;
    const newId = ensureUniqueId(existingLayerIds, oldId, "layer");
    const newName = ensureUniqueName(existingLayerNames, layer.name || "", "导入图层");
    layerIdMap.set(oldId, newId);
    importedLayers.push({
      id: newId,
      name: newName,
      visible: layer.visible !== false,
      locked: false,
    });
    return newId;
  };

  const baseAssets: ProjectAssetsSnapshot = base.assets ?? {
    images: [],
    models: [],
    texts: [],
    videos: [],
  };

  const imageIdMap = new Map<string, string>();
  const modelIdMap = new Map<string, string>();
  const textIdMap = new Map<string, string>();
  const videoIdMap = new Map<string, string>();

  const existingImageIds = new Set(baseAssets.images.map((item) => item.id));
  const existingModelIds = new Set(baseAssets.models.map((item) => item.id));
  const existingTextIds = new Set(baseAssets.texts.map((item) => item.id));
  const existingVideoIds = new Set(baseAssets.videos.map((item) => item.id));

  const importedImages = (sanitizedIncoming.assets?.images ?? []).map((item) => {
    const newId = ensureUniqueId(existingImageIds, item.id, "image");
    imageIdMap.set(item.id, newId);
    return {
      ...item,
      id: newId,
      layerId: mapLayerId(layerIdMap, item.layerId) ?? base.activeLayerId ?? null,
    };
  });

  const importedModels = (sanitizedIncoming.assets?.models ?? []).map((item) => {
    const newId = ensureUniqueId(existingModelIds, item.id, "model3d");
    modelIdMap.set(item.id, newId);
    return {
      ...item,
      id: newId,
      layerId: mapLayerId(layerIdMap, item.layerId) ?? base.activeLayerId ?? null,
    };
  });

  const importedTexts = (sanitizedIncoming.assets?.texts ?? []).map((item) => {
    const newId = ensureUniqueId(existingTextIds, item.id, "text");
    textIdMap.set(item.id, newId);
    return {
      ...item,
      id: newId,
      layerId: mapLayerId(layerIdMap, item.layerId) ?? base.activeLayerId ?? null,
    };
  });

  const importedVideos = (sanitizedIncoming.assets?.videos ?? []).map((item) => {
    const newId = ensureUniqueId(existingVideoIds, item.id, "video");
    videoIdMap.set(item.id, newId);
    return {
      ...item,
      id: newId,
      layerId: mapLayerId(layerIdMap, item.layerId) ?? base.activeLayerId ?? null,
    };
  });

  const baseFlow = base.flow ?? { nodes: [], edges: [] };
  const incomingFlow = sanitizedIncoming.flow ?? { nodes: [], edges: [] };

  const existingFlowNodeIds = new Set(baseFlow.nodes.map((node) => node.id));
  const existingFlowEdgeIds = new Set(baseFlow.edges.map((edge) => edge.id));
  const flowNodeIdMap = new Map<string, string>();

  const incomingFlowNodes = Array.isArray(incomingFlow.nodes) ? incomingFlow.nodes : [];
  const incomingFlowEdges = Array.isArray(incomingFlow.edges) ? incomingFlow.edges : [];

  const importedFlowNodes = incomingFlowNodes.map((node) => {
    const newId = ensureUniqueId(existingFlowNodeIds, node.id, "flow_node");
    flowNodeIdMap.set(node.id, newId);
    return { ...node, id: newId };
  });

  const importedFlowEdges = incomingFlowEdges.map((edge) => {
    const newId = ensureUniqueId(existingFlowEdgeIds, edge.id, "flow_edge");
    const newSource = flowNodeIdMap.get(edge.source) ?? edge.source;
    const newTarget = flowNodeIdMap.get(edge.target) ?? edge.target;
    return { ...edge, id: newId, source: newSource, target: newTarget };
  });

  const baseSessions = base.aiChatSessions ?? [];
  const incomingSessions = sanitizedIncoming.aiChatSessions ?? [];
  const { merged: mergedSessions, active: incomingActive } = mergeChatSessions(
    baseSessions,
    incomingSessions,
    sanitizedIncoming.aiChatActiveSessionId ?? null
  );
  const activeSessionId = base.aiChatActiveSessionId ?? incomingActive ?? null;

  const existingLayers = new Set<paper.Layer>(
    (paper.project?.layers ?? []) as paper.Layer[]
  );
  if (sanitizedIncoming.paperJson) {
    paperSaveService.appendPaperJson(sanitizedIncoming.paperJson);
  }
  const nextLayers = (paper.project?.layers ?? []) as paper.Layer[];
  const addedLayers = nextLayers.filter((layer) => !existingLayers.has(layer));

  addedLayers.forEach((layer) => {
    const name = typeof layer.name === "string" ? layer.name : "";
    const oldId = name.startsWith("layer_") ? name.slice("layer_".length) : "";
    const newId = ensureLayerMetaForPaper(oldId, layer);
    layer.name = `layer_${newId}`;
  });

  updatePaperItemsForImport(addedLayers, {
    layerIdMap,
    imageIdMap,
    modelIdMap,
    textIdMap,
    videoIdMap,
  });

  const nextContent: ProjectContentSnapshot = {
    ...base,
    layers: [...base.layers, ...importedLayers],
    assets: {
      images: [...baseAssets.images, ...importedImages],
      models: [...baseAssets.models, ...importedModels],
      texts: [...baseAssets.texts, ...importedTexts],
      videos: [...baseAssets.videos, ...importedVideos],
    },
    flow: {
      nodes: [...baseFlow.nodes, ...importedFlowNodes],
      edges: [...baseFlow.edges, ...importedFlowEdges],
    },
    aiChatSessions: mergedSessions,
    aiChatActiveSessionId: activeSessionId,
    updatedAt: new Date().toISOString(),
  };

  const paperJson = buildPersistablePaperJson(nextContent);
  if (paperJson) {
    nextContent.paperJson = paperJson;
  }

  projectStore.updatePartial(nextContent, { markDirty: true });
  layerStore.hydrateFromContent(nextContent.layers, nextContent.activeLayerId);

  if (incomingSessions.length > 0) {
    chatStore.hydratePersistedSessions(mergedSessions, activeSessionId, {
      markProjectDirty: false,
    });
  }

  try {
    window.dispatchEvent(new CustomEvent("paper-project-changed"));
  } catch {}

  return {
    imported: {
      layers: importedLayers.length,
      images: importedImages.length,
      models: importedModels.length,
      texts: importedTexts.length,
      videos: importedVideos.length,
      flowNodes: importedFlowNodes.length,
      flowEdges: importedFlowEdges.length,
      chatSessions: incomingSessions.length,
    },
  };
};

const mergeChatSessionsOnly = async (
  payload: ChatSessionsPayload
): Promise<ImportSummary> => {
  const projectStore = useProjectContentStore.getState();
  const chatStore = useAIChatStore.getState();

  if (!projectStore.projectId) {
    throw new Error("当前未打开项目，无法导入对话");
  }

  const base = getProjectContentSnapshot();
  const baseSessions = base.aiChatSessions ?? [];
  const { merged, active } = mergeChatSessions(
    baseSessions,
    payload.sessions,
    payload.activeSessionId ?? null
  );

  const activeSessionId = base.aiChatActiveSessionId ?? active ?? null;
  projectStore.updatePartial(
    {
      aiChatSessions: merged,
      aiChatActiveSessionId: activeSessionId,
      updatedAt: new Date().toISOString(),
    },
    { markDirty: true }
  );
  chatStore.hydratePersistedSessions(merged, activeSessionId, {
    markProjectDirty: false,
  });

  return {
    imported: {
      layers: 0,
      images: 0,
      models: 0,
      texts: 0,
      videos: 0,
      flowNodes: 0,
      flowEdges: 0,
      chatSessions: payload.sessions.length,
    },
  };
};

const buildChatText = (messages: Array<{ type?: string; content?: string | null }>) =>
  messages
    .map((message) => {
      const content = (message.content || "").trim();
      if (!content) return null;
      const role = message.type === "user" ? "用户" : message.type === "ai" ? "AI" : "系统";
      return `${role}: ${content}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");

export const clipboardJsonService = {
  async copyProjectContentToClipboard() {
    const content = getProjectContentSnapshot();
    const paperJson = buildPersistablePaperJson(content);
    const snapshot: ProjectContentSnapshot = {
      ...content,
      paperJson: paperJson ?? content.paperJson,
      updatedAt: new Date().toISOString(),
    };
    const sanitized = sanitizeProjectContentForCloudSave(snapshot)?.sanitized ?? snapshot;
    await writeClipboardText(toEnvelope("tanva.projectContent", sanitized));
  },

  async copyChatSessionsToClipboard() {
    const chatStore = useAIChatStore.getState();
    await chatStore.refreshSessions({ markProjectDirty: true });
    const projectStore = useProjectContentStore.getState();
    const sessions = projectStore.content?.aiChatSessions ?? [];
    const activeSessionId = projectStore.content?.aiChatActiveSessionId ?? null;
    const payload: ChatSessionsPayload = { sessions, activeSessionId };
    await writeClipboardText(toEnvelope("tanva.aiChatSessions", payload));
  },

  copyChatTextToClipboard(messages: Array<{ type?: string; content?: string | null }>) {
    const text = buildChatText(messages);
    if (!text) {
      throw new Error("没有可复制的对话内容");
    }
    return writeClipboardText(text);
  },

  async importProjectContentFromClipboard() {
    const rawText = await readClipboardText();
    const envelope = parseEnvelope(rawText);
    if (envelope?.type === "tanva.projectContent") {
      return mergeProjectContent(envelope.payload as ProjectContentSnapshot);
    }

    const fallback = (() => {
      try {
        return JSON.parse(rawText) as ProjectContentSnapshot;
      } catch {
        return null;
      }
    })();
    if (fallback?.layers && fallback?.canvas) {
      return mergeProjectContent(fallback);
    }
    throw new Error("剪贴板内容不是有效的画布 JSON");
  },

  async importChatSessionsFromClipboard() {
    const rawText = await readClipboardText();
    const envelope = parseEnvelope(rawText);
    if (envelope?.type === "tanva.aiChatSessions") {
      return mergeChatSessionsOnly(envelope.payload as ChatSessionsPayload);
    }

    const fallback = (() => {
      try {
        return JSON.parse(rawText) as ChatSessionsPayload;
      } catch {
        return null;
      }
    })();
    if (fallback?.sessions && Array.isArray(fallback.sessions)) {
      return mergeChatSessionsOnly(fallback);
    }
    throw new Error("剪贴板内容不是有效的对话 JSON");
  },
};
