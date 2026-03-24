import React from 'react';
import { Handle, Position, useStore, type ReactFlowState, type Node } from 'reactflow';
import SmartImage from '../../ui/SmartImage';
import { fetchWithAuth } from '@/services/authFetch';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useLocaleText } from '@/utils/localeText';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'converting' | 'ready' | 'error';
    error?: string;
    videoUrl?: string;
    gifUrl?: string;
    startSeconds?: number;
    durationSeconds?: number;
    fps?: number;
    width?: number;
    loop?: number;
  };
  selected?: boolean;
};

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000') + '/api';

const DEFAULT_START_SECONDS = 0;
const DEFAULT_DURATION_SECONDS = 5;
const DEFAULT_FPS = 10;
const DEFAULT_WIDTH = 480;
const DEFAULT_LOOP = 0;

const sanitizeMediaUrl = (raw?: string | null | undefined): string | undefined => {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
};

const resolveVideoUrlFromNode = (node?: Node<any> | null): string | undefined => {
  if (!node) return undefined;
  const data = (node.data ?? {}) as any;

  const candidates = [
    data.videoUrl,
    data.video_url,
    data.videoSourceUrl,
    data.video_source_url,
    data.video,
    data.videoSource,
    data.output?.video_url,
    Array.isArray(data.output) ? data.output[0]?.video_url : undefined,
    data.output?.url,
    data.raw?.output?.video_url,
    data.raw?.video_url,
    Array.isArray(data.history) ? data.history[0]?.videoUrl : undefined,
    data.videoSource?.url,
  ];

  for (const c of candidates) {
    const s = sanitizeMediaUrl(c);
    if (s) return s;
  }
  return undefined;
};

function VideoToGifNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const projectId = useProjectContentStore((s) => s.projectId);
  const [hover, setHover] = React.useState<string | null>(null);

  const connectedVideoUrl = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find(
          (e) =>
            e.target === id &&
            typeof e.targetHandle === 'string' &&
            e.targetHandle.startsWith('video')
        );
        if (!edge) return undefined;
        const sourceNode = state.getNodes().find((n: Node<any>) => n.id === edge.source);
        return resolveVideoUrlFromNode(sourceNode);
      },
      [id]
    )
  );

  const hasVideoConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (edge) =>
            edge.target === id &&
            typeof edge.targetHandle === 'string' &&
            edge.targetHandle.startsWith('video')
        ),
      [id]
    )
  );

  const effectiveVideoUrl = connectedVideoUrl || data.videoUrl;
  const status = data.status ?? 'idle';
  const error = data.error;
  const gifUrl = data.gifUrl;

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const startSeconds = typeof data.startSeconds === 'number' ? data.startSeconds : DEFAULT_START_SECONDS;
  const durationSeconds =
    typeof data.durationSeconds === 'number' ? data.durationSeconds : DEFAULT_DURATION_SECONDS;
  const fps = typeof data.fps === 'number' ? data.fps : DEFAULT_FPS;
  const width = typeof data.width === 'number' ? data.width : DEFAULT_WIDTH;
  const loop = typeof data.loop === 'number' ? data.loop : DEFAULT_LOOP;

  const updateNodeData = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  React.useEffect(() => {
    const patch: Record<string, any> = {};
    if (typeof data.startSeconds === 'undefined') patch.startSeconds = DEFAULT_START_SECONDS;
    if (typeof data.durationSeconds === 'undefined') patch.durationSeconds = DEFAULT_DURATION_SECONDS;
    if (typeof data.fps === 'undefined') patch.fps = DEFAULT_FPS;
    if (typeof data.width === 'undefined') patch.width = DEFAULT_WIDTH;
    if (typeof data.loop === 'undefined') patch.loop = DEFAULT_LOOP;
    if (Object.keys(patch).length > 0) updateNodeData(patch);
  }, [data.durationSeconds, data.fps, data.loop, data.startSeconds, data.width, updateNodeData]);

  const handleConvert = React.useCallback(async () => {
    if (!effectiveVideoUrl || status === 'converting') return;

    updateNodeData({ status: 'converting', error: undefined });

    try {
      const resp = await fetchWithAuth(`${API_BASE_URL}/video-gif/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: effectiveVideoUrl,
          projectId: projectId ?? undefined,
          startSeconds,
          durationSeconds,
          fps,
          width,
          loop,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.message || lt('视频转 GIF 失败', 'Video to GIF conversion failed'));
      }

      const result = await resp.json().catch(() => ({}));
      if (!result?.gifUrl) {
        throw new Error(lt('未返回 GIF 链接', 'No GIF URL returned'));
      }

      updateNodeData({
        status: 'ready',
        error: undefined,
        videoUrl: effectiveVideoUrl,
        gifUrl: result.gifUrl,
      });
    } catch (err: any) {
      updateNodeData({
        status: 'error',
        error: err?.message || lt('视频转 GIF 失败', 'Video to GIF conversion failed'),
      });
    }
  }, [durationSeconds, effectiveVideoUrl, fps, loop, lt, projectId, startSeconds, status, updateNodeData, width]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail || detail.id !== id) return;
      void handleConvert();
    };

    window.addEventListener('flow:run-node', handler as EventListener);
    return () => {
      window.removeEventListener('flow:run-node', handler as EventListener);
    };
  }, [handleConvert, id]);

  const canConvert = Boolean(effectiveVideoUrl) && status !== 'converting';

  return (
    <div
      style={{
        width: 320,
        padding: 10,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Video to GIF</div>
        <button
          onClick={handleConvert}
          disabled={!canConvert}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            background: canConvert ? '#111827' : '#e5e7eb',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: canConvert ? 'pointer' : 'not-allowed',
          }}
        >
          {status === 'converting' ? lt('转换中...', 'Converting...') : lt('生成 GIF', 'Create GIF')}
        </button>
      </div>

      <div
        style={{
          width: '100%',
          height: 140,
          background: '#111827',
          borderRadius: 6,
          border: '1px solid #eef0f2',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {gifUrl ? (
          <SmartImage
            src={gifUrl}
            alt={lt('GIF 预览', 'GIF preview')}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {hasVideoConnection
              ? lt('等待视频输入', 'Waiting for video input')
              : lt('请连接视频节点', 'Please connect a video node')}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        <label style={{ fontSize: 11, color: '#374151' }}>
          {lt('开始(s)', 'Start(s)')}
          <input
            type='number'
            className='nodrag nopan'
            value={startSeconds}
            min={0}
            step={0.1}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0) updateNodeData({ startSeconds: val });
            }}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>

        <label style={{ fontSize: 11, color: '#374151' }}>
          {lt('时长(s)', 'Duration(s)')}
          <input
            type='number'
            className='nodrag nopan'
            value={durationSeconds}
            min={0.5}
            max={15}
            step={0.5}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0.5 && val <= 15) updateNodeData({ durationSeconds: val });
            }}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>

        <label style={{ fontSize: 11, color: '#374151' }}>
          FPS
          <input
            type='number'
            className='nodrag nopan'
            value={fps}
            min={2}
            max={20}
            step={1}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 2 && val <= 20) updateNodeData({ fps: Math.round(val) });
            }}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>

        <label style={{ fontSize: 11, color: '#374151' }}>
          {lt('宽度(px)', 'Width(px)')}
          <input
            type='number'
            className='nodrag nopan'
            value={width}
            min={160}
            max={960}
            step={10}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 160 && val <= 960) updateNodeData({ width: Math.round(val) });
            }}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
        <input
          type='checkbox'
          className='nodrag nopan'
          checked={loop === 0}
          onChange={(e) => updateNodeData({ loop: e.target.checked ? 0 : 1 })}
        />
        {lt('循环播放（无限）', 'Loop forever')}
      </label>

      {gifUrl && (
        <a
          href={gifUrl}
          target='_blank'
          rel='noreferrer'
          style={{
            fontSize: 12,
            color: '#2563eb',
            textDecoration: 'none',
          }}
        >
          {lt('打开 GIF 原图', 'Open GIF in new tab')}
        </a>
      )}

      {status === 'error' && error && (
        <div
          style={{
            fontSize: 12,
            color: '#ef4444',
            padding: '4px 8px',
            background: '#fef2f2',
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      <Handle
        type='target'
        position={Position.Left}
        id='video'
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('video-in')}
        onMouseLeave={() => setHover(null)}
      />

      <Handle
        type='source'
        position={Position.Right}
        id='image'
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('image-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'video-in' && (
        <div className='flow-tooltip' style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          video
        </div>
      )}
      {hover === 'image-out' && (
        <div className='flow-tooltip' style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          image
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoToGifNodeInner);
