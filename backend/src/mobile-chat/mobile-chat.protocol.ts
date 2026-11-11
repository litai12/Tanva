// 移动端 /m 对话协议（纯函数，便于单测）。
// 对话经小T（TapCanvas /public/v1/chat/completions），用 capability manifest v1.3 hostTools 声明两项宿主能力；
// 模型回传 host_tool 后由 Tanva 后端调用 video-productions 执行，TapCanvas 侧不生成媒体（generationMode 默认 host）。
import { BadRequestException } from '@nestjs/common';
import { MOBILE_HOST_NAME } from '../agent/xiaot-host-context';

export const MOBILE_TOOL_FILM = 'tanva_make_video';
export const MOBILE_TOOL_REMAKE = 'tanva_remake_video';
export const MOBILE_RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'] as const;
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_ATTACHMENTS = 9;
export const MAX_RUNNING_JOBS = 2;

export type MobileAttachment = { type: 'image' | 'video'; url: string; name?: string };

export function buildMobileManifest() {
  return {
    protocol_version: '1',
    host: MOBILE_HOST_NAME,
    executionMode: 'hosted',
    // 协议要求至少 1 个 patchOp 与 nodeSpec；移动端没有画布，宿主会忽略任何 flow_patch。
    patchOps: ['focusNode'],
    nodeSpecs: [{ type: 'videoProductionCard', label: '成片任务卡（只读，由宿主工具创建，禁止 addNode）' }],
    hostTools: [
      {
        name: MOBILE_TOOL_FILM,
        description: '一键成片：把故事/文案/题材做成一条完整短片（服务端自动规划分镜→生参考图→生视频→合成）。',
        parameters: {
          type: 'object',
          properties: {
            story: { type: 'string', description: '完整的故事或文案原文（用户只给题材时，先扩写成 200–800 字的故事再填入）' },
            referenceImageUrls: { type: 'array', items: { type: 'string' }, description: '用户提供的角色/场景/画风参考图 URL，只能用用户消息里出现过的地址' },
            aspectRatio: { type: 'string', enum: [...MOBILE_RATIOS], description: '画幅，默认 9:16' },
            targetSeconds: { type: 'integer', minimum: 4, maximum: 180, description: '目标总时长（秒），用户没说就不填' },
            requirements: { type: 'string', description: '风格、节奏、语言等额外要求' },
          },
          required: ['story'],
        },
      },
      {
        name: MOBILE_TOOL_REMAKE,
        description: '一键复刻：参考一条爆款视频的节奏、镜头和景别，原创人物/场景/台词，复刻出新的成片。',
        parameters: {
          type: 'object',
          properties: {
            referenceVideoUrl: { type: 'string', description: '参考视频 URL（用户上传或给出的视频直链），只能用用户消息里出现过的地址' },
            requirements: { type: 'string', description: '要保留什么、要改什么（如换成某品牌产品、换成古风）' },
            referenceImageUrls: { type: 'array', items: { type: 'string' }, description: '可选：新角色/产品/画风参考图 URL' },
            aspectRatio: { type: 'string', enum: [...MOBILE_RATIOS], description: '画幅，不填则跟随原片' },
          },
          required: ['referenceVideoUrl'],
        },
      },
    ],
    notes: [
      '你是 Tanvas 移动端的视频创作助手，只提供两项能力：一键成片（故事/文案 → 成片）和一键复刻（参考视频 → 复刻成片）。单独生图、画布编辑、文档制作等其它请求，礼貌说明移动端暂不支持，并引导使用这两项能力。',
      `用户给出故事、文案或题材并想要成片时，调用 host_tool ${MOBILE_TOOL_FILM}；信息足够就直接调用，不要反复追问。只有一句题材时自行扩写成完整故事后调用。`,
      `用户提供参考视频（附件或视频直链）并要求复刻时，调用 host_tool ${MOBILE_TOOL_REMAKE}。抖音/小红书等分享链接暂不支持，请用户下载后上传视频文件。`,
      '工具参数中的 URL 只能取自用户消息中的【用户附件】或用户正文里的地址，禁止编造或改写。',
      '调用工具后用一两句话告诉用户：任务已提交，进度会在下方卡片实时更新，积分按实际用量扣除，余额不足会暂停等待充值。不要输出 flow_patch，不要创建节点。',
      '【本会话成片任务】列出了已提交任务的最新状态，用户询问进度时据此回答；用户要求同类新片时可再次调用工具。',
      '回答使用简体中文，简洁友好，适合手机阅读。',
    ],
  };
}

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
};

