import React from 'react';
import { Handle, Position, useStore, type Node, type ReactFlowState } from '@xyflow/react';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useLocaleText } from '@/utils/localeText';
import { resolvePublicAssetUrlFromKey } from '@/utils/assetProxy';
import {
  TAPCANVAS_PLAN_TERMINAL, tapcanvasPlanApi, type TapcanvasPlanAsset, type TapcanvasPlanMode,
  type TapcanvasPlanOptions, type TapcanvasPlanTask,
} from '@/services/tapcanvasPlanApi';
import { PLAN_RELAYOUT_EVENT, buildPlanExpansion, type PlanInputBinding } from '../tapcanvasPlanExpansion';
import { resolveTextFromSourceNode } from '../utils/textSource';

type InputRef = { nodeId: string; kind: 'image' | 'video'; sourceHandle: string };
type Props = {
  id: string;
  selected?: boolean;
  data: {
    mode?: TapcanvasPlanMode;
    text?: string;
    requirement?: string;
    modelKey?: string;
    reasoningEffort?: string;
    clipPreference?: string;
    knowledgeTier?: string;
    step?: number;
    imageType?: 'normal' | 'style';
    taskId?: string;
    taskStatus?: string;
    /** 提交时冻结的 input:N → 画布节点绑定（展开时用于连线）。 */
    inputs?: InputRef[];
    expandedTaskId?: string;
  };
};

const NODE_WIDTH = 340;
const POLL_MS = 4000;
const STATUS_TEXT: Record<string, [string, string]> = {
  submitting: ['正在提交，等待受理…', 'Submitting…'],
  queued: ['已受理，排队中', 'Queued'],
  running: ['规划中（通常 10–25 分钟）', 'Planning (10–25 min)'],
  succeeded: ['规划完成', 'Planned'],
  failed: ['规划失败', 'Failed'],
  canceled: ['已停止', 'Stopped'],
};

const remoteMediaUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value || /^(data:|blob:)/i.test(value)) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  // OSS key（projects/...）按公共资产基址拼接；裸 base64 等无法解析的值丢弃。
  return /^[A-Za-z0-9_-]+\/[^\s]+\.[A-Za-z0-9]{2,5}$/.test(value) ? resolvePublicAssetUrlFromKey(value) ?? undefined : undefined;
};
/** 安全读取嵌套字段：节点 data 来自历史画布，形状不可信。 */
const pick = (value: unknown, ...path: Array<string | number>): unknown =>
  path.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string | number, unknown>)[key] : undefined), value);
const imageUrlOf = (node?: Node): string | undefined => {
  const d = node?.data;
  return remoteMediaUrl(pick(d, 'imageUrl')) || remoteMediaUrl(pick(d, 'imageData')) || remoteMediaUrl(pick(d, 'imageUrls', 0))
    || remoteMediaUrl(pick(d, 'outputImage'));
};
const videoUrlOf = (node?: Node): string | undefined => {
  const d = node?.data;
  for (const c of [pick(d, 'videoUrl'), pick(d, 'video_url'), pick(d, 'videoSourceUrl'), pick(d, 'output', 'video_url'),
    pick(d, 'videoSource', 'url'), pick(d, 'history', 0, 'videoUrl')]) {
    const url = remoteMediaUrl(c);
    if (url) return url;
  }
  return undefined;
};

const positiveSeconds = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
/** 参考视频时长：优先取视频节点上传时记下的 duration，否则只读 URL 元数据；读不到返回 undefined，不阻塞提交。 */
const probeVideoDuration = (url: string): Promise<number | undefined> => new Promise((resolve) => {
  const video = document.createElement('video');
  const finish = (value?: number) => {
    window.clearTimeout(timer);
    video.onloadedmetadata = null; video.onerror = null;
    video.removeAttribute('src'); video.load();
    resolve(positiveSeconds(value));
  };
  const timer = window.setTimeout(() => finish(), 8000);
  video.preload = 'metadata';
  video.onloadedmetadata = () => finish(video.duration);
  video.onerror = () => finish();
  video.src = url;
});

const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

let optionsCache: Promise<TapcanvasPlanOptions> | null = null;
const loadOptions = () => {
  optionsCache ??= tapcanvasPlanApi.options().catch((error) => { optionsCache = null; throw error; });
  return optionsCache;
};

function TapcanvasPlanNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const projectId = useProjectContentStore((s) => s.projectId);
  const mode: TapcanvasPlanMode = data.mode === 'remake' ? 'remake' : 'film';
  const [options, setOptions] = React.useState<TapcanvasPlanOptions | null>(null);
  const [optionsError, setOptionsError] = React.useState<string | null>(null);
  const [task, setTask] = React.useState<TapcanvasPlanTask | null>(null);
  const [busy, setBusy] = React.useState<null | 'submit' | 'cancel' | 'retry' | 'expand'>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const update = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch } }));
  }, [id]);

  // 上游：text 原文 / img 多张参考图（按连线顺序）/ video 1 个参考视频。
  const upstream = useStore(React.useCallback((state: ReactFlowState) => {
    const incoming = state.edges.filter((e) => e.target === id);
    const find = (nodeId: string) => state.nodes.find((n) => n.id === nodeId);
    const textEdge = incoming.find((e) => e.targetHandle === 'text');
    const text = textEdge ? resolveTextFromSourceNode(find(textEdge.source), textEdge.sourceHandle) : undefined;
    const images = incoming.filter((e) => e.targetHandle === 'img').map((e) => ({ nodeId: e.source, sourceHandle: e.sourceHandle || 'img', url: imageUrlOf(find(e.source)) }));
    const videoEdge = incoming.find((e) => e.targetHandle === 'video');
    const videoNode = videoEdge ? find(videoEdge.source) : undefined;
    const video = videoEdge ? { nodeId: videoEdge.source, sourceHandle: videoEdge.sourceHandle || 'video', url: videoUrlOf(videoNode),
      duration: positiveSeconds(pick(videoNode?.data, 'duration')) } : null;
    const position = state.nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
    return JSON.stringify({ hasText: Boolean(textEdge), text, images, video, position });
  }, [id]));
  const inputsNow = React.useMemo(() => JSON.parse(upstream) as {
    hasText: boolean; text?: string; images: Array<{ nodeId: string; sourceHandle: string; url?: string }>;
    video: { nodeId: string; sourceHandle: string; url?: string; duration?: number } | null; position: { x: number; y: number };
  }, [upstream]);

  React.useEffect(() => {
    let alive = true;
    loadOptions().then((value) => { if (alive) setOptions(value); })
      .catch((e) => { if (alive) setOptionsError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const modelKey = data.modelKey || options?.defaultModel || '';
  const effectiveText = (inputsNow.hasText ? inputsNow.text : data.text)?.trim() || '';
  const active = Boolean(task && !TAPCANVAS_PLAN_TERMINAL.has(task.status));

  const expand = React.useCallback(async (taskId: string, frozenInputs: InputRef[] | undefined, manual: boolean) => {
    setBusy('expand'); setError(null);
    try {
      const { nodes } = await tapcanvasPlanApi.result(taskId);
      const bindings: Record<string, PlanInputBinding> = {};
      (frozenInputs ?? []).forEach((ref, index) => { bindings[`input:${index + 1}`] = ref; });
      const origin = { x: inputsNow.position.x + NODE_WIDTH + 120, y: inputsNow.position.y };
      const planId = `tcp${Date.now().toString(36)}`;
      const expansion = buildPlanExpansion(nodes, { origin, idPrefix: planId, inputs: bindings,
        groupName: mode === 'remake' ? lt('爆款复刻规划', 'Remake plan') : lt('一键成片规划', 'Film plan') });
      window.dispatchEvent(new CustomEvent('flow:instantiateTemplate', { detail: {
        template: { nodes: expansion.nodes, edges: expansion.edges }, position: origin } }));
      // 首帧渲染后按实测尺寸再排一次，避免带参数面板的生图/视频节点叠压。
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(PLAN_RELAYOUT_EVENT, { detail: { planId } })));
      update({ expandedTaskId: taskId });
      setNotice(`${lt('已展开', 'Expanded')} ${nodes.length} ${lt('个规划节点（未运行，可在分组上点运行一键生成）', 'planned nodes (not run; run the group to generate)')}`
        + (expansion.warnings.length ? `；${expansion.warnings.join('；')}` : ''));
    } catch (e) {
      setError(`${manual ? '' : lt('自动展开失败：', 'Auto expand failed: ')}${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  }, [inputsNow.position.x, inputsNow.position.y, lt, mode, update]);

  // 轮询回调跨渲染存活：通过 ref 读取最新节点数据与展开函数，避免同一结果被重复展开。
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const expandRef = React.useRef(expand);
  expandRef.current = expand;
  const autoExpandedRef = React.useRef<string | null>(null);

  // 轮询：任务进行中每 4 秒读一次；刷新页面后按节点保存的 taskId 恢复。
  React.useEffect(() => {
    if (!data.taskId) return;
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await tapcanvasPlanApi.get(data.taskId!);
        if (!alive) return;
        setTask(next);
        const current = dataRef.current;
        if (next.status !== current.taskStatus) update({ taskStatus: next.status });
        if (next.status === 'succeeded' && next.hasResult && current.expandedTaskId !== next.id && autoExpandedRef.current !== next.id) {
          autoExpandedRef.current = next.id;
          void expandRef.current(next.id, current.inputs, false);
        }
        const settling = TAPCANVAS_PLAN_TERMINAL.has(next.status) && next.billing?.status !== 'settled' && next.billing?.status !== 'rejected';
        if (TAPCANVAS_PLAN_TERMINAL.has(next.status) && !settling) window.dispatchEvent(new Event('refresh-credits'));
        if (!TAPCANVAS_PLAN_TERMINAL.has(next.status) || (next.status === 'succeeded' && !next.hasResult) || settling) {
          timer = setTimeout(tick, settling ? POLL_MS * 4 : POLL_MS);
        }
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.taskId]);

  const submit = React.useCallback(async () => {
    if (busy || active) return;
    setBusy('submit'); setError(null); setNotice(null);
    try {
      if (mode === 'film' && !effectiveText) throw new Error(lt('请填写或连接故事/章节原文', 'Enter or connect the story text'));
      if (mode === 'remake' && !inputsNow.video) throw new Error(lt('爆款复刻需要连接 1 个参考视频', 'Connect one reference video'));
      if (inputsNow.video && !inputsNow.video.url) throw new Error(lt('参考视频尚未上传完成或不是远程地址', 'Reference video is not uploaded yet'));
      const missing = inputsNow.images.filter((img) => !img.url).length;
      if (missing) throw new Error(`${missing} ${lt('张参考图尚未上传完成，请等待上传后再提交', 'reference images are not uploaded yet')}`);
      if (!modelKey) throw new Error(lt('请选择作者模型', 'Select an author model'));
      const assets: TapcanvasPlanAsset[] = [];
      const refs: InputRef[] = [];
      inputsNow.images.forEach((img) => {
        assets.push({ type: 'image', imageType: data.imageType === 'style' ? 'style' : 'normal', url: img.url! });
        refs.push({ nodeId: img.nodeId, kind: 'image', sourceHandle: img.sourceHandle });
      });
      if (inputsNow.video?.url) {
        assets.push({ type: 'video', url: inputsNow.video.url });
        refs.push({ nodeId: inputsNow.video.nodeId, kind: 'video', sourceHandle: inputsNow.video.sourceHandle });
      }
      const sourceDurationSeconds = mode === 'remake' && inputsNow.video?.url
        ? inputsNow.video.duration ?? await probeVideoDuration(inputsNow.video.url) : undefined;
      const created = await tapcanvasPlanApi.create({
        mode, text: effectiveText, requirement: data.requirement?.trim() || undefined, assets, modelKey,
        reasoningEffort: data.reasoningEffort || 'none', clipPreference: data.clipPreference || undefined,
        knowledgeTier: data.knowledgeTier || undefined, step: typeof data.step === 'number' ? data.step : undefined,
        sourceDurationSeconds, projectId: projectId || undefined, nodeId: id, clientRequestId: newRequestId(),
      });
      setTask(created);
      update({ taskId: created.id, taskStatus: created.status, inputs: refs, expandedTaskId: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, [active, busy, data.clipPreference, data.imageType, data.knowledgeTier, data.reasoningEffort, data.requirement, data.step,
    effectiveText, id, inputsNow.images, inputsNow.video, lt, mode, modelKey, projectId, update]);

  const cancel = React.useCallback(async () => {
    if (!task || busy) return;
    setBusy('cancel'); setError(null);
    try { setTask(await tapcanvasPlanApi.cancel(task.id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }, [busy, task]);

  const retry = React.useCallback(async () => {
    if (!task || busy) return;
    setBusy('retry'); setError(null); setNotice(null);
    try {
      const child = await tapcanvasPlanApi.retry(task.id, newRequestId());
      setTask(child);
      update({ taskId: child.id, taskStatus: child.status, expandedTaskId: undefined });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }, [busy, task, update]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent).detail?.id === id) void submit();
    };
    window.addEventListener('flow:run-node', handler as EventListener);
    return () => window.removeEventListener('flow:run-node', handler as EventListener);
  }, [id, submit]);

  const status = busy === 'submit' ? 'submitting' : task?.status;
  const statusText = status ? lt(...(STATUS_TEXT[status] ?? [status, status])) : null;
  const summary = task?.progress?.nodeSummary;
  const runningStage = task?.progress?.nodes.find((n) => n.status === 'running')?.label;
  const billing = task?.billing;
  const disabledReason = optionsError ? optionsError : options && !options.enabled ? lt('规划结算网关未开启', 'Billing gateway disabled') : null;

  const field: React.CSSProperties = { width: '100%', fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff' };
  const label: React.CSSProperties = { fontSize: 11, color: '#374151', display: 'flex', flexDirection: 'column', gap: 3 };
  const button = (enabled: boolean, primary = false): React.CSSProperties => ({
    fontSize: 12, padding: '4px 10px', borderRadius: 6, border: primary ? 'none' : '1px solid #d1d5db',
    background: primary ? (enabled ? '#111827' : '#e5e7eb') : '#fff', color: primary ? '#fff' : '#111827',
    cursor: enabled ? 'pointer' : 'not-allowed',
  });

  return (
    <div style={{ width: NODE_WIDTH, padding: 10, background: '#fff', border: `1px solid ${selected ? '#2563eb' : '#e5e7eb'}`,
      borderRadius: 8, boxShadow: selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)',
      position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>{lt('爆款复刻 & 一键成片', 'Remake & One-click Film')}</div>
        <div className='nodrag nopan' style={{ display: 'flex', gap: 4 }}>
          {(['film', 'remake'] as const).map((m) => (
            <button key={m} disabled={active} onClick={() => update({ mode: m })}
              style={{ ...button(!active), padding: '2px 8px', background: mode === m ? '#111827' : '#fff', color: mode === m ? '#fff' : '#111827' }}>
              {m === 'film' ? lt('一键成片', 'Film') : lt('爆款复刻', 'Remake')}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#6b7280' }}>
        {lt('参考图', 'Images')} {inputsNow.images.length} · {lt('参考视频', 'Video')} {inputsNow.video ? 1 : 0}
        {mode === 'remake' && !inputsNow.video && <span style={{ color: '#b45309' }}> · {lt('请连接 1 个参考视频', 'connect a video')}</span>}
      </div>

      {inputsNow.hasText ? (
        <div style={{ fontSize: 12, color: '#374151', background: '#f9fafb', borderRadius: 4, padding: 6, maxHeight: 72, overflow: 'hidden' }}>
          {effectiveText ? effectiveText.slice(0, 160) : lt('已连接文本节点（为空）', 'Connected text is empty')}
        </div>
      ) : (
        <textarea className='nodrag nopan nowheel' rows={4} value={data.text ?? ''} onChange={(e) => update({ text: e.target.value })}
          placeholder={mode === 'film' ? lt('粘贴故事或章节原文（也可连接文本节点）', 'Paste story or chapter text')
            : lt('可选：补充人物、设定或改编原文', 'Optional: extra setting or source text')} style={{ ...field, resize: 'vertical' }} />
      )}
      <textarea className='nodrag nopan nowheel' rows={2} value={data.requirement ?? ''} onChange={(e) => update({ requirement: e.target.value })}
        placeholder={mode === 'remake' ? lt('复刻要求（默认：保留节奏、切点、景别与运镜，人物场景台词原创）', 'Remake requirement')
          : lt('可选：创作要求（画风、总时长等）', 'Optional: creative requirement')} style={{ ...field, resize: 'vertical' }} />

      <div className='nodrag nopan' style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        <label style={label}>{lt('作者模型', 'Author model')}
          <select value={modelKey} onChange={(e) => update({ modelKey: e.target.value })} style={field}>
            {(options?.authorModels ?? (modelKey ? [modelKey] : [])).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={label}>{lt('思考强度', 'Reasoning')}
          <select value={data.reasoningEffort || 'none'} onChange={(e) => update({ reasoningEffort: e.target.value })} style={field}>
            {(options?.reasoningEfforts ?? ['none']).map((m) => <option key={m} value={m}>{m === 'none' ? lt('关闭', 'off') : m}</option>)}
          </select>
        </label>
        <label style={label}>{lt('分段方式', 'Clip preference')}
          <select value={data.clipPreference || 'single_shot'} onChange={(e) => update({ clipPreference: e.target.value })} style={field}>
            <option value='single_shot'>{lt('单镜头', 'Single shot')}</option>
            <option value='max_duration'>{lt('最大时长', 'Max duration')}</option>
          </select>
        </label>
        <label style={label}>{lt('单段上限(秒)', 'Max clip (s)')}
          <input type='number' min={4} max={15} value={data.step ?? ''} placeholder={lt('不限', 'Any')} style={field}
            onChange={(e) => update({ step: e.target.value === '' ? undefined : Math.max(1, Math.round(Number(e.target.value))) })} />
        </label>
        <label style={label}>{lt('知识档位', 'Knowledge')}
          <select value={data.knowledgeTier || 'low'} onChange={(e) => update({ knowledgeTier: e.target.value })} style={field}>
            <option value='low'>{lt('低', 'Low')}</option><option value='medium'>{lt('中', 'Medium')}</option><option value='high'>{lt('高', 'High')}</option>
          </select>
        </label>
        <label style={label}>{lt('参考图用途', 'Image role')}
          <select value={data.imageType || 'normal'} onChange={(e) => update({ imageType: e.target.value })} style={field}>
            <option value='normal'>{lt('角色/场景', 'Subject')}</option><option value='style'>{lt('画风', 'Style')}</option>
          </select>
        </label>
      </div>
      {mode === 'remake' && data.clipPreference === 'max_duration' && (
        <div style={{ fontSize: 11, color: '#b45309' }}>
          {lt('最大时长下每段固定取上限秒数，成片总长难以贴合原片；复刻建议用「单镜头」。', 'Max duration fixes every clip at the cap, so the total rarely matches the source; use Single shot for remakes.')}
        </div>
      )}

      <div style={{ fontSize: 11, color: '#6b7280' }}>
        {lt('按实际模型用量结算', 'Billed by actual usage')}
        {options ? ` · ${lt('提交时预扣', 'reserve')} ${options.reserveCredits} ${lt('积分，多退少补', 'credits, settled after')}` : ''}
        {billing?.status === 'settled' && typeof billing.creditsCharged === 'number' ? ` · ${lt('实扣', 'charged')} ${billing.creditsCharged} ${lt('积分', 'credits')}` : ''}
        {task && TAPCANVAS_PLAN_TERMINAL.has(task.status) && billing?.status && billing.status !== 'settled' && billing.status !== 'rejected'
          ? ` · ${lt('费用结算中', 'settling')}` : ''}
      </div>

      {statusText && (
        <div role='status' aria-live='polite' style={{ fontSize: 12, color: status === 'failed' ? '#b91c1c' : '#111827', background: '#f3f4f6', borderRadius: 4, padding: '4px 8px' }}>
          {statusText}{runningStage ? ` · ${runningStage}` : ''}
          {summary && typeof summary.total === 'number' ? ` · ${summary.succeeded ?? 0}/${summary.total}` : ''}
          {task?.progress?.cancelRequestedAt && task.status !== 'canceled' ? ` · ${lt('停止中…', 'stopping…')}` : ''}
        </div>
      )}
      {(error || (task?.error && task.status !== 'canceled')) && (
        <div style={{ fontSize: 12, color: '#ef4444', padding: '4px 8px', background: '#fef2f2', borderRadius: 4 }}>{error || task?.error}</div>
      )}
      {notice && <div style={{ fontSize: 12, color: '#047857', padding: '4px 8px', background: '#ecfdf5', borderRadius: 4 }}>{notice}</div>}

      <div className='nodrag nopan' style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
        {task?.canCancel && <button onClick={cancel} disabled={!!busy} style={button(!busy)}>{busy === 'cancel' ? lt('停止中…', 'Stopping…') : lt('停止', 'Stop')}</button>}
        {task?.canRetry && <button onClick={retry} disabled={!!busy} style={button(!busy)}>{busy === 'retry' ? lt('提交中…', 'Submitting…') : lt('续跑重试', 'Retry')}</button>}
        {task?.hasResult && (
          <button onClick={() => void expand(task.id, data.inputs, true)} disabled={!!busy} style={button(!busy)}>
            {busy === 'expand' ? lt('展开中…', 'Expanding…') : data.expandedTaskId === task.id ? lt('再展开一份', 'Expand again') : lt('展开到画布', 'Expand')}
          </button>
        )}
        <button className='run-btn-with-credit' onClick={submit} disabled={!!busy || active || !!disabledReason}
          title={disabledReason ?? undefined} style={button(!busy && !active && !disabledReason, true)}>
          {busy === 'submit' ? lt('提交中…', 'Submitting…') : active ? lt('规划中…', 'Planning…')
            : task ? lt('重新规划', 'Plan again') : mode === 'remake' ? lt('开始复刻', 'Start remake') : lt('开始规划', 'Start')}
        </button>
      </div>

      <Handle type='target' position={Position.Left} id='text' style={{ top: '30%' }} />
      <Handle type='target' position={Position.Left} id='img' style={{ top: '50%' }} />
      <Handle type='target' position={Position.Left} id='video' style={{ top: '70%' }} />
    </div>
  );
}

export default React.memo(TapcanvasPlanNodeInner);
