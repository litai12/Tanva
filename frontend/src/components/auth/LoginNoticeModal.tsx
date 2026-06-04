import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getStoredLastAuthAt } from "@/services/authApi";
import { getLoginNotice, type LoginNotice } from "@/services/loginNoticeApi";
import { useAuthStore } from "@/stores/authStore";
import { useLocaleText } from "@/utils/localeText";
import {
  plainTextToLoginNoticeHtml,
  sanitizeLoginNoticeHtml,
} from "@/utils/loginNoticeRichText";
import {
  openWechatQrPanel,
  shouldOpenWechatQrFromNoticeAction,
} from "@/utils/wechatQrPanel";

const DISMISSED_KEY_PREFIX = "tanva:login-notice:dismissed";

const buildDismissedKey = (
  userId: string,
  authAt: number,
  noticeUpdatedAt: string | null
) => `${DISMISSED_KEY_PREFIX}:${userId}:${authAt}:${noticeUpdatedAt || "none"}`;

const isDismissed = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

const markDismissed = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {}
};

export default function LoginNoticeModal() {
  const user = useAuthStore((state) => state.user);
  const { lt } = useLocaleText();
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const noticeHtml = useMemo(() => {
    if (!notice) return "";
    return sanitizeLoginNoticeHtml(
      notice.contentHtml || plainTextToLoginNoticeHtml(notice.content)
    );
  }, [notice]);
  const hasMedia = Boolean(notice?.mediaUrl);

  useEffect(() => {
    let cancelled = false;
    setNotice(null);
    setDismissedKey(null);
    setVisible(false);

    if (!user?.id) return;

    const authAt = getStoredLastAuthAt();
    if (!authAt) return;

    getLoginNotice()
      .then((nextNotice) => {
        if (cancelled) return;
        const content = nextNotice.content.trim();
        if (!nextNotice.enabled || !content) return;

        const nextDismissedKey = buildDismissedKey(
          user.id,
          authAt,
          nextNotice.updatedAt
        );
        if (isDismissed(nextDismissedKey)) return;

        setNotice(nextNotice);
        setDismissedKey(nextDismissedKey);
        setVisible(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Failed to load login notice:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!visible || !notice) return null;

  const markAndHide = () => {
    if (dismissedKey) {
      markDismissed(dismissedKey);
    }
    setVisible(false);
  };

  const handleAction = (url?: string) => {
    const target = (url || "").trim();
    markAndHide();
    if (!target) return;
    if (/^https?:\/\//i.test(target)) {
      window.open(target, "_blank", "noopener,noreferrer");
      return;
    }
    if (target.startsWith("/")) {
      const targetUrl = new URL(target, window.location.origin);
      if (targetUrl.pathname === location.pathname) return;
      navigate(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
    }
  };

  const primaryText = notice.primaryButtonText.trim();
  const secondaryText = notice.secondaryButtonText.trim() || lt("我知道了", "Got it");
  const handleSecondaryAction = () => {
    if (
      shouldOpenWechatQrFromNoticeAction(
        notice.secondaryButtonUrl,
        secondaryText
      )
    ) {
      markAndHide();
      openWechatQrPanel();
      return;
    }
    handleAction(notice.secondaryButtonUrl);
  };

  return (
    <div
      className='fixed inset-0 z-[1600] flex items-center justify-center bg-black/72 px-4 py-6'
      role='dialog'
      aria-modal='true'
      aria-labelledby='login-notice-title'
    >
      <div className='relative flex max-h-[calc(100vh-56px)] w-[min(94vw,860px)] flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.30)] lg:w-[min(72vw,860px)] lg:min-w-[680px]'>
        <h2 id='login-notice-title' className='sr-only'>
          {lt("用户提醒", "Notice")}
        </h2>
        <div className='relative aspect-[16/9] max-h-[460px] w-full shrink-0 overflow-hidden bg-[#07101d]'>
          {hasMedia && notice.mediaType === "video" ? (
            <video
              className='h-full w-full object-cover'
              src={notice.mediaUrl}
              poster={notice.posterUrl || undefined}
              autoPlay
              muted
              loop
              playsInline
              preload='metadata'
            />
          ) : hasMedia ? (
            <img
              className='h-full w-full object-cover'
              src={notice.mediaUrl}
              alt=''
              draggable={false}
            />
          ) : null}
          {!hasMedia ? (
            <div className='absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(45,82,130,0.72),transparent_35%),linear-gradient(135deg,#030712_0%,#081827_52%,#12313a_100%)]' />
          ) : null}
          <div className='pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/62 to-transparent' />
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto bg-white px-8 pb-5 pt-7 sm:px-10 sm:pb-6 sm:pt-8'>
          <div
            className='break-words text-base font-normal leading-normal text-slate-950 [&_li]:ml-6 [&_li]:list-disc [&_ol>li]:list-decimal [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-3 [&_ol]:my-3'
            dangerouslySetInnerHTML={{ __html: noticeHtml }}
          />
        </div>

        <div
          className={`grid shrink-0 gap-5 bg-white px-8 pb-7 pt-3 sm:px-10 ${
            primaryText ? "sm:grid-cols-2" : "sm:grid-cols-[minmax(280px,520px)] sm:justify-center"
          }`}
        >
          <Button
            type='button'
            onClick={handleSecondaryAction}
            className='h-12 rounded-lg border border-slate-900 bg-white text-base font-semibold text-slate-950 shadow-none hover:bg-slate-50'
          >
            {secondaryText}
          </Button>
          {primaryText ? (
            <Button
              type='button'
              onClick={() => handleAction(notice.primaryButtonUrl)}
              className='h-12 rounded-lg bg-black text-base font-semibold text-white shadow-none hover:bg-slate-900'
            >
              {primaryText}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
