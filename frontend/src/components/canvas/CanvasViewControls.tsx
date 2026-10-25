import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import FocusModeButton from './FocusModeButton';
import AssetPreviewButton from './AssetPreviewButton';
import CanvasBackgroundPicker from './CanvasBackgroundPicker';
import './canvasBackground.css';

export default function CanvasViewControls({ embeddedDesktop = false }: { embeddedDesktop?: boolean }) {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');
  const showLayerPanel = useUIStore((state) => state.showLayerPanel);
  const theme = useAIChatStore((state) => state.chatTheme);
  const maximized = useAIChatStore((state) => state.isMaximized);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 17, top: 0, direction: 'right' });
  const shellRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const surface = shell?.closest<HTMLElement>('.tanva-canvas-surface');
    if (!shell || !surface) return;
    const toolbar = surface.querySelector<HTMLElement>('.tanva-toolbar-shell');
    const zoom = surface.querySelector<HTMLElement>('.tanva-zoom-shell');
    const place = () => {
      const bounds = surface.getBoundingClientRect();
      const height = 32;
      // Reserve the expanded width in both states so opening the row cannot move
      // the arrow away from the toolbar's actual centerline.
      const width = embeddedDesktop ? 68 : 104;
      const toolbarBounds = toolbar?.getBoundingClientRect();
      const center = toolbarBounds ? toolbarBounds.left + toolbarBounds.width / 2 - bounds.left : 33;
      const anchor = Math.max(0, Math.min(center - height / 2, bounds.width - height));
      const direction = anchor + width > bounds.width && anchor + height >= width ? 'left' : 'right';
      const rowLeft = direction === 'left' ? anchor + height - width : anchor;
      const left = direction === 'left' && expanded ? rowLeft : anchor;
      const obstacles = [toolbar, zoom].flatMap((element) => {
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        return rowLeft + bounds.left < rect.right && rowLeft + width + bounds.left > rect.left
          ? [{ top: Math.max(0, rect.top - bounds.top), bottom: Math.min(bounds.height, rect.bottom - bounds.top) }]
          : [];
      }).sort((a, b) => a.top - b.top);
      const spaces: { top: number; bottom: number }[] = [];
      let edge = 0;
      for (const obstacle of obstacles) {
        if (obstacle.top - edge >= height) spaces.push({ top: edge, bottom: obstacle.top });
        edge = Math.max(edge, obstacle.bottom);
      }
      if (bounds.height - edge >= height) spaces.push({ top: edge, bottom: bounds.height });
      const toolbarBottom = toolbarBounds ? toolbarBounds.bottom - bounds.top : 0;
      const toolbarTop = toolbarBounds ? toolbarBounds.top - bounds.top : bounds.height;
      // Prefer the gap below the toolbar; on short screens stay on its centerline
      // above it. Reduce the usual 8px clearance only when the available gap is tight.
      const space = spaces.find((candidate) => candidate.top >= toolbarBottom)
        ?? spaces.slice().reverse().find((candidate) => candidate.bottom <= toolbarTop)
        ?? spaces[0];
      const gap = space ? Math.min(8, (space.bottom - space.top - height) / 2) : 0;
      const preferredTop = bounds.height - 120 - height;
      const top = space
        ? Math.max(space.top + gap, Math.min(preferredTop, space.bottom - height - gap))
        : Math.max(0, Math.min(toolbarTop - height, bounds.height - height));
      setPosition((previous) => previous.left === left && previous.top === top && previous.direction === direction ? previous : { left, top, direction });
    };
    const observer = new ResizeObserver(place);
    [surface, shell, toolbar, zoom].forEach((element) => { if (element) observer.observe(element); });
    place();
    toolbar?.addEventListener('transitionend', place);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); toolbar?.removeEventListener('transitionend', place); window.removeEventListener('resize', place); };
  }, [expanded, showLayerPanel, embeddedDesktop, maximized]);

  const label = expanded
    ? (isZh ? '收起画布显示控件' : 'Collapse canvas view controls')
    : (isZh ? '展开画布显示控件' : 'Expand canvas view controls');
  const ArrowIcon = expanded !== (position.direction === 'left') ? ChevronLeft : ChevronRight;
  return (
    <div ref={shellRef} className="tanva-canvas-view-controls nodrag nopan" data-canvas-control="true"
      data-scheme={theme === 'black' ? 'dark' : 'light'} data-expanded={expanded} data-direction={position.direction} hidden={maximized}
      style={{ left: position.left, top: position.top }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !shellRef.current?.querySelector('[role="dialog"]')) {
          setExpanded(false);
          toggleRef.current?.focus();
        }
      }}>
      <button ref={toggleRef} type="button" className="tanva-canvas-background-icon tanva-canvas-view-toggle"
        aria-label={label} title={label} aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}>
        <ArrowIcon size={16} />
      </button>
      {/* Keep the shortcut listener mounted while the controls are collapsed. */}
      {!embeddedDesktop && <FocusModeButton hidden={!expanded} />}
      {expanded && !maximized && <AssetPreviewButton />}
      {expanded && !maximized && <CanvasBackgroundPicker />}
    </div>
  );
}
