import React from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
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

import TextPromptNode from './nodes/TextPromptNode';
import ImageNode from './nodes/ImageNode';
import GenerateNode from './nodes/GenerateNode';
import { useCanvasStore } from '@/stores';
import { useUIStore } from '@/stores';
import { aiImageService } from '@/services/aiImageService';
import type { AIImageResult } from '@/types/ai';

type RFNode = Node<any>;

const nodeTypes = {
  textPrompt: TextPromptNode,
  image: ImageNode,
  generate: GenerateNode,
};

function useViewportSync() {
  const { zoom, panX, panY } = useCanvasStore();
  const rf = useReactFlow();
  React.useEffect(() => {
    try {
      rf.setViewport({ x: panX, y: panY, zoom }, { duration: 0 });
    } catch (_) {}
  }, [rf, zoom, panX, panY]);
}

function FlowInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const rf = useReactFlow();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);

  // 背景设置改为驱动底层 Canvas 网格
  const showGrid = useUIStore(s => s.showGrid);
  const setShowGrid = useUIStore(s => s.setShowGrid);
  const gridStyle = useCanvasStore(s => s.gridStyle);
  const setGridStyle = useCanvasStore(s => s.setGridStyle);
  const gridSize = useCanvasStore(s => s.gridSize);
  const setGridSize = useCanvasStore(s => s.setGridSize);
  const gridDotSize = useCanvasStore(s => s.gridDotSize);
  const setGridDotSize = useCanvasStore(s => s.setGridDotSize);
  const gridColor = useCanvasStore(s => s.gridColor);
  const setGridColor = useCanvasStore(s => s.setGridColor);
  const gridBgColor = useCanvasStore(s => s.gridBgColor);
  const setGridBgColor = useCanvasStore(s => s.setGridBgColor);
  const gridBgEnabled = useCanvasStore(s => s.gridBgEnabled);
  const setGridBgEnabled = useCanvasStore(s => s.setGridBgEnabled);

  const [bgEnabled, setBgEnabled] = React.useState(showGrid);
  const [bgVariant, setBgVariant] = React.useState<'dots' | 'lines' | 'solid'>(
    gridStyle === 'dots' ? 'dots' : gridStyle === 'solid' ? 'solid' : 'lines'
  );
  const [bgColorLocal, setBgColorLocal] = React.useState<string>(gridColor || '#e5e7eb');
  const [bgFillLocal, setBgFillLocal] = React.useState<string>(gridBgColor || '#f7f7f7');
  const [bgFillEnabled, setBgFillEnabled] = React.useState<boolean>(gridBgEnabled);
  const [bgGap, setBgGap] = React.useState<number>(gridSize || 16);
  const [bgSize, setBgSize] = React.useState<number>(gridDotSize || 1);
  const [bgGapInput, setBgGapInput] = React.useState<string>(String(bgGap));
  const [bgSizeInput, setBgSizeInput] = React.useState<string>(String(bgSize));

  // 同步输入框字符串与实际数值
  React.useEffect(() => { setBgGapInput(String(bgGap)); }, [bgGap]);
  React.useEffect(() => { setBgSizeInput(String(bgSize)); }, [bgSize]);

  // 将本地设置同步到底层画布
  React.useEffect(() => { setShowGrid(bgEnabled); }, [bgEnabled, setShowGrid]);
  React.useEffect(() => {
    const style = bgVariant === 'dots' ? 'dots' : (bgVariant === 'solid' ? 'solid' : 'lines');
    setGridStyle(style as any);
  }, [bgVariant, setGridStyle]);
  React.useEffect(() => { setGridSize(bgGap); }, [bgGap, setGridSize]);
  React.useEffect(() => { setGridDotSize(bgSize); }, [bgSize, setGridDotSize]);
  React.useEffect(() => { setGridColor(bgColorLocal); }, [bgColorLocal, setGridColor]);
  React.useEffect(() => { setGridBgColor(bgFillLocal); }, [bgFillLocal, setGridBgColor]);
  React.useEffect(() => { setGridBgEnabled(bgFillEnabled); }, [bgFillEnabled, setGridBgEnabled]);

  const commitGap = React.useCallback((val: string) => {
    const n = Math.max(4, Math.min(64, Math.floor(Number(val)) || bgGap));
    setBgGap(n);
    setBgGapInput(String(n));
  }, [bgGap]);

  const commitSize = React.useCallback((val: string) => {
    const n = Math.max(1, Math.min(4, Math.floor(Number(val)) || bgSize));
    setBgSize(n);
    setBgSizeInput(String(n));
  }, [bgSize]);

  useViewportSync();

  // 当开始/结束连线拖拽时，全局禁用/恢复文本选择，避免蓝色选区
  React.useEffect(() => {
    if (isConnecting) {
      document.body.classList.add('tanva-no-select');
    } else {
      document.body.classList.remove('tanva-no-select');
    }
    return () => document.body.classList.remove('tanva-no-select');
  }, [isConnecting]);

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
      if (targetHandle === 'img') return sourceNode.type === 'image' || sourceNode.type === 'generate';
      return false;
    }

    if (targetNode.type === 'image') {
      if (targetHandle === 'img') return sourceNode.type === 'image' || sourceNode.type === 'generate';
      return false;
    }
    return false;
  }, [rf]);

  // 限制：Generate(text) 仅一个连接；Generate(img) 最多6条
  const canAcceptConnection = React.useCallback((params: Connection) => {
    if (!params.target || !params.targetHandle) return false;
    const targetNode = rf.getNode(params.target);
    const incoming = edges.filter(e => e.target === params.target && e.targetHandle === params.targetHandle);
    if (targetNode?.type === 'generate') {
      if (params.targetHandle === 'text') return incoming.length < 1;
      if (params.targetHandle === 'img') return incoming.length < 6;
    }
    if (targetNode?.type === 'image') {
      if (params.targetHandle === 'img') return true; // 允许连接，新线会替换旧线
    }
    return false;
  }, [edges, rf]);

  const onConnect = React.useCallback((params: Connection) => {
    if (!isValidConnection(params)) return;
    if (!canAcceptConnection(params)) return;

    setEdges((eds) => {
      let next = eds;
      // 如果是连接到 Image(img)，先移除旧的输入线，再添加新线
      const tgt = rf.getNode(params.target!);
      if (tgt?.type === 'image' && params.targetHandle === 'img') {
        next = next.filter(e => !(e.target === params.target && e.targetHandle === 'img'));
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
    const incomingTextEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'text');
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
    const imgEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'img').slice(0, 6);
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
        const outs = edges.filter(e => e.source === nodeId);
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
  }, [rf, edges, setNodes]);

  // 在 node 渲染前为 Generate 节点注入 onRun 回调
  const nodesWithHandlers = React.useMemo(() => nodes.map(n => (
    n.type === 'generate'
      ? { ...n, data: { ...n.data, onRun: runNode, onSend: (id: string) => {
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
        } } }
      : n
  )), [nodes, runNode]);

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
    const center = rf.project(centerScreen);
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
        <input type="checkbox" checked={bgEnabled} onChange={(e) => setBgEnabled(e.target.checked)} /> 背景
      </label>
      {bgEnabled && (
        <>
          <select value={bgVariant} onChange={(e) => setBgVariant(e.target.value as 'dots' | 'lines' | 'solid')} style={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 6px', background: '#fff' }}>
            <option value="dots">点阵</option>
            <option value="lines">网格线</option>
            <option value="solid">纯色</option>
          </select>
          <input
            type="color"
            value={bgColorLocal}
            onChange={(e) => { const v = e.target.value; setBgColorLocal(v); setGridColor(v); }}
            title="颜色"
            style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent' }}
          />
          <label style={{ fontSize: 12 }}>间距
            <input
              type="number"
              inputMode="numeric"
              min={4}
              max={64}
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
              min={1}
              max={4}
              value={bgSizeInput}
              onChange={(e) => setBgSizeInput(e.target.value)}
              onBlur={(e) => commitSize(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitSize((e.target as HTMLInputElement).value); }}
              style={{ width: 44, marginLeft: 4, border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 6px' }}
            />
          </label>
          <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={bgFillEnabled} onChange={(e) => setBgFillEnabled(e.target.checked)} /> 底色
          </label>
          <input
            type="color"
            value={bgFillLocal}
            onChange={(e) => { const v = e.target.value; setBgFillLocal(v); setGridBgColor(v); }}
            title="设置底层纯色背景"
            style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent', opacity: bgFillEnabled ? 1 : 0.5, pointerEvents: bgFillEnabled ? 'auto' : 'none' }}
          />
        </>
      )}
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="tanva-flow-overlay absolute inset-0">
      {FlowToolbar}
      <ReactFlow
        nodes={nodesWithHandlers}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={() => setIsConnecting(true)}
        onConnectEnd={() => setIsConnecting(false)}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        fitView={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        selectionOnDrag={false}
        selectNodesOnDrag={false}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
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
