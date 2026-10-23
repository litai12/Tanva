/** 图片全屏预览：复用 TapCanvasPro 的缩放舞台和浮动工具栏。 */
import React, { useContext, useEffect, useCallback, useState, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { TransformWrapper, TransformComponent, useControls, useTransformEffect } from 'react-zoom-pan-pinch';
import { X, Download, ZoomIn, ZoomOut, RotateCcw, RotateCw, Info, RefreshCw, Loader2 } from 'lucide-react';
import SmartImage from './SmartImage';
import { downloadFile, getSuggestedFileName } from '@/utils/downloadHelper';
import { useTranslation } from 'react-i18next';
import './ImagePreviewModal.css';
import { ImagePreviewGalleryContext, type ImagePreviewCrop, type PreviewGalleryImage } from './ImagePreviewGalleryContext';
import { useImagePreviewResource } from '@/hooks/useImagePreviewResource';

export type ImageItem = PreviewGalleryImage;

interface ImagePreviewModalProps {
  isOpen: boolean;
  imageSrc: string;
  imageTitle?: string;
  onClose: () => void;
  imageCollection?: ImageItem[];
  currentImageId?: string;
  onImageChange?: (imageId: string) => void;
  collectionTitle?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
  /** Explicit result/history collections opt out of a canvas host's neighbors. */
  collectionScope?: 'canvas' | 'explicit';
  imageCrop?: ImagePreviewCrop;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
// Smooth wheel zoom multiplies this by deltaY; keep a 100px tick to 0.1x.
const WHEEL_ZOOM_STEP = 0.001;
const BUTTON_ZOOM_STEP = 0.18;
const CLICK_MOVE_TOLERANCE = 5;
const stopEvent = (event: React.SyntheticEvent) => event.stopPropagation();

function PreviewAction({ label, children, active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" className={`image-preview__action${active ? ' image-preview__action--active' : ''}`} title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}

function ImageStage({ src, crop, title, isZh, onClose }: { src: string; crop?: ImagePreviewCrop; title: string; isZh: boolean; onClose: () => void }) {
  const { src: previewSrc, error: resourceError } = useImagePreviewResource(src, crop);
  const { zoomIn, zoomOut, resetTransform, setTransform, centerView, instance } = useControls();
  const imageRef = useRef<HTMLImageElement>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fitRatio, setFitRatio] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const lt = (zh: string, en: string) => isZh ? zh : en;
  const quarterTurned = Math.abs(rotation / 90) % 2 === 1;

  useTransformEffect(({ state }) => { setScale(state.scale); });

  const measure = useCallback(() => {
    const image = imageRef.current;
    if (!image?.naturalWidth) return;
    setFitRatio(image.clientWidth / image.naturalWidth);
    setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
  }, []);
  useLayoutEffect(() => { measure(); }, [measure, loadState, quarterTurned]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const zoomTo = useCallback((nextScale: number) => {
    const wrapper = instance.wrapperComponent;
    const current = instance.state;
    if (!wrapper || nextScale <= 1) {
      centerView(nextScale, 0);
      return;
    }
    const cx = wrapper.offsetWidth / 2;
    const cy = wrapper.offsetHeight / 2;
    const ratio = nextScale / current.scale;
    setTransform(cx - (cx - current.positionX) * ratio, cy - (cy - current.positionY) * ratio, nextScale, 0);
  }, [centerView, instance, setTransform]);

  const resetView = useCallback(() => {
    setRotation(0);
    resetTransform();
  }, [resetTransform]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === '+' || event.key === '=') zoomIn(BUTTON_ZOOM_STEP);
      else if (event.key === '-' || event.key === '_') zoomOut(BUTTON_ZOOM_STEP);
      else if (event.key === '0') resetView();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zoomIn, zoomOut, resetView]);

  const download = async () => {
    if (downloading || !previewSrc || loadState !== 'loaded' || resourceError) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadFile(imageRef.current?.currentSrc || previewSrc, getSuggestedFileName(title, 'tanva-image'));
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : lt('下载失败', 'Download failed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div
        className="image-preview__stage"
        onPointerDown={(event) => { pointerDownRef.current = { x: event.clientX, y: event.clientY }; }}
        onClick={(event) => {
          const down = pointerDownRef.current;
          if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_MOVE_TOLERANCE) return;
          if (event.target instanceof HTMLElement && event.target.closest('img')) return;
          onClose();
        }}
        onDoubleClick={() => setRotation(0)}
      >
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          <SmartImage
            ref={imageRef}
            src={previewSrc}
            alt={title}
            disableLowDetailFallback
            loading="eager"
            draggable={false}
            className="image-preview__image"
            style={{
              maxWidth: quarterTurned ? 'var(--image-preview-avail-h)' : 'var(--image-preview-avail-w)',
              maxHeight: quarterTurned ? 'var(--image-preview-avail-w)' : 'var(--image-preview-avail-h)',
              transform: `rotate(${rotation}deg)`,
              opacity: loadState === 'loaded' ? 1 : 0,
            }}
            onLoad={() => setLoadState('loaded')}
            onError={() => setLoadState('error')}
          />
        </TransformComponent>
        {loadState !== 'loaded' && (
          <div className="image-preview__loader" role="status">
            {loadState === 'loading' && !resourceError ? <><Loader2 className="image-preview__spinner" size={20} /><span>{lt('加载中…', 'Loading…')}</span></> : lt('图片加载失败', 'Image failed to load')}
          </div>
        )}
      </div>
      <div className="image-preview__top-left image-preview__pill" onClick={stopEvent} onWheel={stopEvent}>
        <PreviewAction label={lt('图片信息', 'Image info')} active={showInfo} aria-pressed={showInfo} onClick={() => setShowInfo((value) => !value)}><Info size={18} /></PreviewAction>
        <span className="image-preview__divider" />
        <PreviewAction label={lt('重置视图 (0)', 'Reset view (0)')} onClick={resetView}><RefreshCw size={18} /></PreviewAction>
        <PreviewAction label={lt('下载', 'Download')} disabled={downloading || !previewSrc || loadState !== 'loaded' || resourceError} onClick={() => { void download(); }}>{downloading ? <Loader2 size={18} className="image-preview__spinner" /> : <Download size={18} />}</PreviewAction>
      </div>
      {showInfo && <div className="image-preview__info" onClick={stopEvent}><div className="image-preview__info-title">{title}</div>{naturalSize && <div>{naturalSize.width} × {naturalSize.height}</div>}</div>}
      {downloadError && <div className="image-preview__error" role="alert">{downloadError}</div>}
      <div className="image-preview__top-center image-preview__pill" onClick={stopEvent} onWheel={stopEvent}>
        <PreviewAction label={lt('放大 (+)', 'Zoom in (+)')} onClick={() => zoomIn(BUTTON_ZOOM_STEP)}><ZoomIn size={18} /></PreviewAction>
        <PreviewAction label={lt('缩小 (-)', 'Zoom out (-)')} onClick={() => zoomOut(BUTTON_ZOOM_STEP)}><ZoomOut size={18} /></PreviewAction>
        <span className="image-preview__divider" />
        <span className="image-preview__pct">{Math.round(scale * fitRatio * 100)}%</span>
        <input type="range" className="image-preview__slider" min={Math.log(MIN_SCALE)} max={Math.log(MAX_SCALE)} step="any" value={Math.log(scale)} onChange={(event) => zoomTo(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.exp(Number(event.target.value)))))} aria-label={lt('缩放', 'Zoom')} aria-valuetext={`${Math.round(scale * fitRatio * 100)}%`} />
        <span className="image-preview__divider" />
        <PreviewAction label={lt('顺时针旋转', 'Rotate clockwise')} onClick={() => setRotation((value) => value + 90)}><RotateCw size={18} /></PreviewAction>
        <PreviewAction label={lt('逆时针旋转', 'Rotate counterclockwise')} onClick={() => setRotation((value) => value - 90)}><RotateCcw size={18} /></PreviewAction>
      </div>
    </>
  );
}

