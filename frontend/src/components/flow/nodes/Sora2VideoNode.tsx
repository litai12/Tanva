import React from 'react';
import { Handle, Position } from 'reactflow';
import { AlertTriangle, Video, Share2, Download, Lock } from 'lucide-react';
import SmartImage from '../../ui/SmartImage';
import GenerationProgressBar from './GenerationProgressBar';
import { type Sora2VideoQuality } from '@/stores/aiChatStore';
import { useAuthStore } from '@/stores/authStore';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { fetchWithAuth } from '@/services/authFetch';
import { useLocaleText } from '@/utils/localeText';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    videoVersion?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
    videoQuality?: Sora2VideoQuality;
    model?: 'sora-2' | 'sora-2-vip' | 'sora-2-pro';
    clipDuration?: number;
    aspectRatio?: string;
    style?: string;
    watermark?: boolean;
    thumbnailEnabled?: boolean;
    privateMode?: boolean;
    storyboard?: boolean;
    characterTaskId?: string;
    characterUrl?: string;
    characterTimestamps?: string;
    history?: Sora2VideoHistoryItem[];
    fallbackMessage?: string;
  };
  selected?: boolean;
};

type Sora2VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  quality: Sora2VideoQuality;
  createdAt: string;
  elapsedSeconds?: number;
};

type DownloadFeedback = {
  type: 'progress' | 'success' | 'error';
  message: string;
};

const sora2ModelOptions: Array<{ label: string; value: 'sora-2' | 'sora-2-vip' | 'sora-2-pro' }> = [
  { label: 'sora-2-pro', value: 'sora-2-pro' },
  { label: 'sora-2-vip', value: 'sora-2-vip' },
  { label: 'sora-2', value: 'sora-2' },
];

