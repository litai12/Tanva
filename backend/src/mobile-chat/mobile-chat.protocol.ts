// 移动端 /m 对话协议（纯函数，便于单测）。
// 对话经小T（TapCanvas /public/v1/chat/completions），用 capability manifest v1.3 hostTools 声明两项宿主能力；
// 模型回传 host_tool 后由 Tanva 后端调用 video-productions 执行，TapCanvas 侧不生成媒体（generationMode 默认 host）。
import { BadRequestException } from '@nestjs/common';
import { MOBILE_HOST_NAME } from '../agent/xiaot-host-context';

export const MOBILE_TOOL_FILM = 'tanva_make_video';
export const MOBILE_TOOL_REMAKE = 'tanva_remake_video';
export const MOBILE_TOOL_IMAGE = 'tanva_generate_image';
export const MAX_IMAGES_PER_CALL = 4;
export const MOBILE_TOOL_DETAIL = 'tanva_detail_page';
export const MAX_DETAIL_SECTIONS = 10;
export const MOBILE_RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'] as const;
export const MOBILE_IMAGE_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'] as const;
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
      {
        name: MOBILE_TOOL_IMAGE,
        description: '生成图片：按描述生成图片（海报、插画、产品图、头像、长图等），可参考用户上传的图片做改图/换风格/融合。',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: '完整的画面描述（主体、场景、构图、风格、光线、文字内容等），用户描述简短时自行补全' },
            referenceImageUrls: { type: 'array', items: { type: 'string' }, description: '用户提供的参考图 URL，只能用用户消息里出现过的地址' },
            aspectRatio: { type: 'string', enum: [...MOBILE_IMAGE_RATIOS], description: '画幅，默认 1:1；长图用 9:16，横幅用 16:9' },
            count: { type: 'integer', minimum: 1, maximum: MAX_IMAGES_PER_CALL, description: '张数，默认 1' },
          },
          required: ['prompt'],
        },
      },
      {
        name: MOBILE_TOOL_DETAIL,
        description: '多图详情页 / 多屏长图：把一个商品或主题拆成多屏（首屏主图、卖点、细节、场景、参数、售后等），每屏内容不同、整套风格统一，可再拼成一张长图。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '这套详情页的名称，如「XX 保温杯详情页」' },
            style: { type: 'string', description: '整套统一的视觉风格：主色/辅色、字体气质、版式、背景、光线、品牌元素，每屏都会套用' },
            sections: {
              type: 'array', minItems: 2, maxItems: MAX_DETAIL_SECTIONS,
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '本屏名称，如「首屏主图」「核心卖点」「细节特写」「规格参数」' },
                  prompt: { type: 'string', description: '本屏完整画面描述，含要出现的中文文案（标题、卖点短句），文字要少而大' },
                },
                required: ['title', 'prompt'],
              },
              description: `按从上到下的顺序，2–${MAX_DETAIL_SECTIONS} 屏`,
            },
            aspectRatio: { type: 'string', enum: [...MOBILE_IMAGE_RATIOS], description: '每屏画幅，默认 3:4（手机详情页常用）；需要更长的单屏用 9:16' },
            product: { type: 'string', description: '商品外观锁定（每屏逐字套用）：这套图里只有这一件商品，每屏都画它。只写看得见的结构：外形与高宽比、主色、盖/口/按键/开合方式、配件有或无（提绳、吸管、挂扣等，没有就写“无”）、logo 文字与位置、表面工艺。用户给了商品图就照图写；没给图就由你定下，卖点里提到的结构必须写进来' },
            referenceImageUrls: { type: 'array', items: { type: 'string' }, description: '用户提供的商品/品牌参考图 URL，每屏都会参考；本会话之前给过的商品图也要带上' },
            productChanged: { type: 'boolean', description: '只有这次换成了另一件商品（和本会话之前的详情页不是同一件）才填 true；补充规格、改文案、重做都不填' },
          },
          required: ['sections'],
        },
      },
    ],
    notes: [
      `你是 Tanvas 移动端的创作助手，提供三项能力：一键成片（故事/文案 → 成片）、一键复刻（参考视频 → 复刻成片）和生成图片。用户要单张图片（海报、插画、头像、改图等）时调用 host_tool ${MOBILE_TOOL_IMAGE}；要详情页、多屏长图、一套多张内容不同的图时调用 host_tool ${MOBILE_TOOL_DETAIL}，按内容拆成多屏，不要用 ${MOBILE_TOOL_IMAGE} 的 count 代替（count 只出同一描述的多个版本）。画布编辑、文档制作等其它请求，礼貌说明移动端暂不支持。`,
      `同一个详情页任务里所有屏画的是同一件商品：用户给了商品图，每屏都以它为准；没给图，宿主会先按 product 生成一张商品定妆图，再让每屏都参考它。同一会话里补充规格、改文案、重做详情页仍是同一件商品，宿主会自动沿用上一套详情页的商品参考图，不要另编一件；换成另一件商品时才填 productChanged=true。`,
      `用户给出故事、文案或题材并想要成片时，调用 host_tool ${MOBILE_TOOL_FILM}；信息足够就直接调用，不要反复追问。只有一句题材时自行扩写成完整故事后调用。`,
      `用户提供参考视频（附件或视频直链）并要求复刻时，调用 host_tool ${MOBILE_TOOL_REMAKE}。抖音/小红书等分享链接暂不支持，请用户下载后上传视频文件。`,
      '工具参数中的 URL 只能取自用户消息中的【用户附件】或用户正文里的地址，禁止编造或改写。用户本条消息附带的图片会由宿主自动交给工具（复刻时作为替换主体/新角色/产品参考），你仍应在 requirements 里写清每张图的用途。',
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

/**
 * 合并参考图：模型给的（须是本会话用户给过的地址）∪ 用户本条消息附带的图片。
 * 2026-11-11 线上：用户附图说“用图中车替换”，模型调用工具时漏传了图，复刻照抄了原片车辆——附件不能依赖模型转述。
 */
function mergedImages(args: Record<string, unknown>, userUrls: Set<string>, turn: MobileAttachment[], max: number): string[] {
  const fromModel = Array.isArray(args.referenceImageUrls)
    ? args.referenceImageUrls.slice(0, max).map((u, i) => allowed(u, userUrls, `参考图 ${i + 1}`)) : [];
  return [...new Set([...turn.filter(a => a.type === 'image').map(a => a.url), ...fromModel])].slice(0, max);
}

/** 把模型的 host_tool 参数转成 /api/video-productions 请求体；URL 必须是用户给过的，本条消息的附件由宿主直接补入。 */
export function toProductionRequest(name: string, args: Record<string, unknown>, userUrls: Set<string>, turn: MobileAttachment[] = []): Record<string, unknown> {
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const ratio = typeof args.aspectRatio === 'string' && (MOBILE_RATIOS as readonly string[]).includes(args.aspectRatio) ? args.aspectRatio : undefined;
  const images = mergedImages(args, userUrls, turn, 12);
  const requirements = str(args.requirements, 20_000);
  // 不指定 videoModel：沿用 TapCanvas 规划给的模型（如 Seedance 2.5），提示词与参考图数量都是按它写的。
  if (name === MOBILE_TOOL_FILM) {
    const story = str(args.story, 200_000);
    if (!story) throw new BadRequestException('一键成片缺少故事内容');
    const seconds = Number(args.targetSeconds);
    return {
      mode: 'film', story, aspectRatio: ratio || '9:16', resolution: '720P',
      ...(images.length ? { referenceImageUrls: images } : {}),
      ...(Number.isFinite(seconds) && seconds >= 4 && seconds <= 180 ? { targetSeconds: Math.round(seconds) } : {}),
      ...(requirements ? { requirements } : {}),
    };
  }
  if (name === MOBILE_TOOL_REMAKE) {
    const turnVideos = turn.filter(a => a.type === 'video');
    const given = httpUrl(args.referenceVideoUrl);
    const video = given && userUrls.has(given) ? given
      : turnVideos.length === 1 ? turnVideos[0].url : allowed(args.referenceVideoUrl, userUrls, '参考视频');
    return {
      mode: 'remake', referenceVideoUrl: video, resolution: '720P',
      ...(ratio ? { aspectRatio: ratio } : {}),
      ...(images.length ? { referenceImageUrls: images } : {}),
      ...(requirements ? { requirements } : {}),
    };
  }
  throw new BadRequestException(`未知的宿主工具：${name}`);
}

export type DetailRequest = {
  title: string; style: string; product: string; productChanged: boolean; aspectRatio: string; referenceImageUrls: string[];
  sections: Array<{ title: string; prompt: string }>;
};

export function toDetailRequest(args: Record<string, unknown>, userUrls: Set<string>, turn: MobileAttachment[] = []): DetailRequest {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  let raw: unknown = args.sections ?? args.screens ?? args.pages;
  if (typeof raw === 'string') { const text = raw; try { raw = JSON.parse(text); } catch { raw = text.split(/\n+/).filter(Boolean); } }
  const list = Array.isArray(raw) ? raw : [];
  // 兼容模型常见写法：字符串数组，或用 content/description/text/画面 等字段名。
  const sections = list.slice(0, MAX_DETAIL_SECTIONS).map((s: any, i: number) => {
    if (typeof s === 'string') return { title: `第 ${i + 1} 屏`, prompt: str(s, 4_000) };
    const prompt = str(s?.prompt ?? s?.content ?? s?.description ?? s?.text ?? s?.desc ?? s?.detail ?? s?.copy, 4_000);
    return { title: str(s?.title ?? s?.name ?? s?.heading ?? s?.section, 40) || `第 ${i + 1} 屏`, prompt };
  }).filter(s => s.prompt);
  if (sections.length < 2) throw new BadRequestException('详情页至少需要 2 屏内容');
  const aspectRatio = typeof args.aspectRatio === 'string' && (MOBILE_IMAGE_RATIOS as readonly string[]).includes(args.aspectRatio) ? args.aspectRatio : '3:4';
  return { title: str(args.title, 60) || '详情页', style: str(args.style, 2_000), product: str(args.product, 2_000),
    productChanged: args.productChanged === true, aspectRatio, sections,
    referenceImageUrls: mergedImages(args, userUrls, turn, 10) };
}

/**
 * 同一会话的详情页沿用同一件商品：本轮既没附图、模型也没传图，且没声明换商品时，
 * 取最近一套详情页实际用过的商品参考图（用户商品图或宿主生成的定妆图）。
 * 2026-11-12 线上：首轮附了商品图，次轮补规格重做详情页没再附图，7 屏画成了 7 种杯子。
 */
export function previousProductReferences(history: Array<{ kind?: string | null; attachments?: unknown }>): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.kind !== 'image_set') continue;
    const refs = (m.attachments as { productReferenceUrls?: unknown } | null)?.productReferenceUrls;
    if (Array.isArray(refs) && refs.length) return refs.filter((u): u is string => typeof u === 'string' && !!httpUrl(u)).slice(0, 10);
  }
  return [];
}

