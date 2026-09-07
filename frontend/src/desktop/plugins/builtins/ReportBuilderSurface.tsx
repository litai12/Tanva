import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FilePlus2, Loader2, Plus, Trash2, Upload, WandSparkles } from 'lucide-react';
import { ossUploadService } from '@/services/ossUploadService';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  buildReportGenerationPrompt,
  createDefaultReportBuilderState,
  createDefaultReportChapters,
  loadReportBuilderState,
  REPORT_ANIMATION_PRESETS,
  REPORT_ENTER_OPTIONS,
  REPORT_LAYOUT_OPTIONS,
  REPORT_MODEL_OPTIONS,
  REPORT_PALETTE_OPTIONS,
  REPORT_STYLE_PRESETS,
  REPORT_TEXT_LAYOUT_OPTIONS,
  REPORT_TRANSITION_OPTIONS,
  saveReportBuilderState,
  buildReportExportConfig,
  buildReportOutlineMarkdown,
  classifyReportAsset,
  type ReportBuilderState,
  type ReportChapter,
} from '../../reportBuilderState';
import type { DesktopPluginComponentProps } from '../types';

const projectTypes: ReportBuilderState['projectType'][] = ['建筑', '室内', '景观', '规划', '通用'];

export default function ReportBuilderSurface({ closeSurface }: DesktopPluginComponentProps) {
  const currentSessionId = useAIChatStore((store) => store.currentSessionId);
  const setXiaotModel = useAIChatStore((store) => store.setXiaotModel);
  const [state, setState] = useState<ReportBuilderState>(() => loadReportBuilderState(currentSessionId));
  const [uploading, setUploading] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [previewAnimation, setPreviewAnimation] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const processUserInput = useAIChatStore((store) => store.processUserInput);
  const currentProjectId = useProjectStore((store) => store.currentProjectId);

  useEffect(() => {
    saveReportBuilderState(state, currentSessionId);
  }, [currentSessionId, state]);

  useEffect(() => {
    if (!generating) {
      setGenerationProgress(0);
      return undefined;
    }
    setGenerationProgress(12);
    const timer = window.setInterval(() => {
      setGenerationProgress((value) => Math.min(92, value + (value < 45 ? 9 : value < 75 ? 5 : 2)));
    }, 650);
    return () => window.clearInterval(timer);
  }, [generating]);

  const patch = (next: Partial<ReportBuilderState>) => setState((current) => ({ ...current, ...next }));
  const changeProjectType = (projectType: ReportBuilderState['projectType']) => {
    setState((current) => ({
      ...current,
      projectType,
      chapters: createDefaultReportChapters(projectType),
      // Chapter ids are template-scoped. Clear stale assignments when the
      // template changes so a file never silently lands in a different
      // semantic chapter; the user can reassign it from the asset card.
      assets: current.assets.map((asset) => ({ ...asset, chapterId: undefined })),
    }));
  };
  const enabledChapters = useMemo(() => state.chapters.filter((chapter) => chapter.enabled), [state.chapters]);

  const updateChapter = (id: string, next: Partial<ReportChapter>) => {
    patch({ chapters: state.chapters.map((chapter) => chapter.id === id ? { ...chapter, ...next } : chapter) });
  };

  const addChapter = () => patch({
    chapters: [...state.chapters, { id: `chapter-${Date.now()}`, name: '自定义章节', hint: '', enabled: true }],
  });

  const removeChapter = (id: string) => {
    if (state.chapters.length <= 1) return;
    patch({ chapters: state.chapters.filter((chapter) => chapter.id !== id) });
  };

  const moveChapter = (id: string, direction: -1 | 1) => {
    setState((current) => {
      const index = current.chapters.findIndex((chapter) => chapter.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.chapters.length) return current;
      const chapters = [...current.chapters];
      [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
      return { ...current, chapters };
    });
  };

  const clearAssets = () => {
    if (state.assets.length === 0) return;
    setState((current) => ({ ...current, assets: [] }));
    setNotice(null);
  };

  const inspectFile = async (file: File): Promise<Pick<ReportBuilderState['assets'][number], 'width' | 'height' | 'durationSeconds' | 'orientation'>> => {
    if (file.type.startsWith('image/')) {
      try {
        const bitmap = await createImageBitmap(file);
        const width = bitmap.width;
        const height = bitmap.height;
        bitmap.close();
        return { width, height, orientation: width === height ? 'square' : width > height ? 'landscape' : 'portrait' };
      } catch {
        return { orientation: 'unknown' };
      }
    }
    if (file.type.startsWith('video/')) {
      try {
        const objectUrl = URL.createObjectURL(file);
        const metadata = await new Promise<Pick<ReportBuilderState['assets'][number], 'width' | 'height' | 'durationSeconds' | 'orientation'>>((resolve) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            const width = video.videoWidth || undefined;
            const height = video.videoHeight || undefined;
            resolve({ width, height, durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : undefined, orientation: width && height ? (width === height ? 'square' : width > height ? 'landscape' : 'portrait') : 'unknown' });
          };
          video.onerror = () => resolve({ orientation: 'unknown' });
          video.src = objectUrl;
        });
        URL.revokeObjectURL(objectUrl);
        return metadata;
      } catch {
        return { orientation: 'unknown' };
      }
    }
    return { orientation: 'unknown' };
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setNotice(null);
    setUploading(files.length);
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type ? 'document' : 'other';
      const classification = classifyReportAsset(file.name, kind);
      const id = `report-asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const inspection = await inspectFile(file);
      const aspectRatio = inspection.width && inspection.height ? Math.round((inspection.width / inspection.height) * 1000) / 1000 : undefined;
      // Leave the chapter empty so the report agent can classify the asset from
      // its pixels/content. A user can still pin it to a chapter explicitly.
      setState((current) => ({ ...current, assets: [...current.assets, { id, name: file.name, kind, ...classification, remoteUrl: '', size: file.size, aspectRatio, ...inspection, status: 'uploading' }] }));
      try {
        const result = await ossUploadService.uploadToOSS(file, {
          dir: 'ai-reports/',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          projectId: currentProjectId,
        });
        setState((current) => ({
          ...current,
          assets: current.assets.map((asset) => asset.id === id ? { ...asset, remoteUrl: result.url || '', status: result.success && result.url ? 'ready' : 'error' } : asset),
        }));
        if (!result.success) setNotice(`${file.name} 上传失败：${result.error || '请重试'}`);
      } catch (error) {
        setState((current) => ({ ...current, assets: current.assets.map((asset) => asset.id === id ? { ...asset, status: 'error' } : asset) }));
        setNotice(`${file.name} 上传失败：${error instanceof Error ? error.message : '请重试'}`);
      } finally {
        setUploading((count) => Math.max(0, count - 1));
      }
    }
  };

  const generate = async () => {
    if (generating || uploading > 0 || enabledChapters.length === 0) return;
    setGenerating(true);
    setNotice(null);
    const saved = saveReportBuilderState(state, currentSessionId);
    try {
      // The report builder model picker is authoritative for this run; the
      // normal chat preference is restored when the next chat setting changes.
      setXiaotModel(saved.reportModel);
      await processUserInput(buildReportGenerationPrompt(saved));
      closeSurface();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提交生成任务失败');
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => setState(createDefaultReportBuilderState());

  const openSampleReport = async () => {
    const sampleUrl = 'https://download-installer.jianzhuxuezhang.com/jzxz/WorkReport.html';
    setShowSample(true);
    // Keep an explicit browser fallback for installations whose WebView blocks
    // remote frames; the default path mirrors the reference overlay preview.
    if (!window.location.protocol.startsWith('http') && !window.location.protocol.startsWith('file')) {
      if (window.tanvaDesktop?.openTarget) await window.tanvaDesktop.openTarget(sampleUrl, 'url');
    }
  };

  const toggleValue = (field: 'customTransitions' | 'customEnters', value: string) => {
    setState((current) => {
      const values = current[field];
      const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value].slice(-6);
      return { ...current, [field]: next.length > 0 ? next : values };
    });
  };

  const downloadText = (fileName: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportConfig = () => {
    const saved = saveReportBuilderState(state, currentSessionId);
    downloadText(
      `${(saved.coverTitle || `${saved.projectType}设计汇报`).replace(/[\\/:*?"<>|]/g, '-').slice(0, 70)}-配置.json`,
      JSON.stringify(buildReportExportConfig(saved), null, 2),
      'application/json;charset=utf-8',
    );
  };

  const exportOutline = () => {
    const saved = saveReportBuilderState(state, currentSessionId);
    downloadText(
      `${(saved.coverTitle || `${saved.projectType}设计汇报`).replace(/[\\/:*?"<>|]/g, '-').slice(0, 70)}-大纲.md`,
      buildReportOutlineMarkdown(saved),
      'text/markdown;charset=utf-8',
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f7f8f7] p-5 text-slate-800">
      <div className="mx-auto max-w-3xl space-y-5 pb-12">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">REPORT BUILDER / SIMPLE MODE</div>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">作品汇报网页制作</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">按步骤配置素材、结构和样式后，提交给小T生成可编辑汇报网页或 PPT。</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5"><button type="button" onClick={() => setShowTutorial((visible) => !visible)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-950">{showTutorial ? '收起教程' : '使用教程'}</button><button type="button" onClick={() => void openSampleReport()} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-950">查看示例</button><button type="button" onClick={reset} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-900">重置配置</button></div>
        </div>

        {showTutorial && <section className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-slate-100 shadow-sm"><div className="text-xs font-semibold">三步完成作品汇报</div><ol className="mt-2 grid gap-1.5 text-[11px] leading-5 text-slate-300 sm:grid-cols-3"><li><strong className="text-white">1. 上传素材</strong><br />导入图片、图纸、文档和视频，等待状态变为“已上传”。</li><li><strong className="text-white">2. 调整结构</strong><br />设置标题、章节归属、页面风格和动画，停用不需要的章节。</li><li><strong className="text-white">3. 生成交付</strong><br />选择网页或 PPT 后提交，小T会分析素材并打开可编辑产物。</li></ol></section>}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">01</span><h3 className="text-sm font-semibold">素材上传</h3></div>
          <div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFiles(event.dataTransfer.files); }} className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-7 text-center transition ${dragging ? 'border-slate-900 bg-slate-100' : 'border-slate-300 bg-slate-50 hover:border-slate-500 hover:bg-slate-100'}`}>
            <Upload className="h-5 w-5 text-slate-500" /><strong className="mt-2 text-xs">统一导入项目素材</strong><span className="mt-1 text-[11px] text-slate-400">支持图片、PDF、PPT、DOCX、视频；上传后只保存远程引用</span>
            <div className="mt-3 flex gap-2"><button type="button" onClick={() => inputRef.current?.click()} className="rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700">选择图片与文件</button><button type="button" onClick={() => folderRef.current?.click()} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:border-slate-500">导入文件夹</button></div>
          </div>
          <input ref={inputRef} className="hidden" type="file" multiple accept="image/*,.pdf,.mp4,.mov,.webm,.doc,.docx,.ppt,.pptx,.txt" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ''; }} />
          <input ref={folderRef} className="hidden" type="file" multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ''; }} />
          {state.assets.length > 0 && <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500"><span>已导入 {state.assets.length} 个素材</span><button type="button" onClick={clearAssets} className="text-slate-500 hover:text-red-600">清空已导入素材</button></div>}
          {state.assets.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{state.assets.map((asset) => <div key={asset.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">{asset.kind === 'image' && asset.remoteUrl ? <img src={asset.remoteUrl} alt="" className="h-8 w-10 rounded object-cover" /> : <FilePlus2 className="h-4 w-4 flex-none text-slate-400" />}<span className="min-w-0 flex-1 truncate text-xs">{asset.name}</span><span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">{asset.assetLabel || '待识别'}</span>{(asset.width || asset.height) && <span className="shrink-0 text-[10px] text-slate-400">{asset.width}×{asset.height}</span>}{asset.durationSeconds && <span className="shrink-0 text-[10px] text-slate-400">{Math.round(asset.durationSeconds)}s</span>}<select value={asset.chapterId || ''} onChange={(event) => setState((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? { ...item, chapterId: event.target.value || undefined } : item) }))} className="max-w-[110px] rounded border border-slate-200 bg-white px-1 py-1 text-[10px] text-slate-500" aria-label={`${asset.name} 所属章节`}><option value="">未指定章节</option>{state.chapters.filter((chapter) => chapter.enabled).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select><span className={`text-[10px] ${asset.status === 'ready' ? 'text-emerald-600' : asset.status === 'error' ? 'text-red-500' : 'text-amber-600'}`}>{asset.status === 'ready' ? '已上传' : asset.status === 'error' ? '失败' : '上传中'}</span><button type="button" onClick={() => patch({ assets: state.assets.filter((item) => item.id !== asset.id) })} className="text-slate-400 hover:text-red-600" aria-label={`移除 ${asset.name}`}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">02</span><h3 className="text-sm font-semibold">汇报结构</h3></div>
          <label className="block text-xs text-slate-500">项目封面主标题<input value={state.coverTitle} onChange={(event) => patch({ coverTitle: event.target.value })} maxLength={100} placeholder="例如：滨水文化中心设计" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" /></label>
          <div className="mt-3 space-y-2">{state.chapters.map((chapter, index) => <div key={chapter.id} className="flex items-center gap-2"><input type="checkbox" checked={chapter.enabled} onChange={(event) => updateChapter(chapter.id, { enabled: event.target.checked })} className="accent-slate-900" /><span className="w-5 text-center text-[11px] text-slate-400">{index + 1}</span><input value={chapter.name} onChange={(event) => updateChapter(chapter.id, { name: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-slate-500" /><input value={chapter.hint} onChange={(event) => updateChapter(chapter.id, { hint: event.target.value })} placeholder="章节内容提示（可选）" className="hidden min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-slate-500 md:block" /><span className="flex shrink-0 items-center gap-0.5"><button type="button" disabled={index === 0} onClick={() => moveChapter(chapter.id, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-25" aria-label={`上移 ${chapter.name}`}><ChevronUp className="h-3.5 w-3.5" /></button><button type="button" disabled={index === state.chapters.length - 1} onClick={() => moveChapter(chapter.id, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-25" aria-label={`下移 ${chapter.name}`}><ChevronDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => removeChapter(chapter.id)} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label="删除章节"><Trash2 className="h-3.5 w-3.5" /></button></span></div>)}</div>
          <button type="button" onClick={addChapter} className="mt-3 flex items-center gap-1 text-xs text-slate-600 hover:text-slate-950"><Plus className="h-3.5 w-3.5" />添加自定义章节</button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">03</span><h3 className="text-sm font-semibold">展示方式</h3></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs text-slate-500">项目类型<select value={state.projectType} onChange={(event) => changeProjectType(event.target.value as ReportBuilderState['projectType'])} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none">{projectTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs text-slate-500">展示形式<select value={state.purpose} onChange={(event) => patch({ purpose: event.target.value as ReportBuilderState['purpose'] })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none"><option value="web">网页交互形式</option><option value="slides">PPT 交互形式</option></select></label><label className="text-xs text-slate-500">页面语言<select value={state.language} onChange={(event) => patch({ language: event.target.value as ReportBuilderState['language'] })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none"><option>中文</option><option>中英双语</option><option>英文</option></select></label><label className="text-xs text-slate-500">生成模型<select value={state.reportModel} onChange={(event) => patch({ reportModel: event.target.value as ReportBuilderState['reportModel'] })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none">{REPORT_MODEL_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><span className="mt-1 block truncate text-[10px] text-slate-400">{REPORT_MODEL_OPTIONS.find((option) => option.id === state.reportModel)?.description}</span></label></div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">04</span><h3 className="text-sm font-semibold">页面样式</h3></div><div className="mb-3 flex rounded-lg bg-slate-100 p-1"><button type="button" onClick={() => patch({ styleMode: 'preset' })} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] ${state.styleMode === 'preset' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}>页面风格选择</button><button type="button" onClick={() => patch({ styleMode: 'custom' })} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] ${state.styleMode === 'custom' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}>自定义搭配</button></div>{state.styleMode === 'preset' ? <div className="grid gap-2 sm:grid-cols-3">{REPORT_STYLE_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => patch({ stylePreset: preset.id })} className={`rounded-lg border p-2 text-left transition ${state.stylePreset === preset.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-400'}`}><span className={`mb-2 block h-12 rounded-md ${preset.id === 'monochrome' || preset.id === 'cinematicblack' ? 'bg-gradient-to-br from-slate-950 via-slate-700 to-slate-400' : preset.id === 'naturalwhite' ? 'bg-gradient-to-br from-white via-slate-100 to-blue-100' : preset.id === 'technicalgrid' ? 'bg-[linear-gradient(rgba(30,64,175,.25)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.25)_1px,transparent_1px)] bg-[size:12px_12px] bg-blue-50' : 'bg-gradient-to-br from-slate-700 via-blue-700 to-cyan-300'}`} /><strong className="block text-xs">{preset.label}</strong><span className={`mt-1 block text-[10px] ${state.stylePreset === preset.id ? 'text-slate-300' : 'text-slate-500'}`}>{preset.description}</span></button>)}</div> : <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-slate-500">页面排版<select value={state.customLayout} onChange={(event) => patch({ customLayout: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]">{REPORT_LAYOUT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-xs text-slate-500">文字排版<select value={state.customTextLayout} onChange={(event) => patch({ customTextLayout: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]">{REPORT_TEXT_LAYOUT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-xs text-slate-500">色彩搭配<select value={state.customPalette} onChange={(event) => patch({ customPalette: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]">{REPORT_PALETTE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>}</section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">05</span><h3 className="text-sm font-semibold">播放效果</h3></div><div className="mb-3 flex rounded-lg bg-slate-100 p-1"><button type="button" onClick={() => patch({ animationMode: 'preset' })} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] ${state.animationMode === 'preset' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}>推荐动画组合</button><button type="button" onClick={() => patch({ animationMode: 'custom' })} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] ${state.animationMode === 'custom' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}>自由选择动画</button></div>{state.animationMode === 'preset' ? <div className="grid gap-2 sm:grid-cols-3">{REPORT_ANIMATION_PRESETS.map((preset) => <div key={preset.id} className={`rounded-lg border p-3 transition ${state.animationPreset === preset.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200'}`}><button type="button" onClick={() => patch({ animationPreset: preset.id })} className="w-full text-left"><strong className="block text-xs">{preset.label}</strong><span className={`mt-1 block text-[10px] ${state.animationPreset === preset.id ? 'text-slate-300' : 'text-slate-500'}`}>{preset.description}</span></button><button type="button" onClick={() => setPreviewAnimation(preset.id)} className={`mt-2 rounded border px-2 py-1 text-[10px] ${state.animationPreset === preset.id ? 'border-slate-600 text-slate-200' : 'border-slate-200 text-slate-500'}`}>预览动画</button></div>)}</div> : <div className="grid gap-3 sm:grid-cols-2"><div><div className="mb-2 text-[11px] font-semibold text-slate-600">页面切换（可多选）</div><div className="flex flex-wrap gap-1.5">{REPORT_TRANSITION_OPTIONS.map((item) => <button type="button" key={item.id} onClick={() => toggleValue('customTransitions', item.id)} className={`rounded-full border px-2 py-1 text-[10px] ${state.customTransitions.includes(item.id) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500'}`}>{item.label}</button>)}</div></div><div><div className="mb-2 text-[11px] font-semibold text-slate-600">内容出现（可多选）</div><div className="flex flex-wrap gap-1.5">{REPORT_ENTER_OPTIONS.map((item) => <button type="button" key={item.id} onClick={() => toggleValue('customEnters', item.id)} className={`rounded-full border px-2 py-1 text-[10px] ${state.customEnters.includes(item.id) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500'}`}>{item.label}</button>)}</div></div></div>}<label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={state.presenterMode} onChange={(event) => patch({ presenterMode: event.target.checked })} className="accent-slate-900" />演示者模式（备注与计时）</label></section>

        {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{notice}</div>}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="text-[11px] text-slate-500">已启用 {enabledChapters.length} 个章节 · {state.assets.filter((asset) => asset.status === 'ready').length} 个远程素材{uploading > 0 ? ' · 正在上传' : ''}</div><div className="flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={exportConfig} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-950">下载配置 JSON</button><button type="button" onClick={exportOutline} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-950">下载大纲 MD</button><button type="button" onClick={closeSurface} className="rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-950">返回对话</button><button type="button" onClick={() => void generate()} disabled={generating || uploading > 0 || enabledChapters.length === 0} className="flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-300">{generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}{generating ? '正在提交…' : state.purpose === 'web' ? '生成汇报网页' : '生成 PPT 汇报'}</button></div></div>
      </div>
      {showSample && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="作品汇报示例"><div className="flex h-[min(88vh,900px)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><div className="text-[10px] font-semibold tracking-[0.16em] text-slate-400">SAMPLE REPORT</div><strong className="text-sm text-slate-900">建筑作品汇报示例</strong></div><div className="flex items-center gap-2"><button type="button" onClick={() => { const url = 'https://download-installer.jianzhuxuezhang.com/jzxz/WorkReport.html'; if (window.tanvaDesktop?.openTarget) void window.tanvaDesktop.openTarget(url, 'url'); else window.open(url, '_blank', 'noopener,noreferrer'); }} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600">浏览器打开</button><button type="button" onClick={() => setShowSample(false)} className="rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white">关闭</button></div></div><iframe title="建筑作品汇报示例" src="https://download-installer.jianzhuxuezhang.com/jzxz/WorkReport.html" className="min-h-0 flex-1 border-0 bg-slate-50" sandbox="allow-scripts allow-same-origin" /></div></div>}
      {previewAnimation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="动画预览"><div className="w-[min(720px,94vw)] overflow-hidden rounded-xl bg-slate-900 text-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-700 px-4 py-3"><strong className="text-sm">{REPORT_ANIMATION_PRESETS.find((preset) => preset.id === previewAnimation)?.label} · 动画预览</strong><button type="button" onClick={() => setPreviewAnimation(null)} className="rounded-md bg-white/10 px-3 py-1.5 text-[11px]">关闭</button></div><div className="relative m-4 flex h-64 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-700 via-slate-900 to-slate-950"><div className="absolute inset-0 animate-pulse bg-blue-400/10" /><div className="relative text-center"><div className="text-[10px] tracking-[0.24em] text-slate-400">CHAPTER 01</div><div className="mt-2 text-3xl font-semibold">空间与光</div><div className="mt-3 h-1 w-36 animate-pulse rounded bg-blue-300/80" /><div className="mt-4 text-xs text-slate-400">页面切换与内容入场效果</div></div></div></div></div>}
      {generating && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="正在生成作品汇报"><div className="w-[min(620px,94vw)] rounded-xl bg-slate-900 p-6 text-white shadow-2xl"><div className="text-[10px] font-semibold tracking-[0.2em] text-slate-400">BUILDING / ARCHITECTURE REPORT</div><h3 className="mt-2 text-lg font-semibold">正在整理汇报内容</h3><p className="mt-2 text-xs leading-5 text-slate-300">小T正在读取素材、组合章节，并准备可编辑的{state.purpose === 'web' ? '网页汇报' : 'PPT 汇报'}。</p><div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-cyan-300 transition-[width] duration-500" style={{ width: `${generationProgress}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-slate-400"><span>{generationProgress < 30 ? '校验配置与素材' : generationProgress < 65 ? '提交远程引用给小T' : '生成并验收交付文件'}</span><span>{generationProgress}%</span></div></div></div>}
    </div>
  );
}