function PreviewThumbnail({ item }: { item: ImageItem }) {
  const { src } = useImagePreviewResource(item.src, item.crop);
  return <SmartImage src={src} alt={item.title || ''} className="image-preview__thumb-image" disableLowDetailFallback loading="lazy" />;
}

const ImagePreviewModalView: React.FC<ImagePreviewModalProps> = ({ isOpen, imageSrc, imageCrop, imageTitle, onClose, imageCollection = [], currentImageId, onImageChange, collectionTitle, onLoadMore, hasMore = false, isLoading = false }) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = (zh: string, en: string) => isZh ? zh : en;
  const resolvedImageTitle = imageTitle || lt('图片预览', 'Image Preview');
  const sortedCollection = useMemo(() => imageCollection
    .filter((item): item is ImageItem => Boolean(item?.id && item?.src))
    .map((item, index) => ({ ...item, _originalIndex: index }))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || a._originalIndex - b._originalIndex)
    .map(({ _originalIndex, ...item }) => item), [imageCollection]);
  const thumbnailListRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);
  const loadMoreGuardRef = useRef(false);
  const hasCollection = sortedCollection.length > 0;
  const showOrderBadges = sortedCollection.some((item) => typeof item.timestamp === 'number');
  const currentIndex = sortedCollection.findIndex((item) => item.id === currentImageId);

  const navigateImage = useCallback((direction: number) => {
    if (!onImageChange || currentIndex < 0 || !sortedCollection.length) return;
    onImageChange(sortedCollection[(currentIndex + direction + sortedCollection.length) % sortedCollection.length].id);
  }, [onImageChange, currentIndex, sortedCollection]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      navigateImage(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose, navigateImage]);

  useEffect(() => {
    const modal = modalRef.current;
    if (!isOpen || !modal) return;
    // Retain propagation to the zoom engine, but prevent native scroll/page zoom.
    const preventNativeWheel = (event: WheelEvent) => event.preventDefault();
    modal.addEventListener('wheel', preventNativeWheel, { capture: true, passive: false });
    return () => modal.removeEventListener('wheel', preventNativeWheel, true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    activeThumbnailRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [isOpen, currentImageId]);
  useEffect(() => { if (!isLoading) loadMoreGuardRef.current = false; }, [isLoading]);
  useEffect(() => { if (!isOpen) loadMoreGuardRef.current = false; }, [isOpen]);

  const loadMore = () => {
    if (!onLoadMore || !hasMore || isLoading || loadMoreGuardRef.current) return;
    loadMoreGuardRef.current = true;
    onLoadMore();
  };
  const handleThumbnailScroll = () => {
    const list = thumbnailListRef.current;
    if (list && list.scrollWidth - list.scrollLeft - list.clientWidth <= 120) loadMore();
  };

  if (!isOpen) return null;
  return createPortal(
    <div ref={modalRef} className={`image-preview-modal${hasCollection ? ' image-preview-modal--with-gallery' : ''}`} data-image-preview-modal="true" role="dialog" aria-modal="true" aria-label={resolvedImageTitle} onContextMenuCapture={stopEvent} onPointerDown={stopEvent} onPointerMove={stopEvent} onPointerUp={stopEvent} onClick={stopEvent} onDoubleClick={stopEvent} onWheel={stopEvent} onTouchStart={stopEvent} onTouchMove={stopEvent} onTouchEnd={stopEvent}>
      <TransformWrapper key={`${currentImageId || ''}:${imageSrc}`} minScale={MIN_SCALE} maxScale={MAX_SCALE} initialScale={1} centerOnInit wheel={{ step: WHEEL_ZOOM_STEP }} doubleClick={{ mode: 'reset' }} panning={{ velocityDisabled: true }}>
        <ImageStage src={imageSrc} crop={imageCrop} title={resolvedImageTitle} isZh={isZh} onClose={onClose} />
      </TransformWrapper>
      <div className="image-preview__top-right" onClick={stopEvent}>
        <div className="image-preview__pill"><PreviewAction label={lt('关闭 (Esc)', 'Close (Esc)')} onClick={onClose}><X size={18} /></PreviewAction></div>
        <span className="image-preview__kbd">Esc</span>
      </div>
      {hasCollection && (
        <div className="image-preview__bottom" onClick={stopEvent}>
          <div className="image-preview__hints">
            <span className="image-preview__pill image-preview__hint">{collectionTitle || lt('历史记录', 'History')}{currentIndex >= 0 ? ` ${currentIndex + 1} / ${sortedCollection.length}` : ` ${sortedCollection.length}`}</span>
            {onImageChange && sortedCollection.length > 1 && <span className="image-preview__pill image-preview__hint"><span className="image-preview__kbd">←</span><span className="image-preview__kbd">→</span>{lt('切换', 'Switch')}</span>}
          </div>
          <div className="image-preview__strip" ref={thumbnailListRef} onScroll={handleThumbnailScroll} onWheel={(event) => { event.stopPropagation(); event.currentTarget.scrollLeft += event.deltaX + event.deltaY; }}>
            {sortedCollection.map((item, index) => {
              const active = item.id === currentImageId;
              const isPngFileName = item.title?.toLowerCase().endsWith('.png') ?? false;
              const generatedAt = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
              return (
                <button key={item.id} ref={active ? activeThumbnailRef : undefined} type="button" className={`image-preview__thumb${active ? ' image-preview__thumb--active' : ''}`} aria-current={active} aria-label={item.title || lt(`图片 ${index + 1}`, `Image ${index + 1}`)} title={[item.title, generatedAt].filter(Boolean).join(' · ')} onClick={() => onImageChange?.(item.id)}>
                  {showOrderBadges && !isPngFileName && <span className="image-preview__badge">{sortedCollection.length - index}</span>}
                  {isPngFileName && active && <span className="image-preview__badge image-preview__badge--current">Current</span>}
                  <PreviewThumbnail item={item} />
                </button>
              );
            })}
            {onLoadMore && hasMore && <button type="button" className="image-preview__more" onClick={loadMore} disabled={isLoading}>{isLoading ? <Loader2 size={18} className="image-preview__spinner" /> : lt('加载更多', 'Load more')}</button>}
          </div>
        </div>
      )}
    </div>, document.body,
  );
};

function CanvasImagePreview({ props, gallery }: { props: ImagePreviewModalProps; gallery: NonNullable<React.ContextType<typeof ImagePreviewGalleryContext>> }) {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const [snapshot] = useState(() => {
    const candidates = gallery.getImages();
    const current = candidates.find((item) => item.id === gallery.currentImageId);
    // Previewing an input/reference override still uses its current rendered src.
    if (current) {
      if (props.imageSrc) current.src = props.imageSrc;
      if (props.imageCrop) current.crop = props.imageCrop;
    } else if (props.imageSrc) {
      // Input previews (e.g. Analyze) already belong to an upstream candidate.
      const source = candidates.find((item) => item.src === props.imageSrc && JSON.stringify(item.crop) === JSON.stringify(props.imageCrop));
      if (source) return { images: candidates, initialId: source.id };
      candidates.push({ id: gallery.currentImageId, src: props.imageSrc, title: props.imageTitle, crop: props.imageCrop });
    }
    return { images: candidates, initialId: gallery.currentImageId };
  });
  const images = snapshot.images;
  const [selectedId, setSelectedId] = useState(snapshot.initialId);
  const selected = images.find((item) => item.id === selectedId);
  return <ImagePreviewModalView {...props} imageSrc={selected?.src || props.imageSrc} imageCrop={selected?.crop} imageTitle={selected?.title || props.imageTitle} imageCollection={images} currentImageId={selectedId} onImageChange={setSelectedId} collectionTitle={isZh ? '画布图片' : 'Canvas images'} onLoadMore={undefined} hasMore={false} isLoading={false} />;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = (props) => {
  const gallery = useContext(ImagePreviewGalleryContext);
  if (!props.isOpen) return null;
  // This child unmounts on close, discarding navigation and the old project snapshot.
  return gallery && props.collectionScope !== 'explicit'
    ? <CanvasImagePreview key={gallery.currentImageId} props={props} gallery={gallery} />
    : <ImagePreviewModalView {...props} />;
};

export default ImagePreviewModal;
