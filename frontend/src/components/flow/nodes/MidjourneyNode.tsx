import React from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import { HelpCircle, Send as SendIcon, Sparkles } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import SmartImage from '../../ui/SmartImage';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { parseFlowImageAssetRef } from '@/services/flowImageAssetStore';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import {
  isAssetKeyRef,
  isBlobUrl,
  isDataImageUrl,
  isRemoteUrl,
  toRenderableImageSrc,
} from '@/utils/imageSource';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { useLocaleText } from '@/utils/localeText';
import { useAIChatStore } from '@/stores/aiChatStore';
import { flowImagePreviewWell, flowLetterboxBackground } from './flowNodeDarkTheme';
import RunCreditBadge from './RunCreditBadge';
import { useImageNodeCreditsPreview } from '../hooks/useImageNodeCreditsPreview';

type Props = {
  id: string;
  type?: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    progressStartedAt?: number | string | null;
    imageData?: string;
    thumbnail?: string;
    imageUrls?: string[]; // V7/Niji7 多图支持
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    presetPrompt?: string;
    creditsPerCall?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
    imageUrl?: string;
    promptEn?: string;
    lastHistoryId?: string;
    speedMode?: 'draft' | 'fast' | 'turbo';
    modelVersion?: 'v7' | 'v8';
    raw?: boolean;
    chaos?: string | number;
    stylize?: string | number;
    weird?: string | number;
    seed?: string | number;
    noPrompt?: string;
    imageWeight?: string | number;
    styleRefs?: string;
    styleVersion?: string | number;
    styleWeight?: string | number;
    quality?: '1' | '2' | '4';
    draft?: boolean;
    tile?: boolean;
    hd?: boolean;
    objectReference?: string;
    omniReference?: string;
    omniWeight?: string | number;
    exp?: string | number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
  };
  selected?: boolean;
};

// 构建图片 src - 优先使用 OSS URL，避�?proxy 降级
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (isDataImageUrl(trimmed) || isBlobUrl(trimmed)) {
    return trimmed;
  }

  if (isAssetKeyRef(trimmed)) {
    const key = trimmed.replace(/^\/+/, '');
    return proxifyRemoteAssetUrl(
      `/api/assets/proxy?key=${encodeURIComponent(key)}`,
      { forceProxy: true }
    );
  }

  if (isRemoteUrl(trimmed)) {
    const renderable = toRenderableImageSrc(trimmed);
    return renderable || proxifyRemoteAssetUrl(trimmed, { forceProxy: true });
  }

  return toRenderableImageSrc(trimmed) || undefined;
};

