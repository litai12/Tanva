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
import seedanceNoticeImage from "@/assets/SD2.0.png";
import seedanceNoticeVideo from "@/assets/sd2.0.mp4";

const DISMISSED_KEY_PREFIX = "tanva:login-notice:dismissed";
const DEFAULT_SEEDANCE_NOTICE_UPDATED_AT = "seedance-2-default-2026-06-04";
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const buildApiUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

const DEFAULT_SEEDANCE_NOTICE: LoginNotice = {
  enabled: true,
  content:
    "Seedance 2.0 更低价，单条最低约合人民币 0.35 元\n每月满 10000 积分 / 返还 1000 积分\n惊喜直减：6月5日（本周五）全天 10:00-23:59，Seedance2.0 模型限时 3.5 折优惠！\n积分返还：每冲刺 10000 积分，加入社群联系客服，凭积分使用截图获得 1000 积分额外返还，上不封顶！（仅限 Seedance2.0 模型）",
  contentHtml:
    '<p><span style="color:#2563eb"><strong>Seedance 2.0</strong></span> <strong>更低价 单条最低约合人民币 <span style="color:#2563eb">0.35</span> 元</strong></p><p><strong>每月满 10000 积分 / 返还 1000 积分</strong></p><p>· <strong>惊喜直减：</strong>6月5日（本周五）全天 <strong>10:00-23:59</strong>，Seedance2.0 模型限时 <strong>3.5 折优惠！</strong></p><p>· <strong>积分返还：</strong>每冲刺 <strong>10000 积分</strong>，加入社群联系客服，凭积分使用截图获得 <strong>1000 积分</strong> 额外返还，上不封顶！（仅限 Seedance2.0 模型）</p>',
  mediaType: null,
  mediaUrl: "",
  posterUrl: "",
  primaryButtonText: "开始创作",
  primaryButtonUrl: "/app",
  secondaryButtonText: "加入社群 获取积分赠礼",
  secondaryButtonUrl: "/__action__/wechat",
  secondaryButtonQrUrl: "/qrcode-group.png",
  updatedAt: DEFAULT_SEEDANCE_NOTICE_UPDATED_AT,
};

const resolveNotice = (nextNotice: LoginNotice): LoginNotice => {
  const content = nextNotice.content.trim();
  if (nextNotice.enabled && content) return nextNotice;
  return {
    ...DEFAULT_SEEDANCE_NOTICE,
    secondaryButtonQrUrl:
      nextNotice.secondaryButtonQrUrl || DEFAULT_SEEDANCE_NOTICE.secondaryButtonQrUrl,
  };
};

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

const sanitizeNoticeUrl = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(?:javascript|data|blob):/i.test(trimmed)) return "";
  if (/^(?:https?:\/\/|\/)/i.test(trimmed)) return trimmed;
  return "";
};

const getLoginNoticeButtonQrUrl = async () => {
  const response = await fetch(buildApiUrl("/api/settings/wechat-qrcodes"));
  if (!response.ok) return "";
  const data = await response.json().catch(() => ({}));
  return sanitizeNoticeUrl(data?.loginNoticeButton);
};

