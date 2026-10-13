import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Palette, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useCanvasBackgroundStore } from '@/stores/canvasBackgroundStore';
import {
  CANVAS_BACKGROUND_SWATCHES, CANVAS_DEFAULT_BACKGROUND,
  hexToHsv, hsvToHex, normalizeHexColor, type HsvColor,
} from '@/utils/canvasBackground';
import './canvasBackground.css';

export default function CanvasBackgroundPicker() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');
  const text = (zh: string, en: string) => isZh ? zh : en;
  const theme = useAIChatStore((state) => state.chatTheme);
  const scheme = theme === 'black' ? 'dark' : 'light';
  const custom = useCanvasBackgroundStore((state) => state.byScheme[scheme]);
  const setBackground = useCanvasBackgroundStore((state) => state.setBackground);
  const current = custom ?? CANVAS_DEFAULT_BACKGROUND[scheme];
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(current.slice(1));
  const [hsv, setHsv] = useState(() => hexToHsv(current));
  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const shell = shellRef.current;
    const popover = popoverRef.current;
    const surface = shell?.closest<HTMLElement>('.tanva-canvas-surface');
    if (!shell || !popover || !surface) return;
    const place = () => {
      const root = surface.getBoundingClientRect();
      const anchor = shell.getBoundingClientRect();
      const left = Math.max(0, root.left) + 8;
      const top = Math.max(0, root.top) + 8;
      const right = Math.min(window.innerWidth, root.right) - 8;
      const bottom = Math.min(window.innerHeight, root.bottom) - 8;
      const width = Math.min(236, Math.max(0, right - left));
      const maxHeight = Math.max(0, bottom - top);
      const height = Math.min(popover.scrollHeight, maxHeight);
      setPopoverStyle({ width, maxHeight,
        left: Math.max(left, Math.min(anchor.left, right - width)) - anchor.left,
        top: Math.max(top, Math.min(anchor.top - height - 10, bottom - height)) - anchor.top });
    };
    const observer = new ResizeObserver(place);
    observer.observe(surface);
    // The dock can move horizontally when a sidebar or short-screen toolbar changes.
    observer.observe(surface.querySelector('.tanva-canvas-view-controls') ?? shell);
    const mutations = new MutationObserver(place);
    mutations.observe(surface.querySelector('.tanva-canvas-view-controls') ?? shell, { attributes: true, attributeFilter: ['style'] });
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); mutations.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => {
    setHexDraft(current.slice(1));
    setHsv((previous) => {
      const next = hexToHsv(current);
      return next.s ? next : { ...next, h: previous.h };
    });
  }, [current]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !shellRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnBlur = () => setOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('blur', closeOnBlur);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('blur', closeOnBlur);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const commitHex = () => {
    const next = normalizeHexColor(hexDraft);
    if (next) setBackground(scheme, next);
    setHexDraft((next ?? current).slice(1));
  };
  const updateHsv = (next: HsvColor) => {
    setHsv(next);
    setBackground(scheme, hsvToHex(next));
  };
  const updateSaturation = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    updateHsv({
      ...hsv,
      s: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      v: 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    });
  };
  const title = text('画布背景色', 'Canvas background');
  return (
    <div ref={shellRef} className="tanva-canvas-background-shell" data-canvas-control="true" data-scheme={scheme}>
      <button ref={triggerRef} type="button" className="tanva-canvas-background-trigger"
        aria-label={title} title={title} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}>
        <Palette size={17} />
        <span className="tanva-canvas-background-indicator" style={{ background: current }} aria-hidden="true" />
      </button>
      {open && (
        <div ref={popoverRef} style={popoverStyle} className="tanva-canvas-background-popover nodrag nopan" role="dialog" aria-label={title}
          data-canvas-background-popover="true"
          onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }} onKeyUp={(event) => event.stopPropagation()}>
          <div className="tanva-canvas-background-heading">
            <span>{title}</span>
            <button type="button" className="tanva-canvas-background-icon" aria-label={text('关闭', 'Close')}
              onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={15} /></button>
          </div>
          <div className="tanva-canvas-background-spectrum" role="slider" tabIndex={0}
            aria-label={text('饱和度和明度', 'Saturation and brightness')} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
            style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateSaturation(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturation(event); }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              updateHsv({ ...hsv,
                s: Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowRight' ? 0.01 : event.key === 'ArrowLeft' ? -0.01 : 0))),
                v: Math.max(0, Math.min(1, hsv.v + (event.key === 'ArrowUp' ? 0.01 : event.key === 'ArrowDown' ? -0.01 : 0))),
              });
            }}>
            <span className="tanva-canvas-background-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <input className="tanva-canvas-background-hue" type="range" min={0} max={359} step={1}
            aria-label={text('色相', 'Hue')} value={Math.round(hsv.h)}
            onChange={(event) => updateHsv({ ...hsv, h: Number(event.currentTarget.value) })} />
          <div className="tanva-canvas-background-swatches">
            {CANVAS_BACKGROUND_SWATCHES[scheme].map((color) => (
              <button key={color} type="button" className="tanva-canvas-background-swatch"
                style={{ background: color }} aria-label={`${text('背景色', 'Background')} ${color}`}
                aria-pressed={custom === color} onClick={() => setBackground(scheme, color)} />
            ))}
          </div>
          <div className="tanva-canvas-background-fields">
            <label className="tanva-canvas-background-hex"><span>#</span>
              <Input ref={inputRef} className="tanva-canvas-background-input" value={hexDraft}
                aria-label={text('背景色 HEX', 'Background HEX')} maxLength={7} spellCheck={false}
                onChange={(event) => setHexDraft(event.currentTarget.value.replace(/^#/, ''))}
                onBlur={commitHex} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitHex(); } }} />
            </label>
            <button type="button" className="tanva-canvas-background-icon" aria-label={text('恢复主题默认', 'Reset theme default')}
              title={text('恢复主题默认', 'Reset theme default')} onClick={() => setBackground(scheme, null)}><RotateCcw size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
