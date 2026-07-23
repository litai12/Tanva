// 小T host_ui 卡片渲染。两类 kind（均在 agentCanvasProtocol.ts 的 manifest.ui 声明，
// 声明与本文件渲染必须一一对应，否则卡片被 facade 降级成纯文本或静默丢弃）：
//   ① 协议级：choices（问题+选项按钮）/ suggestions（chips）/ media（图片视频）
//   ② tc-card 富卡（协议 v1.2）：artifact（可折叠文档卡）/ character_cards（角色卡）/
//      scene_list（场景列表）/ action_banner（推荐操作横幅）/ role_note（角色点评卡）
// 形状权威定义见 TapCanvas-pro apps/agents-cli/src/types/content-blocks.ts。
// 数据来源：aiChatStore runXiaotAgent 把 SSE host_ui 事件写进消息 metadata.xiaotCards /
// metadata.xiaotSuggestions；点击选项/chip 把文本原文作为用户消息发送（小T模式下走 runXiaotAgent）。
import React from "react";
import ReactMarkdown from "react-markdown";
import {
  ChevronDown,
  Copy,
  Download,
  FileText,
  Plus,
  Sparkles,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ImagePreviewModal, {
  type ImageItem,
} from "@/components/ui/ImagePreviewModal";
import { downloadFile } from "@/utils/downloadHelper";
import { resolveAgentNodeId } from "@/services/agentPatchApplier";
import { compatibleRemarkPlugins } from "@/utils/markdownCompatibility";

export interface XiaotCard {
  kind: string;
  payload: unknown;
}

interface XiaotCardsProps {
  cards?: XiaotCard[];
  suggestions?: string[];
  onSend: (text: string) => void;
  disabled?: boolean;
}

interface ChoiceOption {
  label: string;
  description?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const cardShellClass =
  "mt-2 rounded-lg border border-solid border-slate-300 bg-slate-50/80 px-2.5 py-2 text-xs text-slate-700 shadow-sm dark:border-white/20 dark:bg-white/5 dark:text-slate-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]";

const cardTitleClass =
  "mb-1.5 font-medium text-slate-800 dark:text-slate-100";

// 卡片携带 nodeId → 点击聚焦画布节点（对齐 TapCanvas 原生 DataCardViews 的
// focusCanvasNode）。小T 给的 id 可能是它自造的 agent id，先经 idMap 解析成真实
// 节点 id 再派发 flow:focus-node（FlowOverlay 侧监听）。
function focusCanvasNode(nodeId?: string): void {
  const raw = String(nodeId || "").trim();
  if (!raw) return;
  try {
    window.dispatchEvent(
      new CustomEvent("flow:focus-node", { detail: { id: resolveAgentNodeId(raw) } })
    );
  } catch {
    /* ignore */
  }
}

// 卡片内 markdown（文档卡/点评卡正文）：与聊天气泡同款紧凑排版
const cardMarkdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className='mb-1 last:mb-0'>{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className='mb-1 ml-2 list-disc list-inside'>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className='mb-1 ml-2 list-decimal list-inside'>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className='mb-0.5'>{children}</li>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className='mt-1.5 mb-1 text-sm font-bold'>{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className='mt-1.5 mb-1 text-[13px] font-bold'>{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className='mt-1.5 mb-1 text-xs font-semibold'>{children}</h3>
  ),
  // 表格（分镜表/时间轴常用）：窄容器里横向滚动，不撑破气泡
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className='my-1 overflow-x-auto'>
      <table className='w-full border-collapse text-[11px]'>{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className='border border-solid border-slate-300 px-1.5 py-1 text-left font-medium dark:border-white/20'>
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className='border border-solid border-slate-300 px-1.5 py-1 align-top dark:border-white/20'>
      {children}
    </td>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => {
    const url = String(src || "").trim();
    if (!url) return null;
    return (
      <a href={url} target='_blank' rel='noreferrer'>
        <img
          src={url}
          alt={alt || "image"}
          loading='lazy'
          className='my-1 max-w-full rounded-md border border-solid border-slate-200 dark:border-white/15'
        />
      </a>
    );
  },
};

function CardMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className='text-[11px] leading-relaxed'>
      <ReactMarkdown remarkPlugins={compatibleRemarkPlugins} components={cardMarkdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function ChoicesCard({
  payload,
  onSend,
  disabled,
}: {
  payload: unknown;
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const record = asRecord(payload);
  const question = typeof record?.question === "string" ? record.question : "";
  const options: ChoiceOption[] = Array.isArray(record?.options)
    ? (record!.options as unknown[])
        .map((opt): ChoiceOption | null => {
          const o = asRecord(opt);
          if (!o || typeof o.label !== "string" || !o.label.trim()) return null;
          return {
            label: o.label,
            description:
              typeof o.description === "string" ? o.description : undefined,
          };
        })
        .filter((opt): opt is ChoiceOption => opt !== null)
    : [];
  if (options.length === 0) return null;
  return (
    <div className={cardShellClass}>
      {question && (
        <div className='mb-1.5 font-medium text-slate-800 dark:text-slate-100'>{question}</div>
      )}
      <div className='flex flex-col gap-1'>
        {options.map((option, idx) => (
          <button
            key={`${option.label}-${idx}`}
            type='button'
            disabled={disabled}
            onClick={() => onSend(option.label)}
            className={cn(
              "rounded-md border border-solid border-slate-200 bg-white px-2.5 py-1.5 text-left transition-colors dark:border-white/15 dark:bg-white/10",
              disabled
                ? "cursor-not-allowed opacity-50"
                : "hover:border-slate-400 hover:bg-slate-100 dark:hover:border-white/40 dark:hover:bg-white/20"
            )}
          >
            <span className='font-medium text-slate-800 dark:text-slate-100'>{option.label}</span>
            {option.description && (
              <span className='ml-1.5 text-[11px] text-slate-500 dark:text-slate-400'>
                {option.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

interface MediaItem {
  kind: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  title?: string;
}

function MediaCard({ payload }: { payload: unknown }) {
  const record = asRecord(payload);
  const layout = typeof record?.layout === "string" ? record.layout : "grid";
  const items: MediaItem[] = Array.isArray(record?.items)
    ? (record!.items as unknown[])
        .map((item) => {
          const o = asRecord(item);
          if (!o || typeof o.url !== "string" || !o.url.trim()) return null;
          const kind = o.kind === "video" ? "video" : "image";
          return {
            kind,
            url: o.url,
            thumbnailUrl:
              typeof o.thumbnailUrl === "string" ? o.thumbnailUrl : undefined,
            title: typeof o.title === "string" ? o.title : undefined,
          } as MediaItem;
        })
        .filter((item): item is MediaItem => item !== null)
    : [];
  // 预览集合：仅图片可放大浏览（视频保留原生 controls）。用原图 url 作放大源，
  // 缩略图仅用于列表小图。id 用稳定 url+idx，供预览左右切换定位。
  const imageItems = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.kind === "image");
  const collection: ImageItem[] = imageItems.map(({ item, idx }) => ({
    id: `${item.url}-${idx}`,
    src: item.url,
    title: item.title,
  }));
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const activePreview = collection.find((c) => c.id === previewId) || null;

  const handleDownload = React.useCallback(
    (item: MediaItem, idx: number) => {
      const base = (item.title || `小T图片_${idx + 1}`).replace(
        /[\\/:*?"<>|]+/g,
        "_"
      );
      const fileName = /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}.png`;
      void downloadFile(item.url, fileName);
    },
    []
  );

  if (items.length === 0) return null;
  return (
    <div className={cardShellClass}>
      <div
        className={cn(
          layout === "grid" && items.length > 1
            ? "grid grid-cols-2 gap-1.5"
            : "flex flex-col gap-1.5"
        )}
      >
        {items.map((item, idx) => (
          <div key={`${item.url}-${idx}`} className='min-w-0'>
            {item.kind === "video" ? (
              <video
                controls
                preload='metadata'
                src={item.url}
                poster={item.thumbnailUrl}
                className='w-full max-w-full rounded-md border border-solid border-slate-200 dark:border-white/15'
              />
            ) : (
              <div className='group relative'>
                <img
                  src={item.thumbnailUrl || item.url}
                  alt={item.title || "小T媒体"}
                  loading='lazy'
                  className='w-full max-w-full cursor-zoom-in rounded-md border border-solid border-slate-200 dark:border-white/15 object-cover'
                  onClick={() => setPreviewId(`${item.url}-${idx}`)}
                />
                {/* 右下角下载按钮：hover 显示，走同源资产代理下载原图 */}
                <button
                  type='button'
                  title='下载'
                  aria-label='下载图片'
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(item, idx);
                  }}
                  className='absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 hover:bg-black/75 group-hover:opacity-100'
                >
                  <Download className='h-3.5 w-3.5' />
                </button>
              </div>
            )}
            {item.title && (
              <div className='mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400'>
                {item.title}
              </div>
            )}
          </div>
        ))}
      </div>

      {activePreview && (
        <ImagePreviewModal
          isOpen={true}
          imageSrc={activePreview.src}
          imageTitle={activePreview.title}
          onClose={() => setPreviewId(null)}
          imageCollection={collection}
          currentImageId={activePreview.id}
          onImageChange={(id) => setPreviewId(id)}
          collectionTitle='本组图片'
        />
      )}
    </div>
  );
}

/* ── tc-card 富卡（v1.2）：形状对齐 TapCanvas content-blocks.ts ── */

// ① 策划文档卡：默认折叠、点击展开完整 markdown，右上角可复制
function ArtifactCard({ payload }: { payload: unknown }) {
  const record = asRecord(payload);
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const title = typeof record?.title === "string" ? record.title.trim() : "";
  const markdown =
    typeof record?.markdown === "string" ? record.markdown.trim() : "";
  const summaryRaw = record?.summary ?? record?.timestamp;
  const summary = typeof summaryRaw === "string" ? summaryRaw.trim() : "";
  if (!title && !markdown) return null;
  return (
    <div className={cardShellClass}>
      <button
        type='button'
        onClick={() => setExpanded((prev) => !prev)}
        className='flex w-full items-center gap-1.5 text-left'
      >
        <FileText className='h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400' />
        <span className='min-w-0 flex-1'>
          <span className='block truncate font-medium text-slate-800 dark:text-slate-100'>
            {title || "策划文档"}
          </span>
          {summary && (
            <span className='block truncate text-[11px] text-slate-500 dark:text-slate-400'>
              {summary}
            </span>
          )}
        </span>
        <span
          role='button'
          tabIndex={0}
          aria-label='复制文档'
          title={copied ? "已复制" : "复制文档"}
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard
              ?.writeText(markdown)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => undefined);
          }}
          className='shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200'
        >
          <Copy className='h-3.5 w-3.5' />
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      {expanded && markdown && (
        <div className='mt-2 border-t border-solid border-slate-200 pt-2 dark:border-white/15'>
          <CardMarkdown markdown={markdown} />
        </div>
      )}
    </div>
  );
}

// ② 角色卡：横向排列，图占满、名字/语音沉底；带 nodeId 可点击聚焦画布节点
let sharedVoiceAudio: HTMLAudioElement | null = null;
function playVoice(url: string): void {
  if (sharedVoiceAudio) {
    sharedVoiceAudio.pause();
    sharedVoiceAudio = null;
  }
  sharedVoiceAudio = new Audio(url);
  void sharedVoiceAudio.play().catch(() => undefined);
}

function CharacterCards({ payload }: { payload: unknown }) {
  const record = asRecord(payload);
  const items = Array.isArray(record?.items)
    ? (record!.items as unknown[])
        .map((raw) => asRecord(raw))
        .filter(
          (o): o is Record<string, unknown> =>
            !!o && typeof o.name === "string" && !!o.name.trim()
        )
    : [];
  if (items.length === 0) return null;
  const title =
    typeof record?.title === "string" && record.title.trim()
      ? record.title
      : "角色设计";
  return (
    <div className={cardShellClass}>
      <div className={cardTitleClass}>{title}</div>
      <div className='flex gap-1.5 overflow-x-auto pb-0.5'>
        {items.map((item, idx) => {
          const name = String(item.name);
          const image = String(item.thumbnailUrl || item.imageUrl || "").trim();
          const voiceUrl = String(item.voiceUrl || "").trim();
          const nodeId = String(item.nodeId || "").trim();
          return (
            <div
              key={`${name}-${idx}`}
              role={nodeId ? "button" : undefined}
              tabIndex={nodeId ? 0 : undefined}
              title={nodeId ? "点击聚焦画布节点" : item.description ? String(item.description) : undefined}
              onClick={() => focusCanvasNode(nodeId)}
              className={cn(
                "relative w-[74px] shrink-0 overflow-hidden rounded-md border border-solid border-slate-200 bg-white dark:border-white/15 dark:bg-white/10",
                nodeId && "cursor-pointer hover:border-slate-400 dark:hover:border-white/40"
              )}
            >
              {image ? (
                <img
                  src={image}
                  alt={name}
                  loading='lazy'
                  className='h-[74px] w-full object-cover'
                />
              ) : (
                <div className='flex h-[74px] w-full items-center justify-center bg-slate-100 text-base font-medium text-slate-400 dark:bg-white/5'>
                  {name.slice(0, 1)}
                </div>
              )}
              <div className='flex items-center gap-0.5 px-1 py-0.5'>
                <span className='min-w-0 flex-1 truncate text-[10px]'>{name}</span>
                {voiceUrl && (
                  <button
                    type='button'
                    aria-label={`试听 ${name} 的声音`}
                    onClick={(e) => {
                      e.stopPropagation();
                      playVoice(voiceUrl);
                    }}
                    className='shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                  >
                    <Volume2 className='h-3 w-3' />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ③ 场景列表：要点列点 + 缩略图网格 +「新建场景」按钮（发送 newSceneAction 原话）
function SceneListCard({
  payload,
  onSend,
  disabled,
}: {
  payload: unknown;
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const record = asRecord(payload);
  const items = Array.isArray(record?.items)
    ? (record!.items as unknown[])
        .map((raw) => asRecord(raw))
        .filter(
          (o): o is Record<string, unknown> =>
            !!o && typeof o.name === "string" && !!o.name.trim()
        )
    : [];
  if (items.length === 0) return null;
  const title =
    typeof record?.title === "string" && record.title.trim()
      ? record.title
      : "场景列表";
  const newSceneAction =
    typeof record?.newSceneAction === "string" ? record.newSceneAction.trim() : "";
  const withSummary = items.filter(
    (i) => typeof i.summary === "string" && i.summary.trim()
  );
  const withImage = items.filter((i) =>
    String(i.thumbnailUrl || i.imageUrl || "").trim()
  );
  return (
    <div className={cardShellClass}>
      <div className='mb-1.5 flex items-center justify-between gap-2'>
        <span className='font-medium text-slate-800 dark:text-slate-100'>{title}</span>
        {newSceneAction && (
          <button
            type='button'
            disabled={disabled}
            onClick={() => onSend(newSceneAction)}
            className={cn(
              "flex shrink-0 items-center gap-0.5 rounded-full border border-solid border-slate-300 bg-white px-1.5 py-0.5 text-[10px] dark:border-white/25 dark:bg-white/15",
              disabled
                ? "cursor-not-allowed opacity-50"
                : "hover:border-slate-400 hover:bg-slate-100 dark:hover:bg-white/25"
            )}
          >
            <Plus className='h-2.5 w-2.5' /> 新建场景
          </button>
        )}
      </div>
      {withSummary.length > 0 && (
        <ul className='mb-1.5 ml-2 list-disc list-inside'>
          {withSummary.map((item, idx) => (
            <li key={`pt-${idx}`} className='mb-0.5'>
              <strong className='font-medium'>{String(item.name)}：</strong>
              {String(item.summary)}
            </li>
          ))}
        </ul>
      )}
      {withImage.length > 0 && (
        <div className='grid grid-cols-3 gap-1.5'>
          {withImage.map((item, idx) => {
            const nodeId = String(item.nodeId || "").trim();
            const src = String(item.thumbnailUrl || item.imageUrl || "").trim();
            return (
              <div
                key={`scene-${idx}`}
                role={nodeId ? "button" : undefined}
                tabIndex={nodeId ? 0 : undefined}
                title={nodeId ? "点击聚焦画布节点" : undefined}
                onClick={() => focusCanvasNode(nodeId)}
                className={cn(
                  "overflow-hidden rounded-md border border-solid border-slate-200 bg-white dark:border-white/15 dark:bg-white/10",
                  nodeId && "cursor-pointer hover:border-slate-400 dark:hover:border-white/40"
                )}
              >
                <img
                  src={src}
                  alt={String(item.name)}
                  loading='lazy'
                  className='h-14 w-full object-cover'
                />
                <div className='truncate px-1 py-0.5 text-[10px]'>{String(item.name)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ④ 推荐操作横幅：一键执行（发送 action 原话），可带积分价
function ActionBannerCard({
  payload,
  onSend,
  disabled,
}: {
  payload: unknown;
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const record = asRecord(payload);
  const title = typeof record?.title === "string" ? record.title.trim() : "";
  const action = typeof record?.action === "string" ? record.action.trim() : "";
  if (!title || !action) return null;
  const description =
    typeof record?.description === "string" ? record.description.trim() : "";
  const cost = Number(record?.cost);
  return (
    <div className={cn(cardShellClass, "flex items-center gap-2")}>
      <Sparkles className='h-3.5 w-3.5 shrink-0 text-amber-500' />
      <span className='min-w-0 flex-1'>
        <span className='block truncate font-medium text-slate-800 dark:text-slate-100'>
          {title}
        </span>
        {description && (
          <span className='block truncate text-[11px] text-slate-500 dark:text-slate-400'>
            {description}
          </span>
        )}
      </span>
      <button
        type='button'
        disabled={disabled}
        onClick={() => onSend(action)}
        className={cn(
          "shrink-0 rounded-md border border-solid border-slate-300 bg-white px-2 py-1 text-[11px] font-medium dark:border-white/25 dark:bg-white/15",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:border-slate-400 hover:bg-slate-100 dark:hover:bg-white/25"
        )}
      >
        一键执行
        {Number.isFinite(cost) && cost > 0 && (
          <span className='ml-0.5 text-amber-600 dark:text-amber-400'>✦{cost}</span>
        )}
      </button>
    </div>
  );
}

// ⑤ 角色点评卡：智能团某角色在某阶段的专业判断（Tanva 无 teamRoster 头像资源，
// 按名字+类别徽标渲染，不移植 avatar/accent 色）
function RoleNoteCard({ payload }: { payload: unknown }) {
  const record = asRecord(payload);
  const roleName =
    typeof record?.roleName === "string" ? record.roleName.trim() : "";
  const markdown =
    typeof record?.markdown === "string" ? record.markdown.trim() : "";
  if (!roleName || !markdown) return null;
  const label =
    typeof record?.label === "string" ? record.label.trim().toUpperCase() : "";
  const nodeId = Array.isArray(record?.nodeIds)
    ? String(
        (record!.nodeIds as unknown[]).find(
          (id) => typeof id === "string" && id.trim()
        ) || ""
      ).trim()
    : "";
  return (
    <div
      role={nodeId ? "button" : undefined}
      tabIndex={nodeId ? 0 : undefined}
      title={nodeId ? "点击聚焦画布节点" : undefined}
      onClick={() => focusCanvasNode(nodeId)}
      className={cn(
        cardShellClass,
        "border-l-2 border-l-slate-400 dark:border-l-white/40",
        nodeId && "cursor-pointer hover:border-slate-400 dark:hover:border-white/40"
      )}
    >
      <div className='mb-1 flex items-center gap-1.5'>
        <span className='font-medium text-slate-800 dark:text-slate-100'>{roleName}</span>
        {label && (
          <span className='rounded border border-solid border-slate-300 px-1 text-[9px] font-medium tracking-wider text-slate-500 dark:border-white/25 dark:text-slate-400'>
            {label}
          </span>
        )}
      </div>
      <CardMarkdown markdown={markdown} />
    </div>
  );
}

export default function XiaotCards({
  cards,
  suggestions,
  onSend,
  disabled,
}: XiaotCardsProps) {
  const cardList = Array.isArray(cards) ? cards : [];
  const chips = Array.isArray(suggestions)
    ? suggestions.filter((s) => typeof s === "string" && s.trim().length > 0)
    : [];
  if (cardList.length === 0 && chips.length === 0) return null;
  return (
    <div className='text-xs'>
      {cardList.map((card, idx) => {
        const key = `${card?.kind}-${idx}`;
        switch (card?.kind) {
          case "choices":
            return (
              <ChoicesCard
                key={key}
                payload={card.payload}
                onSend={onSend}
                disabled={disabled}
              />
            );
          case "media":
            return <MediaCard key={key} payload={card.payload} />;
          case "artifact":
            return <ArtifactCard key={key} payload={card.payload} />;
          case "character_cards":
            return <CharacterCards key={key} payload={card.payload} />;
          case "scene_list":
            return (
              <SceneListCard
                key={key}
                payload={card.payload}
                onSend={onSend}
                disabled={disabled}
              />
            );
          case "action_banner":
            return (
              <ActionBannerCard
                key={key}
                payload={card.payload}
                onSend={onSend}
                disabled={disabled}
              />
            );
          case "role_note":
            return <RoleNoteCard key={key} payload={card.payload} />;
          default:
            // 声明了 ui 却没渲染实现 = 协议两侧漂移。静默丢弃会让内容凭空消失且难查，
            // 这里留一条可见的开发期线索（manifest.ui 与本文件 switch 必须同步）。
            console.warn("[xiaot] 未实现的卡片 kind，已忽略:", card?.kind);
            return null;
        }
      })}
      {chips.length > 0 && (
        <div className='mt-2 flex flex-wrap gap-1.5'>
          {chips.map((chip, idx) => (
            <button
              key={`${chip}-${idx}`}
              type='button'
              disabled={disabled}
              onClick={() => onSend(chip)}
              className={cn(
                "rounded-full border border-solid border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 transition-colors dark:border-white/25 dark:bg-white/15 dark:text-slate-200",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "hover:border-slate-400 hover:bg-slate-100 dark:hover:border-white/45 dark:hover:bg-white/25"
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