function Sora2VideoNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>('16/9');
  const [aspectMenuOpen, setAspectMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] = React.useState<DownloadFeedback | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const [showHistory, setShowHistory] = React.useState(false);
  const sanitizeMediaUrl = React.useCallback((url?: string | null) => {
    if (!url || typeof url !== 'string') return undefined;
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    // 处理被 Markdown 包裹的格式，例如 "https://xxx.webp](https://xxx.webp"
    const markdownSplit = trimmed.split('](');
    const candidate = markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
    // 进一步去除空格后附带的内容
    const spaceIdx = candidate.indexOf(' ');
    return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
  }, []);
  const sanitizedVideoUrl = React.useMemo(
    () => sanitizeMediaUrl(data.videoUrl),
    [data.videoUrl, sanitizeMediaUrl]
  );
  const sanitizedThumbnail = React.useMemo(
    () => sanitizeMediaUrl(data.thumbnail),
    [data.thumbnail, sanitizeMediaUrl]
  );
  const cacheBustedVideoUrl = React.useMemo(() => {
    if (!sanitizedVideoUrl) return undefined;
    // 如果是 presigned 链接（包含 X-Amz / X-Tos 等签名字段），不要添加 cache-bust 参数（会导致签名失效）
    const isPresigned =
      /[?&](?:X-Amz|X-Tos)[^=]*=/i.test(sanitizedVideoUrl) ||
      /x-amz-|x-tos-/i.test(sanitizedVideoUrl);
    if (isPresigned) return sanitizedVideoUrl;
    const version = Number(data.videoVersion || 0);
    const separator = sanitizedVideoUrl.includes('?') ? '&' : '?';
    return `${sanitizedVideoUrl}${separator}v=${version}&_ts=${Date.now()}`;
  }, [sanitizedVideoUrl, data.videoVersion]);

  const handleMediaError = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { thumbnail: undefined, videoUrl: undefined } }
    }));
  }, [id]);

  React.useEffect(() => {
    if (!videoRef.current || !sanitizedVideoUrl) return;
    try {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      videoRef.current.load();
    } catch (error) {
      console.warn(lt('无法重置视频播放器', 'Failed to reset video player'), error);
    }
  }, [cacheBustedVideoUrl, lt, sanitizedVideoUrl]);

  // 全屏时强制设置 object-fit: contain，确保视频按原比例显示
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleFullscreenChange = () => {
      const isFullscreen =
        document.fullscreenElement === video ||
        (document as any).webkitFullscreenElement === video ||
        (document as any).mozFullScreenElement === video ||
        (document as any).msFullscreenElement === video;

      if (isFullscreen) {
        video.style.objectFit = 'contain';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.maxWidth = '100vw';
        video.style.maxHeight = '100vh';
        video.style.background = '#000';
      } else {
        video.style.objectFit = 'cover';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.maxWidth = '';
        video.style.maxHeight = '';
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [sanitizedVideoUrl]);
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.('.sora2-dropdown')) {
        setAspectMenuOpen(false);
        setDurationMenuOpen(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      if (downloadFeedbackTimer.current) {
        window.clearTimeout(downloadFeedbackTimer.current);
        downloadFeedbackTimer.current = undefined;
      }
    };
  }, []);
  const scheduleFeedbackClear = React.useCallback((delay: number = 3000) => {
    if (downloadFeedbackTimer.current) {
      window.clearTimeout(downloadFeedbackTimer.current);
      downloadFeedbackTimer.current = undefined;
    }
    downloadFeedbackTimer.current = window.setTimeout(() => {
      setDownloadFeedback(null);
      downloadFeedbackTimer.current = undefined;
    }, delay);
  }, [setDownloadFeedback]);
  const onRun = React.useCallback(() => data.onRun?.(id), [data, id]);
  const onSend = React.useCallback(() => data.onSend?.(id), [data, id]);
  const styleValue = typeof data.style === 'string' ? data.style : '';
  const watermarkEnabled = data.watermark === true;
  const thumbnailEnabled = data.thumbnailEnabled === true;
  const privateModeEnabled = data.privateMode === true;
  const storyboardEnabled = data.storyboard === true;
  const characterTaskId = typeof data.characterTaskId === 'string' ? data.characterTaskId : '';
  const characterUrl = typeof data.characterUrl === 'string' ? data.characterUrl : '';
  const characterTimestamps = typeof data.characterTimestamps === 'string' ? data.characterTimestamps : '';
  const clipDuration = typeof data.clipDuration === 'number' ? data.clipDuration : undefined;
  const aspectRatioValue = typeof data.aspectRatio === 'string' ? data.aspectRatio : '';
  const selectedModel: 'sora-2' | 'sora-2-vip' | 'sora-2-pro' =
    data.model === 'sora-2' || data.model === 'sora-2-vip' || data.model === 'sora-2-pro'
      ? data.model
      : 'sora-2-pro';
  const handleModelChange = React.useCallback((value: 'sora-2' | 'sora-2-vip' | 'sora-2-pro') => {
    if (value === selectedModel) return;
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { model: value } }
    }));
  }, [id, selectedModel]);
  const styleOptions = React.useMemo<Array<{ label: string; value: string }>>(() => ([
    { label: lt('无（默认）', 'None (default)'), value: '' },
    { label: lt('动漫（anime）', 'Anime (anime)'), value: 'anime' },
    { label: lt('漫画（comic）', 'Comic (comic)'), value: 'comic' },
    { label: lt('新闻（news）', 'News (news)'), value: 'news' },
    { label: lt('自拍（selfie）', 'Selfie (selfie)'), value: 'selfie' },
    { label: lt('复古（nostalgic）', 'Nostalgic (nostalgic)'), value: 'nostalgic' },
    { label: lt('感恩节（thanksgiving）', 'Thanksgiving (thanksgiving)'), value: 'thanksgiving' },
  ]), [lt]);
  const handleStyleChange = React.useCallback((value: string) => {
    if (value === styleValue) return;
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { style: value || undefined } }
    }));
  }, [id, styleValue]);
  const toggleFlag = React.useCallback((key: 'watermark' | 'thumbnailEnabled' | 'privateMode' | 'storyboard', current: boolean) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { [key]: !current } }
    }));
  }, [id]);
  const updateTextField = React.useCallback((key: 'characterTaskId' | 'characterUrl' | 'characterTimestamps', value: string) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { [key]: value.trim() || undefined } }
    }));
  }, [id]);
  const aspectOptions = React.useMemo(() => ([
    { label: lt('自动', 'Auto'), value: '' },
    { label: lt('横屏（16:9）', 'Landscape (16:9)'), value: '16:9', suffix: lt('横屏 16:9', 'Landscape 16:9') },
    { label: lt('竖屏（9:16）', 'Portrait (9:16)'), value: '9:16', suffix: lt('竖屏 9:16', 'Portrait 9:16') },
  ]), [lt]);
  const handleAspectChange = React.useCallback((value: string) => {
    if (value === aspectRatioValue) return;
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { aspectRatio: value || undefined } }
    }));
  }, [aspectRatioValue, id]);
  const durationOptions = React.useMemo(() => ([
    { label: lt('10秒', '10s'), value: 10 },
    { label: lt('15秒', '15s'), value: 15 },
    { label: lt('25秒', '25s'), value: 25, locked: !isAdmin }
  ]), [isAdmin, lt]);
  const handleDurationChange = React.useCallback((value: number) => {
    if (value === clipDuration) return;
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { clipDuration: value } }
    }));
  }, [clipDuration, id]);
  const promptSuffixPreview = React.useMemo(() => {
    const pieces: string[] = [];
    if (clipDuration) pieces.push(`${clipDuration}s`);
    const aspectSuffix = aspectOptions.find(opt => opt.value === aspectRatioValue)?.suffix;
    if (aspectSuffix) pieces.push(aspectSuffix);
    return pieces.join(' ');
  }, [clipDuration, aspectRatioValue, aspectOptions]);
  const aspectLabel = React.useMemo(() => {
    const match = aspectOptions.find(opt => opt.value === aspectRatioValue);
    return match ? match.label : lt('自动', 'Auto');
  }, [aspectOptions, aspectRatioValue, lt]);
  const durationLabel = React.useMemo(() => {
    const match = durationOptions.find(opt => opt.value === clipDuration);
    if (match) return match.label;
    if (clipDuration) return lt(`${clipDuration}秒`, `${clipDuration}s`);
    return lt('未设置', 'Not set');
  }, [clipDuration, durationOptions, lt]);

  React.useEffect(() => {
    if (!aspectRatioValue) {
      setPreviewAspect('16/9');
      return;
    }
    const [w, h] = aspectRatioValue.split(':');
    if (w && h) {
      setPreviewAspect(`${w}/${h}`);
    }
  }, [aspectRatioValue]);
  const feedbackColors = React.useMemo(() => {
    if (!downloadFeedback) return null;
    if (downloadFeedback.type === 'error') {
      return { color: '#b91c1c', background: '#fef2f2', borderColor: '#fecaca' };
    }
    if (downloadFeedback.type === 'success') {
      return { color: '#15803d', background: '#ecfdf5', borderColor: '#bbf7d0' };
    }
    return { color: '#1d4ed8', background: '#eff6ff', borderColor: '#bfdbfe' };
  }, [downloadFeedback]);
  const isDownloadDisabled = !data.videoUrl || isDownloading;
  const historyItems = React.useMemo<Sora2VideoHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history]
  );
  const copyVideoLink = React.useCallback(async (url?: string) => {
    if (!url) {
      alert(lt('没有可复制的视频链接', 'No video link to copy'));
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        alert(lt('已复制视频链接', 'Video link copied'));
        return;
      }
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (success) {
        alert(lt('已复制视频链接', 'Video link copied'));
      } else {
        prompt(lt('请手动复制以下链接：', 'Please copy this link manually:'), url);
      }
    } catch (error) {
      console.error(lt('复制失败:', 'Copy failed:'), error);
      prompt(lt('复制失败，请手动复制以下链接：', 'Copy failed. Please copy this link manually:'), url);
    }
  }, [lt]);
  const triggerDownload = React.useCallback(async (url?: string) => {
    if (!url || isDownloading) return;
    if (downloadFeedbackTimer.current) {
      window.clearTimeout(downloadFeedbackTimer.current);
      downloadFeedbackTimer.current = undefined;
    }
    setIsDownloading(true);
    setDownloadFeedback({ type: 'progress', message: lt('视频下载中，请稍等...', 'Downloading video...') });
    try {
      const proxiedUrl = proxifyRemoteAssetUrl(url);
      const response = await fetchWithAuth(proxiedUrl, {
        mode: 'cors',
        credentials: 'omit',
        auth: 'omit',
        allowRefresh: false,
      });
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `video-${new Date().toISOString().split('T')[0]}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 200);
        setDownloadFeedback({ type: 'success', message: lt('下载完成，稍后可再次下载', 'Download completed') });
        scheduleFeedbackClear(2000);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setDownloadFeedback({ type: 'success', message: lt('已在新标签页打开视频链接', 'Opened video link in new tab') });
        scheduleFeedbackClear(3000);
      }
    } catch (error) {
      console.error(lt('下载失败:', 'Download failed:'), error);
      alert(lt('下载失败，请尝试在浏览器中打开链接', 'Download failed. Please try opening the link in browser.'));
      setDownloadFeedback({ type: 'error', message: lt('下载失败，请稍后重试', 'Download failed. Please try again later.') });
      scheduleFeedbackClear(4000);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, lt, scheduleFeedbackClear]);
  const handleApplyHistory = React.useCallback((item: Sora2VideoHistoryItem) => {
    const patch: Record<string, any> = {
      videoUrl: item.videoUrl,
      thumbnail: item.thumbnail,
      videoVersion: Number(data.videoVersion || 0) + 1,
    };

    // 如果当前正在运行，不要改动运行状态，避免刷新掉 Run 按钮的 loading / 进度
    if (data.status !== 'running') {
      patch.status = 'succeeded';
      patch.error = undefined;
    }

    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [id, data.videoVersion, data.status]);
  const formatHistoryTime = React.useCallback((iso: string) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }, []);
  const truncatePrompt = React.useCallback((text: string) => {
    if (!text) return lt('（无提示词）', '(No prompt)');
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }, [lt]);

  const handleMediaPointerDown = (event: React.PointerEvent | React.MouseEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as any).nativeEvent;
    nativeEvent?.stopImmediatePropagation?.();
  };
  const handleMediaTouchStart = (event: React.TouchEvent) => {
    event.stopPropagation();
    const nativeEvent = event.nativeEvent;
    nativeEvent?.stopImmediatePropagation?.();
  };
  // 阻止按钮的mousedown事件冒泡，防止触发节点拖拽
  const handleButtonMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  const renderPreview = () => {
    const commonMediaStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      borderRadius: 6,
      background: '#000'
    };

    if (sanitizedVideoUrl) {
      const rawSrc = cacheBustedVideoUrl || sanitizedVideoUrl;
      const videoSrc = proxifyRemoteAssetUrl(rawSrc);
      return (
        <video
          key={`${videoSrc}-${data.videoVersion || 0}`}
          ref={videoRef}
          controls
          poster={proxifyRemoteAssetUrl(sanitizedThumbnail || '')}
          style={commonMediaStyle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
            }
          }}
          onPointerDownCapture={handleMediaPointerDown}
          onMouseDownCapture={handleMediaPointerDown}
          onTouchStartCapture={handleMediaTouchStart}
          onError={handleMediaError}
        >
          <source src={videoSrc} type="video/mp4" />
          {lt('您的浏览器不支持 video 标签', 'Your browser does not support video tag')}
        </video>
      );
    }
    if (sanitizedThumbnail) {
      return (
        <SmartImage
          src={proxifyRemoteAssetUrl(sanitizedThumbnail)}
          alt="video thumbnail"
          style={commonMediaStyle}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setPreviewAspect(`${img.naturalWidth}/${img.naturalHeight}`);
            }
          }}
          onPointerDownCapture={handleMediaPointerDown}
          onMouseDownCapture={handleMediaPointerDown}
          onTouchStartCapture={handleMediaTouchStart}
          onError={handleMediaError}
        />
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
        <Video size={24} strokeWidth={2} />
        <div style={{ fontSize: 11 }}>{lt('等待生成...', 'Waiting...')}</div>
      </div>
    );
  };

  return (
    <div style={{
      width: 280,
      padding: 10,
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      boxShadow,
      position: 'relative'
    }}>
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '32%' }}
        onMouseEnter={() => setHover('text-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: '60%' }}
        onMouseEnter={() => setHover('image-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="character"
        style={{ top: '78%' }}
        onMouseEnter={() => setHover('character-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('video-out')}
        onMouseLeave={() => setHover(null)}
      />
      {hover === 'text-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '32%', transform: 'translate(-100%, -50%)' }}>prompt</div>
      )}
      {hover === 'image-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '60%', transform: 'translate(-100%, -50%)' }}>image</div>
      )}
      {hover === 'character-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '78%', transform: 'translate(-100%, -50%)' }}>character</div>
      )}
      {hover === 'video-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>video</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Video size={18} />
          <span>Sora2 Pro</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onRun}
            onMouseDown={handleButtonMouseDown}
            disabled={data.status === 'running'}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: data.status === 'running' ? '#e5e7eb' : '#111827',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: data.status === 'running' ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: data.status === 'running' ? 0.6 : 1
            }}
          >
            {lt('运行', 'Run')}
          </button>
          <button
            onClick={() => copyVideoLink(data.videoUrl)}
            onMouseDown={handleButtonMouseDown}
            title={lt('复制链接', 'Copy link')}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: '#111827',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: data.videoUrl ? 'pointer' : 'not-allowed',
              color: '#fff',
              opacity: data.videoUrl ? 1 : 0.35
            }}
            disabled={!data.videoUrl}
          >
            <Share2 size={14} />
          </button>
          <button
            onClick={() => triggerDownload(data.videoUrl)}
            onMouseDown={handleButtonMouseDown}
            title={lt('下载视频', 'Download video')}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: isDownloadDisabled ? '#e5e7eb' : '#111827',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isDownloadDisabled ? 'not-allowed' : 'pointer',
              color: '#fff',
              opacity: isDownloadDisabled ? 0.35 : 1
            }}
            disabled={isDownloadDisabled}
          >
            {isDownloading ? (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#111827' }}>···</span>
            ) : (
              <Download size={14} />
            )}
          </button>
        </div>
      </div>

      {downloadFeedback && feedbackColors && (
        <div
          style={{
            margin: '2px 0',
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: 11,
            border: `1px solid ${feedbackColors.borderColor}`,
            background: feedbackColors.background,
            color: feedbackColors.color
          }}
        >
          {downloadFeedback.message}
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lt('模型', 'Model')}</div>
        <select
          className='nodrag'
          value={selectedModel}
          onChange={(event) => handleModelChange(event.target.value as 'sora-2' | 'sora-2-vip' | 'sora-2-pro')}
          style={{
            width: '100%',
            height: 32,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            padding: '0 10px',
            fontSize: 12,
            background: '#fff'
          }}
        >
          {sora2ModelOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lt('视频风格', 'Video Style')}</div>
        <select
          className='nodrag'
          value={styleValue}
          onChange={(event) => handleStyleChange(event.target.value)}
          style={{
            width: '100%',
            height: 32,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            padding: '0 10px',
            fontSize: 12,
            background: '#fff'
          }}
        >
          {styleOptions.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <button
          type='button'
          onMouseDown={handleButtonMouseDown}
          onClick={() => toggleFlag('watermark', watermarkEnabled)}
          style={{
            borderRadius: 8,
            border: `1px solid ${watermarkEnabled ? '#111827' : '#e5e7eb'}`,
            background: watermarkEnabled ? '#111827' : '#fff',
            color: watermarkEnabled ? '#fff' : '#111827',
            fontSize: 12,
            height: 30,
            cursor: 'pointer'
          }}
        >
          {lt('水印', 'Watermark')} {watermarkEnabled ? lt('开', 'On') : lt('关', 'Off')}
        </button>
        <button
          type='button'
          onMouseDown={handleButtonMouseDown}
          onClick={() => toggleFlag('thumbnailEnabled', thumbnailEnabled)}
          style={{
            borderRadius: 8,
            border: `1px solid ${thumbnailEnabled ? '#111827' : '#e5e7eb'}`,
            background: thumbnailEnabled ? '#111827' : '#fff',
            color: thumbnailEnabled ? '#fff' : '#111827',
            fontSize: 12,
            height: 30,
            cursor: 'pointer'
          }}
        >
          {lt('缩略图', 'Thumbnail')} {thumbnailEnabled ? lt('开', 'On') : lt('关', 'Off')}
        </button>
        <button
          type='button'
          onMouseDown={handleButtonMouseDown}
          onClick={() => toggleFlag('privateMode', privateModeEnabled)}
          style={{
            borderRadius: 8,
            border: `1px solid ${privateModeEnabled ? '#111827' : '#e5e7eb'}`,
            background: privateModeEnabled ? '#111827' : '#fff',
            color: privateModeEnabled ? '#fff' : '#111827',
            fontSize: 12,
            height: 30,
            cursor: 'pointer'
          }}
        >
          {lt('隐私', 'Private')} {privateModeEnabled ? lt('开', 'On') : lt('关', 'Off')}
        </button>
        <button
          type='button'
          onMouseDown={handleButtonMouseDown}
          onClick={() => toggleFlag('storyboard', storyboardEnabled)}
          style={{
            borderRadius: 8,
            border: `1px solid ${storyboardEnabled ? '#111827' : '#e5e7eb'}`,
            background: storyboardEnabled ? '#111827' : '#fff',
            color: storyboardEnabled ? '#fff' : '#111827',
            fontSize: 12,
            height: 30,
            cursor: 'pointer'
          }}
        >
          {lt('故事板', 'Storyboard')} {storyboardEnabled ? lt('开', 'On') : lt('关', 'Off')}
        </button>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lt('角色任务ID（可选）', 'Character Task ID (optional)')}</div>
        <input
          className='nodrag'
          value={characterTaskId}
          onChange={(event) => updateTextField('characterTaskId', event.target.value)}
          placeholder='task_xxx'
          style={{
            width: '100%',
            height: 32,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            padding: '0 10px',
            fontSize: 12
          }}
        />
        <div style={{ marginTop: 4, fontSize: 10, color: '#94a3b8' }}>
          {lt(
            '运行时会自动解析角色并补全 @username / 角色ID',
            'Character info will be auto-resolved at runtime and fill @username / character ID'
          )}
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lt('角色ID/URL（可选）', 'Character ID/URL (optional)')}</div>
        <input
          className='nodrag'
          value={characterUrl}
          onChange={(event) => updateTextField('characterUrl', event.target.value)}
          placeholder={lt('ch_xxx 或 URL', 'ch_xxx or URL')}
          style={{
            width: '100%',
            height: 32,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            padding: '0 10px',
            fontSize: 12
          }}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lt('角色时间戳（可选）', 'Character Timestamps (optional)')}</div>
        <input
          className='nodrag'
          value={characterTimestamps}
          onChange={(event) => updateTextField('characterTimestamps', event.target.value)}
          placeholder='1,3'
          style={{
            width: '100%',
            height: 32,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            padding: '0 10px',
            fontSize: 12
          }}
        />
      </div>
      <div className="sora2-dropdown" style={{ marginBottom: 8, position: 'relative' }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lt('尺寸', 'Size')}</div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDurationMenuOpen(false);
            setAspectMenuOpen((open) => !open);
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            background: '#fff',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          <span>{aspectLabel}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{aspectMenuOpen ? '▴' : '▾'}</span>
        </button>
        {aspectMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(event) => event.stopPropagation()}
            style={{
              position: 'absolute',
              zIndex: 20,
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 8,
              boxShadow: '0 8px 16px rgba(15,23,42,0.08)'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {aspectOptions.map((option) => {
                const isActive = option.value === aspectRatioValue;
                return (
                  <button
                    key={option.value || 'auto'}
                    type="button"
                    onClick={() => {
                      handleAspectChange(option.value);
                      setAspectMenuOpen(false);
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: `1px solid ${isActive ? '#2563eb' : '#e5e7eb'}`,
                      background: isActive ? '#2563eb' : '#fff',
                      color: isActive ? '#fff' : '#111827',
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className="sora2-dropdown" style={{ marginBottom: 8, position: 'relative' }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lt('时间长度', 'Duration')}</div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setAspectMenuOpen(false);
            setDurationMenuOpen((open) => !open);
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            background: '#fff',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          <span>{durationLabel}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{durationMenuOpen ? '▴' : '▾'}</span>
        </button>
        {durationMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(event) => event.stopPropagation()}
            style={{
              position: 'absolute',
              zIndex: 20,
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 8,
              boxShadow: '0 8px 16px rgba(15,23,42,0.08)'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {durationOptions.map((option) => {
                const isActive = option.value === clipDuration;
                const isLocked = option.locked;
                return (
                  <button
                    key={option.value}
                    type="button"
                    title={isLocked ? lt('仅管理员可用', 'Admin only') : undefined}
                    onClick={() => {
                      if (isLocked) return;
                      handleDurationChange(option.value);
                      setDurationMenuOpen(false);
                    }}
                    disabled={isLocked}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: `1px solid ${isActive ? '#2563eb' : '#e5e7eb'}`,
                      background: isActive ? '#2563eb' : '#fff',
                      color: isActive ? '#fff' : (isLocked ? '#9ca3af' : '#111827'),
                      fontSize: 12,
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      opacity: isLocked ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    {option.label}
                    {isLocked && <Lock size={10} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {promptSuffixPreview && (
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
          {lt('当前生成参数：', 'Current params: ')}{promptSuffixPreview}
        </div>
      )}

      <div
        style={{
          width: '100%',
          aspectRatio: previewAspect,
          minHeight: 140,
          background: '#f8fafc',
          borderRadius: 6,
          border: '1px solid #eef0f2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        {renderPreview()}
      </div>

      <GenerationProgressBar
        status={data.status || 'idle'}
        progress={data.status === 'running' ? 30 : data.status === 'succeeded' ? 100 : 0}
      />

      {historyItems.length > 0 && (
        <div style={{
          marginTop: 8,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => setShowHistory(!showHistory)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{lt('历史记录', 'History')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{historyItems.length} {lt('条', 'items')}</span>
              <span style={{ fontSize: 14, color: '#64748b' }}>{showHistory ? '▴' : '▾'}</span>
            </div>
          </div>
          {showHistory && historyItems.map((item, index) => {
            const isActive = item.videoUrl === data.videoUrl;
            return (
              <div
                key={item.id}
                style={{
                  borderRadius: 6,
                  border: '1px solid ' + (isActive ? '#c7d2fe' : '#e2e8f0'),
                  background: isActive ? '#eef2ff' : '#fff',
                  padding: '6px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#475569' }}>
                  <span>
                    #{index + 1} · {formatHistoryTime(item.createdAt)}
                  </span>
                  {isActive && (
                    <span style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 600 }}>{lt('当前', 'Current')}</span>
                  )}
                </div>
                {typeof item.elapsedSeconds === 'number' && (
                  <div style={{ fontSize: 11, color: '#475569' }}>
                    {lt('耗时', 'Elapsed')} {item.elapsedSeconds}s
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#0f172a' }}>
                  {truncatePrompt(item.prompt)}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => handleApplyHistory(item)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid #94a3b8',
                        background: '#fff',
                        fontSize: 11,
                        cursor: 'pointer'
                      }}
                    >
                      {lt('设为当前', 'Set current')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => copyVideoLink(item.videoUrl)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid #94a3b8',
                      background: '#fff',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                  >
                    {lt('复制链接', 'Copy link')}
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerDownload(item.videoUrl)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid #94a3b8',
                      background: '#fff',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                  >
                    {lt('下载', 'Download')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.error && (
        <div style={{
          marginTop: 6,
          padding: '6px 8px',
          background: '#fef2f2',
          border: '1px solid #fecdd3',
          borderRadius: 6,
          color: '#b91c1c',
          fontSize: 12,
          display: 'flex',
          gap: 6,
          alignItems: 'center'
        }}>
          <AlertTriangle size={14} />
          <span>{data.error}</span>
        </div>
      )}

      {data.fallbackMessage && (
        <div style={{
          marginTop: 6,
          padding: '6px 8px',
          background: '#fefce8',
          border: '1px solid #fde047',
          borderRadius: 6,
          fontSize: 11,
          color: '#854d0e',
          display: 'flex',
          gap: 6,
          alignItems: 'center'
        }}>
          <span>ℹ️</span>
          <span>{data.fallbackMessage}</span>
        </div>
      )}
    </div>
  );
}

export default React.memo(Sora2VideoNodeInner);
