import { BadRequestException } from '@nestjs/common';

// TapCanvas 资产规划（/public/v1/asset-plans）经 Tanva new-api 签名订单中转的请求合同。
// 规划费用 = TapCanvas 回执人民币 × 1.5 × 100 积分，由 consumption-orders 统一结算。

export const TAPCANVAS_PLAN_TASK_TYPE = 'tapcanvas-plan';
export const TAPCANVAS_PLAN_MODEL = 'tapcanvas-asset-plan';
export const TAPCANVAS_PLAN_SERVICE_TYPE = 'tapcanvas-asset-plan';
export const TAPCANVAS_PLAN_GATEWAY_PATH = '/v1/tanva/asset-plans';

export const PLAN_MODES = ['film', 'remake'] as const;
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const CLIP_PREFERENCES = ['single_shot', 'max_duration'] as const;
export const KNOWLEDGE_TIERS = ['low', 'medium', 'high'] as const;

export type PlanMode = (typeof PLAN_MODES)[number];
export type PlanAsset = { type: 'image'; imageType: 'style' | 'normal'; url: string } | { type: 'video'; url: string };

/** 作者对话模型：与 TapCanvas `/public/v1/models` 目录对齐；不在目录内的模型由上游以 400 零费用拒绝。 */
export const DEFAULT_AUTHOR_MODELS = [
  'deepseek-v4.1-flash', 'gemini-3.8-flash', 'qwen3.8-flash', 'glm-5.3-flash',
  'doubao-seed-2-1-turbo-260628', 'gpt-5.6-luna', 'claude-haiku-5-5',
];

export const FILM_GUIDE = '请为以下章节进行全章资产与视频片段规划，提供参考资产设计和完整视频提示词。忠实原文：完整保留原文事实、因果与逐字台词，只把内容镜头化并补足可拍的动作承接。';
export const REMAKE_DEFAULT_REQUIREMENT = '保留原片的叙事节奏、镜头切点、景别和运镜，人物、场景与台词重新原创设计。';

export interface PlanInput {
  mode: PlanMode;
  text: string;
  requirement?: string;
  assets: PlanAsset[];
  modelKey: string;
  reasoningEffort: (typeof REASONING_EFFORTS)[number];
  clipPreference?: (typeof CLIP_PREFERENCES)[number];
  knowledgeTier?: (typeof KNOWLEDGE_TIERS)[number];
  step?: number;
  projectId?: string;
  nodeId?: string;
  clientRequestId: string;
}

const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_TEXT = 200_000;
const MAX_IMAGES = 12;

const pick = <T extends readonly string[]>(value: unknown, allowed: T, name: string, fallback?: T[number]): T[number] | undefined => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) throw new BadRequestException(`${name} 无效`);
  return value as T[number];
};

const optionalId = (value: unknown, name: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !ID.test(value)) throw new BadRequestException(`${name} 无效`);
  return value;
};

/** 只接受已托管的远程 http(s) 地址；data:/blob:/裸 base64 一律拒绝。 */
export function remoteUrl(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > 4096) throw new BadRequestException(`${name} 必须是远程地址`);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new BadRequestException(`${name} 必须是远程地址`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequestException(`${name} 必须是已上传的 http(s) 地址`);
  return url.toString();
}

export function parsePlanInput(raw: any): PlanInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('请求体无效');
  const mode = pick(raw.mode, PLAN_MODES, 'mode', 'film')!;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length > MAX_TEXT) throw new BadRequestException('原文过长，请按章节分别规划');
  const requirement = typeof raw.requirement === 'string' && raw.requirement.trim() ? raw.requirement.trim().slice(0, 20_000) : undefined;
  if (!Array.isArray(raw.assets ?? [])) throw new BadRequestException('assets 无效');
  const assets: PlanAsset[] = (raw.assets ?? []).map((asset: any, index: number) => {
    if (asset?.type === 'video') return { type: 'video', url: remoteUrl(asset.url, `参考视频 ${index + 1}`) };
    if (asset?.type === 'image') return { type: 'image', imageType: asset.imageType === 'style' ? 'style' : 'normal', url: remoteUrl(asset.url, `参考图 ${index + 1}`) };
    throw new BadRequestException(`素材 ${index + 1} 类型无效`);
  });
  if (assets.filter(a => a.type === 'image').length > MAX_IMAGES) throw new BadRequestException(`参考图最多 ${MAX_IMAGES} 张`);
  const videos = assets.filter(a => a.type === 'video').length;
  if (videos > 1) throw new BadRequestException('参考视频最多 1 个');
  if (mode === 'film' && !text) throw new BadRequestException('一键成片需要填写故事或章节原文');
  if (mode === 'remake' && videos !== 1) throw new BadRequestException('爆款复刻需要连接 1 个参考视频');
  if (typeof raw.modelKey !== 'string' || !ID.test(raw.modelKey)) throw new BadRequestException('作者模型无效');
  const reasoningEffort = pick(raw.reasoningEffort, REASONING_EFFORTS, 'reasoningEffort', 'none')!;
  const clipPreference = pick(raw.clipPreference, CLIP_PREFERENCES, 'clipPreference');
  const knowledgeTier = pick(raw.knowledgeTier, KNOWLEDGE_TIERS, 'knowledgeTier');
  let step: number | undefined;
  if (raw.step !== undefined && raw.step !== null && raw.step !== '') {
    step = Number(raw.step);
    if (!Number.isFinite(step) || step <= 0 || step > 120) throw new BadRequestException('单段时长上限无效');
  }
  const clientRequestId = optionalId(raw.clientRequestId, 'clientRequestId');
  if (!clientRequestId) throw new BadRequestException('缺少 clientRequestId');
  return { mode, text, requirement, assets, modelKey: raw.modelKey, reasoningEffort, clipPreference, knowledgeTier, step,
    projectId: optionalId(raw.projectId, 'projectId'), nodeId: optionalId(raw.nodeId, 'nodeId'), clientRequestId };
}

