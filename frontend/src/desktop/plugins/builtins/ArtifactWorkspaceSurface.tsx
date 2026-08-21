import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, PanelRightOpen, Presentation, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requestDesktopSurface } from '../surfaceEvents';
import { TANVA_CANVAS_PLUGIN_ID } from '../pluginIds';
import { useDesktopArtifactStore } from '../../artifacts/artifactState';
import { downloadSpreadsheetWorkbook } from '../../artifacts/spreadsheetExport';
import type { DesktopPluginComponentProps } from '../types';
import type { HtmlPptDeck, HtmlPptSlide } from '@/utils/htmlPptDeck';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slideSrcDoc = (deck: HtmlPptDeck, slide: HtmlPptSlide): string => {
  const origin = typeof window !== 'undefined' ? `${window.location.origin}/` : '/';
  const design = deck.aspectRatio === '4:3'
    ? { width: 1440, height: 1080 }
    : { width: 1920, height: 1080 };
  const css = `
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111827; }
body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.slide-root { position: relative; width: ${design.width}px; height: ${design.height}px; overflow: hidden; box-sizing: border-box; }
.slide-root *, .slide-root *::before, .slide-root *::after { box-sizing: border-box; }
.slide-root img, .slide-root video { max-width: 100%; }
${deck.themeCss || ''}
${slide.css || ''}`.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; media-src https: http: blob:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><base href="${escapeHtml(origin)}"><style>${css}</style></head><body><main class="slide-root">${slide.html || ''}</main></body></html>`;
};

function PresentationSlidePreview({
  deck,
  slide,
  title,
  interactive = false,
}: {
  deck: HtmlPptDeck;
  slide: HtmlPptSlide;
  title: string;
  interactive?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const design = deck.aspectRatio === '4:3'
    ? { width: 1440, height: 1080 }
    : { width: 1920, height: 1080 };
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const scale = Math.max(0.01, Math.min(size.width / design.width, size.height / design.height));
  const srcDoc = useMemo(() => slideSrcDoc(deck, slide), [deck, slide]);
  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-slate-950">
      <iframe
        title={title}
        srcDoc={srcDoc}
        sandbox=""
        className="absolute left-1/2 top-1/2 border-0 bg-white shadow-sm"
        style={{
          width: design.width,
          height: design.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center',
          pointerEvents: interactive ? 'auto' : 'none',
        }}
      />
    </div>
  );
}

const iconForKind = (kind: string) => {
  if (kind === 'presentation') return Presentation;
  if (kind === 'spreadsheet') return FileSpreadsheet;
  return FileText;
};

const deckAspectClass = (aspectRatio: HtmlPptDeck['aspectRatio']) =>
  aspectRatio === '4:3' ? 'aspect-[4/3]' : 'aspect-video';

export default function ArtifactWorkspaceSurface(_props: DesktopPluginComponentProps) {
  const artifacts = useDesktopArtifactStore((state) => state.artifacts);
  const activeArtifactId = useDesktopArtifactStore((state) => state.activeArtifactId);
  const activate = useDesktopArtifactStore((state) => state.activate);
  const active = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0];
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
        完成 PPT、Excel 或文档任务后，文件会在这里打开。
      </div>
    );
  }

  const Icon = iconForKind(active.kind);
  const sheet = active.sheets?.[activeSheetIndex] ?? active.sheets?.[0];
  const presentationDeck = active.deck;
  const activeSlide = presentationDeck?.slides[activeSlideIndex] ?? presentationDeck?.slides[0];

  const exportPresentation = (format: 'html' | 'pptx') => {
    if (!active.nodeId) return;
    window.dispatchEvent(
      new CustomEvent('flow:html-ppt-export', {
        detail: { id: active.nodeId, format },
      })
    );
  };

  return (
    <div className="flex h-full min-w-0 bg-white">
      <aside className="w-48 flex-none overflow-y-auto border-r border-slate-200 bg-slate-50 p-2">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          文件
        </div>
        <div className="mt-1 space-y-1">
          {artifacts.map((artifact) => {
            const ItemIcon = iconForKind(artifact.kind);
            return (
              <button
                key={artifact.id}
                type="button"
                onClick={() => {
                  activate(artifact.id);
                  setActiveSheetIndex(0);
                  setActiveSlideIndex(0);
                }}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg p-2 text-left',
                  artifact.id === active.id
                    ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:bg-white/70'
                )}
              >
                <ItemIcon className="mt-0.5 h-4 w-4 flex-none" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{artifact.title}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-400">
                    {artifact.kind === 'presentation'
                      ? 'PPTX'
                      : artifact.kind === 'spreadsheet'
                        ? 'XLSX'
                        : '文档'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 flex-none items-center gap-3 border-b border-slate-200 px-4">
          <Icon className="h-4 w-4 text-slate-500" />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            {active.title}
          </div>
          {active.kind === 'spreadsheet' && active.sheets && (
            <button
              type="button"
              onClick={() => downloadSpreadsheetWorkbook(active.title, active.sheets || [])}
              className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              下载 XLSX
            </button>
          )}
          {active.kind === 'presentation' && active.nodeId && (
            <>
              {active.formats?.includes('html') && (
                <button type="button" onClick={() => exportPresentation('html')} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Download className="h-3.5 w-3.5" />HTML
                </button>
              )}
              {active.formats?.includes('pptx') && (
                <button type="button" onClick={() => exportPresentation('pptx')} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Download className="h-3.5 w-3.5" />PPTX
                </button>
              )}
            </>
          )}
          {active.nodeId && (
            <button
              type="button"
              onClick={() => {
                requestDesktopSurface({
                  pluginId: TANVA_CANVAS_PLUGIN_ID,
                  mode: 'maximized',
                  reason: 'artifact-edit-on-canvas',
                });
                window.setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent('flow:focus-node', { detail: { id: active.nodeId } })
                  );
                }, 120);
              }}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              title="在画布中编辑"
              aria-label="在画布中编辑"
            >
              <PanelRightOpen className="h-3.5 w-3.5" />
            </button>
          )}
        </header>

        {active.kind === 'presentation' && presentationDeck && activeSlide ? (
          <div className="flex min-h-0 flex-1 bg-slate-100">
            <aside className="w-36 flex-none overflow-y-auto border-r border-slate-200 bg-slate-50 p-2">
              <div className="space-y-2">
                {presentationDeck.slides.map((slide, index) => (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => setActiveSlideIndex(index)}
                    className={cn(
                      'w-full rounded-lg p-1 text-left transition-colors',
                      index === activeSlideIndex
                        ? 'bg-blue-50 ring-2 ring-blue-500'
                        : 'hover:bg-white'
                    )}
                    aria-label={`第 ${index + 1} 页 ${slide.title}`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span className="w-4 flex-none pt-0.5 text-right text-[10px] text-slate-400">{index + 1}</span>
                      <div className={cn('min-w-0 flex-1 overflow-hidden rounded bg-slate-900', deckAspectClass(presentationDeck.aspectRatio))}>
                        <PresentationSlidePreview deck={presentationDeck} slide={slide} title={`${active.title} 第 ${index + 1} 页缩略图`} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-6">
              <div className={cn('w-full max-w-5xl overflow-hidden rounded-lg bg-slate-950 shadow-xl', deckAspectClass(presentationDeck.aspectRatio))}>
                <PresentationSlidePreview deck={presentationDeck} slide={activeSlide} title={`${active.title} 第 ${activeSlideIndex + 1} 页`} interactive />
              </div>
            </div>
          </div>
        ) : active.kind === 'spreadsheet' && sheet ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 flex-none items-center gap-1 border-b border-slate-200 bg-slate-50 px-3">
              {active.sheets?.map((item, index) => (
                <button
                  key={`${item.name}-${index}`}
                  type="button"
                  onClick={() => setActiveSheetIndex(index)}
                  className={cn(
                    'h-7 rounded-md px-2.5 text-[11px]',
                    index === activeSheetIndex
                      ? 'bg-white font-medium text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  )}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full border-collapse text-xs">
                <tbody>
                  {sheet.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <th className="sticky left-0 w-10 border border-slate-200 bg-slate-50 px-2 py-1.5 text-right font-normal text-slate-400">
                        {rowIndex + 1}
                      </th>
                      {row.map((cell, columnIndex) => (
                        <td
                          key={columnIndex}
                          className={cn(
                            'min-w-32 border border-slate-200 px-2 py-1.5 align-top text-slate-700',
                            rowIndex === 0 && 'bg-blue-50 font-semibold text-slate-900'
                          )}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6">
            <div className="mx-auto min-h-[520px] max-w-4xl rounded-xl bg-white p-8 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Rows3 className="h-4 w-4 text-slate-400" />
                {active.summary || '文件已生成'}
              </div>
              <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {active.markdown ||
                  (active.kind === 'presentation'
                    ? '演示文稿已经生成。可在画布中进行逐页视觉编辑，并导出 PPTX。'
                    : '文档已经生成，可继续通过小T修改。')}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
