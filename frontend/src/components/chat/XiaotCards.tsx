// 小T host_ui 卡片渲染：choices（问题+选项按钮）/ suggestions（chips）/ media（图片视频）。
// 数据来源：aiChatStore runXiaotAgent 把 SSE host_ui 事件写进消息 metadata.xiaotCards /
// metadata.xiaotSuggestions；点击选项/chip 把文本原文作为用户消息发送（小T模式下走 runXiaotAgent）。
import React from "react";
import { cn } from "@/lib/utils";

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
  "mt-2 rounded-lg border border-white/35 bg-white/5 px-2.5 py-2 text-xs text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-[2px]";

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
        <div className='mb-1.5 font-medium text-slate-800'>{question}</div>
      )}
      <div className='flex flex-col gap-1'>
        {options.map((option, idx) => (
          <button
            key={`${option.label}-${idx}`}
            type='button'
            disabled={disabled}
            onClick={() => onSend(option.label)}
            className={cn(
              "rounded-md border border-white/30 bg-white/10 px-2.5 py-1.5 text-left transition-colors",
              disabled
                ? "cursor-not-allowed opacity-50"
                : "hover:bg-white/30 hover:border-white/50"
            )}
          >
            <span className='font-medium text-slate-800'>{option.label}</span>
            {option.description && (
              <span className='ml-1.5 text-[11px] text-slate-500'>
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
                className='w-full max-w-full rounded-md border border-white/30'
              />
            ) : (
              <img
                src={item.thumbnailUrl || item.url}
                alt={item.title || "小T媒体"}
                loading='lazy'
                className='w-full max-w-full cursor-pointer rounded-md border border-white/30 object-cover'
                onClick={() =>
                  window.open(item.url, "_blank", "noopener,noreferrer")
                }
              />
            )}
            {item.title && (
              <div className='mt-0.5 truncate text-[11px] text-slate-500'>
                {item.title}
              </div>
            )}
          </div>
        ))}
      </div>
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
                "rounded-full border border-white/35 bg-white/15 px-2.5 py-1 text-[11px] text-slate-700 transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-white/35 hover:border-white/55"
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
