import React from 'react';
import { Handle, Position } from 'reactflow';
import ImagePreviewModal from '../../ui/ImagePreviewModal';
import { aiImageService } from '@/services/aiImageService';
import { useAIChatStore, getImageModelForProvider } from '@/stores/aiChatStore';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    prompt?: string;
    error?: string;
    analysisPrompt?: string;
  };
};

// 默认提示词
const DEFAULT_ANALYSIS_PROMPT = '分析一下这张图的内容，尽可能描述出来场景中的物体和特点，用一段提示词的方式输出';

export default function AnalysisNode({ id, data }: Props) {
  const { status, error } = data;
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const imageModel = React.useMemo(
    () => getImageModelForProvider(aiProvider),
    [aiProvider]
  );

  const promptInput = data.analysisPrompt ?? DEFAULT_ANALYSIS_PROMPT;

  // 用于追踪分析进行中的状态
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  // 初始化节点提示词
  React.useEffect(() => {
    if (typeof data.analysisPrompt === 'undefined') {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { analysisPrompt: DEFAULT_ANALYSIS_PROMPT } }
      }));
    }
  }, [data.analysisPrompt, id]);

  const onAnalyze = React.useCallback(async () => {
    if (!src || status === 'running' || isAnalyzing) return;

    const promptToUse = (data.analysisPrompt ?? DEFAULT_ANALYSIS_PROMPT).trim();
    if (!promptToUse.length) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: 'Prompt cannot be empty' } }
      }));
      return;
    }

    // 更新节点状态为运行中
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { status: 'running', error: undefined, prompt: '', text: '' } }
    }));

    try {
      // 标记正在分析
      setIsAnalyzing(true);

      const result = await aiImageService.analyzeImage({
        prompt: promptToUse,
        sourceImage: src,
        aiProvider,
        model: imageModel,
      });

      if (!result.success || !result.data) {
        const message = result.error?.message || 'Analysis failed, please try again later';
        throw new Error(message);
      }

      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'succeeded', error: undefined, prompt: result.data.analysis, text: result.data.analysis } }
      }));
      console.log('✅ Analysis finished. Result synced to node:', result.data.analysis.substring(0, 50) + '...');

    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('❌ Analysis failed:', msg);

      // 更新节点状态为失败
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: msg, prompt: '', text: '' } }
      }));

    } finally {
      setIsAnalyzing(false);
    }
  }, [aiProvider, data.analysisPrompt, id, imageModel, isAnalyzing, src, status]);

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  const onPromptChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { analysisPrompt: value } }
    }));
  }, [id]);

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
        <div style={{ fontWeight: 600 }}>Analysis</div>
        <button
          onClick={onAnalyze}
          disabled={status === 'running' || !src || isAnalyzing}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            background: (status === 'running' || !src || isAnalyzing) ? '#e5e7eb' : '#111827',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: (status === 'running' || !src || isAnalyzing) ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'running' || isAnalyzing ? 'Running...' : 'Run'}
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
        title={src ? 'Double click to preview' : undefined}
      >
        {src ? (
          <img
            src={src}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>Waiting for image input</span>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Analysis Prompt</div>
        <textarea
          value={promptInput}
          onChange={onPromptChange}
          placeholder="Enter prompt for analysis"
          style={{
            width: '100%',
            minHeight: 70,
            resize: 'vertical',
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
        {data.prompt ? data.prompt : <span style={{ color: '#9ca3af' }}>Analysis result will appear here</span>}
      </div>

      <div style={{ fontSize: 12, color: '#6b7280' }}>Status: {status || 'idle'}</div>
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
        imageTitle="Analysis Preview"
        onClose={() => setPreview(false)}
        imageCollection={[]}
        currentImageId=""
        onImageChange={() => {}}
      />
    </div>
  );
}
