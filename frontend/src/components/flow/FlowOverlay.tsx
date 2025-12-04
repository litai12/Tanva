// @ts-nocheck
import React from 'react';
import { Trash2, Plus, Upload, Download } from 'lucide-react';
import paper from 'paper';
import ReactFlow, {
  MiniMap,
  Background,
  BackgroundVariant,
  type Connection,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node
} from 'reactflow';
import { ReactFlowProvider } from 'reactflow';
import { useCanvasStore } from '@/stores';
import { useToolStore } from '@/stores';
import 'reactflow/dist/style.css';
import './flow.css';
import type { FlowTemplate, TemplateIndexEntry, TemplateNode, TemplateEdge } from '@/types/template';
import { loadBuiltInTemplateIndex, loadBuiltInTemplateByPath, listUserTemplates, getUserTemplate, saveUserTemplate, deleteUserTemplate, generateId } from '@/services/templateStore';

import TextPromptNode from './nodes/TextPromptNode';
import TextChatNode from './nodes/TextChatNode';
import ImageNode from './nodes/ImageNode';
import GenerateNode from './nodes/GenerateNode';
import Generate4Node from './nodes/Generate4Node';
import GenerateReferenceNode from './nodes/GenerateReferenceNode';
import ThreeNode from './nodes/ThreeNode';
import CameraNode from './nodes/CameraNode';
import PromptOptimizeNode from './nodes/PromptOptimizeNode';
import AnalysisNode from './nodes/AnalyzeNode';
import Sora2VideoNode from './nodes/Sora2VideoNode';
import TextNoteNode from './nodes/TextNoteNode';
import StoryboardSplitNode from './nodes/StoryboardSplitNode';
import GenerateProNode from './nodes/GenerateProNode';
import GeneratePro4Node from './nodes/GeneratePro4Node';
import { useFlowStore, FlowBackgroundVariant } from '@/stores/flowStore';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useUIStore } from '@/stores';
import { useAIChatStore, getImageModelForProvider, uploadImageToOSS, requestSora2VideoGeneration, DEFAULT_SORA2_VIDEO_QUALITY } from '@/stores/aiChatStore';
import type { Sora2VideoQuality } from '@/stores/aiChatStore';
import { historyService } from '@/services/historyService';
import { clipboardService, type ClipboardFlowNode } from '@/services/clipboardService';
import { aiImageService } from '@/services/aiImageService';
import { generateImageViaAPI, editImageViaAPI, blendImagesViaAPI } from '@/services/aiBackendAPI';
import { normalizeWheelDelta, computeSmoothZoom } from '@/lib/zoomUtils';
import type { AIImageGenerateRequest, AIImageResult } from '@/types/ai';
import MiniMapImageOverlay from './MiniMapImageOverlay';
import PersonalLibraryPanel from './PersonalLibraryPanel';
import { resolveTextFromSourceNode } from './utils/textSource';

type RFNode = Node<any>;

type EdgeLabelEditorState = {
  visible: boolean;
  edgeId: string | null;
  value: string;
  position: { x: number; y: number };
};

const createEdgeLabelEditorState = (): EdgeLabelEditorState => ({
  visible: false,
  edgeId: null,
  value: '',
  position: { x: 0, y: 0 },
});

const ensureDataUrl = (imageData: string): string =>
  imageData.startsWith('data:image') ? imageData : `data:image/png;base64,${imageData}`;

const nodeTypes = {
  textPrompt: TextPromptNode,
  textChat: TextChatNode,
  promptOptimize: PromptOptimizeNode,
  textNote: TextNoteNode,
  image: ImageNode,
  generate: GenerateNode,
  generate4: Generate4Node,
  generatePro: GenerateProNode,
  generatePro4: GeneratePro4Node,
  generateRef: GenerateReferenceNode,
  three: ThreeNode,
  camera: CameraNode,
  analysis: AnalysisNode,
  sora2Video: Sora2VideoNode,
  storyboardSplit: StoryboardSplitNode,
};

const DEFAULT_REFERENCE_PROMPT = '请参考第二张图的内容';

const BUILTIN_TEMPLATE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '摄影', label: '摄影' },
  { value: '建筑设计', label: '建筑设计' },
  { value: '室内设计', label: '室内设计' },
  { value: '平面设计', label: '平面设计' },
  { value: '其他', label: '其他' },
];

const BUILTIN_CATEGORY_VALUE_SET = new Set(BUILTIN_TEMPLATE_CATEGORIES.map(c => c.value));

function normalizeBuiltinCategory(category?: string): string {
  if (!category) return '其他';
  return BUILTIN_CATEGORY_VALUE_SET.has(category) ? category : '其他';
}

const ADD_PANEL_TAB_STORAGE_KEY = 'tanva-add-panel-tab';

const SORA2_HISTORY_LIMIT = 5;

type Sora2VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  quality: Sora2VideoQuality;
  createdAt: string;
};

const getStoredAddPanelTab = (): 'nodes' | 'templates' | 'personal' => {
  if (typeof window === 'undefined') {
    return 'nodes';
  }
  try {
    const saved = window.localStorage.getItem(ADD_PANEL_TAB_STORAGE_KEY);
    return saved === 'templates' || saved === 'personal' || saved === 'nodes' ? saved : 'nodes';
  } catch {
    return 'nodes';
  }
};