/** 没有商品图时先出的商品定妆图：只给各屏当外观参考，不进详情页、不拼长图。 */
export function detailAnchorPrompt(req: DetailRequest): string {
  return [
    `商品定妆图（电商详情页「${req.title}」的商品外观参考，不是详情页中的一屏）。`,
    req.product ? `商品：${req.product}` : `商品：${req.title.replace(/详情页$/, '')}`,
    '画面：纯白 #FFFFFF 背景上并排三视图——同一件商品的正面、侧面、关键结构特写（如盖子开合、按键、接口）；商品占画面 60–70%，柔和棚拍光，材质、颜色、logo 清晰。',
    '不要：任何文字、标题、标签、道具、手、人物、场景、阴影以外的装饰。',
  ].join('\n');
}

/** 每屏实际提交的提示词：统一风格 + 本屏内容 + 位置，保证整套看起来是同一张详情页。 */
export function detailSectionPrompt(req: DetailRequest, index: number): string {
  const s = req.sections[index];
  return [
    `电商详情页「${req.title}」第 ${index + 1}/${req.sections.length} 屏：${s.title}。`,
    req.style ? `整套统一风格：${req.style}` : '',
    req.product ? `商品（每屏都是同一件，结构不得改变）：${req.product}` : '',
    `本屏画面：${s.prompt}`,
    '要求：与同一套详情页其它屏保持完全一致的配色、字体、版式与光线；画面完整居中，上下边缘留出与相邻屏衔接的空间；文字清晰可读、不出现乱码。',
    req.referenceImageUrls.length ? '商品外观、颜色、结构与标识严格以参考图为准：参考图就是这件商品本身，不得改变外形、盖型、配件、logo 与颜色；文字描述与参考图冲突时以参考图为准。' : '',
  ].filter(Boolean).join('\n');
}

export type ImageRequest = { prompt: string; referenceImageUrls: string[]; aspectRatio: string; count: number };

export function toImageRequest(args: Record<string, unknown>, userUrls: Set<string>, turn: MobileAttachment[] = []): ImageRequest {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim().slice(0, 8_000) : '';
  if (!prompt) throw new BadRequestException('生成图片缺少画面描述');
  const aspectRatio = typeof args.aspectRatio === 'string' && (MOBILE_IMAGE_RATIOS as readonly string[]).includes(args.aspectRatio) ? args.aspectRatio : '1:1';
  const n = Math.round(Number(args.count));
  const count = Number.isFinite(n) ? Math.min(MAX_IMAGES_PER_CALL, Math.max(1, n)) : 1;
  return { prompt, referenceImageUrls: mergedImages(args, userUrls, turn, 10), aspectRatio, count };
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
