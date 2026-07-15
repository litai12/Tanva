// 小T host_ui 卡片渲染：choices（问题+选项按钮）/ suggestions（chips）/ media（图片视频）。
// 数据来源：aiChatStore runXiaotAgent 把 SSE host_ui 事件写进消息 metadata.xiaotCards /
// metadata.xiaotSuggestions；点击选项/chip 把文本原文作为用户消息发送（小T模式下走 runXiaotAgent）。
import React from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import ImagePreviewModal, {
  type ImageItem,
} from "@/components/ui/ImagePreviewModal";
import { downloadFile } from "@/utils/downloadHelper";

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
        if (card?.kind === "choices") {
          return (
            <ChoicesCard
              key={`choices-${idx}`}
              payload={card.payload}
              onSend={onSend}
              disabled={disabled}
            />
          );
        }
        if (card?.kind === "media") {
          return <MediaCard key={`media-${idx}`} payload={card.payload} />;
        }
        return null;
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
