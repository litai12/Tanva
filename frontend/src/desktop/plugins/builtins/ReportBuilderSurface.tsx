import { useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, Loader2, Plus, Trash2, Upload, WandSparkles } from 'lucide-react';
import { ossUploadService } from '@/services/ossUploadService';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  buildReportGenerationPrompt,
  createDefaultReportBuilderState,
  loadReportBuilderState,
  REPORT_ANIMATION_PRESETS,
  REPORT_STYLE_PRESETS,
  saveReportBuilderState,
  buildReportExportConfig,
  buildReportOutlineMarkdown,
  type ReportBuilderState,
  type ReportChapter,
} from '../../reportBuilderState';
import type { DesktopPluginComponentProps } from '../types';

const projectTypes: ReportBuilderState['projectType'][] = ['建筑', '室内', '景观', '规划', '通用'];

export default function ReportBuilderSurface({ closeSurface }: DesktopPluginComponentProps) {
  const currentSessionId = useAIChatStore((store) => store.currentSessionId);
  const [state, setState] = useState<ReportBuilderState>(() => loadReportBuilderState(currentSessionId));
  const [uploading, setUploading] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const processUserInput = useAIChatStore((store) => store.processUserInput);
  const currentProjectId = useProjectStore((store) => store.currentProjectId);

  useEffect(() => {
    saveReportBuilderState(state, currentSessionId);
  }, [currentSessionId, state]);

  const patch = (next: Partial<ReportBuilderState>) => setState((current) => ({ ...current, ...next }));
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

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setNotice(null);
    setUploading(files.length);
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type ? 'document' : 'other';
      const id = `report-asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setState((current) => ({ ...current, assets: [...current.assets, { id, name: file.name, kind, remoteUrl: '', chapterId: current.chapters.find((chapter) => chapter.enabled)?.id, size: file.size, status: 'uploading' }] }));
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
      await processUserInput(buildReportGenerationPrompt(saved));
      closeSurface();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提交生成任务失败');
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => setState(createDefaultReportBuilderState());

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
          <button type="button" onClick={reset} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-900">重置配置</button>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">01</span><h3 className="text-sm font-semibold">素材上传</h3></div>
          <div className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center hover:border-slate-500 hover:bg-slate-100">
            <Upload className="h-5 w-5 text-slate-500" /><strong className="mt-2 text-xs">统一导入项目素材</strong><span className="mt-1 text-[11px] text-slate-400">支持图片、PDF、PPT、DOCX、视频；上传后只保存远程引用</span>
            <div className="mt-3 flex gap-2"><button type="button" onClick={() => inputRef.current?.click()} className="rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700">选择图片与文件</button><button type="button" onClick={() => folderRef.current?.click()} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:border-slate-500">导入文件夹</button></div>
          </div>
          <input ref={inputRef} className="hidden" type="file" multiple accept="image/*,.pdf,.mp4,.mov,.webm,.doc,.docx,.ppt,.pptx,.txt" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ''; }} />
          <input ref={folderRef} className="hidden" type="file" multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ''; }} />
          {state.assets.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{state.assets.map((asset) => <div key={asset.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2"><FilePlus2 className="h-4 w-4 flex-none text-slate-400" /><span className="min-w-0 flex-1 truncate text-xs">{asset.name}</span><select value={asset.chapterId || ''} onChange={(event) => setState((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? { ...item, chapterId: event.target.value || undefined } : item) }))} className="max-w-[110px] rounded border border-slate-200 bg-white px-1 py-1 text-[10px] text-slate-500" aria-label={`${asset.name} 所属章节`}><option value="">未指定章节</option>{state.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select><span className={`text-[10px] ${asset.status === 'ready' ? 'text-emerald-600' : asset.status === 'error' ? 'text-red-500' : 'text-amber-600'}`}>{asset.status === 'ready' ? '已上传' : asset.status === 'error' ? '失败' : '上传中'}</span><button type="button" onClick={() => patch({ assets: state.assets.filter((item) => item.id !== asset.id) })} className="text-slate-400 hover:text-red-600" aria-label={`移除 ${asset.name}`}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">02</span><h3 className="text-sm font-semibold">汇报结构</h3></div>
          <label className="block text-xs text-slate-500">项目封面主标题<input value={state.coverTitle} onChange={(event) => patch({ coverTitle: event.target.value })} maxLength={100} placeholder="例如：滨水文化中心设计" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" /></label>
          <div className="mt-3 space-y-2">{state.chapters.map((chapter, index) => <div key={chapter.id} className="flex items-center gap-2"><input type="checkbox" checked={chapter.enabled} onChange={(event) => updateChapter(chapter.id, { enabled: event.target.checked })} className="accent-slate-900" /><span className="w-5 text-center text-[11px] text-slate-400">{index + 1}</span><input value={chapter.name} onChange={(event) => updateChapter(chapter.id, { name: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-slate-500" /><input value={chapter.hint} onChange={(event) => updateChapter(chapter.id, { hint: event.target.value })} placeholder="章节内容提示（可选）" className="hidden min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-slate-500 md:block" /><button type="button" onClick={() => removeChapter(chapter.id)} className="text-slate-400 hover:text-red-600" aria-label="删除章节"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>
          <button type="button" onClick={addChapter} className="mt-3 flex items-center gap-1 text-xs text-slate-600 hover:text-slate-950"><Plus className="h-3.5 w-3.5" />添加自定义章节</button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">03</span><h3 className="text-sm font-semibold">展示方式</h3></div>
          <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-slate-500">项目类型<select value={state.projectType} onChange={(event) => patch({ projectType: event.target.value as ReportBuilderState['projectType'] })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none">{projectTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs text-slate-500">展示形式<select value={state.purpose} onChange={(event) => patch({ purpose: event.target.value as ReportBuilderState['purpose'] })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none"><option value="web">网页交互形式</option><option value="slides">PPT 交互形式</option></select></label><label className="text-xs text-slate-500">页面语言<select value={state.language} onChange={(event) => patch({ language: event.target.value as ReportBuilderState['language'] })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none"><option>中文</option><option>中英双语</option><option>英文</option></select></label></div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">04</span><h3 className="text-sm font-semibold">页面样式</h3></div><div className="grid gap-2 sm:grid-cols-3">{REPORT_STYLE_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => patch({ stylePreset: preset.id })} className={`rounded-lg border p-3 text-left transition ${state.stylePreset === preset.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-400'}`}><strong className="block text-xs">{preset.label}</strong><span className={`mt-1 block text-[10px] ${state.stylePreset === preset.id ? 'text-slate-300' : 'text-slate-500'}`}>{preset.description}</span></button>)}</div></section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">05</span><h3 className="text-sm font-semibold">播放效果</h3></div><div className="grid gap-2 sm:grid-cols-3">{REPORT_ANIMATION_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => patch({ animationPreset: preset.id })} className={`rounded-lg border p-3 text-left transition ${state.animationPreset === preset.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-400'}`}><strong className="block text-xs">{preset.label}</strong><span className={`mt-1 block text-[10px] ${state.animationPreset === preset.id ? 'text-slate-300' : 'text-slate-500'}`}>{preset.description}</span></button>)}</div><label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={state.presenterMode} onChange={(event) => patch({ presenterMode: event.target.checked })} className="accent-slate-900" />演示者模式（备注与计时）</label></section>

        {notice && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{notice}</div>}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="text-[11px] text-slate-500">已启用 {enabledChapters.length} 个章节 · {state.assets.filter((asset) => asset.status === 'ready').length} 个远程素材{uploading > 0 ? ' · 正在上传' : ''}</div><div className="flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={exportConfig} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-950">下载配置 JSON</button><button type="button" onClick={exportOutline} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-950">下载大纲 MD</button><button type="button" onClick={closeSurface} className="rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-950">返回对话</button><button type="button" onClick={() => void generate()} disabled={generating || uploading > 0 || enabledChapters.length === 0} className="flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-300">{generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}{generating ? '正在提交…' : state.purpose === 'web' ? '生成汇报网页' : '生成 PPT 汇报'}</button></div></div>
      </div>
    </div>
  );
}