export default function LoginNoticeModal() {
  const user = useAuthStore((state) => state.user);
  const { lt } = useLocaleText();
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [secondaryQrOpen, setSecondaryQrOpen] = useState(false);
  const [noticeButtonQrUrl, setNoticeButtonQrUrl] = useState("");
  const noticeHtml = useMemo(() => {
    if (!notice) return "";
    return sanitizeLoginNoticeHtml(
      notice.contentHtml || plainTextToLoginNoticeHtml(notice.content)
    );
  }, [notice]);
  const mediaUrl = notice?.mediaUrl || seedanceNoticeVideo;
  const mediaType = notice?.mediaUrl ? notice.mediaType : "video";
  const isDefaultSeedanceNotice =
    notice?.updatedAt === DEFAULT_SEEDANCE_NOTICE_UPDATED_AT;

  useEffect(() => {
    let cancelled = false;
    setNotice(null);
    setDismissedKey(null);
    setVisible(false);
    setSecondaryQrOpen(false);

    if (location.pathname !== "/app") return;
    if (!user?.id) return;

    const authAt = getStoredLastAuthAt();
    if (!authAt) return;
    const showResolvedNotice = (resolvedNotice: LoginNotice) => {
      const nextDismissedKey = buildDismissedKey(
        user.id,
        authAt,
        resolvedNotice.updatedAt
      );
      if (isDismissed(nextDismissedKey)) return;

      setNotice(resolvedNotice);
      setDismissedKey(nextDismissedKey);
      setVisible(true);
    };

    getLoginNotice()
      .then((nextNotice) => {
        if (cancelled) return;
        showResolvedNotice(resolveNotice(nextNotice));
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Failed to load login notice:", error);
          showResolvedNotice(DEFAULT_SEEDANCE_NOTICE);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, user?.id]);

  useEffect(() => {
    let cancelled = false;
    getLoginNoticeButtonQrUrl()
      .then((url) => {
        if (!cancelled && url) {
          setNoticeButtonQrUrl(url);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  const primaryText = isDefaultSeedanceNotice
    ? "开始创作"
    : notice.primaryButtonText.trim();
  const secondaryText = isDefaultSeedanceNotice
    ? "加入社群 获取积分赠礼"
    : notice.secondaryButtonText.trim() || lt("我知道了", "Got it");
  const secondaryButtonQrUrl =
    noticeButtonQrUrl ||
    notice.secondaryButtonQrUrl ||
    (isDefaultSeedanceNotice ? "/qrcode-group.png" : "");
  const handleSecondaryAction = () => {
    if (
      secondaryButtonQrUrl &&
      shouldOpenWechatQrFromNoticeAction(
        notice.secondaryButtonUrl,
        secondaryText
      )
    ) {
      setSecondaryQrOpen(true);
      return;
    }
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
      <div className='relative flex max-h-[calc(100vh-56px)] w-[min(94vw,840px)] flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.30)] lg:w-[min(70vw,840px)] lg:min-w-[680px]'>
        <h2 id='login-notice-title' className='sr-only'>
          {lt("用户提醒", "Notice")}
        </h2>
        <div className='relative aspect-[16/9] max-h-[340px] w-full shrink-0 overflow-hidden bg-[#07101d]'>
          {mediaType === "video" ? (
            <video
              className='h-full w-full scale-[1.05] object-contain'
              src={mediaUrl}
              poster={notice.posterUrl || seedanceNoticeImage}
              autoPlay
              muted
              loop
              playsInline
              preload='metadata'
              onLoadedMetadata={(event) => {
                event.currentTarget.playbackRate = 0.9;
              }}
            />
          ) : (
            <img
              className='h-full w-full object-cover'
              src={mediaUrl}
              alt=''
              draggable={false}
            />
          )}
          <div className='pointer-events-none absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-black/75 via-black/35 to-transparent' />
          {isDefaultSeedanceNotice ? (
            <div className='pointer-events-none absolute bottom-[7%] left-[8%] flex items-baseline gap-2 text-[clamp(28px,3.3vw,44px)] font-black leading-none tracking-normal text-white'>
              <span>Seedance 2.0</span>
              <span className='text-[#e7ff63]'>限时3.5折!</span>
            </div>
          ) : null}
        </div>

        {isDefaultSeedanceNotice ? (
          <div className='min-h-0 flex-1 overflow-y-auto bg-white px-[clamp(28px,4.5vw,56px)] pb-4 pt-[clamp(24px,3vw,36px)]'>
            <div className='max-w-none'>
              <div className='text-[clamp(22px,2.45vw,31px)] font-black leading-[1.36] tracking-normal text-black'>
                <span className='text-[#2563eb]'>Seedance 2.0</span>
                <span> 更低价&nbsp; 单条最低约合人民币</span>
                <span className='text-[#2563eb]'>0.35</span>
                <span>元</span>
                <br />
                <span>每月满10000积分/返还1000积分</span>
              </div>
              <div className='mt-[clamp(14px,1.8vw,22px)] space-y-2 text-[clamp(13px,1.25vw,16px)] font-normal leading-[1.45] tracking-normal text-[#2f2f2f]'>
                <p>
                  <span>· </span>
                  <strong className='font-black text-black'>惊喜直减：</strong>
                  <span> 6月5日（本周五）全天「</span>
                  <strong className='font-black text-black underline underline-offset-2'>00:00-23:59</strong>
                  <span>」，Seedance2.0 模型限时</span>
                  <strong className='font-black text-black underline underline-offset-2'>3.5折</strong>
                  <span>优惠！</span>
                </p>
                <p>
                  <span>· </span>
                  <strong className='font-black text-black'>积分返还：</strong>
                  <span> 每冲刺</span>
                  <strong className='font-black text-black'>10000积分</strong>
                  <span>，加入社群联系客服，凭积分使用截图获得</span>
                  <strong className='font-black text-black'>1000积分</strong>
                  <span>额外返还，上不封顶！（仅限Seedance2.0模型）</span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className='min-h-0 flex-1 overflow-y-auto bg-white px-8 pb-5 pt-7 sm:px-10 sm:pb-6 sm:pt-8'>
            <div
              className='break-words text-base font-normal leading-normal text-slate-950 [&_li]:ml-6 [&_li]:list-disc [&_ol>li]:list-decimal [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-3 [&_ol]:my-3'
              dangerouslySetInnerHTML={{ __html: noticeHtml }}
            />
          </div>
        )}

        <div
          className={`grid shrink-0 bg-white px-[clamp(28px,4.5vw,56px)] pb-[clamp(24px,3.2vw,36px)] pt-2 ${
            primaryText ? "gap-[clamp(20px,3vw,38px)] sm:grid-cols-2" : "sm:grid-cols-[minmax(280px,520px)] sm:justify-center"
          }`}
        >
          <div
            className='relative'
            onMouseEnter={() => secondaryButtonQrUrl && setSecondaryQrOpen(true)}
            onMouseLeave={() => setSecondaryQrOpen(false)}
            onFocus={() => secondaryButtonQrUrl && setSecondaryQrOpen(true)}
            onBlur={() => setSecondaryQrOpen(false)}
          >
            {secondaryQrOpen && secondaryButtonQrUrl ? (
              <div className='absolute bottom-full left-1/2 z-[1700] mb-3 w-40 -translate-x-1/2 rounded-2xl border border-black/10 bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.22)]'>
                <div className='aspect-square w-full rounded-xl bg-white p-1'>
                  <img
                    src={secondaryButtonQrUrl}
                    alt='加入社群二维码'
                    className='h-full w-full object-contain'
                    draggable={false}
                  />
                </div>
                <div className='mt-2 text-center text-xs font-semibold text-slate-700'>
                  扫码加入社群
                </div>
              </div>
            ) : null}
            <Button
              type='button'
              onClick={handleSecondaryAction}
              onPointerDown={() => secondaryButtonQrUrl && setSecondaryQrOpen(true)}
              className='h-[clamp(46px,4.2vw,54px)] w-full rounded-lg border-2 border-black bg-white text-[clamp(15px,1.55vw,20px)] font-black tracking-normal text-black shadow-none hover:bg-slate-50'
            >
              {secondaryText}
            </Button>
          </div>
          {primaryText ? (
            <Button
              type='button'
              onClick={() => handleAction(notice.primaryButtonUrl)}
              className='h-[clamp(46px,4.2vw,54px)] rounded-lg bg-black text-[clamp(15px,1.55vw,20px)] font-black tracking-normal text-white shadow-none hover:bg-slate-900'
            >
              {primaryText}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
