import React from 'react';
import { Handle, Position } from 'reactflow';
import ImagePreviewModal from '../../ui/ImagePreviewModal';
import { useAIChatStore } from '@/stores/aiChatStore';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    prompt?: string;
    error?: string;
  };
};

// 固定的分析提示词
const ANALYSIS_PROMPT = '分析一下这张图的内容，尽可能描述出来场景中的物体和特点，用一段提示词的方式输出';

export default function AnalysisNode({ id, data }: Props) {
  const { status, error } = data;
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const rf = React.useContext(require('reactflow').ReactFlowContext);

  // 使用 AI Chat Store
  const store = useAIChatStore();
  const generationStatus = store.generationStatus;

  // 用于追踪分析进行中的状态
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const prevMessagesLengthRef = React.useRef(0);

  // 监听 store 消息变化，自动提取分析结果
  React.useEffect(() => {
    if (!isAnalyzing) return;

    // 检查是否有新消息产生
    const currentMessagesLength = store.messages.length;

    // 如果消息增加了，说明分析完成
    if (currentMessagesLength > prevMessagesLengthRef.current) {
      const latestAiMessage = store.messages
        .filter(msg => msg.type === 'ai')
        .pop();

      if (latestAiMessage) {
        // 更新节点数据为成功状态
        window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { status: 'succeeded', error: undefined, prompt: latestAiMessage.content } }
        }));
        console.log('✅ 分析完成，结果已更新到节点:', latestAiMessage.content.substring(0, 50) + '...');

        // 停止监听
        setIsAnalyzing(false);
        store.setSourceImageForAnalysis(null);
      }
    }

    // 检查是否出错
    if (store.generationStatus.error && isAnalyzing) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: store.generationStatus.error, prompt: '' } }
      }));
      setIsAnalyzing(false);
      store.setSourceImageForAnalysis(null);
    }
  }, [isAnalyzing, store.messages.length, store.generationStatus.error, id, store]);

  const onAnalyze = React.useCallback(async () => {
    if (!src || status === 'running' || generationStatus.isGenerating || isAnalyzing) return;

    // 更新节点状态为运行中
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { status: 'running', error: undefined, prompt: '' } }
    }));

    try {
      // 记录当前消息长度
      prevMessagesLengthRef.current = store.messages.length;

      // 标记正在分析
      setIsAnalyzing(true);

      // 设置分析图像到 store
      store.setSourceImageForAnalysis(src);

      // 调用 store 的 analyzeImage 方法，复用 dialog 的完整逻辑
      await store.analyzeImage(ANALYSIS_PROMPT, src);

    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('❌ 分析失败:', msg);

      // 更新节点状态为失败
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: msg, prompt: '' } }
      }));

      setIsAnalyzing(false);
      store.setSourceImageForAnalysis(null);
    }
  }, [id, src, status, store, generationStatus.isGenerating, isAnalyzing]);

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  return (
    <div
      style={{
        width: 260,
        padding: 8,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>分析</div>
        <button
          onClick={onAnalyze}
          disabled={status === 'running' || !src || generationStatus.isGenerating}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            background: (status === 'running' || !src || generationStatus.isGenerating) ? '#e5e7eb' : '#111827',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: (status === 'running' || !src || generationStatus.isGenerating) ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'running' || generationStatus.isGenerating ? '分析中...' : '分析'}
        </button>
      </div>

      <div
        onDoubleClick={() => src && setPreview(true)}
        style={{
          width: '100%',
          height: 140,
          background: '#fff',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: '1px solid #eef0f2',
        }}
        title={src ? '双击预览' : undefined}
      >
        {src ? (
          <img
            src={src}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>等待图像输入</span>
        )}
      </div>

      {/* 显示内置提示词 */}
      <div
        style={{
          minHeight: 60,
          background: '#f0f9ff',
          borderRadius: 6,
          padding: 6,
          fontSize: 11,
          color: '#0369a1',
          border: '1px solid #bfdbfe',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        title="节点内置的分析提示词"
      >
        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 10 }}>📋 内置提示词：</div>
        {ANALYSIS_PROMPT}
      </div>

      <div
        style={{
          minHeight: 72,
          maxHeight: 120,
          overflowY: 'auto',
          background: '#f9fafb',
          borderRadius: 6,
          padding: 8,
          fontSize: 12,
          color: '#374151',
          whiteSpace: 'pre-wrap',
        }}
      >
        {data.prompt ? data.prompt : <span style={{ color: '#9ca3af' }}>分析结果将在此显示</span>}
      </div>

      <div style={{ fontSize: 12, color: '#6b7280' }}>状态: {status || 'idle'}</div>
      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="prompt"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'img-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          image
        </div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          prompt
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={src || ''}
        imageTitle="图像分析预览"
        onClose={() => setPreview(false)}
        imageCollection={[]}
        currentImageId=""
        onImageChange={() => {}}
      />
    </div>
  );
}
