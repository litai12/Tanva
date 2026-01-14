import React from 'react';
import { Handle, Position, useStore, type ReactFlowState, type Node } from 'reactflow';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    videoUrl?: string;
    prompt?: string;
    error?: string;
    analysisPrompt?: string;
    text?: string;
  };
  selected?: boolean;
};

const DEFAULT_ANALYSIS_PROMPT = '分析一下这个视频的内容，描述视频中的场景、动作和关键信息';
const DEFAULT_VIDEO_MODEL = 'gemini-3-flash-preview';
const DEFAULT_VIDEO_PROVIDER = 'banana';

function VideoAnalyzeNodeInner({ id, data, selected = false }: Props) {
  const { status, error } = data;
  const [hover, setHover] = React.useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  // 获取连接的视频节点数据
  const connectedVideoUrl = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find(
          (e) => e.target === id && e.targetHandle === 'video'
        );
        if (!edge) return undefined;
        const sourceNode = state.getNodes().find((n: Node<any>) => n.id === edge.source);
        return sourceNode?.data?.videoUrl as string | undefined;
      },
      [id]
    )
  );

  // 使用连接的视频 URL 或节点自身的 videoUrl
  const effectiveVideoUrl = connectedVideoUrl || data.videoUrl;

  // 检查是否有视频输入连接
  const hasVideoConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (edge) => edge.target === id && edge.targetHandle === 'video'
        ),
      [id]
    )
  );

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const promptInput = data.analysisPrompt ?? DEFAULT_ANALYSIS_PROMPT;

  // 初始化节点提示词
  React.useEffect(() => {
    if (typeof data.analysisPrompt === 'undefined') {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { analysisPrompt: DEFAULT_ANALYSIS_PROMPT } }
      }));
    }
  }, [data.analysisPrompt, id]);

  const onAnalyze = React.useCallback(async () => {
    if (!effectiveVideoUrl || status === 'running' || isAnalyzing) return;

    const promptToUse = (data.analysisPrompt ?? DEFAULT_ANALYSIS_PROMPT).trim();
    if (!promptToUse.length) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: '提示词不能为空' } }
      }));
      return;
    }

    // 更新节点状态为运行中
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { status: 'running', error: undefined, prompt: '', text: '' } }
    }));

    try {
      setIsAnalyzing(true);

      const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:4000';

	      const response = await fetch(`${apiBase}/api/ai/analyze-video`, {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        credentials: 'include',
	        body: JSON.stringify({
	          prompt: promptToUse,
	          videoUrl: effectiveVideoUrl,
	          aiProvider: DEFAULT_VIDEO_PROVIDER,
	          model: DEFAULT_VIDEO_MODEL,
	        }),
	      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const analysisText = result.analysis || result.text || result.data?.analysis || '';

      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            status: 'succeeded',
            error: undefined,
            prompt: analysisText,
            text: analysisText
          }
        }
      }));

      console.log('✅ Video analysis finished:', analysisText.substring(0, 50) + '...');

    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('❌ Video analysis failed:', msg);

      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: msg, prompt: '', text: '' } }
      }));

    } finally {
      setIsAnalyzing(false);
    }
  }, [data.analysisPrompt, effectiveVideoUrl, id, isAnalyzing, status]);

  const onPromptChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { analysisPrompt: event.target.value } }
    }));
  }, [id]);

  const canRun = !!effectiveVideoUrl && status !== 'running' && !isAnalyzing;

  return (
    <div
      style={{
        width: 280,
        padding: 8,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Video Analysis</div>
        <button
          onClick={onAnalyze}
          disabled={!canRun}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            background: canRun ? '#111827' : '#e5e7eb',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: canRun ? 'pointer' : 'not-allowed',
          }}
        >
          {status === 'running' || isAnalyzing ? '分析中...' : '分析'}
        </button>
      </div>

      {/* 视频预览区域 */}
      <div
        style={{
          width: '100%',
          height: 120,
          background: '#000',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: '1px solid #eef0f2',
        }}
      >
        {effectiveVideoUrl ? (
          <video
            src={effectiveVideoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            controls
            preload="metadata"
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {hasVideoConnection ? '等待视频输入' : '请连接视频节点'}
          </span>
        )}
      </div>

      {/* 分析提示词 */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>分析提示词</div>
        <textarea
          className="nodrag nopan nowheel"
          value={promptInput}
          onChange={onPromptChange}
          onWheelCapture={(e) => e.stopPropagation()}
          onPointerDownCapture={(e) => e.stopPropagation()}
          placeholder="输入分析提示词"
          style={{
            width: '100%',
            minHeight: 60,
            resize: 'none',
            fontSize: 12,
            lineHeight: 1.4,
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: '#fff',
            color: '#111827',
            fontFamily: 'inherit',
          }}
          disabled={status === 'running' || isAnalyzing}
        />
      </div>

      {/* 分析结果 */}
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
        {data.prompt || data.text ? (
          data.prompt || data.text
        ) : (
          <span style={{ color: '#9ca3af' }}>分析结果将显示在这里</span>
        )}
      </div>

      {/* 错误信息 */}
      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      {/* 连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('video-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('text-out')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 工具提示 */}
      {hover === 'video-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          video
        </div>
      )}
      {hover === 'text-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          text
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoAnalyzeNodeInner);