// 用户模板卡片组件
const UserTemplateCard: React.FC<{
  item: {id:string;name:string;category?:string;tags?:string[];thumbnail?:string;createdAt:string;updatedAt:string};
  onInstantiate: () => Promise<void>;
  onDelete: () => Promise<void>;
}> = ({ item, onInstantiate, onDelete }) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 18,
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '18px 20px',
        background: '#fff',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        position: 'relative',
        minHeight: 160,
        height: 160,
        overflow: 'hidden'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#2563eb';
        e.currentTarget.style.background = '#f1f5ff';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 16px 32px rgba(37, 99, 235, 0.12)';
        setIsHovered(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#e5e7eb';
        e.currentTarget.style.background = '#fff';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        setIsHovered(false);
      }}
      onClick={async (e) => {
        if ((e.target as HTMLElement).closest('.delete-btn')) return;
        await onInstantiate();
      }}
    >
      <div
        style={{
          flex: '0 0 50%',
          maxWidth: '50%',
        height: '100%',
        background: item.thumbnail ? 'transparent' : '#f3f4f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>暂无预览</div>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 6 }}>{item.name}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>更新于 {new Date(item.updatedAt).toLocaleString()}</div>
        </div>
        {item.category ? <div style={{ fontSize: 12, color: '#9ca3af' }}>分类：{item.category}</div> : null}
        {item.tags?.length ? (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>标签：{item.tags.join(' / ')}</div>
        ) : null}
      </div>
      {isHovered && (
        <button
          className="delete-btn"
          style={{
            position: 'absolute',
            right: 16,
            top: 16,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid #fecaca',
            background: '#fff',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#fee2e2';
            e.currentTarget.style.borderColor = '#fca5a5';
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fff';
            e.currentTarget.style.borderColor = '#fecaca';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          title="删除模板"
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

const AddTemplateCard: React.FC<{ onAdd: () => Promise<void>; label?: string }> = ({ onAdd, label }) => {
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
          await onAdd();
        } finally {
          setIsLoading(false);
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed #cbd5f5',
        borderRadius: 12,
        padding: '18px 20px',
        minHeight: 160,
        height: 160,
        background: '#f8fbff',
        color: '#2563eb',
        cursor: isLoading ? 'wait' : 'pointer',
        transition: 'all 0.15s ease',
        gap: 10,
        fontSize: 13,
        fontWeight: 500
      }}
      onMouseEnter={(e) => {
        if (isLoading) return;
        e.currentTarget.style.background = '#eef2ff';
        e.currentTarget.style.borderColor = '#93c5fd';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 12px 24px rgba(37, 99, 235, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#f8fbff';
        e.currentTarget.style.borderColor = '#cbd5f5';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
      disabled={isLoading}
    >
      <Plus size={24} strokeWidth={2.5} />
      <div>{isLoading ? '保存中…' : label || '保存为模板'}</div>
    </button>
  );
};

const TemplatePlaceholder: React.FC<{ label?: string }> = ({ label }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'stretch',
      gap: 18,
      border: '1px dashed #d1d5db',
      borderRadius: 12,
      padding: '18px 20px',
      minHeight: 160,
      height: 160,
      background: '#f9fafb',
      transition: 'all 0.2s ease'
    }}
  >
    <div
      style={{
        flex: '0 0 50%',
        maxWidth: '50%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
        borderRadius: 8,
        color: '#94a3b8'
      }}
    >
      <Plus size={28} strokeWidth={2} />
    </div>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{label || '敬请期待更多模板'}</div>
      <div>我们正在准备更多创意模板</div>
    </div>
  </div>
);

// Flow独立的视口管理，不再与Canvas同步
function useFlowViewport() {
  const { flowZoom, flowPanX, flowPanY, setFlowZoom, setFlowPan } = useFlowStore();
  const rf = useReactFlow();
  
  const updateViewport = React.useCallback((x: number, y: number, zoom: number) => {
    try {
      rf.setViewport({ x, y, zoom }, { duration: 0 });
      setFlowPan(x, y);
      setFlowZoom(zoom);
    } catch (_) {}
  }, [rf, setFlowPan, setFlowZoom]);

  return { 
    zoom: flowZoom, 
    panX: flowPanX, 
    panY: flowPanY, 
    updateViewport 
  };
}

// 默认节点配置 - 暂时注释，后面再用
// const initialNodes: RFNode[] = [
//   {
//     id: 'prompt-1',
//     type: 'textPrompt',
//     position: { x: 50, y: 200 },
//     data: { 
//       text: '画一只猫'
//     },
//   },
//   {
//     id: 'generate-1',
//     type: 'generate',
//     position: { x: 350, y: 150 },
//     data: {
//       status: 'idle'
//     },
//   },
//   {
//     id: 'image-1',
//     type: 'image',
//     position: { x: 650, y: 200 },
//     data: {
//       label: 'Image'
//     },
//   },
// ];

// 默认连线配置 - 暂时注释，后面再用
// const initialEdges: Edge[] = [
//   {
//     id: 'prompt-generate',
//     source: 'prompt-1',
//     target: 'generate-1',
//     sourceHandle: 'text',
//     targetHandle: 'text',
//     type: 'default',
//   },
//   {
//     id: 'generate-image',
//     source: 'generate-1',
//     target: 'image-1',
//     sourceHandle: 'img',
//     targetHandle: 'img',
//     type: 'default',
//   },
// ];

function FlowInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const imageSize = useAIChatStore((state) => state.imageSize);
  const imageModel = React.useMemo(
    () => getImageModelForProvider(aiProvider),
    [aiProvider]
  );

  // 获取当前工具模式
  const drawMode = useToolStore((state) => state.drawMode);
  const isPointerMode = drawMode === 'pointer';

  const onNodesChangeWithHistory = React.useCallback((changes: any) => {
    onNodesChange(changes);
    try {
      const needCommit = Array.isArray(changes) && changes.some((c: any) => (
        c?.type === 'position' && c?.dragging === false
      ) || c?.type === 'remove' || c?.type === 'add' || c?.type === 'dimensions');
      if (needCommit) historyService.commit('flow-nodes-change').catch(() => {});
    } catch {}
  }, [onNodesChange]);

  const onEdgesChangeWithHistory = React.useCallback((changes: any) => {
    onEdgesChange(changes);
    try {
      const needCommit = Array.isArray(changes) && changes.some((c: any) => c?.type === 'remove' || c?.type === 'add');
      if (needCommit) historyService.commit('flow-edges-change').catch(() => {});
    } catch {}
  }, [onEdgesChange]);
  const rf = useReactFlow();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [edgeLabelEditor, setEdgeLabelEditor] = React.useState<EdgeLabelEditorState>(() => createEdgeLabelEditorState());
  const edgeLabelInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (edgeLabelEditor.visible) {
      const id = window.setTimeout(() => edgeLabelInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [edgeLabelEditor.visible]);

  React.useEffect(() => {
    if (!edgeLabelEditor.visible || !edgeLabelEditor.edgeId) return;
    if (!edges.some(edge => edge.id === edgeLabelEditor.edgeId)) {
      setEdgeLabelEditor(createEdgeLabelEditorState());
    }
  }, [edges, edgeLabelEditor.visible, edgeLabelEditor.edgeId]);
  // 统一画板：节点橡皮已禁用

  // —— 项目内容（文件）中的 Flow 图谱持久化 ——
  const projectId = useProjectContentStore(s => s.projectId);
  const hydrated = useProjectContentStore(s => s.hydrated);
  const contentFlow = useProjectContentStore(s => s.content?.flow);
  const updateProjectPartial = useProjectContentStore(s => s.updatePartial);
  const hydratingFromStoreRef = React.useRef(false);
  const lastSyncedJSONRef = React.useRef<string | null>(null);
  const nodeDraggingRef = React.useRef(false);
  const commitTimerRef = React.useRef<number | null>(null);

  const sanitizeNodeData = React.useCallback((input: any) => {
    try {
      return JSON.parse(JSON.stringify(input, (_key, value) => (
        typeof value === 'function' ? undefined : value
      )));
    } catch {
      if (!input || typeof input !== 'object') return input;
      if (Array.isArray(input)) {
        return input.map(sanitizeNodeData);
      }
      const result: Record<string, any> = {};
      Object.entries(input).forEach(([key, value]) => {
        if (typeof value === 'function') return;
        result[key] = sanitizeNodeData(value);
      });
      return result;
    }
  }, []);

  const rfNodesToTplNodes = React.useCallback((ns: RFNode[]): ClipboardFlowNode[] => {
    return ns.map((n: any) => {
      const rawData = { ...(n.data || {}) } as any;
      delete rawData.onRun;
      delete rawData.onSend;
      const data = sanitizeNodeData(rawData);
      if (data) {
        delete data.status;
        delete data.error;
      }
      return {
        id: n.id,
        type: n.type || 'default',
        position: { x: n.position.x, y: n.position.y },
        data,
        boxW: data?.boxW,
        boxH: data?.boxH,
        width: n.width,
        height: n.height,
        style: n.style ? { ...n.style } : undefined,
      } as ClipboardFlowNode;
    });
  }, [sanitizeNodeData]);

  const rfEdgesToTplEdges = React.useCallback((es: Edge[]): TemplateEdge[] => es.map((e: any) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type || 'default',
    label: typeof e.label === 'string' ? e.label : undefined,
  })), []);

  const tplNodesToRfNodes = React.useCallback((ns: TemplateNode[]): RFNode[] => ns.map((n) => ({
    id: n.id,
    type: (n as any).type || 'default',
    position: { x: n.position.x, y: n.position.y },
    data: { ...(n.data || {}) },
  })) as any, []);

  const tplEdgesToRfEdges = React.useCallback((es: TemplateEdge[]): Edge[] => es.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type || 'default',
    label: e.label,
  })) as any, []);

  const handleCopyFlow = React.useCallback(() => {
    const allNodes = rf.getNodes();
    const selectedNodes = allNodes.filter((node: any) => node.selected);
    if (!selectedNodes.length) return false;

    const nodeSnapshots = rfNodesToTplNodes(selectedNodes as any);
    const selectedIds = new Set(selectedNodes.map((node: any) => node.id));
    const relatedEdges = rf.getEdges().filter((edge: any) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
    const edgeSnapshots = rfEdgesToTplEdges(relatedEdges);

    const minX = Math.min(...selectedNodes.map((node: any) => node.position?.x ?? 0));
    const minY = Math.min(...selectedNodes.map((node: any) => node.position?.y ?? 0));

    clipboardService.setFlowData({
      nodes: nodeSnapshots,
      edges: edgeSnapshots,
      origin: { x: minX, y: minY },
    });
    return true;
  }, [rf, rfNodesToTplNodes, rfEdgesToTplEdges]);

  const handlePasteFlow = React.useCallback(() => {
    const payload = clipboardService.getFlowData();
    if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) return false;

    const OFFSET = 40;
    const idMap = new Map<string, string>();

    const newNodes = payload.nodes.map((node) => {
      const newId = generateId(node.type || 'n');
      idMap.set(node.id, newId);
      const data: any = sanitizeNodeData(node.data || {});
      return {
        id: newId,
        type: node.type || 'default',
        position: {
          x: node.position.x + OFFSET,
          y: node.position.y + OFFSET,
        },
        data,
        selected: true,
        width: node.width,
        height: node.height,
        style: node.style ? { ...node.style } : undefined,
      } as any;
    });

    if (!newNodes.length) return false;

    const newEdges = (payload.edges || []).map((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return null;
      return {
        id: generateId('e'),
        source,
        target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: edge.type || 'default',
        label: edge.label,
      } as any;
    }).filter(Boolean) as Edge[];

    setNodes((prev: any[]) => prev.map((node) => ({ ...node, selected: false })).concat(newNodes));
    if (newEdges.length) {
      setEdges((prev: any[]) => prev.concat(newEdges));
    }

    try { historyService.commit('flow-paste').catch(() => {}); } catch {}
    return true;
  }, [sanitizeNodeData, setEdges, setNodes]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const isCopy = (event.key === 'c' || event.key === 'C') && (event.metaKey || event.ctrlKey);
      const isPaste = (event.key === 'v' || event.key === 'V') && (event.metaKey || event.ctrlKey);
      if (!isCopy && !isPaste) return;

      const active = document.activeElement as Element | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable = !!active && (tagName === 'input' || tagName === 'textarea' || (active as any).isContentEditable);
      if (isEditable) return;

      if (isCopy) {
        const handled = handleCopyFlow();
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (isPaste) {
        if (clipboardService.getZone() !== 'flow') return;
        const handled = handlePasteFlow();
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleCopyFlow, handlePasteFlow]);

  // 当项目内容的 flow 变化时，水合到 ReactFlow
  React.useEffect(() => {
    if (!projectId || !hydrated) return;
    if (nodeDraggingRef.current) return; // 拖拽过程中不从store覆盖本地状态，避免闪烁
    const ns = contentFlow?.nodes || [];
    const es = contentFlow?.edges || [];
    hydratingFromStoreRef.current = true;
    const nextNodes = tplNodesToRfNodes(ns);
    setNodes((prev) => {
      const prevMap = new Map((prev as RFNode[]).map((node) => [node.id, node]));
      return nextNodes.map((node) => {
        const prevNode = prevMap.get(node.id);
        if (!prevNode) return node as RFNode;
        return {
          ...prevNode,
          position: node.position,
          data: { ...(prevNode.data || {}), ...(node.data || {}) },
          width: node.width ?? prevNode.width,
          height: node.height ?? prevNode.height,
          style: node.style || prevNode.style,
        } as RFNode;
      });
    });
    setEdges(tplEdgesToRfEdges(es));
    // 记录当前从 store 水合的快照，避免立刻写回造成环路
    try { lastSyncedJSONRef.current = JSON.stringify({ n: ns, e: es }); } catch { lastSyncedJSONRef.current = null; }
    Promise.resolve().then(() => { hydratingFromStoreRef.current = false; });
  }, [projectId, hydrated, contentFlow, setNodes, setEdges, tplNodesToRfNodes, tplEdgesToRfEdges]);

  // 切换项目时先清空，避免跨项目残留
  React.useEffect(() => {
    setNodes([]); setEdges([]);
  }, [projectId, setNodes, setEdges]);

  // 将 ReactFlow 的更改写回项目内容（触发自动保存）
  const scheduleCommit = React.useCallback((nodesSnapshot: TemplateNode[], edgesSnapshot: TemplateEdge[]) => {
    if (!projectId) return;
    if (!hydrated) return;
    if (hydratingFromStoreRef.current) return;
    if (nodeDraggingRef.current) return; // 拖拽时不高频写回
    const json = (() => { try { return JSON.stringify({ n: nodesSnapshot, e: edgesSnapshot }); } catch { return null; } })();
    if (json && lastSyncedJSONRef.current === json) return;
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      lastSyncedJSONRef.current = json;
      updateProjectPartial({ flow: { nodes: nodesSnapshot, edges: edgesSnapshot } }, { markDirty: true });
      commitTimerRef.current = null;
    }, 120); // 轻微节流，避免频繁渲染
  }, [projectId, hydrated, updateProjectPartial]);

  React.useEffect(() => {
    if (!projectId) return;
    if (!hydrated) return;
    if (hydratingFromStoreRef.current) return;
    const nodesSnapshot = rfNodesToTplNodes(nodes as any);
    const edgesSnapshot = rfEdgesToTplEdges(edges);
    scheduleCommit(nodesSnapshot, edgesSnapshot);
  }, [nodes, edges, projectId, hydrated, rfNodesToTplNodes, rfEdgesToTplEdges, scheduleCommit]);

  React.useEffect(() => {
    if (hydrated) return;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, [hydrated]);

  // 背景设置改为驱动底层 Canvas 网格
  // 使用独立的Flow状态
  // 分别选择，避免一次性取整个 store 导致不必要的重渲染/快照警告
  const backgroundEnabled = useFlowStore(s => s.backgroundEnabled);
  const backgroundVariant = useFlowStore(s => s.backgroundVariant);
  const backgroundGap = useFlowStore(s => s.backgroundGap);
  const backgroundSize = useFlowStore(s => s.backgroundSize);
  const backgroundColor = useFlowStore(s => s.backgroundColor);
  const backgroundOpacity = useFlowStore(s => s.backgroundOpacity);
  const setBackgroundEnabled = useFlowStore(s => s.setBackgroundEnabled);
  const setBackgroundVariant = useFlowStore(s => s.setBackgroundVariant);
  const setBackgroundGap = useFlowStore(s => s.setBackgroundGap);
  const setBackgroundSize = useFlowStore(s => s.setBackgroundSize);
  const setBackgroundColor = useFlowStore(s => s.setBackgroundColor);
  const setBackgroundOpacity = useFlowStore(s => s.setBackgroundOpacity);

  // Flow独立的背景状态管理，不再同步到Canvas
  const [bgGapInput, setBgGapInput] = React.useState<string>(String(backgroundGap));
  const [bgSizeInput, setBgSizeInput] = React.useState<string>(String(backgroundSize));

  // 同步输入框字符串与实际数值
  React.useEffect(() => { setBgGapInput(String(backgroundGap)); }, [backgroundGap]);
  React.useEffect(() => { setBgSizeInput(String(backgroundSize)); }, [backgroundSize]);

  const commitGap = React.useCallback((val: string) => {
    const n = Math.max(4, Math.min(100, Math.floor(Number(val)) || backgroundGap));
    setBackgroundGap(n);
    setBgGapInput(String(n));
  }, [backgroundGap, setBackgroundGap]);

  const commitSize = React.useCallback((val: string) => {
    const n = Math.max(0.5, Math.min(10, Math.floor(Number(val)) || backgroundSize));
    setBackgroundSize(n);
    setBgSizeInput(String(n));
  }, [backgroundSize, setBackgroundSize]);

  // 使用Canvas → Flow 单向同步：保证节点随画布平移/缩放
  // 使用数组选择器而非对象，避免 React 19 对 getSnapshot 的新警告
  const cvZoom = useCanvasStore(s => s.zoom);
  const cvPanX = useCanvasStore(s => s.panX);
  const cvPanY = useCanvasStore(s => s.panY);
  const lastApplied = React.useRef<{ x: number; y: number; z: number } | null>(null);
  React.useEffect(() => {
    const z = cvZoom || 1;
    // Canvas: screen_px = z * (world + panWorld)
    // 世界坐标以设备像素为单位，CSS 需除以 dpr
    // ReactFlow: 使用 CSS 像素，因此 translate 需折算 dpr：translate = (z * panWorld) / dpr
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const x = ((cvPanX || 0) * z) / dpr;
    const y = ((cvPanY || 0) * z) / dpr;
    const prev = lastApplied.current;
    const eps = 1e-6;
    if (prev && Math.abs(prev.x - x) < eps && Math.abs(prev.y - y) < eps && Math.abs(prev.z - z) < eps) return;
    lastApplied.current = { x, y, z };
    let raf = 0;
    raf = requestAnimationFrame(() => {
      try { rf.setViewport({ x, y, zoom: z }, { duration: 0 }); } catch { /* noop */ }
    });
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [rf, cvZoom, cvPanX, cvPanY]);

  // 当开始/结束连线拖拽时，全局禁用/恢复文本选择，避免蓝色选区
  React.useEffect(() => {
    if (isConnecting) {
      document.body.classList.add('tanva-no-select', 'tanva-flow-connecting');
    } else {
      document.body.classList.remove('tanva-no-select', 'tanva-flow-connecting');
    }
    return () => document.body.classList.remove('tanva-no-select', 'tanva-flow-connecting');
  }, [isConnecting]);

  // 擦除模式退出时清除高亮
  React.useEffect(() => {
    // 节点橡皮已禁用，确保无高亮残留
    setNodes(ns => ns.map(n => (n.className === 'eraser-hover' ? { ...n, className: undefined } : n)));
  }, []);

  // 双击空白处弹出添加面板
  const [addPanel, setAddPanel] = React.useState<{ visible: boolean; screen: { x: number; y: number }; world: { x: number; y: number } }>({ visible: false, screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } });
  const [addTab, setAddTab] = React.useState<'nodes' | 'templates' | 'personal'>(() => getStoredAddPanelTab());
  const setAddTabWithMemory = React.useCallback((tab: 'nodes' | 'templates' | 'personal') => {
    setAddTab(tab);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ADD_PANEL_TAB_STORAGE_KEY, tab);
      } catch (error) {
        console.warn('[FlowOverlay] 无法保存添加面板的页签状态', error);
      }
    }
  }, [setAddTab]);
  const addPanelRef = React.useRef<HTMLDivElement | null>(null);
  const lastPaneClickRef = React.useRef<{ t: number; x: number; y: number } | null>(null);
  const lastGlobalClickRef = React.useRef<{ t: number; x: number; y: number } | null>(null);
  // 模板相关状态
  const [tplIndex, setTplIndex] = React.useState<TemplateIndexEntry[] | null>(null);
  const [userTplList, setUserTplList] = React.useState<Array<{id:string;name:string;category?:string;tags?:string[];thumbnail?:string;createdAt:string;updatedAt:string}>>([]);
  const [tplLoading, setTplLoading] = React.useState(false);
  const [templateScope, setTemplateScope] = React.useState<'public' | 'mine'>('public');
  const [activeBuiltinCategory, setActiveBuiltinCategory] = React.useState<string>(BUILTIN_TEMPLATE_CATEGORIES[0].value);

  const filteredTplIndex = React.useMemo(() => {
    if (!tplIndex) return [];
    return tplIndex.filter(item => normalizeBuiltinCategory(item.category) === activeBuiltinCategory);
  }, [tplIndex, activeBuiltinCategory]);

  const getPlaceholderCount = React.useCallback((len: number, opts?: { columns?: number; minVisible?: number }) => {
    const columns = opts?.columns ?? 2;
    const minVisible = opts?.minVisible ?? 0;
    const minFill = len < minVisible ? minVisible - len : 0;
    const remainder = len % columns;
    const columnFill = remainder ? columns - remainder : 0;
    return Math.max(minFill, columnFill);
  }, []);

  const openAddPanelAt = React.useCallback((clientX: number, clientY: number) => {
    const world = rf.screenToFlowPosition({ x: clientX, y: clientY });
    setAddPanel({ visible: true, screen: { x: clientX, y: clientY }, world });
  }, [rf]);

  // ---------- 导出/导入（序列化） ----------
  const cleanNodeData = React.useCallback((data: any) => {
    if (!data) return {};
    // 不导出回调与大体积图像数据
    const { onRun, onSend, imageData, ...rest } = data || {};
    return rest;
  }, []);

  const exportFlow = React.useCallback(() => {
    try {
      // 导出为可内置的模板格式（与内置模板一致）
      const payload = {
        schemaVersion: 1 as const,
        id: `tpl_${Date.now()}`,
        name: `导出模板_${new Date().toLocaleString()}`,
        nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: cleanNodeData(n.data) })),
        edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: (e as any).sourceHandle, targetHandle: (e as any).targetHandle, type: e.type || 'default' })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tanva-template-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) {
      console.error('导出失败', err);
    }
  }, [nodes, edges, cleanNodeData]);

  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const handleImportClick = React.useCallback(() => {
    // 点击导入后立即关闭面板
    setAddPanel(v => ({ ...v, visible: false }));
    importInputRef.current?.click();
  }, []);

  const handleImportFiles = React.useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const obj = JSON.parse(text);
        const rawNodes = Array.isArray(obj?.nodes) ? obj.nodes : [];
        const rawEdges = Array.isArray(obj?.edges) ? obj.edges : [];

        const existing = new Set((rf.getNodes() || []).map(n => n.id));
        const idMap = new Map<string, string>();

        const now = Date.now();
        const mappedNodes = rawNodes.map((n: any, idx: number) => {
          const origId = String(n.id || `n_${idx}`);
          let newId = origId;
          if (existing.has(newId) || idMap.has(newId)) newId = `${origId}_${now}_${idx}`;
          idMap.set(origId, newId);
          return {
            id: newId,
            type: n.type,
            position: n.position || { x: 0, y: 0 },
            data: cleanNodeData(n.data) || {},
          } as any;
        });

        const mappedEdges = rawEdges.map((e: any, idx: number) => {
          const sid = idMap.get(String(e.source)) || String(e.source);
          const tid = idMap.get(String(e.target)) || String(e.target);
          return { id: String(e.id || `e_${now}_${idx}`), source: sid, target: tid, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: e.type || 'default' } as any;
        }).filter((e: any) => mappedNodes.find(n => n.id === e.source) && mappedNodes.find(n => n.id === e.target));

        setNodes(ns => ns.concat(mappedNodes));
        setEdges(es => es.concat(mappedEdges));
        console.log(`✅ 导入成功：节点 ${mappedNodes.length} 条，连线 ${mappedEdges.length} 条`);
        try { historyService.commit('flow-import').catch(() => {}); } catch {}
      } catch (err) {
        console.error('导入失败：JSON 解析错误', err);
      } finally {
        // 确保面板关闭；重置 input 值，允许重复导入同一文件
        setAddPanel(v => ({ ...v, visible: false }));
        try { if (importInputRef.current) importInputRef.current.value = ''; } catch {}
      }
    };
    reader.readAsText(file);
  }, [rf, setNodes, setEdges, cleanNodeData]);

  // 仅在真正空白处（底层画布）允许触发
  const isBlankArea = React.useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;

    // 屏蔽 AI 对话框等区域及其外侧保护带（24px），防止误触发
    try {
      const shield = 24; // 外侧保护带
      const preventEls = Array.from(document.querySelectorAll('[data-prevent-add-panel]')) as HTMLElement[];
      for (const el of preventEls) {
        const r = el.getBoundingClientRect();
        if (clientX >= r.left - shield && clientX <= r.right + shield && clientY >= r.top - shield && clientY <= r.bottom + shield) {
          return false;
        }
      }
    } catch {}

    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return false;
    // 排除：添加面板/工具栏/Flow交互元素/任意标记为不触发的UI
    if (el.closest('.tanva-add-panel, .tanva-flow-toolbar, .react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, [data-prevent-add-panel]')) return false;
    // 接受：底层画布 或 ReactFlow 背景/Pane（网格区域）
    const tag = el.tagName.toLowerCase();
    const isCanvas = tag === 'canvas';
    const isPane = !!el.closest('.react-flow__pane');
    const isGridBg = !!el.closest('.react-flow__background');
    if (!isCanvas && !isPane && !isGridBg) return false;
    
    // 进一步：命中检测 Paper.js 物体（文本/图像/形状等）
    let projectPoint: paper.Point | null = null;
    try {
      const canvas = paper?.view?.element as HTMLCanvasElement | undefined;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const vx = (clientX - rect.left) * dpr;
        const vy = (clientY - rect.top) * dpr;
        const pt = paper.view.viewToProject(new paper.Point(vx, vy));
        projectPoint = pt;
        const hit = paper.project.hitTest(pt, {
          segments: true,
          stroke: true,
          fill: true,
          bounds: true,
          center: true,
          tolerance: 4,
        } as any);
        if (hit && hit.item) {
          const item: any = hit.item;

          // 向上查找真实内容（例如图片组），避免命中辅助框时被误判为空白
          let current: any = item;
          while (current) {
            const data = current.data || {};
            if ((data.type === 'image' && data.imageId) || (typeof data.type === 'string' && !data.isHelper && data.type !== 'grid')) {
              return false; // 命中真实内容，视为非空白
            }
            current = current.parent;
          }

          // 原有的网格/辅助元素检测
          const layerName = item?.layer?.name || '';
          const isGridLayer = layerName === 'grid';
          const isHelper = !!item?.data?.isAxis || item?.data?.isHelper === true;
          const isGridType = typeof item?.data?.type === 'string' && item.data.type.startsWith('grid');
          if (isGridLayer || isHelper || isGridType) {
            // 命中网格/坐标轴等辅助元素：视为空白
          } else {
            return false; // 命中真实内容，视为非空白
          }
        }
      }
    } catch {}

    // 兜底：若未命中元素，基于保存的3D模型包围盒再次检查，避免3D区域被误判为空白
    try {
      if (projectPoint && paper?.project) {
        const hitModel = paper.project.getItems({
          match: (item: any) => item?.data?.type === '3d-model' && item?.data?.bounds
        }).some((item: any) => {
          try {
            const b = item.data.bounds;
            return projectPoint!.x >= b.x && projectPoint!.x <= b.x + b.width && projectPoint!.y >= b.y && projectPoint!.y <= b.y + b.height;
          } catch {
            return false;
          }
        });
        if (hitModel) return false;
      }
    } catch {}
    return true;
  }, []);

  const allowNativeScroll = React.useCallback((target: EventTarget | null) => {
    if (!target || !(target instanceof HTMLElement)) return false;
    const container = containerRef.current;
    if (!container) return false;
    let el: HTMLElement | null = target;
    while (el && container.contains(el)) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select' || el.isContentEditable) {
        return true;
      }
      try {
        const style = window.getComputedStyle(el);
        const canScrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
        const canScrollX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
        if (canScrollX || canScrollY) return true;
      } catch {
        // getComputedStyle 可能失败，忽略并继续向上
      }
      el = el.parentElement;
    }
    return false;
  }, []);

  // 中键拖拽以平移 Flow 视口，阻止浏览器的自动滚动
  const middleDragRef = React.useRef<{ dragging: boolean; lastX: number; lastY: number }>({
    dragging: false,
    lastX: 0,
    lastY: 0,
  });
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stopDrag = () => {
      if (!middleDragRef.current.dragging) return;
      middleDragRef.current.dragging = false;
      container.classList.remove('tanva-flow-middle-panning');
      container.style.cursor = '';
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      if (allowNativeScroll(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      middleDragRef.current.dragging = true;
      middleDragRef.current.lastX = event.clientX;
      middleDragRef.current.lastY = event.clientY;
      container.classList.add('tanva-flow-middle-panning');
      container.style.cursor = 'grabbing';
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!middleDragRef.current.dragging) return;
      event.preventDefault();
      const store = useCanvasStore.getState();
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const zoom = store.zoom || 1;
      const dx = event.clientX - middleDragRef.current.lastX;
      const dy = event.clientY - middleDragRef.current.lastY;
      if (dx === 0 && dy === 0) return;
      middleDragRef.current.lastX = event.clientX;
      middleDragRef.current.lastY = event.clientY;
      store.setPan(store.panX + (dx * dpr) / zoom, store.panY + (dy * dpr) / zoom);
    };

    const handleMouseUp = () => stopDrag();
    const handleWindowBlur = () => stopDrag();

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('blur', handleWindowBlur);
      stopDrag();
    };
  }, [allowNativeScroll]);

  const handleWheelCapture = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    if (allowNativeScroll(event.target)) return;

    const store = useCanvasStore.getState();
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();

      const canvasEl = (paper?.view?.element as HTMLCanvasElement | undefined) || containerRef.current;
      const rect = canvasEl?.getBoundingClientRect();
      if (!rect) return;

      const sx = (event.clientX - rect.left) * dpr;
      const sy = (event.clientY - rect.top) * dpr;
      const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
      if (Math.abs(delta) < 1e-6) return;

      const z1 = store.zoom || 1;
      const z2 = computeSmoothZoom(z1, delta);
      if (z1 === z2) return;

      const pan2x = store.panX + sx * (1 / z2 - 1 / z1);
      const pan2y = store.panY + sy * (1 / z2 - 1 / z1);
      store.setPan(pan2x, pan2y);
      store.setZoom(z2);
      return;
    }

    const hasDelta = Math.abs(event.deltaX) > 0.0001 || Math.abs(event.deltaY) > 0.0001;
    if (!hasDelta) return;

    event.preventDefault();
    event.stopPropagation();

    const zoom = store.zoom || 1;
    const worldDeltaX = (-event.deltaX * dpr) / zoom;
    const worldDeltaY = (-event.deltaY * dpr) / zoom;
    store.setPan(store.panX + worldDeltaX, store.panY + worldDeltaY);
  }, [allowNativeScroll]);

  const onPaneClick = React.useCallback((event: React.MouseEvent) => {
    // 基于两次快速点击判定双击（ReactFlow Pane 无原生 onDoubleClick 回调）
    const now = Date.now();
    const x = event.clientX, y = event.clientY;
    const last = lastPaneClickRef.current;
    lastPaneClickRef.current = { t: now, x, y };
    if (last && (now - last.t) < 200 && Math.hypot(last.x - x, last.y - y) < 10) {
      if (isBlankArea(x, y)) openAddPanelAt(x, y);
    } else if (!isPointerMode) {
      // 单击空白区域时，取消所有节点的选择（pointer 模式下不自动取消选择）
      setNodes((prev: any[]) => prev.map((node) => ({ ...node, selected: false })));
    }
  }, [openAddPanelAt, isBlankArea, setNodes, isPointerMode]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddPanel(v => ({ ...v, visible: false })); };
    const onDown = (e: MouseEvent) => {
      if (!addPanel.visible) return;
      const el = addPanelRef.current;
      if (el && !el.contains(e.target as HTMLElement)) setAddPanel(v => ({ ...v, visible: false }));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [addPanel.visible]);

  // 监听点击事件，在空白区域点击时取消节点选择
  // 在 window 级别监听，确保能捕获到事件（即使 CSS 阻止了子元素的事件）
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      // pointer 模式下不自动取消选择
      if (isPointerMode) return;

      // 检查点击是否在容器内
      const rect = container.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        return; // 点击在容器外，不处理
      }

      // 检查是否点击了节点、连线或其他 Flow 交互元素
      const target = e.target as HTMLElement;
      if (target.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .tanva-add-panel, .tanva-flow-toolbar, [data-prevent-add-panel]')) {
        return; // 点击了 Flow 元素，不处理
      }

      // 检查是否是空白区域
      if (isBlankArea(e.clientX, e.clientY)) {
        // 取消所有节点的选择
        setNodes((prev: any[]) => prev.map((node) => ({ ...node, selected: false })));
      }
    };

    // 在 window 级别监听，使用捕获阶段确保能捕获到事件
    window.addEventListener('click', handleClick, true);
    return () => {
      window.removeEventListener('click', handleClick, true);
    };
  }, [isBlankArea, setNodes, isPointerMode]);

  // 在打开模板页签时加载内置与用户模板
  React.useEffect(() => {
    if (!addPanel.visible || addTab !== 'templates') return;
    let cancelled = false;
    (async () => {
      setTplLoading(true);
      try {
        if (!tplIndex) {
          const idx = await loadBuiltInTemplateIndex();
          const normalizedIdx = idx.map(item => ({ ...item, category: normalizeBuiltinCategory(item.category) }));
          if (!cancelled) {
            setTplIndex(normalizedIdx);
            setActiveBuiltinCategory(prev => {
              const hasPrev = normalizedIdx.some(item => normalizeBuiltinCategory(item.category) === prev);
              if (hasPrev) return prev;
              const fallback = BUILTIN_TEMPLATE_CATEGORIES.find(cat => normalizedIdx.some(item => normalizeBuiltinCategory(item.category) === cat.value));
              return fallback ? fallback.value : BUILTIN_TEMPLATE_CATEGORIES[0].value;
            });
          }
        }
        const list = await listUserTemplates();
        if (!cancelled) setUserTplList(list);
      } finally {
        if (!cancelled) setTplLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [addPanel.visible, addTab, tplIndex]);

  // 捕获原生点击，通过自定义检测实现双击（200ms 间隔），仅在真正空白 Pane 区域触发；排除 AI 对话框及其保护带
  React.useEffect(() => {
    const DOUBLE_CLICK_INTERVAL = 200; // 双击时间间隔（毫秒）
    const DOUBLE_CLICK_DISTANCE = 10; // 允许的最大移动距离（像素）

    const onNativeClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX, y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;

      // 若事件来源路径中包含受保护元素（AI 对话框等），直接忽略
      try {
        const path = (e.composedPath && e.composedPath()) || [];
        for (const n of path) {
          if (n && (n as any).closest && (n as HTMLElement).closest?.('[data-prevent-add-panel]')) {
            return;
          }
          if (n instanceof HTMLElement && n.getAttribute && n.getAttribute('data-prevent-add-panel') !== null) {
            return;
          }
        }
      } catch {}

      // 若在屏蔽元素或其外侧保护带内，忽略
      try {
        const shield = 24;
        const preventEls = Array.from(document.querySelectorAll('[data-prevent-add-panel]')) as HTMLElement[];
        for (const el of preventEls) {
          const r = el.getBoundingClientRect();
          if (x >= r.left - shield && x <= r.right + shield && y >= r.top - shield && y <= r.bottom + shield) {
            return;
          }
        }
      } catch {}

      // 自定义双击检测
      const now = Date.now();
      const last = lastGlobalClickRef.current;
      
      if (last && (now - last.t) < DOUBLE_CLICK_INTERVAL && Math.hypot(x - last.x, y - last.y) < DOUBLE_CLICK_DISTANCE) {
        // 检测到双击
        if (isBlankArea(x, y)) {
          e.stopPropagation();
          e.preventDefault();
          openAddPanelAt(x, y);
        }
        // 重置记录，避免连续三次点击被识别为两次双击
        lastGlobalClickRef.current = null;
      } else {
        // 更新点击记录
        lastGlobalClickRef.current = { t: now, x, y };
      }
    };

    window.addEventListener('click', onNativeClick, true);
    return () => window.removeEventListener('click', onNativeClick, true);
  }, [openAddPanelAt, isBlankArea]);

  const createNodeAtWorldCenter = React.useCallback((type: 'textPrompt' | 'textChat' | 'textNote' | 'promptOptimize' | 'image' | 'generate' | 'generatePro' | 'generatePro4' | 'generate4' | 'generateRef' | 'three' | 'camera' | 'analysis' | 'sora2Video' | 'storyboardSplit', world: { x: number; y: number }) => {
    // 以默认尺寸中心对齐放置
    const size = {
      textPrompt: { w: 240, h: 180 },
      textNote: { w: 220, h: 140 },
      textChat: { w: 320, h: 540 },
      promptOptimize: { w: 360, h: 300 },
      image: { w: 260, h: 240 },
      generate: { w: 260, h: 200 },
      generatePro: { w: 320, h: 400 },
      generatePro4: { w: 380, h: 480 },
      generate4: { w: 300, h: 240 },
      generateRef: { w: 260, h: 240 },
      three: { w: 280, h: 260 },
      camera: { w: 260, h: 220 },
      analysis: { w: 260, h: 280 },
      sora2Video: { w: 280, h: 260 },
      storyboardSplit: { w: 320, h: 400 },
    }[type];
    const id = `${type}_${Date.now()}`;
    const pos = { x: world.x - size.w / 2, y: world.y - size.h / 2 };
    const data = type === 'textPrompt' ? { text: '', boxW: size.w, boxH: size.h, title: 'Prompt' }
      : type === 'textNote' ? { text: '', boxW: size.w, boxH: size.h }
      : type === 'textChat' ? { status: 'idle' as const, manualInput: '', responseText: '', enableWebSearch: false, boxW: size.w, boxH: size.h }
      : type === 'promptOptimize' ? { text: '', expandedText: '', boxW: size.w, boxH: size.h }
      : type === 'image' ? { imageData: undefined, boxW: size.w, boxH: size.h }
      : type === 'generate' ? { status: 'idle' as const, boxW: size.w, boxH: size.h, presetPrompt: '' }
      : type === 'generatePro' ? { status: 'idle' as const, boxW: size.w, boxH: size.h, prompts: [''] }
      : type === 'generatePro4' ? { status: 'idle' as const, images: [], boxW: size.w, boxH: size.h, prompts: [''] }
      : type === 'generate4' ? { status: 'idle' as const, images: [], count: 4, boxW: size.w, boxH: size.h }
      : type === 'generateRef' ? { status: 'idle' as const, referencePrompt: undefined, boxW: size.w, boxH: size.h }
      : type === 'analysis' ? { status: 'idle' as const, prompt: '', analysisPrompt: undefined, boxW: size.w, boxH: size.h }
      : type === 'sora2Video' ? { status: 'idle' as const, videoUrl: undefined, thumbnail: undefined, videoQuality: DEFAULT_SORA2_VIDEO_QUALITY, videoVersion: 0, history: [], clipDuration: undefined, aspectRatio: undefined, boxW: size.w, boxH: size.h }
      : type === 'storyboardSplit' ? { status: 'idle' as const, inputText: '', segments: [], outputCount: 9, boxW: size.w, boxH: size.h }
      : { boxW: size.w, boxH: size.h };
    setNodes(ns => ns.concat([{ id, type, position: pos, data } as any]));
    try { historyService.commit('flow-add-node').catch(() => {}); } catch {}
    setAddPanel(v => ({ ...v, visible: false }));
    return id;
  }, [setNodes]);

  const textSourceTypes = React.useMemo(() => ['textPrompt','textChat','promptOptimize','analysis','textNote','storyboardSplit','generatePro','generatePro4'], []);
  const TEXT_PROMPT_MAX_CONNECTIONS = 20;
  const isTextHandle = React.useCallback((handle?: string | null) => typeof handle === 'string' && handle.startsWith('text'), []);

  const appendSora2History = React.useCallback((
    history: Sora2VideoHistoryItem[] | undefined,
    entry: Sora2VideoHistoryItem
  ): Sora2VideoHistoryItem[] => {
    const base = Array.isArray(history) ? history : [];
    const deduped = base.filter(item => item.videoUrl !== entry.videoUrl);
    return [entry, ...deduped].slice(0, SORA2_HISTORY_LIMIT);
  }, []);

  // 允许 TextPrompt -> Generate(text); Image/Generate(img) -> Generate(img)
  const isValidConnection = React.useCallback((connection: Connection) => {
    const { source, target, targetHandle } = connection;
    if (!source || !target || !targetHandle) return false;
    if (source === target) return false;

    const sourceNode = rf.getNode(source);
    const targetNode = rf.getNode(target);
    if (!sourceNode || !targetNode) return false;

    // 允许连接到 Generate / Generate4 / GenerateRef / Image / PromptOptimizer
    if (targetNode.type === 'generateRef') {
      if (targetHandle === 'text') return textSourceTypes.includes(sourceNode.type || '');
      if (targetHandle === 'image1' || targetHandle === 'refer') return ['image','generate','generate4','generatePro','generatePro4','three','camera'].includes(sourceNode.type || '');
      if (targetHandle === 'image2' || targetHandle === 'img') return ['image','generate','generate4','generatePro','generatePro4','three','camera'].includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'generate' || targetNode.type === 'generate4' || targetNode.type === 'generatePro' || targetNode.type === 'generatePro4') {
      if (targetHandle === 'text') return textSourceTypes.includes(sourceNode.type || '');
      if (targetHandle === 'img') return ['image','generate','generate4','generatePro','generatePro4','three','camera'].includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'sora2Video') {
      if (targetHandle === 'image') {
        return ['image','generate','generate4','generatePro','generatePro4','three','camera'].includes(sourceNode.type || '');
      }
      if (targetHandle === 'text') {
        return textSourceTypes.includes(sourceNode.type || '');
      }
      return false;
    }

    if (targetNode.type === 'image') {
      if (targetHandle === 'img') return ['image','generate','generate4','generatePro','generatePro4','three','camera'].includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'promptOptimize') {
      if (isTextHandle(targetHandle)) return textSourceTypes.includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'textPrompt') {
      if (isTextHandle(targetHandle)) return textSourceTypes.includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'analysis') {
      if (targetHandle === 'img') return ['image','generate','generate4','generatePro','generatePro4','three','camera'].includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'textChat') {
      if (isTextHandle(targetHandle)) return textSourceTypes.includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'textNote') {
      if (isTextHandle(targetHandle)) return textSourceTypes.includes(sourceNode.type || '');
      return false;
    }
    if (targetNode.type === 'storyboardSplit') {
      if (isTextHandle(targetHandle)) return textSourceTypes.includes(sourceNode.type || '');
      return false;
    }
    return false;
  }, [rf, isTextHandle, textSourceTypes]);

  // 限制：Generate(text) 仅一个连接；Generate(img) 最多6条
  const canAcceptConnection = React.useCallback((params: Connection) => {
    if (!params.target || !params.targetHandle) return false;
    const targetNode = rf.getNode(params.target);
    const currentEdges = rf.getEdges();
    const incoming = currentEdges.filter(e => e.target === params.target && e.targetHandle === params.targetHandle);
    if (targetNode?.type === 'generate' || targetNode?.type === 'generate4' || targetNode?.type === 'generatePro' || targetNode?.type === 'generatePro4') {
      if (params.targetHandle === 'text') return true; // 允许连接，新线会替换旧线
      if (params.targetHandle === 'img') return incoming.length < 6;
    }
    if (targetNode?.type === 'generateRef') {
      const handle = params.targetHandle;
      if (handle === 'text') return true;
      if (handle === 'image1' || handle === 'refer') return true;
      if (handle === 'image2' || handle === 'img') return true;
    }
    if (targetNode?.type === 'image') {
      if (params.targetHandle === 'img') return true; // 允许连接，新线会替换旧线
    }
    if (targetNode?.type === 'promptOptimize') {
      if (isTextHandle(params.targetHandle)) return true; // 仅一条连接，后续替换
    }
    if (targetNode?.type === 'textPrompt') {
      if (isTextHandle(params.targetHandle)) return incoming.length < TEXT_PROMPT_MAX_CONNECTIONS;
    }
    if (targetNode?.type === 'textNote') {
      if (isTextHandle(params.targetHandle)) return true;
    }
    if (targetNode?.type === 'sora2Video') {
      if (params.targetHandle === 'image') return true;
      if (params.targetHandle === 'text') return true;
    }
    if (targetNode?.type === 'analysis') {
      if (params.targetHandle === 'img') return true; // 仅一条连接，后续替换
    }
    if (targetNode?.type === 'textChat') {
      if (isTextHandle(params.targetHandle)) return true;
    }
    if (targetNode?.type === 'storyboardSplit') {
      if (isTextHandle(params.targetHandle)) return true;
    }
    return false;
  }, [rf, isTextHandle]);

  const onConnect = React.useCallback((params: Connection) => {
    if (!isValidConnection(params)) return;
    if (!canAcceptConnection(params)) return;

    setEdges((eds) => {
      let next = eds;
      const tgt = rf.getNode(params.target!);
      
      // 如果是连接到 Image(img)，先移除旧的输入线，再添加新线
      if ((tgt?.type === 'image' || tgt?.type === 'analysis') && params.targetHandle === 'img') {
        next = next.filter(e => !(e.target === params.target && e.targetHandle === 'img'));
      }
      
      // 如果是连接到 Generate(text) 或 PromptOptimize(text)，先移除旧的输入线，再添加新线
      if (((tgt?.type === 'generate') || (tgt?.type === 'generatePro') || (tgt?.type === 'generatePro4') || (tgt?.type === 'generate4') || (tgt?.type === 'generateRef') || (tgt?.type === 'promptOptimize') || (tgt?.type === 'textNote') || (tgt?.type === 'sora2Video') || (tgt?.type === 'storyboardSplit')) && isTextHandle(params.targetHandle)) {
        next = next.filter(e => !(e.target === params.target && e.targetHandle === params.targetHandle));
      }
      if ((tgt?.type === 'sora2Video') && params.targetHandle === 'image') {
        next = next.filter(e => !(e.target === params.target && e.targetHandle === 'image'));
      }
      if (tgt?.type === 'generateRef') {
        const image1Handles = ['image1','refer'];
        const image2Handles = ['image2','img'];
        if (params.targetHandle && image1Handles.includes(params.targetHandle)) {
          next = next.filter(e => !(e.target === params.target && image1Handles.includes((e.targetHandle || ''))));
        } else if (params.targetHandle && image2Handles.includes(params.targetHandle)) {
          next = next.filter(e => !(e.target === params.target && image2Handles.includes((e.targetHandle || ''))));
        }
      }
      const out = addEdge({ ...params, type: 'default' }, next);
      return out;
    });
    try { historyService.commit('flow-connect').catch(() => {}); } catch {}

    // 若连接到 Image(img)，立即把源图像写入目标
    try {
      const target = rf.getNode(params.target!);
      if ((target?.type === 'image' || target?.type === 'analysis') && params.targetHandle === 'img' && params.source) {
        const src = rf.getNode(params.source);
        let img: string | undefined;
        let incomingImageName: string | undefined;
        if (src?.type === 'generate4' || src?.type === 'generatePro4') {
          const handle = (params as any).sourceHandle as string | undefined;
          const idx = handle && handle.startsWith('img') ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1)) : 0;
          const imgs = (src.data as any)?.images as string[] | undefined;
          img = imgs?.[idx];
          const imageNames = (src.data as any)?.imageNames as string[] | undefined;
          if (Array.isArray(imageNames)) {
            incomingImageName = imageNames[idx];
          }
          if (!img) {
            // 回退到 imageData（若实现了镜像）
            img = (src.data as any)?.imageData;
            incomingImageName = incomingImageName ?? (src.data as any)?.imageName;
          }
        } else {
          img = (src?.data as any)?.imageData;
          incomingImageName = (src?.data as any)?.imageName;
        }
        const normalizedIncomingName = typeof incomingImageName === 'string'
          ? incomingImageName.trim()
          : '';
        if (img) {
          setNodes(ns => ns.map(n => {
            if (n.id !== target.id) return n;
            const resetStatus = target.type === 'analysis'
              ? { status: 'idle', error: undefined, prompt: '', text: '' }
              : {};
            return {
              ...n,
              data: {
                ...n.data,
                imageData: img,
                imageName: normalizedIncomingName || undefined,
                ...resetStatus
              }
            };
          }));
        }
      }
    } catch {}
    setIsConnecting(false);
  }, [isValidConnection, canAcceptConnection, setEdges, rf, setNodes, isTextHandle, setIsConnecting]);

  // 监听来自节点的本地数据写入（TextPrompt）
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; patch: Record<string, any> };
      if (!detail?.id) return;

      // 处理位置偏移（用于中心点缩放）
      const positionOffset = detail.patch?._positionOffset;

      setNodes((ns) => ns.map((n) => {
        if (n.id !== detail.id) return n;
        const patch = { ...(detail.patch || {}) };

        // 移除内部使用的 _positionOffset
        delete patch._positionOffset;

        if (Object.prototype.hasOwnProperty.call(patch, 'imageData') &&
            !Object.prototype.hasOwnProperty.call(patch, 'imageName')) {
          patch.imageName = undefined;
        }

        // 如果有位置偏移，同时更新节点位置
        let newPosition = n.position;
        if (positionOffset) {
          newPosition = {
            x: n.position.x + positionOffset.x,
            y: n.position.y + positionOffset.y,
          };
        }

        return { ...n, position: newPosition, data: { ...n.data, ...patch } };
      }));
      // 若目标是 Image 且设置了 imageData 为空，自动断开输入连线
      if (Object.prototype.hasOwnProperty.call(detail.patch, 'imageData') && !detail.patch.imageData) {
        setEdges(eds => eds.filter(e => !(e.target === detail.id && e.targetHandle === 'img')));
      }
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [setNodes]);

  // 监听双击输出节点创建新节点并连线
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        sourceId: string;
        sourceHandle: string;
        targetHandle: string;
        nodeType: string;
        offsetX: number;
      };
      if (!detail?.sourceId || !detail?.nodeType) return;

      const sourceNode = rf.getNode(detail.sourceId);
      if (!sourceNode) return;

      // 创建新节点 ID
      const newId = `${detail.nodeType}_${Date.now()}`;

      // 计算新节点位置（在源节点右侧）
      const newPosition = {
        x: sourceNode.position.x + detail.offsetX,
        y: sourceNode.position.y,
      };

      // 根据节点类型创建默认数据
      const newData = detail.nodeType === 'generatePro'
        ? { status: 'idle' as const, prompts: [''], imageWidth: 296 }
        : { status: 'idle' as const };

      // 添加新节点
      setNodes(ns => ns.concat([{
        id: newId,
        type: detail.nodeType,
        position: newPosition,
        data: newData,
        selected: true,
      } as any]));

      // 取消选中源节点，选中新节点
      setNodes(ns => ns.map(n => ({
        ...n,
        selected: n.id === newId,
      })));

      // 创建连线
      setEdges(eds => addEdge({
        source: detail.sourceId,
        sourceHandle: detail.sourceHandle,
        target: newId,
        targetHandle: detail.targetHandle,
      }, eds));
    };
    window.addEventListener('flow:duplicateAndConnect', handler as EventListener);
    return () => window.removeEventListener('flow:duplicateAndConnect', handler as EventListener);
  }, [rf, setNodes, setEdges]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { imageData?: string; label?: string; imageName?: string };
      if (!detail?.imageData) return;
      const normalizedImageName = detail.imageName?.trim();
      const rect = containerRef.current?.getBoundingClientRect();
      const screenPosition = {
        x: (rect?.width || window.innerWidth) / 2 + (Math.random() * 120 - 60),
        y: (rect?.height || window.innerHeight) / 2 + 60 + (Math.random() * 80 - 40),
      };
      const position = rf.screenToFlowPosition(screenPosition);
      const id = `img_${Date.now()}`;
      setNodes(ns => ns.concat([{
        id,
        type: 'image',
        position,
        data: {
          imageData: detail.imageData,
          label: detail.label || 'Image',
          imageName: normalizedImageName || undefined,
          boxW: 260,
          boxH: 240,
        },
        selected: true,
      } as any]));
      try {
        historyService.commit('flow-create-image-from-canvas').catch(() => {});
      } catch {}
    };
    window.addEventListener('flow:createImageNode', handler as EventListener);
    return () => window.removeEventListener('flow:createImageNode', handler as EventListener);
  }, [rf, setNodes]);


  // 运行：根据输入自动选择 生图/编辑/融合（支持 generate / generate4 / generateRef）
  const runNode = React.useCallback(async (nodeId: string) => {
    const node = rf.getNode(nodeId);
    if (!node) return;

    const currentEdges = rf.getEdges();

    const resolveImageData = (edge: Edge): string | undefined => {
      const srcNode = rf.getNode(edge.source);
      if (!srcNode) return undefined;
      const data = (srcNode.data as any);

      if (srcNode.type === 'generate4' || srcNode.type === 'generatePro4') {
        const handle = (edge as any).sourceHandle as string | undefined;
        const idx = handle?.startsWith('img')
          ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1))
          : 0;
        const imgs = Array.isArray(data?.images) ? data.images as string[] : undefined;
        let img = imgs?.[idx];
        if (!img && typeof data?.imageData === 'string' && data.imageData.length) {
          img = data.imageData;
        }
        return img;
      }

      return typeof data?.imageData === 'string' ? data.imageData : undefined;
    };

    const collectImages = (edgesToCollect: Edge[]) =>
      edgesToCollect
        .map(resolveImageData)
        .filter((img): img is string => typeof img === 'string' && img.length > 0);
    const getTextPromptForNode = (targetId: string) => {
      const textEdge = currentEdges.find(e => e.target === targetId && e.targetHandle === 'text');
      if (!textEdge) return { text: '', hasEdge: false };
      const promptNode = rf.getNode(textEdge.source);
      if (!promptNode) return { text: '', hasEdge: true };
      const resolved = resolveTextFromSourceNode(promptNode, textEdge.sourceHandle);
      return { text: resolved?.trim() || '', hasEdge: true };
    };

    if (node.type === 'sora2Video') {
      const projectId = useProjectContentStore.getState().projectId;
      const { text: promptText, hasEdge: hasText } = getTextPromptForNode(nodeId);
      if (!hasText) {
        setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: '缺少 TextPrompt 输入' } } : n));
        return;
      }
      if (!promptText) {
        setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: '提示词为空' } } : n));
        return;
      }

      const clipDuration = typeof (node.data as any)?.clipDuration === 'number'
        ? (node.data as any).clipDuration
        : undefined;
      const aspectSetting = typeof (node.data as any)?.aspectRatio === 'string'
        ? (node.data as any).aspectRatio
        : '';
      const suffixPieces: string[] = [];
      if (clipDuration) suffixPieces.push(`${clipDuration}s`);
      if (aspectSetting) {
        suffixPieces.push(aspectSetting === '9:16' ? '竖屏 9:16' : '横屏 16:9');
      }
      const finalPromptText = suffixPieces.length
        ? `${promptText} ${suffixPieces.join(' ')}`
        : promptText;

      const imageEdges = currentEdges
        .filter(e => e.target === nodeId && e.targetHandle === 'image')
        .slice(0, 1);
      const referenceImages = collectImages(imageEdges);

      let referenceImageUrl: string | undefined;
      if (referenceImages.length) {
        try {
          const dataUrl = ensureDataUrl(referenceImages[0]);
          const uploaded = await uploadImageToOSS(dataUrl, projectId);
          if (!uploaded) {
            setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: '参考图上传失败' } } : n));
            return;
          }
          referenceImageUrl = uploaded;
        } catch (error) {
          const msg = error instanceof Error ? error.message : '参考图上传失败';
          setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: msg } } : n));
          return;
        }
      }

      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'running', error: undefined } } : n));
      const videoQuality = (node.data as any)?.videoQuality === 'sd' ? 'sd' : DEFAULT_SORA2_VIDEO_QUALITY;

      try {
        const videoResult = await requestSora2VideoGeneration(
          finalPromptText,
          referenceImageUrl,
          { quality: videoQuality }
        );
        setNodes(ns => ns.map(n => {
          if (n.id !== nodeId) return n;
          const previousData = (n.data as any) || {};
          const nextThumbnail = videoResult.thumbnailUrl || previousData.thumbnail;
          const historyEntry: Sora2VideoHistoryItem = {
            id: `sora2-history-${Date.now()}`,
            videoUrl: videoResult.videoUrl,
            thumbnail: nextThumbnail,
            prompt: finalPromptText,
            quality: videoQuality,
            createdAt: new Date().toISOString(),
          };
          return {
            ...n,
            data: {
              ...previousData,
              status: 'succeeded',
              videoUrl: videoResult.videoUrl,
              thumbnail: nextThumbnail,
              error: undefined,
              videoVersion: Number(previousData.videoVersion || 0) + 1,
              history: appendSora2History(previousData.history as Sora2VideoHistoryItem[] | undefined, historyEntry),
            }
          };
        }));
      } catch (error) {
        const msg = error instanceof Error ? error.message : '视频生成失败';
        setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: msg } } : n));
      }
      return;
    }

    if (
      node.type !== 'generate' &&
      node.type !== 'generate4' &&
      node.type !== 'generateRef' &&
      node.type !== 'generatePro' &&
      node.type !== 'generatePro4'
    ) return;

    const { text: promptFromText, hasEdge: hasPromptEdge } = getTextPromptForNode(nodeId);

    const failWithMessage = (message: string) => {
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: message } } : n));
    };

    let prompt = '';

    if (node.type === 'generateRef') {
      const rawBase = typeof (node.data as any)?.referencePrompt === 'string'
        ? (node.data as any).referencePrompt
        : '';
      const basePrompt = rawBase.trim().length ? rawBase.trim() : DEFAULT_REFERENCE_PROMPT;
      const pieces = [basePrompt, promptFromText.trim()].filter(Boolean);
      prompt = pieces.join('，').trim();
      if (!prompt.length) {
        failWithMessage('提示词为空');
        return;
      }
    } else if (node.type === 'generatePro' || node.type === 'generatePro4') {
      // GeneratePro / GeneratePro4: 合并本地 prompts 数组和外部提示词
      const localPrompts = (() => {
        const raw = (node.data as any)?.prompts;
        if (Array.isArray(raw)) {
          return raw.filter((p: unknown) => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim());
        }
        return [];
      })();
      const externalPrompt = promptFromText.trim();

      // 合并：外部提示词 + 本地提示词数组（依次叠加）
      const allPrompts = [externalPrompt, ...localPrompts].filter(Boolean);
      prompt = allPrompts.join(' ').trim();

      if (!prompt.length) {
        failWithMessage('提示词为空（请输入本地提示词或连接外部提示词）');
        return;
      }
    } else {
      if (!hasPromptEdge) {
        failWithMessage('缺少 TextPrompt 输入');
        return;
      }
      prompt = promptFromText.trim();
      if (!prompt.length) {
        failWithMessage('提示词为空');
        return;
      }
    }

    if (node.type === 'generate') {
      const preset = (() => {
        const raw = (node.data as any)?.presetPrompt;
        return typeof raw === 'string' ? raw.trim() : '';
      })();
      if (preset) {
        prompt = `${preset} ${prompt}`.trim();
      }
    }

    let imageDatas: string[] = [];

    if (node.type === 'generateRef') {
      const primaryEdges = currentEdges
        .filter(e => e.target === nodeId && ['image2','img'].includes((e.targetHandle || '')))
        .slice(0, 1);
      const referEdges = currentEdges
        .filter(e => e.target === nodeId && ['image1','refer'].includes((e.targetHandle || '')))
        .slice(0, 1);
      imageDatas = [...collectImages(primaryEdges), ...collectImages(referEdges)];
    } else {
      const imgEdges = currentEdges.filter(e => e.target === nodeId && e.targetHandle === 'img').slice(0, 6);
      imageDatas = collectImages(imgEdges);
    }

    const aspectRatioValue = (() => {
      const raw = (node.data as any)?.aspectRatio;
      return typeof raw === 'string' && raw.trim().length ? raw.trim() as AIImageGenerateRequest['aspectRatio'] : undefined;
    })();

    if (node.type === 'generate4') {
      const total = Math.max(1, Math.min(4, Number((node.data as any)?.count) || 4));
      setNodes(ns => ns.map(n => n.id === nodeId ? {
        ...n,
        data: { ...n.data, status: 'running', error: undefined, images: [] }
      } : n));
      const produced: string[] = [];
      const updateMultiGenerateProgress = (completedSlots: number) => {
        const ratio = Math.max(0, Math.min(1, completedSlots / total));
        setNodes(ns => ns.map(n => n.id === nodeId ? {
          ...n,
          data: { ...n.data, images: [...produced] }
        } : n));
      };

      for (let i = 0; i < total; i++) {
        let generatedImage: string | undefined;
        try {
          let result: { success: boolean; data?: AIImageResult; error?: { message: string } };
          if (imageDatas.length === 0) {
            result = await generateImageViaAPI({
              prompt,
              outputFormat: 'png',
              aiProvider,
              model: imageModel,
              aspectRatio: aspectRatioValue,
              imageSize: imageSize || undefined,
            });
          } else if (imageDatas.length === 1) {
            result = await editImageViaAPI({
              prompt,
              sourceImage: imageDatas[0],
              outputFormat: 'png',
              aiProvider,
              model: imageModel,
              aspectRatio: aspectRatioValue,
              imageSize: imageSize || undefined,
            });
          } else {
            result = await blendImagesViaAPI({
              prompt,
              sourceImages: imageDatas.slice(0, 6),
              outputFormat: 'png',
              aiProvider,
              model: imageModel,
              aspectRatio: aspectRatioValue,
              imageSize: imageSize || undefined,
            });
          }

          if (!result.success || !result.data || !result.data.imageData) {
            if (result.success && result.data && !result.data.imageData) {
              console.warn('⚠️ Flow generate4 success but no image returned', {
                nodeId,
                slot: i,
                aiProvider,
                model: imageModel,
                prompt,
                hasImage: !!result.data.imageData,
              });
            }
          } else {
            generatedImage = result.data.imageData;
          }
        } catch {
          // 忽略单张失败，继续下一张
        }

        if (generatedImage) {
          produced[i] = generatedImage;

          const outs = rf.getEdges().filter(e => e.source === nodeId && (e as any).sourceHandle === `img${i + 1}`);
          if (outs.length) {
            const imgB64 = generatedImage;
            setNodes(ns => ns.map(n => {
              const hits = outs.filter(e => e.target === n.id);
              if (!hits.length) return n;
              if (n.type === 'image' && imgB64) return { ...n, data: { ...n.data, imageData: imgB64 } };
              return n;
            }));
          }
        }

        updateMultiGenerateProgress(i + 1);
      }

      const hasAny = produced.filter(Boolean).length > 0;
      setNodes(ns => ns.map(n => n.id === nodeId ? {
        ...n,
        data: {
          ...n.data,
          status: hasAny ? 'succeeded' : 'failed',
          error: hasAny ? undefined : '全部生成失败',
          images: [...produced],
        }
      } : n));
      return;
    }

    // 处理 generatePro4 节点：并发生成4张图片
    if (node.type === 'generatePro4') {
      const total = 4;
      setNodes(ns => ns.map(n => n.id === nodeId ? {
        ...n,
        data: { ...n.data, status: 'running', error: undefined, images: [] }
      } : n));

      // 并发生成4张图片
      const generateSingleImage = async (index: number): Promise<{ index: number; image?: string; error?: string }> => {
        try {
          let result: { success: boolean; data?: AIImageResult; error?: { message: string } };
          if (imageDatas.length === 0) {
            result = await generateImageViaAPI({
              prompt,
              outputFormat: 'png',
              aiProvider,
              model: imageModel,
              aspectRatio: aspectRatioValue,
              imageSize: imageSize || undefined,
            });
          } else if (imageDatas.length === 1) {
            result = await editImageViaAPI({
              prompt,
              sourceImage: imageDatas[0],
              outputFormat: 'png',
              aiProvider,
              model: imageModel,
              aspectRatio: aspectRatioValue,
              imageSize: imageSize || undefined,
            });
          } else {
            result = await blendImagesViaAPI({
              prompt,
              sourceImages: imageDatas.slice(0, 6),
              outputFormat: 'png',
              aiProvider,
              model: imageModel,
              aspectRatio: aspectRatioValue,
              imageSize: imageSize || undefined,
            });
          }

          if (result.success && result.data?.imageData) {
            return { index, image: result.data.imageData };
          }
          // 返回错误信息
          return { index, error: result.error?.message || '生成失败' };
        } catch (err) {
          console.error(`[generatePro4] Image ${index} generation error:`, err);
          return { index, error: err instanceof Error ? err.message : '生成异常' };
        }
      };

      // 创建4个并发任务
      const tasks = Array.from({ length: total }, (_, i) => generateSingleImage(i));
      const produced: string[] = new Array(total).fill('');
      const errors: string[] = [];

      // 使用 Promise.all 等待所有任务完成，同时监听每个完成的结果
      const results = await Promise.all(
        tasks.map(async (task) => {
          const result = await task;
          if (result.image) {
            produced[result.index] = result.image;

            // 更新UI显示已完成的图片
            setNodes(ns => ns.map(n => n.id === nodeId ? {
              ...n,
              data: { ...n.data, images: [...produced] }
            } : n));

            // 更新连接的下游节点
            const outs = rf.getEdges().filter(e => e.source === nodeId && (e as any).sourceHandle === `img${result.index + 1}`);
            if (outs.length) {
              const imgB64 = result.image;
              setNodes(ns => ns.map(n => {
                const hits = outs.filter(e => e.target === n.id);
                if (!hits.length) return n;
                if (n.type === 'image' && imgB64) return { ...n, data: { ...n.data, imageData: imgB64 } };
                return n;
              }));
            }
          } else if (result.error) {
            errors.push(`图${result.index + 1}: ${result.error}`);
          }
          return result;
        })
      );

      const hasAny = produced.filter(Boolean).length > 0;
      const errorMsg = errors.length > 0 ? errors.join('; ') : '全部生成失败';
      setNodes(ns => ns.map(n => n.id === nodeId ? {
        ...n,
        data: {
          ...n.data,
          status: hasAny ? 'succeeded' : 'failed',
          error: hasAny ? undefined : errorMsg,
          images: [...produced],
        }
      } : n));
      return;
    }

    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'running', error: undefined } } : n));

    try {
      let result: { success: boolean; data?: AIImageResult; error?: { message: string } };

      if (imageDatas.length === 0) {
        result = await generateImageViaAPI({
          prompt,
          outputFormat: 'png',
          aiProvider,
          model: imageModel,
          aspectRatio: aspectRatioValue,
          imageSize: imageSize || undefined,
        });
      } else if (imageDatas.length === 1) {
        result = await editImageViaAPI({
          prompt,
          sourceImage: imageDatas[0],
          outputFormat: 'png',
          aiProvider,
          model: imageModel,
          aspectRatio: aspectRatioValue,
          imageSize: imageSize || undefined,
        });
      } else {
        result = await blendImagesViaAPI({
          prompt,
          sourceImages: imageDatas.slice(0, 6),
          outputFormat: 'png',
          aiProvider,
          model: imageModel,
          aspectRatio: aspectRatioValue,
          imageSize: imageSize || undefined,
        });
      }

      if (!result.success || !result.data) {
        const msg = result.error?.message || '执行失败';
        setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: msg } } : n));
        return;
      }

      const out = result.data;
      const imgBase64 = out.imageData;
      if (!imgBase64) {
        console.warn('⚠️ Flow generate success but no image returned', {
          nodeId,
          aiProvider,
          model: imageModel,
          prompt,
          hasImage: !!imgBase64,
        });
      }

      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'succeeded', imageData: imgBase64, error: undefined } } : n));

      if (imgBase64) {
        const outs = rf.getEdges().filter(e => e.source === nodeId);
        if (outs.length) {
          setNodes(ns => ns.map(n => {
            const hits = outs.filter(e => e.target === n.id);
            if (!hits.length) return n;
            if (n.type === 'image') return { ...n, data: { ...n.data, imageData: imgBase64 } };
            return n;
          }));
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: msg } } : n));
    }
  }, [aiProvider, imageModel, rf, setNodes, appendSora2History]);

  // 定义稳定的onSend回调
  const onSendHandler = React.useCallback((id: string) => {
    const node = rf.getNode(id);
    if (!node) return;
    const mime = 'image/png';
    if (node.type === 'generate4') {
      const imgs = ((node.data as any)?.images as string[] | undefined) || [];
      if (!imgs.length) return;
      imgs.forEach((img, idx) => {
        if (!img) return;
        const dataUrl = `data:${mime};base64,${img}`;
        const fileName = `flow_${id}_${idx + 1}.png`;
        window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
          detail: {
            imageData: dataUrl,
            fileName,
            operationType: 'generate',
            smartPosition: undefined,
            sourceImageId: undefined,
            sourceImages: undefined,
          }
        }));
      });
      return;
    }
    // 默认单图
    const img = (node.data as any)?.imageData as string | undefined;
    if (!img) return;
    const dataUrl = `data:${mime};base64,${img}`;
    const fileName = `flow_${Date.now()}.png`;
    window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
      detail: {
        imageData: dataUrl,
        fileName,
        operationType: 'generate',
        smartPosition: undefined,
        sourceImageId: undefined,
        sourceImages: undefined,
      }
    }));
  }, [rf]);

  // 连接状态回调
  const onConnectStart = React.useCallback(() => setIsConnecting(true), [setIsConnecting]);
  const onConnectStop = React.useCallback(() => setIsConnecting(false), [setIsConnecting]);
  const onConnectEnd = React.useCallback(() => setIsConnecting(false), [setIsConnecting]);

  // 在 node 渲染前为 Generate 节点注入 onRun 回调
  const nodesWithHandlers = React.useMemo(() => nodes.map(n => (
    (n.type === 'generate' || n.type === 'generate4' || n.type === 'generateRef' || n.type === 'generatePro' || n.type === 'generatePro4')
      ? { ...n, data: { ...n.data, onRun: runNode, onSend: onSendHandler } }
      : n.type === 'sora2Video'
        ? { ...n, data: { ...n.data, onRun: runNode } }
        : n
  )), [nodes, runNode, onSendHandler]);

  // 简单的全局调试API，便于从控制台添加节点
  React.useEffect(() => {
    (window as any).tanvaFlow = {
      addTextPrompt: (x = 0, y = 0, text = '') => {
        const id = `tp_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'textPrompt', position: { x, y }, data: { text, title: 'Prompt' } }] as any));
        return id;
      },
      addTextNote: (x = 0, y = 0, text = '') => {
        const id = `tn_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'textNote', position: { x, y }, data: { text } }] as any));
        return id;
      },
      addImage: (x = 0, y = 0, imageData?: string) => {
        const id = `img_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'image', position: { x, y }, data: { imageData } }] as any));
        return id;
      },
      addThree: (x = 0, y = 0) => {
        const id = `three_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'three', position: { x, y }, data: {} }] as any));
        return id;
      },
      addCamera: (x = 0, y = 0) => {
        const id = `camera_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'camera', position: { x, y }, data: {} }] as any));
        return id;
      },
      addGenerate: (x = 0, y = 0) => {
        const id = `gen_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'generate', position: { x, y }, data: { status: 'idle', presetPrompt: '' } }] as any));
        return id;
      },
      addGenerate4: (x = 0, y = 0) => {
        const id = `gen4_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'generate4', position: { x, y }, data: { status: 'idle', images: [], count: 4 } }] as any));
        return id;
      },
      connect: (source: string, target: string, targetHandle: 'text' | 'img' | 'image1' | 'image2' | 'refer' | 'text-top-in' | 'text-bottom-in' | 'text-left-in' | 'text-right-in') => {
        const conn = { source, target, targetHandle } as any;
        if (isValidConnection(conn as any) && canAcceptConnection(conn as any)) {
          setEdges(eds => addEdge(conn, eds));
          return true;
        }
        return false;
      }
    };
    return () => { delete (window as any).tanvaFlow; };
  }, [setNodes, setEdges, isValidConnection, canAcceptConnection]);

  const addAtCenter = React.useCallback((type: 'textPrompt' | 'textChat' | 'textNote' | 'promptOptimize' | 'image' | 'generate' | 'generatePro' | 'generate4' | 'generateRef' | 'analysis') => {
    const rect = containerRef.current?.getBoundingClientRect();
    const centerScreen = {
      x: (rect?.width || window.innerWidth) / 2,
      y: (rect?.height || window.innerHeight) / 2,
    };
    const center = rf.screenToFlowPosition(centerScreen);
    const id = `${type}_${Date.now()}`;
    const base: any = {
      id,
      type,
      position: center,
      data:
        type === 'textPrompt' ? { text: '', title: 'Prompt' } :
        type === 'textNote' ? { text: '' } :
        type === 'textChat' ? { status: 'idle' as const, manualInput: '', responseText: '', enableWebSearch: false } :
        type === 'promptOptimize' ? { text: '', expandedText: '' } :
        type === 'generate' ? { status: 'idle', presetPrompt: '' } :
        type === 'generatePro' ? { status: 'idle', prompts: [''] } :
        type === 'generate4' ? { status: 'idle', images: [], count: 4 } :
        type === 'generateRef' ? { status: 'idle', referencePrompt: undefined } :
        type === 'analysis' ? { status: 'idle', prompt: '', analysisPrompt: undefined } :
        { imageData: undefined }
    };
    setNodes(ns => ns.concat([base]));
    try { historyService.commit('flow-add-at-center').catch(() => {}); } catch {}
    return id;
  }, [rf, setNodes]);

  const showFlowPanel = useUIStore(s => s.showFlowPanel);
  const flowUIEnabled = useUIStore(s => s.flowUIEnabled);
  const focusMode = useUIStore(s => s.focusMode);

  const FlowToolbar = flowUIEnabled && showFlowPanel ? (
    <div className="tanva-flow-toolbar"
      style={{ position: 'absolute', top: 56, right: 16, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.9)', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}
    >
      <button onClick={() => addAtCenter('textPrompt')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>文字</button>
      <button onClick={() => addAtCenter('textNote')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>文本卡片</button>
      <button onClick={() => addAtCenter('textChat')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>文字交互</button>
      <button onClick={() => addAtCenter('promptOptimize')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>优化</button>
      <button onClick={() => addAtCenter('analysis')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>分析</button>
      <button onClick={() => addAtCenter('image')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>图片</button>
      <button onClick={() => addAtCenter('generate')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#111827', color: '#fff' }}>生成</button>
      <button onClick={() => addAtCenter('generateRef')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#111827', color: '#fff' }}>参考生成</button>
      <button onClick={() => addAtCenter('generate4')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#111827', color: '#fff' }}>Multi Generate</button>
      <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <input type="checkbox" checked={backgroundEnabled} onChange={(e) => setBackgroundEnabled(e.target.checked)} /> Flow背景
      </label>
      {backgroundEnabled && (
        <>
          <select 
            value={backgroundVariant} 
            onChange={(e) => setBackgroundVariant(e.target.value as FlowBackgroundVariant)} 
            style={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 6px', background: '#fff' }}
          >
            <option value={FlowBackgroundVariant.DOTS}>点阵</option>
            <option value={FlowBackgroundVariant.LINES}>网格线</option>
            <option value={FlowBackgroundVariant.CROSS}>十字网格</option>
          </select>
          <input
            type="color"
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
            title="背景颜色"
            style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent' }}
          />
          <label style={{ fontSize: 12 }}>间距
            <input
              type="number"
              inputMode="numeric"
              min={4}
              max={100}
              value={bgGapInput}
              onChange={(e) => setBgGapInput(e.target.value)}
              onBlur={(e) => commitGap(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitGap((e.target as HTMLInputElement).value); }}
              style={{ width: 56, marginLeft: 4, border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 6px' }}
            />
          </label>
          <label style={{ fontSize: 12 }}>尺寸
            <input
              type="number"
              inputMode="numeric"
              min={0.5}
              max={10}
              step={0.5}
              value={bgSizeInput}
              onChange={(e) => setBgSizeInput(e.target.value)}
              onBlur={(e) => commitSize(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitSize((e.target as HTMLInputElement).value); }}
              style={{ width: 44, marginLeft: 4, border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 6px' }}
            />
          </label>
          <label style={{ fontSize: 12 }}>透明度
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={backgroundOpacity}
              onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
              style={{ width: 60, marginLeft: 4 }}
            />
          </label>
        </>
      )}
    </div>
  ) : null;

  // 计算添加面板的容器内定位
  const addPanelStyle = React.useMemo(() => {
    if (!addPanel.visible) return { display: 'none' } as React.CSSProperties;
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect ? rect.width / 2 : window.innerWidth / 2;
    const top = rect ? rect.height / 2 : window.innerHeight / 2;
    // 始终在视窗（容器）中心显示：用 translate(-50%, -50%) 校正为居中
    return { position: 'absolute', left, top, transform: 'translate(-50%, -50%)', zIndex: 20 } as React.CSSProperties;
  }, [addPanel.visible]);

  const handleContainerDoubleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isBlankArea(e.clientX, e.clientY)) openAddPanelAt(e.clientX, e.clientY);
  }, [openAddPanelAt, isBlankArea]);

  const commitEdgeLabelValue = React.useCallback((edgeId: string, value: string) => {
    const trimmed = value.trim();
    let changed = false;
    setEdges(prev =>
      prev.map(edge => {
        if (edge.id !== edgeId) return edge;
        const prevValue = typeof edge.label === 'string' ? edge.label : '';
        if (prevValue === trimmed) return edge;
        changed = true;
        if (trimmed) {
          return { ...edge, label: trimmed };
        }
        const next = { ...edge };
        delete (next as any).label;
        return next;
      })
    );
    if (changed) {
      try { historyService.commit('flow-edge-label').catch(() => {}); } catch {}
    }
  }, [setEdges]);

  const finalizeEdgeLabelEditor = React.useCallback((commit: boolean) => {
    setEdgeLabelEditor(prev => {
      if (commit && prev.edgeId) {
        commitEdgeLabelValue(prev.edgeId, prev.value);
      }
      return createEdgeLabelEditorState();
    });
  }, [commitEdgeLabelValue]);

  const handleEdgeLabelChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setEdgeLabelEditor(prev => ({ ...prev, value }));
  }, []);

  const handleEdgeLabelKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finalizeEdgeLabelEditor(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finalizeEdgeLabelEditor(false);
    }
  }, [finalizeEdgeLabelEditor]);

  const handleEdgeLabelBlur = React.useCallback(() => {
    finalizeEdgeLabelEditor(true);
  }, [finalizeEdgeLabelEditor]);

  const handleEdgeDoubleClick = React.useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();

    const containerRect = containerRef.current?.getBoundingClientRect();
    const targetElement = event.target as HTMLElement | null;
    const targetRect = targetElement?.getBoundingClientRect?.();
    const globalX = targetRect ? targetRect.left + targetRect.width / 2 : event.clientX;
    const globalY = targetRect ? targetRect.top + targetRect.height / 2 : event.clientY;
    let localX = containerRect ? globalX - containerRect.left : globalX;
    let localY = containerRect ? globalY - containerRect.top : globalY;
    if (containerRect) {
      const margin = 16;
      localX = Math.min(Math.max(margin, localX), containerRect.width - margin);
      localY = Math.min(Math.max(margin, localY), containerRect.height - margin);
    }

    const allEdges = (rf.getEdges?.() || edges) as Edge[];
    const currentEdge = allEdges.find(e => e.id === edge.id);
    const existingValue = typeof currentEdge?.label === 'string' ? currentEdge.label : '';

    setEdgeLabelEditor(prev => {
      if (prev.visible && prev.edgeId && prev.edgeId !== edge.id) {
        commitEdgeLabelValue(prev.edgeId, prev.value);
      }
      return {
        visible: true,
        edgeId: edge.id,
        value: existingValue,
        position: { x: localX, y: localY },
      };
    });

    try {
      const selection = window.getSelection?.();
      selection?.removeAllRanges?.();
    } catch {}
  }, [rf, edges, commitEdgeLabelValue]);

  // -------- 模板：实例化与保存 --------
  const instantiateTemplateAt = React.useCallback(async (tpl: FlowTemplate, world: { x: number; y: number }) => {
    if (!tpl?.nodes?.length) return;
    const minX = Math.min(...tpl.nodes.map(n => n.position?.x || 0));
    const minY = Math.min(...tpl.nodes.map(n => n.position?.y || 0));
    const idMap = new Map<string,string>();
    const newNodes = tpl.nodes.map(n => {
      const newId = generateId(n.type || 'n');
      idMap.set(n.id, newId);
      const data: any = { ...(n.data || {}) };
      delete data.onRun; delete data.onSend; delete data.status; delete data.error;
      return {
        id: newId,
        type: n.type as any,
        position: { x: world.x + (n.position.x - minX), y: world.y + (n.position.y - minY) },
        data,
      } as any;
    });
    const newEdges = (tpl.edges || []).map(e => ({
      id: generateId('e'),
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      sourceHandle: (e as any).sourceHandle,
      targetHandle: (e as any).targetHandle,
      type: e.type || 'default',
      label: e.label,
    })) as any[];
    setNodes(ns => ns.concat(newNodes));
    setEdges(es => es.concat(newEdges));
    setAddPanel(v => ({ ...v, visible: false }));
  }, [setNodes, setEdges]);

  const saveCurrentAsTemplate = React.useCallback(async () => {
    const allNodes = rf.getNodes();
    const selected = allNodes.filter((n: any) => n.selected);
    const nodesToSave = selected.length ? selected : allNodes;
    if (!nodesToSave.length) return;
    const edgesAll = rf.getEdges();
    const nodeIdSet = new Set(nodesToSave.map(n => n.id));
    const edgesToSave = edgesAll.filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
    const name = prompt('模板名称', `模板_${new Date().toLocaleString()}`) || `模板_${Date.now()}`;
    const id = generateId('tpl');
    const minX = Math.min(...nodesToSave.map(n => n.position.x));
    const minY = Math.min(...nodesToSave.map(n => n.position.y));
    const tpl: FlowTemplate = {
      schemaVersion: 1,
      id,
      name,
      nodes: nodesToSave.map(n => ({
        id: n.id,
        type: n.type || 'default',
        position: { x: n.position.x - minX, y: n.position.y - minY },
        data: (() => { const d: any = { ...(n.data || {}) }; delete d.onRun; delete d.onSend; delete d.status; delete d.error; return d; })(),
        boxW: (n as any).data?.boxW,
        boxH: (n as any).data?.boxH,
      })) as any,
      edges: edgesToSave.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: (e as any).sourceHandle,
        targetHandle: (e as any).targetHandle,
        type: e.type || 'default',
        label: typeof e.label === 'string' ? e.label : undefined,
      })) as any,
    };
    await saveUserTemplate(tpl);
    const list = await listUserTemplates();
    setUserTplList(list);
    alert('已保存为模板');
  }, [rf]);

  return (
    <div
      ref={containerRef}
      className={`tanva-flow-overlay absolute inset-0 ${isPointerMode ? 'pointer-mode' : ''}`}
      onDoubleClick={handleContainerDoubleClick}
      onWheelCapture={handleWheelCapture}
    >
      {FlowToolbar}
      <ReactFlow
        nodes={nodesWithHandlers}
        edges={edges}
        onNodesChange={onNodesChangeWithHistory}
        onEdgesChange={onEdgesChangeWithHistory}
        onNodeDragStart={() => { nodeDraggingRef.current = true; }}
        onNodeDragStop={() => {
          nodeDraggingRef.current = false;
          const ns = rfNodesToTplNodes((rf.getNodes?.() || nodes) as any);
          const es = rfEdgesToTplEdges((rf.getEdges?.() || edges));
          scheduleCommit(ns, es);
        }}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectStop={onConnectStop}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}

        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        fitView={false}
        panOnDrag={!isPointerMode}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        selectionOnDrag={isPointerMode}
        selectNodesOnDrag={!isPointerMode}
        nodesDraggable={true}
        nodesConnectable={!isPointerMode}
        multiSelectionKeyCode={isPointerMode ? null : ['Meta', 'Control']}
        selectionKeyCode={isPointerMode ? null : null}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        {backgroundEnabled && (
          <Background
            variant={
              backgroundVariant === FlowBackgroundVariant.DOTS 
                ? BackgroundVariant.Dots
                : backgroundVariant === FlowBackgroundVariant.LINES
                ? BackgroundVariant.Lines
                : BackgroundVariant.Cross
            }
            gap={backgroundGap}
            size={backgroundSize}
            color={backgroundColor}
            style={{ opacity: backgroundOpacity }}
          />
        )}
        {/* 视口由 Canvas 驱动，禁用 MiniMap 交互避免竞态 - 专注模式下隐藏 */}
        {!focusMode && <MiniMap pannable={false} zoomable={false} />}
        {/* 将画布上的图片以绿色块显示在 MiniMap 内 - 专注模式下隐藏 */}
        {!focusMode && <MiniMapImageOverlay />}
      </ReactFlow>

      {edgeLabelEditor.visible && (
        <div
          className="tanva-edge-label-editor"
          style={{ left: edgeLabelEditor.position.x, top: edgeLabelEditor.position.y }}
          data-prevent-add-panel
        >
          <input
            ref={edgeLabelInputRef}
            value={edgeLabelEditor.value}
            onChange={handleEdgeLabelChange}
            onKeyDown={handleEdgeLabelKeyDown}
            onBlur={handleEdgeLabelBlur}
            placeholder="输入文本"
          />
        </div>
      )}

      {/* 添加面板（双击空白处出现） */}
      <div ref={addPanelRef} style={addPanelStyle} className="tanva-add-panel">
        {addPanel.visible && (
          <div style={{ 
            background: '#fff', 
            border: '1px solid #e5e7eb', 
            borderRadius: 16, 
            boxShadow: '0 18px 45px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)',
            width: '60vw',
            minWidth: 720,
            maxWidth: 960
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8, 
              padding: '10px 12px 0', 
              borderBottom: 'none',
              background: '#f5f7fa',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16
            }}>
              <div style={{ display: 'flex', gap: 2 }}>
                <button 
                onClick={() => setAddTabWithMemory('nodes')} 
                style={{ 
                  padding: '10px 18px 14px', 
                  fontSize: 13,
                  fontWeight: addTab === 'nodes' ? 600 : 500,
                  borderRadius: '24px 24px 0 0', 
                  border: 'none',
                  background: addTab === 'nodes' ? '#fff' : 'transparent', 
                  color: addTab === 'nodes' ? '#111827' : '#374151',
                  marginBottom: -2,
                  transition: 'all 0.15s ease',
                  cursor: 'pointer'
                }}
              >
                节点
              </button>
              <button 
                onClick={() => setAddTabWithMemory('templates')} 
                style={{ 
                  padding: '10px 18px 14px', 
                  fontSize: 13,
                  fontWeight: addTab === 'templates' ? 600 : 500,
                  borderRadius: '24px 24px 0 0', 
                  border: 'none',
                  background: addTab === 'templates' ? '#fff' : 'transparent', 
                  color: addTab === 'templates' ? '#111827' : '#374151',
                  marginBottom: -2,
                  transition: 'all 0.15s ease',
                  cursor: 'pointer'
                }}
              >
                模板
              </button>
              <button 
                onClick={() => setAddTabWithMemory('personal')} 
                style={{ 
                  padding: '10px 18px 14px', 
                  fontSize: 13,
                  fontWeight: addTab === 'personal' ? 600 : 500,
                  borderRadius: '24px 24px 0 0', 
                  border: 'none',
                  background: addTab === 'personal' ? '#fff' : 'transparent', 
                  color: addTab === 'personal' ? '#111827' : '#374151',
                  marginBottom: -2,
                  transition: 'all 0.15s ease',
                  cursor: 'pointer'
                }}
              >
                个人库
              </button>
              </div>
            </div>
            {addTab === 'nodes' ? (
              <div style={{ 
                height: 'min(70vh, 640px)',
                overflowY: 'auto',
                overflowX: 'hidden',
                paddingTop: 8
              }}>
                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 12,
                  padding: 20
                }}>
                <button 
                  onClick={() => createNodeAtWorldCenter('textPrompt', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Prompt Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>提示词</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('textChat', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Text Chat Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>纯文本交互</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('textNote', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Text Note Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>纯文本</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('promptOptimize', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                <span>Prompt Optimizer</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>提示词优化</span>
              </button>
              <button 
                onClick={() => createNodeAtWorldCenter('analysis', addPanel.world)} 
                style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Analysis Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>图像分析</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('image', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Image Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>图片</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('generate', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Generate Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>生成</span>
                </button>
                <button
                  onClick={() => createNodeAtWorldCenter('generatePro', addPanel.world)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13,
                    fontWeight: 500,
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Generate Pro</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>专业生成</span>
                </button>
                <button
                  onClick={() => createNodeAtWorldCenter('generatePro4', addPanel.world)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13,
                    fontWeight: 500,
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Generate Pro 4</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>四图专业生成</span>
                </button>
                <button
                  onClick={() => createNodeAtWorldCenter('generateRef', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Generate Refer</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>参考图生成</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('generate4', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Multi Generate</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>生成多张图片</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('three', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>3D Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>三维</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('sora2Video', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Sora2 Video</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>视频生成</span>
                </button>
                <button 
                  onClick={() => createNodeAtWorldCenter('camera', addPanel.world)} 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13, 
                    fontWeight: 500,
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    border: '1px solid #e5e7eb', 
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Shot Node</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>截图</span>
                </button>
                <button
                  onClick={() => createNodeAtWorldCenter('storyboardSplit', addPanel.world)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13,
                    fontWeight: 500,
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    color: '#374151',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    width: '100%'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#fff';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span>Storyboard Split</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>分镜拆分</span>
                </button>
                </div>
              </div>
            ) : addTab === 'templates' ? (
              <div style={{ height: 'min(70vh, 640px)', overflowY: 'auto', overflowX: 'hidden', padding: '12px 18px 18px' }}>
                <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap: 12, marginBottom: templateScope === 'public' ? 12 : 18 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{templateScope === 'public' ? '公共模板' : '我的模板'}</div>
                    {tplLoading ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>加载中…</div> : null}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                    {/* 小图标：导出/导入，仅在模板页签显示 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={exportFlow}
                        title="导出当前编排为JSON"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          border: '1px solid #e5e7eb',
                          background: '#fff',
                          color: '#374151',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f9fafb';
                          e.currentTarget.style.borderColor = '#d1d5db';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#fff';
                          e.currentTarget.style.borderColor = '#e5e7eb';
                        }}
                      >
                        <Download size={16} strokeWidth={2} />
                      </button>
                      <button
                        onClick={handleImportClick}
                        title="导入JSON并复现编排"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          border: '1px solid #e5e7eb',
                          background: '#fff',
                          color: '#374151',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f9fafb';
                          e.currentTarget.style.borderColor = '#d1d5db';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#fff';
                          e.currentTarget.style.borderColor = '#e5e7eb';
                        }}
                      >
                        <Upload size={16} strokeWidth={2} />
                      </button>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', padding: 2, border: '1px solid #d4d8de', borderRadius: 999, background: '#fff' }}>
                      <button
                        onClick={() => setTemplateScope('public')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 999,
                          border: 'none',
                          background: templateScope === 'public' ? '#2563eb' : 'transparent',
                          color: templateScope === 'public' ? '#fff' : '#374151',
                          fontSize: 12,
                          fontWeight: templateScope === 'public' ? 600 : 500,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >公共模板</button>
                      <button
                        onClick={() => setTemplateScope('mine')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 999,
                          border: 'none',
                          background: templateScope === 'mine' ? '#2563eb' : 'transparent',
                          color: templateScope === 'mine' ? '#fff' : '#374151',
                          fontSize: 12,
                          fontWeight: templateScope === 'mine' ? 600 : 500,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >我的模板</button>
                    </div>
                  </div>
                </div>
                {templateScope === 'public' && tplIndex ? (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                      {BUILTIN_TEMPLATE_CATEGORIES.map(cat => {
                        const isActive = cat.value === activeBuiltinCategory;
                        return (
                          <button
                            key={cat.value}
                            onClick={() => setActiveBuiltinCategory(cat.value)}
                            style={{
                              padding: '6px 14px',
                              borderRadius: 999,
                              border: '1px solid ' + (isActive ? '#2563eb' : '#e5e7eb'),
                              background: isActive ? '#2563eb' : '#fff',
                              color: isActive ? '#fff' : '#374151',
                              fontSize: 12,
                              fontWeight: isActive ? 600 : 500,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              boxShadow: isActive ? '0 10px 18px rgba(37, 99, 235, 0.18)' : 'none'
                            }}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
                      {filteredTplIndex.map(item => (
                        <div 
                          key={item.id} 
                          style={{ 
                            display: 'flex',
                            alignItems: 'stretch',
                            gap: 20,
                            border: '1px solid #e5e7eb',
                            borderRadius: 12,
                            padding: '18px 20px',
                            background: '#fff',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            minHeight: 160,
                            height: 160,
                            overflow: 'hidden'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#2563eb';
                            e.currentTarget.style.background = '#f1f5ff';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 18px 36px rgba(37, 99, 235, 0.12)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = '#e5e7eb';
                            e.currentTarget.style.background = '#fff';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                          onClick={async () => {
                            const tpl = await loadBuiltInTemplateByPath(item.path);
                            if (tpl) instantiateTemplateAt(tpl, addPanel.world);
                          }}
                        >
                          <div
                            style={{
                              flex: '0 0 50%',
                              maxWidth: '50%',
                              height: '100%',
                              background: item.thumbnail ? 'transparent' : '#f3f4f6',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden'
                            }}
                          >
                            {item.thumbnail ? (
                              <img src={item.thumbnail} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ fontSize: 12, color: '#9ca3af' }}>暂无预览</div>
                            )}
                          </div>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
                            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{item.name}</div>
                            {item.description ? <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>{item.description}</div> : null}
                            {item.tags?.length ? <div style={{ fontSize: 12, color: '#9ca3af' }}>标签：{item.tags.join(' / ')}</div> : null}
                          </div>
                        </div>
                      ))}
                      {Array.from({ length: getPlaceholderCount(filteredTplIndex.length, { minVisible: 6 }) }).map((_, idx) => (
                        <TemplatePlaceholder key={`builtin-placeholder-${idx}`} label="敬请期待更多模板" />
                      ))}
                    </div>
                  </div>
                ) : null}
                {templateScope === 'mine' ? (
                  <div style={{ display:'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
                      <AddTemplateCard
                        onAdd={saveCurrentAsTemplate}
                        label={userTplList.length ? '保存当前为新模板' : '创建我的第一个模板'}
                      />
                      {userTplList.map(item => {
                        return (
                          <UserTemplateCard 
                            key={item.id}
                            item={item}
                            onInstantiate={async () => {
                              const tpl = await getUserTemplate(item.id);
                              if (tpl) instantiateTemplateAt(tpl, addPanel.world);
                            }}
                            onDelete={async () => {
                              if (confirm(`确定要删除模板 "${item.name}" 吗？此操作无法撤销。`)) {
                                try {
                                  await deleteUserTemplate(item.id);
                                  const list = await listUserTemplates();
                                  setUserTplList(list);
                                } catch (err) {
                                  console.error('删除模板失败:', err);
                                  alert('删除模板失败');
                                }
                              }
                            }}
                          />
                        );
                      })}
                      {Array.from({ length: userTplList.length === 0 ? 0 : getPlaceholderCount(userTplList.length + 1, { minVisible: 4 }) }).map((_, idx) => (
                        <TemplatePlaceholder key={`user-placeholder-${idx}`} />
                      ))}
                    </div>
                ) : null}
              </div>
            ) : addTab === 'personal' ? (
              <PersonalLibraryPanel />
            ) : null}
          </div>
        )}
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => handleImportFiles(e.target.files)}
        />
      </div>
    </div>
  );
}

export default function FlowOverlay() {
  // 若未启用 Flow UI，则让该层不拦截指针事件
  const flowUIEnabled = useUIStore(s => s.flowUIEnabled);
  const wrapperStyle: React.CSSProperties = flowUIEnabled ? { pointerEvents: 'auto' } : { pointerEvents: 'none' };
  return (
    <div style={{ position: 'absolute', inset: 0, ...wrapperStyle }}>
      <ReactFlowProvider>
        <FlowInner />
      </ReactFlowProvider>
    </div>
  );
}