function MidjourneyNodeInner({ id, type, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isNiji = type === 'niji7';
  const accentColor = isNiji ? '#ec4899' : '#8b5cf6';
  const accentSoft = isNiji ? '#fdf2f8' : '#faf5ff';
  const accentBorder = isNiji ? '#f9a8d4' : '#e9d5ff';
  const isDarkTheme = useAIChatStore((state) => state.chatTheme === 'black');
  const title = isNiji ? 'Niji 7' : 'Midjourney';
  const midjourneyModelVersion = !isNiji && data.modelVersion === 'v8' ? 'v8' : 'v7';
  const isV8 = midjourneyModelVersion === 'v8';
  const referenceImageLimit = isV8 ? 20 : 10;
  const { status, error } = data;
  const rawFullValue = data.imageUrl || data.imageData;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = fullAssetId ? (fullAssetUrl || undefined) : buildImageSrc(rawFullValue);

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = thumbAssetId ? (thumbAssetUrl || fullSrc) : (buildImageSrc(rawThumbValue) || fullSrc);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [showHelp, setShowHelp] = React.useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = React.useState(false);
  const advancedImageOutputHandlePositions = ['28%', '42%', '58%', '72%'] as const;
  const advancedImageOutputHandleIds = ['img1', 'img2', 'img3', 'img4'] as const;

  const borderColor = selected ? accentColor : '#e5e7eb';
  const boxShadow = selected
    ? isNiji
      ? '0 0 0 2px rgba(236,72,153,0.12)'
      : '0 0 0 2px rgba(139,92,246,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);

  const allImages = React.useMemo(
    () => {
      // 优先使用 V7/Niji7 �?imageUrls
      if (data.imageUrls && data.imageUrls.length > 0) {
        return data.imageUrls.map((url, idx) => ({
          id: `mj-${idx}`,
          src: buildImageSrc(url),
          title: `Image ${idx + 1}`,
          timestamp: Date.now() + idx,
        } as ImageItem));
      }
      return projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.src,
            title: item.title,
            timestamp: item.timestamp,
          } as ImageItem)
      );
    },
    [projectHistory, data.imageUrls]
  );

  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter((edge) => edge.target === id && edge.targetHandle === 'img').length;
  });
  const aspectRatioValue = data.aspectRatio ?? '1:1';
  const { credits: backendCredits } = useImageNodeCreditsPreview({
    nodeType: type === 'niji7' ? 'niji7' : 'midjourneyV7',
    aiProvider: 'midjourney',
    modelVersion: midjourneyModelVersion,
    aspectRatio: aspectRatioValue || undefined,
    referenceImageCount: imageInputCount,
    managedModelKey: data.managedModelKey,
    vendorKey: data.vendorKey,
    platformKey: data.platformKey,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === 'number' ? backendCredits : data.creditsPerCall;

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const updateData = React.useCallback(
    (patch: Partial<Props['data']>) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  // 宽高比选择
  const aspectOptions = React.useMemo(
    () => [
      { label: lt('自动', 'Auto'), value: '' },
      { label: '1:1', value: '1:1' },
      { label: '3:4', value: '3:4' },
      { label: '4:3', value: '4:3' },
      { label: '2:3', value: '2:3' },
      { label: '3:2', value: '3:2' },
      { label: '4:5', value: '4:5' },
      { label: '5:4', value: '5:4' },
      { label: '9:16', value: '9:16' },
      { label: '16:9', value: '16:9' },
      { label: '21:9', value: '21:9' },
    ],
    [lt]
  );

  const updateAspectRatio = React.useCallback(
    (ratio: string) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { aspectRatio: ratio || undefined } },
        })
      );
    },
    [id]
  );

  // 预设提示�?
  const presetPromptValue = data.presetPrompt ?? '';
  const updatePresetPrompt = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { presetPrompt: value } },
        })
      );
    },
    [id]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 当节点数据更新时同步最新历史图�?id（历史写入在 FlowOverlay 中统一处理，避�?onlyRenderVisibleElements 时丢失）
  React.useEffect(() => {
    if (status === 'succeeded' && data.lastHistoryId) {
      setCurrentImageId(data.lastHistoryId);
    }
  }, [data.lastHistoryId, status]);

  // 处理图片切换
  const handleImageChange = React.useCallback(
    (imageId: string) => {
      const selectedImage = allImages.find((item) => item.id === imageId);
      if (selectedImage) {
        setCurrentImageId(imageId);
      }
    },
    [allImages]
  );

  // ESC 关闭预览
  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  const commonInputStyle: React.CSSProperties = {
    width: '100%',
    fontSize: 12,
    padding: '4px 6px',
    borderRadius: 6,
    border: '1px solid #e5e7eb',
    outline: 'none',
    background: '#fff',
    color: '#111827',
  };

  const commonLabelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 2,
  };

  const renderAdvancedContent = () => {
    const resolvedSpeedMode =
      data.speedMode === 'draft' || data.speedMode === 'fast' || data.speedMode === 'turbo'
        ? data.speedMode
        : data.draft
          ? 'draft'
          : 'fast';
    const speedMode = (isNiji || isV8) && resolvedSpeedMode !== 'fast' ? 'fast' : resolvedSpeedMode;
    const qualityValue = isV8 && data.quality === '2' ? '1' : data.quality ?? '1';
    const chaosValue = String(data.chaos ?? '0');
    const stylizeValue = String(data.stylize ?? '100');
    const weirdValue = String(data.weird ?? '');
    const hasAdvancedOverrides =
      (!isNiji && qualityValue !== '1') ||
      chaosValue !== '0' ||
      stylizeValue !== '100' ||
      (!isV8 && weirdValue !== '') ||
      String(data.seed ?? '') !== '' ||
      Boolean(data.raw) ||
      (!isV8 && speedMode === 'turbo') ||
      (!isNiji && !isV8 && speedMode === 'draft') ||
      (!isNiji && !isV8 && Boolean(data.tile)) ||
      (!isNiji && String(data.noPrompt ?? '').trim() !== '') ||
      (isV8 && Boolean(data.hd)) ||
      (isV8 && String(data.imageWeight ?? '').trim() !== '') ||
      (isV8 && String(data.styleRefs ?? '').trim() !== '') ||
      (isV8 && String(data.styleWeight ?? '').trim() !== '') ||
      (isV8 && String(data.objectReference ?? '').trim() !== '') ||
      (isV8 && String(data.exp ?? '').trim() !== '') ||
      String(data.presetPrompt ?? '').trim() !== '';

    return (
      <>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={16} color={accentColor} />
            <span style={{ fontWeight: 600, color: accentColor }}>
              {title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setShowHelp((value) => !value)}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                background: showHelp ? accentColor : '#f3f4f6',
                color: showHelp ? '#fff' : '#6b7280',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title={lt('玩法说明', 'Help')}
            >
              <HelpCircle size={14} />
            </button>
            <button
              onClick={onRun}
              disabled={status === 'running'}
              className='run-btn-with-credit'
              title={
                status === 'running'
                  ? 'Running...'
                  : resolvedRunCredits
                    ? `${lt('Cost', 'Cost')}: ${resolvedRunCredits} ${lt('credits', 'credits')}`
                    : lt('Run generation', 'Run generation')
              }
              style={{
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                minHeight: 30,
                padding: '0 10px',
                background: status === 'running' ? '#e5e7eb' : accentColor,
                color: '#fff',
                borderRadius: 6,
                border: 'none',
                cursor: status === 'running' ? 'not-allowed' : 'pointer',
                gap: 6,
                ['--run-credit-hover-bg' as any]: accentColor,
                ['--run-credit-hover-border' as any]: accentBorder,
              }}
            >
              {status === 'running' ? (
                <span className='run-text-trigger'>Running...</span>
              ) : (
                <>
                  <span className='run-text-trigger'>Run</span>
                  <RunCreditBadge credits={resolvedRunCredits} runButton />
                </>
              )}
            </button>
            <button
              onClick={onSend}
              disabled={!(data.imageData || data.imageUrl)}
              title={!(data.imageData || data.imageUrl) ? lt('无可发送的图像', 'No image to send') : lt('发送到画布', 'Send to canvas')}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                background: !(data.imageData || data.imageUrl) ? '#e5e7eb' : accentColor,
                color: '#fff',
                borderRadius: 6,
                border: 'none',
                cursor: !(data.imageData || data.imageUrl) ? 'not-allowed' : 'pointer',
              }}
            >
              <SendIcon size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {showHelp && (
          <div
            style={{
              fontSize: 11,
              color: '#374151',
              background: accentSoft,
              padding: 8,
              borderRadius: 6,
              marginBottom: 8,
              border: `1px solid ${accentBorder}`,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: accentColor }}>
              {title} {lt('玩法说明', 'Usage')}
            </div>
            <div>{isNiji ? lt('适合动漫角色、分镜、游戏立绘和日系插画。', 'Best for anime, character art, and stylized illustrations.') : lt('适合商业视觉、产品图、电影感场景和概念设计。', 'Best for commercial visuals, product shots, and cinematic concepts.')}</div>
            <div>
              {isV8
                ? lt('支持文本生图，也支持连接最多 20 张垫图。', 'Supports text-to-image and up to 20 prompt images.')
                : lt('支持文本生图，也支持连接最多 10 张参考图。', 'Supports text-to-image and up to 10 reference images.')}
            </div>
            <div>{lt('连图后 prompt 可继续填写；只接图也能运行。', 'You can still add prompt after connecting images; image-only generation is also allowed.')}</div>
            <div>
              {isV8
                ? lt('V8 使用 v8.1 接入：支持 Raw、HD、SREF/OREF、IW、EXP；不支持 Draft、Turbo、Weird、Tile、CREF。', 'V8 uses v8.1: Raw, HD, SREF/OREF, IW, and EXP are supported; Draft, Turbo, Weird, Tile, and CREF are not.')
                : lt('V7 / Niji 7 不支持多提示词 ::。', 'V7 / Niji 7 do not support multi-prompt "::".')}
            </div>
            {!isV8 && (
              <div>
                {lt(
                  '万物参考请连「omni」柄（与参考图一并上传，勿在提示词里写 base64）；当前悠船接入不在提示词中传 sref/sv/sw/ow/exp/iw。',
                  'Use the omni handle for character-style refs (uploaded with images; do not put base64 in the prompt). This channel does not send sref/sv/sw/ow/exp/iw in the prompt text.'
                )}
              </div>
            )}
          </div>
        )}

        {imageInputCount > referenceImageLimit && (
          <div
            style={{
              fontSize: 11,
              color: '#b91c1c',
              background: '#fef2f2',
              padding: '6px 8px',
              borderRadius: 6,
              marginBottom: 8,
              border: '1px solid #fecaca',
            }}
          >
            {lt(
              `已连接 ${imageInputCount} 张参考图，最多支持 ${referenceImageLimit} 张，运行时只读取前 ${referenceImageLimit} 张。`,
              `Connected ${imageInputCount} references. Only the first ${referenceImageLimit} will be used.`
            )}
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <label style={commonLabelStyle}>{lt('预设提示词', 'Preset prompt')}</label>
          <input
            value={presetPromptValue}
            onChange={(e) => updatePresetPrompt(e.target.value)}
            placeholder={lt('可选，与左侧 Text 提示词拼接', 'Optional; prepended before the Text prompt')}
            style={commonInputStyle}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isNiji ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          {!isNiji && (
            <div>
              <label style={commonLabelStyle}>{lt('模型', 'Model')}</label>
              <select
                value={midjourneyModelVersion}
                onChange={(e) => {
                  const nextModelVersion = e.target.value === 'v8' ? 'v8' : 'v7';
                  updateData(
                    nextModelVersion === 'v8'
                      ? {
                          modelVersion: 'v8',
                          speedMode: 'fast',
                          draft: false,
                          tile: false,
                          weird: '',
                          quality: data.quality === '4' ? '4' : '1',
                        }
                      : { modelVersion: 'v7' }
                  );
                }}
                style={commonInputStyle}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              >
                <option value="v7">V7</option>
                <option value="v8">V8</option>
              </select>
            </div>
          )}
          <div>
            <label style={commonLabelStyle}>{lt('尺寸比例', 'Aspect ratio')}</label>
            <select
              value={aspectRatioValue}
              onChange={(e) => updateAspectRatio(e.target.value)}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            >
              {aspectOptions.map((opt) => (
                <option key={opt.value || 'auto'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={commonLabelStyle}>{lt('速度模式', 'Speed')}</label>
            <select
              value={speedMode}
              onChange={(e) => {
                const nextSpeedMode = e.target.value as 'draft' | 'fast' | 'turbo';
                updateData({
                  speedMode: nextSpeedMode,
                  // Keep legacy field in sync so old persisted flows behave consistently.
                  draft: !isNiji && !isV8 && nextSpeedMode === 'draft',
                });
              }}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            >
              {!isNiji && !isV8 && <option value="draft">{lt('草图模式', 'Draft')}</option>}
              <option value="fast">{lt('快速', 'Fast')}</option>
              {!isV8 && <option value="turbo">{lt('极速', 'Turbo')}</option>}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setShowAdvancedControls((value) => !value)}
            style={{
              width: '100%',
              border: `1px solid ${accentBorder}`,
              background: accentSoft,
              color: accentColor,
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              padding: '7px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          >
            <span>{lt('高级控制', 'Advanced controls')}</span>
            <span>
              {showAdvancedControls
                ? lt('收起', 'Hide')
                : lt('展开', 'Show')}
            </span>
          </button>
        </div>

        {showAdvancedControls && (
          <>
        <div style={{ display: 'grid', gridTemplateColumns: isNiji ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          {!isNiji && (
            <div>
              <label style={commonLabelStyle}>{lt('质量', 'Quality')}</label>
              <select
                value={qualityValue}
                onChange={(e) => updateData({ quality: e.target.value as '1' | '2' | '4' })}
                style={commonInputStyle}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              >
                <option value="1">1</option>
                {!isV8 && <option value="2">2</option>}
                <option value="4">4</option>
              </select>
            </div>
          )}
          <div>
            <label style={commonLabelStyle}>{lt('混乱度', 'Chaos')}</label>
            <input
              value={chaosValue}
              onChange={(e) => updateData({ chaos: e.target.value })}
              placeholder={lt('默认 0，填 0–100', 'Default 0; 0–100')}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
          <div>
            <label style={commonLabelStyle}>{lt('风格化', 'Stylize')}</label>
            <input
              value={stylizeValue}
              onChange={(e) => updateData({ stylize: e.target.value })}
              placeholder="0-1000"
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isV8 ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          {!isV8 && (
            <div>
              <label style={commonLabelStyle}>{lt('怪异度', 'Weird')}</label>
              <input
                value={weirdValue}
                onChange={(e) => updateData({ weird: e.target.value })}
                placeholder="0-3000"
                style={commonInputStyle}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
            </div>
          )}
          <div>
            <label style={commonLabelStyle}>{lt('随机种子', 'Seed')}</label>
            <input
              value={String(data.seed ?? '')}
              onChange={(e) => updateData({ seed: e.target.value })}
              placeholder="0-4294967295"
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(data.raw)}
              onChange={(e) => updateData({ raw: e.target.checked })}
              style={{ marginRight: 6 }}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
            <span>{lt('原始风格 Raw', 'Raw style')}</span>
          </label>
          {isV8 && (
            <label style={{ display: 'flex', alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(data.hd)}
                onChange={(e) => updateData({ hd: e.target.checked })}
                style={{ marginRight: 6 }}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
              <span>{lt('原生高清 HD', 'Native HD')}</span>
            </label>
          )}
          {!isNiji && !isV8 && (
            <label style={{ display: 'flex', alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(data.tile)}
                onChange={(e) => updateData({ tile: e.target.checked })}
                style={{ marginRight: 6 }}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
              <span>{lt('平铺纹理', 'Tile')}</span>
            </label>
          )}
        </div>

        {!isNiji && (
          <div style={{ marginBottom: 8 }}>
            <label style={commonLabelStyle}>{lt('否定提示词', 'No prompt')}</label>
            <input
              value={data.noPrompt ?? ''}
              onChange={(e) => updateData({ noPrompt: e.target.value })}
              placeholder={lt('例如：text, watermark, blurry', 'For example: text, watermark, blurry')}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
        )}

        {isV8 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={commonLabelStyle}>{lt('图像权重', 'Image weight')}</label>
                <input
                  value={String(data.imageWeight ?? '')}
                  onChange={(e) => updateData({ imageWeight: e.target.value })}
                  placeholder="0-3"
                  style={commonInputStyle}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                />
              </div>
              <div>
                <label style={commonLabelStyle}>{lt('实验参数', 'EXP')}</label>
                <input
                  value={String(data.exp ?? '')}
                  onChange={(e) => updateData({ exp: e.target.value })}
                  placeholder="0-100"
                  style={commonInputStyle}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                />
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={commonLabelStyle}>{lt('风格参考 URL', 'Style reference URLs')}</label>
              <input
                value={data.styleRefs ?? ''}
                onChange={(e) => updateData({ styleRefs: e.target.value })}
                placeholder={lt('最多 20 个，逗号或换行分隔', 'Up to 20, separated by commas or new lines')}
                style={commonInputStyle}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={commonLabelStyle}>{lt('风格权重', 'Style weight')}</label>
                <input
                  value={String(data.styleWeight ?? '')}
                  onChange={(e) => updateData({ styleWeight: e.target.value })}
                  placeholder="0-1000"
                  style={commonInputStyle}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                />
              </div>
              <div>
                <label style={commonLabelStyle}>{lt('风格版本', 'Style version')}</label>
                <select
                  value="6"
                  onChange={() => updateData({ styleVersion: '6' })}
                  disabled
                  style={commonInputStyle}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                >
                  <option value="6">6</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={commonLabelStyle}>{lt('物体参考 URL', 'Object reference URL')}</label>
              <input
                value={data.objectReference ?? data.omniReference ?? ''}
                onChange={(e) => updateData({ objectReference: e.target.value })}
                placeholder={lt('仅支持 1 张，用于 --oref', 'Only 1 URL, sent as --oref')}
                style={commonInputStyle}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
            </div>
          </>
        )}

        {/* V7/Niji7 多图矩阵显示 */}
          </>
        )}

        {data.imageUrls && data.imageUrls.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 4,
              marginBottom: 8,
            }}
          >
            {data.imageUrls.slice(0, 4).map((url, idx) => (
              <div
                key={idx}
                onDoubleClick={() => {
                  setCurrentImageId(`mj-${idx}`);
                  setPreview(true);
                }}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 6,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  position: 'relative',
                  ...flowImagePreviewWell(isDarkTheme, {
                    background: accentSoft,
                    border: `1px solid ${accentBorder}`,
                  }),
                }}
                title={lt('双击预览', 'Double click to preview')}
              >
                <SmartImage
                  src={buildImageSrc(url)}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: flowLetterboxBackground(isDarkTheme),
                  }}
                />
                {/* 图片序号标签 */}
                <div
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 4,
                    fontSize: 10,
                    color: '#6b7280',
                    background: 'rgba(255,255,255,0.85)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontWeight: 500,
                  }}
                >
                  {idx + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            onDoubleClick={() => fullSrc && setPreview(true)}
            style={{
              width: '100%',
              height: 180,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              ...flowImagePreviewWell(isDarkTheme, {
                background: accentSoft,
                border: `1px solid ${accentBorder}`,
              }),
            }}
            title={displaySrc ? lt('双击预览', 'Double click to preview') : undefined}
          >
            {displaySrc ? (
              <SmartImage
                src={displaySrc}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: flowLetterboxBackground(isDarkTheme),
                }}
              />
            ) : (
              <div style={{ textAlign: 'center' }}>
                <Sparkles size={24} color={isNiji ? '#f9a8d4' : '#c4b5fd'} />
                <div style={{ fontSize: 12, color: accentColor, marginTop: 4 }}>
                  {lt('等待生成', 'Waiting for generation')}
                </div>
              </div>
            )}
          </div>
        )}

        <GenerationProgressBar
          status={status}
          simulateDurationMs={60 * 1000}
          startedAt={data.progressStartedAt}
          runKey={id}
        />

        {status === 'failed' && error && (
          <div
            style={{
              fontSize: 11,
              color: '#ef4444',
              marginTop: 4,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error}
          </div>
        )}
      </>
    );
  };

  return (
    <div
      style={{
        width: 300,
        padding: 10,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
      }}
    >
      {renderAdvancedContent()}

      {/* 连接桩 - V7/Niji7 */}
      <>
          <Handle
            type="target"
            position={Position.Left}
            id="text"
            style={{ top: '34%' }}
            onMouseEnter={() => setHover('prompt-in')}
            onMouseLeave={() => setHover(null)}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="img"
            style={{ top: '58%' }}
            onMouseEnter={() => setHover('img-in')}
            onMouseLeave={() => setHover(null)}
          />
          {!isNiji && (
            <Handle
              type="target"
              position={Position.Left}
              id="omniImage"
              style={{ top: '78%' }}
              onMouseEnter={() => setHover('omni-image-in')}
              onMouseLeave={() => setHover(null)}
            />
          )}
          {advancedImageOutputHandleIds.map((handleId, idx) => (
            <Handle
              key={handleId}
              type="source"
              position={Position.Right}
              id={handleId}
              style={{ top: advancedImageOutputHandlePositions[idx] }}
              onMouseEnter={() => setHover(`${handleId}-out`)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          {/* 兼容旧工程：保留 img 输出句柄，避免历史连线失效 */}
          <Handle
            type="source"
            position={Position.Right}
            id="img"
            style={{ top: '50%', opacity: 0, pointerEvents: 'none' }}
          />
          {hover === 'prompt-in' && (
            <div
              className="flow-tooltip"
              style={{ left: -8, top: '34%', transform: 'translate(-100%, -50%)' }}
            >
              prompt
            </div>
          )}
          {hover === 'img-in' && (
            <div
              className="flow-tooltip"
              style={{ left: -8, top: '58%', transform: 'translate(-100%, -50%)' }}
            >
              image
            </div>
          )}
          {!isNiji && hover === 'omni-image-in' && (
            <div
              className="flow-tooltip"
              style={{ left: -8, top: '78%', transform: 'translate(-100%, -50%)' }}
            >
              {lt('万物参考图', 'Omni reference image')}
            </div>
          )}
          {advancedImageOutputHandleIds.map((handleId, idx) =>
            hover === `${handleId}-out` ? (
              <div
                key={`${handleId}-tooltip`}
                className="flow-tooltip"
                style={{
                  right: -8,
                  top: advancedImageOutputHandlePositions[idx],
                  transform: 'translate(100%, -50%)',
                }}
              >
                {`image#${idx + 1}`}
              </div>
            ) : null
          )}
      </>

      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src || fullSrc || ''
            : fullSrc || ''
        }
        imageTitle={lt("Midjourney 图片预览", "Midjourney image preview")}
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}

export default React.memo(MidjourneyNodeInner);