export function parseAttachments(raw: unknown): MobileAttachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) throw new BadRequestException(`附件最多 ${MAX_ATTACHMENTS} 个`);
  return raw.map((item: any, i) => {
    const type = item?.type === 'video' ? 'video' : item?.type === 'image' ? 'image' : null;
    const url = httpUrl(item?.url);
    // 设计 JSON 规范：只收远程引用，data:/blob:/裸 base64 一律拒绝。
    if (!type || !url) throw new BadRequestException(`附件 ${i + 1} 无效：只接受已上传的图片/视频远程地址`);
    const name = typeof item?.name === 'string' ? item.name.slice(0, 120) : undefined;
    return { type, url, ...(name ? { name } : {}) };
  });
}

/** 用户在本会话里真正给出过的 URL（附件 + 正文）。工具参数只能引用这些地址。 */
export function collectUserUrls(messages: Array<{ content: string; attachments?: unknown }>): Set<string> {
  const out = new Set<string>();
  for (const message of messages) {
    for (const match of message.content.matchAll(/https?:\/\/[^\s<>"'，。）)]+/g)) {
      const url = httpUrl(match[0]);
      if (url) out.add(url);
    }
    if (Array.isArray(message.attachments)) {
      for (const a of message.attachments as any[]) {
        const url = httpUrl(a?.url);
        if (url) out.add(url);
      }
    }
  }
  return out;
}

const allowed = (value: unknown, urls: Set<string>, name: string): string => {
  const url = httpUrl(value);
  if (!url) throw new BadRequestException(`${name} 不是有效地址`);
  if (!urls.has(url)) throw new BadRequestException(`${name} 不是你在本会话中提供的地址`);
  return url;
};

/** 把模型的 host_tool 参数转成 /api/video-productions 请求体；URL 必须是用户给过的。 */
export function toProductionRequest(name: string, args: Record<string, unknown>, userUrls: Set<string>): Record<string, unknown> {
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const ratio = typeof args.aspectRatio === 'string' && (MOBILE_RATIOS as readonly string[]).includes(args.aspectRatio) ? args.aspectRatio : undefined;
  const images = Array.isArray(args.referenceImageUrls)
    ? args.referenceImageUrls.slice(0, 12).map((u, i) => allowed(u, userUrls, `参考图 ${i + 1}`)) : [];
  const requirements = str(args.requirements, 20_000);
  if (name === MOBILE_TOOL_FILM) {
    const story = str(args.story, 200_000);
    if (!story) throw new BadRequestException('一键成片缺少故事内容');
    const seconds = Number(args.targetSeconds);
    return {
      mode: 'film', story, aspectRatio: ratio || '9:16', resolution: '720P', videoModel: 'seedance-2.0',
      ...(images.length ? { referenceImageUrls: images } : {}),
      ...(Number.isFinite(seconds) && seconds >= 4 && seconds <= 180 ? { targetSeconds: Math.round(seconds) } : {}),
      ...(requirements ? { requirements } : {}),
    };
  }
  if (name === MOBILE_TOOL_REMAKE) {
    return {
      mode: 'remake', referenceVideoUrl: allowed(args.referenceVideoUrl, userUrls, '参考视频'),
      resolution: '720P', videoModel: 'seedance-2.0',
      ...(ratio ? { aspectRatio: ratio } : {}),
      ...(images.length ? { referenceImageUrls: images } : {}),
      ...(requirements ? { requirements } : {}),
    };
  }
  throw new BadRequestException(`未知的宿主工具：${name}`);
}

const STAGE_TEXT: Record<string, string> = {
  planning: '规划分镜中', waiting_credits: '余额不足已暂停', producing: '生成中', composing: '合成中',
  succeeded: '已完成', failed: '失败', cancelled: '已取消',
};

export type JobBrief = { jobId: string; mode: string; stage: string; finalVideoUrl?: string | null; error?: string | null };

/** 发给上游的用户回合：正文 + 附件清单 + 本会话任务状态（上游会话保留历史，这里只补宿主侧真实状态）。 */
export function composeUpstreamPrompt(text: string, attachments: MobileAttachment[], jobs: JobBrief[]): string {
  const parts = [text.trim() || '（用户只发送了附件）'];
  if (attachments.length) {
    parts.push(['【用户附件】', ...attachments.map(a => `- ${a.type === 'video' ? '视频' : '图片'}：${a.url}`)].join('\n'));
  }
  if (jobs.length) {
    parts.push(['【本会话成片任务】', ...jobs.slice(-5).map(j =>
      `- ${j.mode === 'remake' ? '一键复刻' : '一键成片'} ${j.jobId}：${STAGE_TEXT[j.stage] || j.stage}` +
      (j.finalVideoUrl ? `，成片 ${j.finalVideoUrl}` : '') + (j.error ? `，原因：${j.error.slice(0, 120)}` : ''))].join('\n'));
  }
  return parts.join('\n\n');
}

export function titleFrom(text: string, attachments: MobileAttachment[]): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean) return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean;
  return attachments.some(a => a.type === 'video') ? '视频复刻' : '新会话';
}
