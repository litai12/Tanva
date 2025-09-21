import React from 'react';
import { Trash2, Plus } from 'lucide-react';
import paper from 'paper';
import ReactFlow, {
  Controls,
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
import 'reactflow/dist/style.css';
import './flow.css';
import type { FlowTemplate, TemplateIndexEntry } from '@/types/template';
import { loadBuiltInTemplateIndex, loadBuiltInTemplateByPath, listUserTemplates, getUserTemplate, saveUserTemplate, deleteUserTemplate, generateId } from '@/services/templateStore';

import TextPromptNode from './nodes/TextPromptNode';
import ImageNode from './nodes/ImageNode';
import GenerateNode from './nodes/GenerateNode';
import ThreeNode from './nodes/ThreeNode';
import CameraNode from './nodes/CameraNode';
import { useFlowStore, FlowBackgroundVariant } from '@/stores/flowStore';
import { useUIStore } from '@/stores';
import { aiImageService } from '@/services/aiImageService';
import type { AIImageResult } from '@/types/ai';

type RFNode = Node<any>;

const nodeTypes = {
  textPrompt: TextPromptNode,
  image: ImageNode,
  generate: GenerateNode,
  three: ThreeNode,
  camera: CameraNode,
};

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
  const rf = useReactFlow();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  // 统一画板：节点橡皮已禁用

  // 背景设置改为驱动底层 Canvas 网格
  // 使用独立的Flow状态
  const {
    backgroundEnabled,
    backgroundVariant,
    backgroundGap,
    backgroundSize,
    backgroundColor,
    backgroundOpacity,
    setBackgroundEnabled,
    setBackgroundVariant,
    setBackgroundGap,
    setBackgroundSize,
    setBackgroundColor,
    setBackgroundOpacity,
  } = useFlowStore();

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

  // 使用Flow独立的视口管理
  useFlowViewport();

  // 当开始/结束连线拖拽时，全局禁用/恢复文本选择，避免蓝色选区
  React.useEffect(() => {
    if (isConnecting) {
      document.body.classList.add('tanva-no-select');
    } else {
      document.body.classList.remove('tanva-no-select');
    }
    return () => document.body.classList.remove('tanva-no-select');
  }, [isConnecting]);

  // 擦除模式退出时清除高亮
  React.useEffect(() => {
    // 节点橡皮已禁用，确保无高亮残留
    setNodes(ns => ns.map(n => (n.className === 'eraser-hover' ? { ...n, className: undefined } : n)));
  }, [setNodes]);

  // 双击空白处弹出添加面板
  const [addPanel, setAddPanel] = React.useState<{ visible: boolean; screen: { x: number; y: number }; world: { x: number; y: number } }>({ visible: false, screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } });
  const [addTab, setAddTab] = React.useState<'nodes' | 'templates'>('nodes');
  const addPanelRef = React.useRef<HTMLDivElement | null>(null);
  const lastPaneClickRef = React.useRef<{ t: number; x: number; y: number } | null>(null);
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
    setAddTab('nodes');
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
    try {
      const canvasRect = (paper?.view?.element as HTMLCanvasElement | undefined)?.getBoundingClientRect();
      if (canvasRect) {
        const vx = clientX - canvasRect.left;
        const vy = clientY - canvasRect.top;
        const pt = paper.view.viewToProject(new paper.Point(vx, vy));
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
    return true;
  }, []);

  const onPaneClick = React.useCallback((event: React.MouseEvent) => {
    // 基于两次快速点击判定双击（ReactFlow Pane 无原生 onDoubleClick 回调）
    const now = Date.now();
    const x = event.clientX, y = event.clientY;
    const last = lastPaneClickRef.current;
    lastPaneClickRef.current = { t: now, x, y };
    if (last && (now - last.t) < 500 && Math.hypot(last.x - x, last.y - y) < 10) {
      if (isBlankArea(x, y)) openAddPanelAt(x, y);
    }
  }, [openAddPanelAt, isBlankArea]);

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

  // 捕获原生双击，仅在真正空白 Pane 区域触发；排除 AI 对话框及其保护带
  React.useEffect(() => {
    const onNativeDblClick = (e: MouseEvent) => {
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

      if (isBlankArea(x, y)) {
        e.stopPropagation();
        e.preventDefault();
        openAddPanelAt(x, y);
      }
    };
    window.addEventListener('dblclick', onNativeDblClick, true);
    return () => window.removeEventListener('dblclick', onNativeDblClick, true);
  }, [openAddPanelAt, isBlankArea]);

  const createNodeAtWorldCenter = React.useCallback((type: 'textPrompt' | 'image' | 'generate' | 'three' | 'camera', world: { x: number; y: number }) => {
    // 以默认尺寸中心对齐放置
    const size = {
      textPrompt: { w: 240, h: 180 },
      image: { w: 260, h: 240 },
      generate: { w: 260, h: 200 },
      three: { w: 280, h: 260 },
      camera: { w: 260, h: 220 },
    }[type];
    const id = `${type}_${Date.now()}`;
    const pos = { x: world.x - size.w / 2, y: world.y - size.h / 2 };
    const data = type === 'textPrompt' ? { text: '', boxW: size.w, boxH: size.h }
      : type === 'image' ? { imageData: undefined, boxW: size.w, boxH: size.h }
      : type === 'generate' ? { status: 'idle' as const, boxW: size.w, boxH: size.h }
      : { boxW: size.w, boxH: size.h };
    setNodes(ns => ns.concat([{ id, type, position: pos, data } as any]));
    setAddPanel(v => ({ ...v, visible: false }));
    return id;
  }, [setNodes]);

  // 允许 TextPrompt -> Generate(text); Image/Generate(img) -> Generate(img)
  const isValidConnection = React.useCallback((connection: Connection) => {
    const { source, target, targetHandle } = connection;
    if (!source || !target || !targetHandle) return false;
    if (source === target) return false;

    const sourceNode = rf.getNode(source);
    const targetNode = rf.getNode(target);
    if (!sourceNode || !targetNode) return false;

    // 允许连接到 Generate 和 Image
    if (targetNode.type === 'generate') {
      if (targetHandle === 'text') return sourceNode.type === 'textPrompt';
      if (targetHandle === 'img') return ['image','generate','three','camera'].includes(sourceNode.type || '');
      return false;
    }

    if (targetNode.type === 'image') {
      if (targetHandle === 'img') return ['image','generate','three','camera'].includes(sourceNode.type || '');
      return false;
    }
    return false;
  }, [rf]);

  // 限制：Generate(text) 仅一个连接；Generate(img) 最多6条
  const canAcceptConnection = React.useCallback((params: Connection) => {
    if (!params.target || !params.targetHandle) return false;
    const targetNode = rf.getNode(params.target);
    const currentEdges = rf.getEdges();
    const incoming = currentEdges.filter(e => e.target === params.target && e.targetHandle === params.targetHandle);
    if (targetNode?.type === 'generate') {
      if (params.targetHandle === 'text') return true; // 允许连接，新线会替换旧线
      if (params.targetHandle === 'img') return incoming.length < 6;
    }
    if (targetNode?.type === 'image') {
      if (params.targetHandle === 'img') return true; // 允许连接，新线会替换旧线
    }
    return false;
  }, [rf]);

  const onConnect = React.useCallback((params: Connection) => {
    if (!isValidConnection(params)) return;
    if (!canAcceptConnection(params)) return;

    setEdges((eds) => {
      let next = eds;
      const tgt = rf.getNode(params.target!);
      
      // 如果是连接到 Image(img)，先移除旧的输入线，再添加新线
      if (tgt?.type === 'image' && params.targetHandle === 'img') {
        next = next.filter(e => !(e.target === params.target && e.targetHandle === 'img'));
      }
      
      // 如果是连接到 Generate(text)，先移除旧的输入线，再添加新线
      if (tgt?.type === 'generate' && params.targetHandle === 'text') {
        next = next.filter(e => !(e.target === params.target && e.targetHandle === 'text'));
      }
      
      return addEdge({ ...params, type: 'default' }, next);
    });

    // 若连接到 Image(img)，立即把源图像写入目标
    try {
      const target = rf.getNode(params.target!);
      if (target?.type === 'image' && params.targetHandle === 'img' && params.source) {
        const src = rf.getNode(params.source);
        const img = (src?.data as any)?.imageData;
        if (img) {
          setNodes(ns => ns.map(n => n.id === target.id ? { ...n, data: { ...n.data, imageData: img } } : n));
        }
      }
    } catch {}
  }, [isValidConnection, canAcceptConnection, setEdges, rf, setNodes]);

  // 监听来自节点的本地数据写入（TextPrompt）
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; patch: Record<string, any> };
      if (!detail?.id) return;
      setNodes((ns) => ns.map((n) => n.id === detail.id ? { ...n, data: { ...n.data, ...detail.patch } } : n));
      // 若目标是 Image 且设置了 imageData 为空，自动断开输入连线
      if (Object.prototype.hasOwnProperty.call(detail.patch, 'imageData') && !detail.patch.imageData) {
        setEdges(eds => eds.filter(e => !(e.target === detail.id && e.targetHandle === 'img')));
      }
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [setNodes]);

  // 运行：根据输入自动选择 生图/编辑/融合
  const runNode = React.useCallback(async (nodeId: string) => {
    const node = rf.getNode(nodeId);
    if (!node || node.type !== 'generate') return;

    // 收集 prompt
    const currentEdges = rf.getEdges();
    const incomingTextEdge = currentEdges.find(e => e.target === nodeId && e.targetHandle === 'text');
    if (!incomingTextEdge) {
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: '缺少 TextPrompt 输入' } } : n));
      return;
    }
    const promptNode = rf.getNode(incomingTextEdge.source);
    const prompt = (promptNode?.data as any)?.text || '';
    if (!prompt.trim()) {
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: '提示词为空' } } : n));
      return;
    }

    // 收集图片输入（最多6张），来源可为 Image 或 Generate
    const imgEdges = currentEdges.filter(e => e.target === nodeId && e.targetHandle === 'img').slice(0, 6);
    const imageDatas: string[] = [];
    for (const e of imgEdges) {
      const srcNode = rf.getNode(e.source);
      if (!srcNode) continue;
      const data = (srcNode.data as any);
      const img = data?.imageData;
      if (typeof img === 'string' && img.length > 0) imageDatas.push(img);
    }

    // 更新状态
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'running', error: undefined } } : n));

    try {
      let result: { success: boolean; data?: AIImageResult; error?: { message: string } };

      if (imageDatas.length === 0) {
        // 文生图
        result = await aiImageService.generateImage({ prompt, outputFormat: 'png' });
      } else if (imageDatas.length === 1) {
        // 图生图（编辑）
        result = await aiImageService.editImage({ prompt, sourceImage: imageDatas[0], outputFormat: 'png' });
      } else {
        // 多图融合（2-6张）
        result = await aiImageService.blendImages({ prompt, sourceImages: imageDatas.slice(0, 6), outputFormat: 'png' });
      }

      if (!result.success || !result.data) {
        const msg = result.error?.message || '执行失败';
        setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: msg } } : n));
        return;
      }

      const out = result.data;
      const imgBase64 = out.imageData;

      // 更新本节点
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'succeeded', imageData: imgBase64, error: undefined } } : n));

      // 将图片添加到画布（沿用现有快速上传机制）
      // 生成结果不再自动发送到画布，由节点上的 Send 按钮触发

      // 若该生成节点连接到 Image 节点，自动把结果写入目标 Image
      if (imgBase64) {
        const currentEdges = rf.getEdges();
        const outs = currentEdges.filter(e => e.source === nodeId);
        if (outs.length) {
          setNodes(ns => ns.map(n => {
            const hits = outs.filter(e => e.target === n.id);
            if (!hits.length) return n;
            if (n.type === 'image') {
              return { ...n, data: { ...n.data, imageData: imgBase64 } };
            }
            return n;
          }));
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, status: 'failed', error: msg } } : n));
    }
  }, [rf, setNodes]);

  // 定义稳定的onSend回调
  const onSendHandler = React.useCallback((id: string) => {
    const node = rf.getNode(id);
    const img = (node?.data as any)?.imageData as string | undefined;
    if (!img) return;
    const mime = `image/png`;
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
  const onConnectEnd = React.useCallback(() => setIsConnecting(false), [setIsConnecting]);

  // 在 node 渲染前为 Generate 节点注入 onRun 回调
  const nodesWithHandlers = React.useMemo(() => nodes.map(n => (
    n.type === 'generate'
      ? { ...n, data: { ...n.data, onRun: runNode, onSend: onSendHandler } }
      : n
  )), [nodes, runNode, onSendHandler]);

  // 简单的全局调试API，便于从控制台添加节点
  React.useEffect(() => {
    (window as any).tanvaFlow = {
      addTextPrompt: (x = 0, y = 0, text = '') => {
        const id = `tp_${Date.now()}`;
        setNodes(ns => ns.concat([{ id, type: 'textPrompt', position: { x, y }, data: { text } }] as any));
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
        setNodes(ns => ns.concat([{ id, type: 'generate', position: { x, y }, data: { status: 'idle' } }] as any));
        return id;
      },
      connect: (source: string, target: string, targetHandle: 'text' | 'img') => {
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

  const addAtCenter = React.useCallback((type: 'textPrompt' | 'image' | 'generate') => {
    const rect = containerRef.current?.getBoundingClientRect();
    const centerScreen = {
      x: (rect?.width || window.innerWidth) / 2,
      y: (rect?.height || window.innerHeight) / 2,
    };
    const center = rf.screenToFlowPosition(centerScreen);
    const id = `${type}_${Date.now()}`;
    const base: any = { id, type, position: center, data: type === 'textPrompt' ? { text: '' } : (type === 'generate' ? { status: 'idle' } : { imageData: undefined }) };
    setNodes(ns => ns.concat([base]));
    return id;
  }, [rf, setNodes]);

  const showFlowPanel = useUIStore(s => s.showFlowPanel);
  const flowUIEnabled = useUIStore(s => s.flowUIEnabled);

  const FlowToolbar = flowUIEnabled && showFlowPanel ? (
    <div className="tanva-flow-toolbar"
      style={{ position: 'absolute', top: 56, right: 16, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.9)', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}
    >
      <button onClick={() => addAtCenter('textPrompt')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>文字</button>
      <button onClick={() => addAtCenter('image')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff' }}>图片</button>
      <button onClick={() => addAtCenter('generate')} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb', background: '#111827', color: '#fff' }}>生成</button>
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
    const left = (addPanel.screen.x - (rect?.left || 0));
    const top = (addPanel.screen.y - (rect?.top || 0));
    return { position: 'absolute', left, top, zIndex: 20 } as React.CSSProperties;
  }, [addPanel.visible, addPanel.screen.x, addPanel.screen.y]);

  const handleContainerDoubleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isBlankArea(e.clientX, e.clientY)) openAddPanelAt(e.clientX, e.clientY);
  }, [openAddPanelAt, isBlankArea]);

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
      edges: edgesToSave.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: (e as any).sourceHandle, targetHandle: (e as any).targetHandle, type: e.type || 'default' })) as any,
    };
    await saveUserTemplate(tpl);
    const list = await listUserTemplates();
    setUserTplList(list);
    alert('已保存为模板');
  }, [rf]);

  return (
    <div ref={containerRef} className={"tanva-flow-overlay absolute inset-0"} onDoubleClick={handleContainerDoubleClick}>
      {FlowToolbar}
      <ReactFlow
        nodes={nodesWithHandlers}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        fitView={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        selectionOnDrag={false}
        selectNodesOnDrag={false}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
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
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>

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
                onClick={() => setAddTab('nodes')} 
                style={{ 
                  padding: '10px 18px 14px', 
                  fontSize: 13,
                  fontWeight: addTab === 'nodes' ? 600 : 500,
                  borderRadius: '8px 8px 0 0', 
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
                onClick={() => setAddTab('templates')} 
                style={{ 
                  padding: '10px 18px 14px', 
                  fontSize: 13,
                  fontWeight: addTab === 'templates' ? 600 : 500,
                  borderRadius: '8px 8px 0 0', 
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
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={exportFlow} title="导出当前编排为JSON" style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer' }}>导出</button>
                <button onClick={handleImportClick} title="导入JSON并复现编排" style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer' }}>导入</button>
                <input ref={importInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => handleImportFiles(e.target.files)} />
              </div>
            </div>
            {addTab === 'nodes' ? (
              <div style={{ 
                maxHeight: '60vh',
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
                </div>
              </div>
            ) : addTab === 'templates' ? (
              <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: '12px 18px 18px' }}>
                <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap: 12, marginBottom: templateScope === 'public' ? 12 : 18 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{templateScope === 'public' ? '公共模板' : '我的模板'}</div>
                    {tplLoading ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>加载中…</div> : null}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
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
                      {Array.from({ length: getPlaceholderCount(filteredTplIndex.length, { minVisible: 4 }) }).map((_, idx) => (
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
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FlowOverlay() {
  return (
    <ReactFlowProvider>
      <FlowInner />
    </ReactFlowProvider>
  );
}
