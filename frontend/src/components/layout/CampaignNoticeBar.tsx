import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAMPAIGN_NOTICE_DEADLINE_MS } from "@/components/layout/campaignNoticeConfig";

type CountdownState = {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

type CampaignNoticeBarProps = {
  className?: string;
  onClose: () => void;
  onExpire?: () => void;
};

const getCountdownState = (): CountdownState => {
  const totalMs = Math.max(0, CAMPAIGN_NOTICE_DEADLINE_MS - Date.now());
  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    totalMs,
    days,
    hours,
    minutes,
    seconds,
  };
};

const pad2 = (value: number) => value.toString().padStart(2, "0");

const DigitGroup = ({ value, label }: { value: string; label?: string }) => (
  <span className="inline-flex items-center gap-0.5">
    {Array.from(value).map((digit, index) => (
      <span
        key={`${digit}-${index}`}
        className="flex h-6 min-w-[18px] items-center justify-center rounded-md bg-[#0f6dff] px-1 text-sm font-bold leading-none text-white shadow-[0_5px_14px_rgba(15,109,255,0.24)]"
      >
        {digit}
      </span>
    ))}
    {label && (
      <span className="ml-0.5 text-xs font-semibold text-[#0f6dff]">
        {label}
      </span>
    )}
  </span>
);

export default function CampaignNoticeBar({
  className,
  onClose,
  onExpire,
}: CampaignNoticeBarProps) {
  const [countdown, setCountdown] = useState<CountdownState>(() =>
    getCountdownState()
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = getCountdownState();
      setCountdown(next);
      if (next.totalMs <= 0) {
        window.clearInterval(timer);
        onExpire?.();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [onExpire]);

  const ariaLabel = useMemo(() => {
    return `距离活动结束还有 ${countdown.days} 天 ${countdown.hours} 小时 ${countdown.minutes} 分 ${countdown.seconds} 秒`;
  }, [countdown.days, countdown.hours, countdown.minutes, countdown.seconds]);

  if (countdown.totalMs <= 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "tanva-campaign-notice-bar relative z-[1400] flex min-h-[var(--tanva-campaign-notice-height)] w-full shrink-0 items-center justify-center overflow-hidden border-b border-blue-200/60 bg-[linear-gradient(90deg,#f8fbff_0%,#eff6ff_38%,#dce9ff_100%)] px-3 text-slate-950 shadow-[0_1px_0_rgba(15,109,255,0.08)]",
        className
      )}
      role="region"
      aria-label="活动通知"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-2 pr-10 text-center sm:gap-3">
        <span className="shrink-0 text-sm font-bold text-[#0f6dff]">
          距活动结束:
        </span>

        <div
          className="flex shrink-0 items-center gap-1 sm:gap-1.5"
          aria-label={ariaLabel}
        >
          <DigitGroup value={pad2(countdown.days)} label="天" />
          <DigitGroup value={pad2(countdown.hours)} />
          <span className="text-sm font-black text-[#0f6dff]">:</span>
          <DigitGroup value={pad2(countdown.minutes)} />
          <span className="text-sm font-black text-[#0f6dff]">:</span>
          <DigitGroup value={pad2(countdown.seconds)} />
        </div>

        <span className="hidden text-sm font-bold text-slate-950 md:inline">
          疯狂星期五！
          <span className="text-[#0f6dff]">Seedance2.0</span>
          限时3.5折！
        </span>
        <span className="hidden text-sm font-bold text-slate-950 lg:inline">
          单条最低约合人民币0.35元！
        </span>
      </div>

      <button
        type="button"
        className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        onClick={onClose}
        aria-label="关闭活动通知"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
