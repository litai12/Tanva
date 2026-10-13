import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/uiStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import FocusModeButton from './FocusModeButton';
import CanvasBackgroundPicker from './CanvasBackgroundPicker';
import './canvasBackground.css';

export default function CanvasViewControls({ embeddedDesktop = false }: { embeddedDesktop?: boolean }) {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');
  const showLayerPanel = useUIStore((state) => state.showLayerPanel);
  const theme = useAIChatStore((state) => state.chatTheme);
  const maximized = useAIChatStore((state) => state.isMaximized);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 0, compact: false });
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
      const height = shell.offsetHeight;
      let width = expanded ? (embeddedDesktop ? 78 : 114) : 42;
      let compact = false;
      let left = showLayerPanel ? 330 : 16;
      let top = Math.max(8, bounds.height - 120 - height);
      // A short screen can put the centered, variable-height toolbar at the eye's
      // original position. Move the entire row right of its actual footprint.
      for (const obstacle of [toolbar, zoom]) {
        if (!obstacle) continue;
        const rect = obstacle.getBoundingClientRect();
        if (top + bounds.top < rect.bottom + 8 && top + height + bounds.top > rect.top - 8 &&
            left + bounds.left < rect.right + 8 && left + width + bounds.left > rect.left - 8) {
          left = rect.right - bounds.left + 8;
        }
      }
      // A narrow desktop panel can still fit the two controls beside the toolbar
      // with smaller hit targets; keep the row horizontal rather than clipping it.
      const compactWidth = expanded ? (embeddedDesktop ? 62 : 90) : 34;
      if (left + width + 8 > bounds.width && left + compactWidth + 8 <= bounds.width) {
        compact = true;
        width = compactWidth;
      }
      left = Math.max(8, Math.min(left, bounds.width - width - 8));
      // If there is too little horizontal room beside the layer toolbar, prefer
      // the free space below/above it while staying outside the layer panel.
      for (const obstacle of [toolbar, zoom]) {
        if (!obstacle) continue;
        const rect = obstacle.getBoundingClientRect();
        if (left + bounds.left < rect.right + 8 && left + width + bounds.left > rect.left - 8 &&
            top + bounds.top < rect.bottom + 8 && top + height + bounds.top > rect.top - 8) {
          const below = rect.bottom - bounds.top + 8;
          const above = rect.top - bounds.top - height - 8;
          if (below + height <= bounds.height - 8) top = below;
          else if (above >= 8) top = above;
        }
      }
      top = Math.min(top, Math.max(8, bounds.height - height - 8));
      setPosition((previous) => previous.left === left && previous.top === top && previous.compact === compact ? previous : { left, top, compact });
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
  return (
    <div ref={shellRef} className="tanva-canvas-view-controls nodrag nopan" data-canvas-control="true"
      data-scheme={theme === 'black' ? 'dark' : 'light'} data-expanded={expanded} data-compact={position.compact} hidden={maximized}
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
        {expanded ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
      </button>
      {/* Keep the shortcut listener mounted while the controls are collapsed. */}
      {!embeddedDesktop && <FocusModeButton hidden={!expanded} />}
      {expanded && !maximized && <CanvasBackgroundPicker />}
    </div>
  );
}