/** 交给 TapCanvas 的创作原文。复刻模式沿用 TapCanvas 爆款复刻的边界：原视频只用于理解，不作为任何生成输入。 */
export function buildPlanPrompt(input: Pick<PlanInput, 'mode' | 'text' | 'requirement'>): string {
  if (input.mode === 'film') {
    return [FILM_GUIDE, input.requirement ? `\n创作要求：${input.requirement}` : '', '\n章节原文：', input.text].join('\n').trim();
  }
  return [
    '爆款复刻：创作来源是参考视频（input 中的视频素材）的逐镜头理解，按它复刻节奏、镜头切点、景别、运镜与声音结构。原视频不得作为任何生成接口的输入，也不得直接引用原视频画面。',
    `复刻要求：${input.requirement || REMAKE_DEFAULT_REQUIREMENT}`,
    input.text ? `\n补充原文/设定：\n${input.text}` : '',
  ].join('\n').trim();
}

/** TapCanvas AssetPlanRequest（strict：不得带未声明字段）。 */
export function buildAssetPlanRequest(input: PlanInput): Record<string, unknown> {
  return {
    prompt: buildPlanPrompt(input),
    modelKey: input.modelKey,
    reasoningEffort: input.reasoningEffort,
    assets: input.assets,
    ...(input.step !== undefined ? { step: input.step } : {}),
    ...(input.clipPreference ? { clipPreference: input.clipPreference } : {}),
    ...(input.knowledgeTier ? { knowledgeTier: input.knowledgeTier } : {}),
  };
}

export type TapPlanStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
const TAP_STATUSES = new Set<TapPlanStatus>(['queued', 'running', 'succeeded', 'failed', 'canceled']);
export const TERMINAL_PLAN_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

/** TapCanvas 资产规划信封 `{ ret, message, data }` 中的任务回执。 */
export function readTapJob(body: any): { jobId: string; status: TapPlanStatus; data: Record<string, any> } | null {
  const data = body?.data;
  if (!data || typeof data !== 'object' || typeof data.jobId !== 'string' || !ID.test(data.jobId)) return null;
  if (!TAP_STATUSES.has(data.status)) return null;
  return { jobId: data.jobId, status: data.status, data };
}

/** 只保留进度卡需要的字段，不把上游诊断全文写库。 */
export function compactProgress(data: Record<string, any>) {
  const progress = data?.progress;
  const nodes = Array.isArray(progress?.nodes) ? progress.nodes.slice(0, 20).map((n: any) => ({
    label: typeof n?.label === 'string' ? n.label.slice(0, 60) : '', status: typeof n?.status === 'string' ? n.status : 'unknown',
  })) : [];
  return {
    nodeSummary: progress?.nodeSummary && typeof progress.nodeSummary === 'object' ? progress.nodeSummary : null,
    nodes,
    elapsedMs: Number.isFinite(data?.elapsedMs) ? data.elapsedMs : null,
    deadlineAt: typeof data?.executionDeadline?.deadlineAt === 'string' ? data.executionDeadline.deadlineAt : null,
    cancelRequestedAt: data?.cancelRequestedAt ?? null,
    retryable: typeof data?.retryUrl === 'string',
  };
}

export function upstreamErrorMessage(status: number, body: any): string {
  const code = body?.data?.code || body?.error;
  if (status === 402) return 'TapCanvas 规划渠道余额不足，请联系管理员充值后重试';
  if (code === 'tapcanvas_upstream_uncertain' || code === 'tanva_order_in_progress') return '规划服务响应不确定，正在按原请求核对';
  const message = typeof body?.message === 'string' && body.message ? body.message
    : typeof body?.data?.message === 'string' ? body.data.message : typeof body?.error === 'string' ? body.error : '';
  return message ? `规划服务拒绝请求：${message.slice(0, 300)}` : `规划服务拒绝请求（HTTP ${status}）`;
}
