import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
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
import { CAMPAIGN_NOTICE_DETAIL_EVENT } from "@/utils/campaignNoticeDetail";
import { isSeedance20FreeEnabled } from "@/utils/seedanceFree";
import seedanceNoticeImage from "@/assets/SD2.0.png";
import seedanceNoticeVideo from "@/assets/sd2.0.mp4";
import tanvasAiNoticeImage from "@/assets/TanvasAI.png";

const DISMISSED_KEY_PREFIX = "tanva:login-notice:dismissed";
// 限时免费活动开启时换一个 updatedAt，避免沿用「3.5折」版本已被用户关闭的记录，
// 让免费文案能重新弹出。
const SEEDANCE20_FREE = isSeedance20FreeEnabled();
const DEFAULT_SEEDANCE_NOTICE_UPDATED_AT = SEEDANCE20_FREE
  ? "seedance-2-free-2026-06-05"
  : "seedance-2-default-2026-06-04";
// 顶部高亮角标：免费活动 vs 3.5 折
const SEEDANCE20_HIGHLIGHT = SEEDANCE20_FREE ? "限时免费!" : "限时3.5折!";
const CONTEST_DETAIL_URL =
  "https://mp.weixin.qq.com/s/E-WqYdpy-9bU5gtw0xQI4g";
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";
type DefaultNoticeSlide = "seedance" | "contest";
type LoginNoticeQrUrls = {
  loginNoticeButton: string;
  wechatGroup: string;
  contestRegistration: string;
};

const buildApiUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

const DEFAULT_SEEDANCE_NOTICE: LoginNotice = {
  enabled: true,
  content: SEEDANCE20_FREE
    ? "Seedance 2.0 限时免费，生成视频 0 积分！\n每月满 10000 积分 / 返还 1000 积分\n限时免费：活动期间 Seedance2.0 模型生成视频全程免费，0 积分畅玩！\n积分返还：每冲刺 10000 积分，加入社群联系客服，凭积分使用截图获得 1000 积分额外返还，上不封顶！（仅限 Seedance2.0 模型）"
    : "Seedance 2.0 更低价，每秒最低约合人民币 0.35 元\n每月满 10000 积分 / 返还 1000 积分\n惊喜直减：6月5日（本周五）全天 10:00-23:59，Seedance2.0 模型限时 3.5 折优惠！\n积分返还：每冲刺 10000 积分，加入社群联系客服，凭积分使用截图获得 1000 积分额外返还，上不封顶！（仅限 Seedance2.0 模型）",
  contentHtml: SEEDANCE20_FREE
    ? '<p><span style="color:#2563eb"><strong>Seedance 2.0</strong></span> <strong>限时免费 生成视频 <span style="color:#2563eb">0</span> 积分！</strong></p><p><strong>每月满 10000 积分 / 返还 1000 积分</strong></p><p>· <strong>限时免费：</strong>活动期间 Seedance2.0 模型生成视频 <strong>全程免费，0 积分畅玩！</strong></p><p>· <strong>积分返还：</strong>每冲刺 <strong>10000 积分</strong>，加入社群联系客服，凭积分使用截图获得 <strong>1000 积分</strong> 额外返还，上不封顶！（仅限 Seedance2.0 模型）</p>'
    : '<p><span style="color:#2563eb"><strong>Seedance 2.0</strong></span> <strong>更低价 每秒最低约合人民币 <span style="color:#2563eb">0.35</span> 元</strong></p><p><strong>每月满 10000 积分 / 返还 1000 积分</strong></p><p>· <strong>惊喜直减：</strong>6月5日（本周五）全天 <strong>10:00-23:59</strong>，Seedance2.0 模型限时 <strong>3.5 折优惠！</strong></p><p>· <strong>积分返还：</strong>每冲刺 <strong>10000 积分</strong>，加入社群联系客服，凭积分使用截图获得 <strong>1000 积分</strong> 额外返还，上不封顶！（仅限 Seedance2.0 模型）</p>',
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

const getLoginNoticeQrUrls = async (): Promise<LoginNoticeQrUrls> => {
  const response = await fetch(
    buildApiUrl(`/api/settings/wechat-qrcodes?_t=${Date.now()}`)
  );
  if (!response.ok) {
    return {
      loginNoticeButton: "",
      wechatGroup: "",
      contestRegistration: "",
    };
  }
  const data = await response.json().catch(() => ({}));
  return {
    loginNoticeButton: sanitizeNoticeUrl(data?.loginNoticeButton),
    wechatGroup: sanitizeNoticeUrl(data?.wechatGroup),
    contestRegistration: sanitizeNoticeUrl(
      data?.contestRegistration ||
        data?.contestRegistrationQrUrl ||
        data?.contestRegistrationQrCode ||
        data?.contest_registration_qrcode
    ),
  };
};

function NoticeQrImage({ label, url }: { label: string; url: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url) {
    return (
      <div className='flex h-full w-full items-center justify-center rounded-lg bg-slate-100 px-3 text-center text-xs font-semibold leading-relaxed text-slate-400'>
        未配置
      </div>
    );
  }

  if (failed) {
    return (
      <div className='flex h-full w-full items-center justify-center rounded-lg bg-slate-100 px-3 text-center text-xs font-semibold leading-relaxed text-slate-400'>
        图片加载失败
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=''
      aria-label={`${label}二维码`}
      className='block h-full w-full object-contain'
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

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
  const [wechatGroupQrUrl, setWechatGroupQrUrl] = useState("");
  const [contestRegistrationQrUrl, setContestRegistrationQrUrl] = useState("");
  const [defaultSlide, setDefaultSlide] =
    useState<DefaultNoticeSlide>("seedance");
  const seedanceVideoRef = useRef<HTMLVideoElement | null>(null);
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
  const applyLoginNoticeQrUrls = useCallback((urls: LoginNoticeQrUrls) => {
    if (urls.loginNoticeButton) {
      setNoticeButtonQrUrl(urls.loginNoticeButton);
    }
    if (urls.wechatGroup) {
      setWechatGroupQrUrl(urls.wechatGroup);
    }
    if (urls.contestRegistration) {
      setContestRegistrationQrUrl(urls.contestRegistration);
    }
  }, []);

  const refreshLoginNoticeQrUrls = useCallback(async () => {
    try {
      applyLoginNoticeQrUrls(await getLoginNoticeQrUrls());
    } catch {}
  }, [applyLoginNoticeQrUrls]);

  useEffect(() => {
    let cancelled = false;
    setNotice(null);
    setDismissedKey(null);
    setVisible(false);
    setSecondaryQrOpen(false);
    setDefaultSlide("seedance");

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

      setDefaultSlide("seedance");
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
    void refreshLoginNoticeQrUrls();
  }, [refreshLoginNoticeQrUrls]);

  useEffect(() => {
    const handleOpenCampaignNoticeDetail = () => {
      void refreshLoginNoticeQrUrls();
      setNotice(DEFAULT_SEEDANCE_NOTICE);
      setDismissedKey(null);
      setSecondaryQrOpen(false);
      setDefaultSlide("seedance");
      setVisible(true);
    };

    window.addEventListener(
      CAMPAIGN_NOTICE_DETAIL_EVENT,
      handleOpenCampaignNoticeDetail
    );
    return () => {
      window.removeEventListener(
        CAMPAIGN_NOTICE_DETAIL_EVENT,
        handleOpenCampaignNoticeDetail
      );
    };
  }, [refreshLoginNoticeQrUrls]);

  useEffect(() => {
    if (!visible || !isDefaultSeedanceNotice || defaultSlide !== "seedance") {
      return;
    }
    const video = seedanceVideoRef.current;
    if (!video) return;
    try {
      video.currentTime = 0;
    } catch {}
    void video.play().catch(() => {});
  }, [defaultSlide, isDefaultSeedanceNotice, visible]);

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
    ? ""
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
      void refreshLoginNoticeQrUrls();
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
  const handleContestDetailAction = () => {
    handleAction(CONTEST_DETAIL_URL);
  };
  const showSeedanceSlide = () => {
    setSecondaryQrOpen(false);
    setDefaultSlide("seedance");
  };
  const showContestSlide = () => {
    void refreshLoginNoticeQrUrls();
    setSecondaryQrOpen(false);
    setDefaultSlide("contest");
  };
  const openSecondaryQrPopover = () => {
    void refreshLoginNoticeQrUrls();
    setSecondaryQrOpen(true);
  };
  const openContestQrPopover = () => {
    void refreshLoginNoticeQrUrls();
    setSecondaryQrOpen(true);
  };
  const qrPopover = secondaryQrOpen && secondaryButtonQrUrl ? (
    <div className='absolute bottom-full left-1/2 z-[1700] mb-3 w-40 -translate-x-1/2 rounded-2xl border border-black/10 bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.22)]'>
      <div className='aspect-square w-full rounded-xl bg-white p-1'>
        <NoticeQrImage label='加入社群' url={secondaryButtonQrUrl} />
      </div>
      <div className='mt-2 text-center text-xs font-semibold text-slate-700'>
        扫码加入社群
      </div>
    </div>
  ) : null;
  const contestGroupQrUrl = noticeButtonQrUrl || wechatGroupQrUrl || "/qrcode-group.png";
  const contestQrItems = [
    { label: "赛事报名", url: contestRegistrationQrUrl },
    { label: "赛事交流群", url: contestGroupQrUrl },
  ];
  const contestQrPopover =
    secondaryQrOpen && contestQrItems.length > 0 ? (
      <div
        className='absolute bottom-full left-1/2 z-[1700] mb-3 w-[21rem] -translate-x-1/2 rounded-2xl border border-black/10 bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.22)]'
      >
        <div className='grid grid-cols-2 gap-3'>
          {contestQrItems.map((item) => (
            <div key={item.label} className='min-w-0'>
              <div className='aspect-square w-full rounded-xl bg-white p-1'>
                <NoticeQrImage label={item.label} url={item.url} />
              </div>
              <div className='mt-2 text-center text-xs font-semibold text-slate-700'>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;
  const closeButton = (
    <button
      type='button'
      onClick={markAndHide}
      className='absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-white/60'
      aria-label='关闭弹窗'
    >
      <X className='h-5 w-5' />
    </button>
  );

  const seedanceHeadline = SEEDANCE20_FREE ? (
    <>
      <span className='text-[#2563eb]'>Seedance 2.0</span>
      <span> 限时免费&nbsp; 生成视频</span>
      <span className='text-[#2563eb]'>0</span>
      <span>积分</span>
      <br />
      <span>每日用满10000积分/返还1000积分</span>
    </>
  ) : (
    <>
      <span className='text-[#2563eb]'>Seedance 2.0</span>
      <span> 更低价&nbsp; 每秒最低约合人民币</span>
      <span className='text-[#2563eb]'>0.35</span>
      <span>元</span>
      <br />
      <span>每日用满10000积分/返还1000积分</span>
    </>
  );

  const seedancePromoLine = SEEDANCE20_FREE ? (
    <p>
      <span>·  </span>
      <strong className='font-black text-black'> 限时免费：</strong>
      <span> 活动期间 Seedance2.0 模型生成视频</span>
      <strong className='font-black text-black underline underline-offset-2'>全程免费</strong>
      <span>，</span>
      <strong className='font-black text-black underline underline-offset-2'>0 积分</strong>
      <span>畅玩！</span>
    </p>
  ) : (
    <p>
      <span>·  </span>
      <strong className='font-black text-black'> 惊喜直减：</strong>
      <span> 6月5日（本周五）全天「</span>
      <strong className='font-black text-black underline underline-offset-2'>00:00-23:59</strong>
      <span>」，Seedance2.0 模型限时</span>
      <strong className='font-black text-black underline underline-offset-2'>3.5折</strong>
      <span>优惠！</span>
    </p>
  );

  if (isDefaultSeedanceNotice) {
    return (
      <div
        className='fixed inset-0 z-[1600] flex items-center justify-center bg-black/72 px-4 py-6'
        role='dialog'
        aria-modal='true'
        aria-labelledby='login-notice-title'
      >
        <div className='relative max-h-[calc(100vh-56px)] w-[min(94vw,840px)] overflow-hidden rounded-[12px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.30)] lg:w-[min(70vw,840px)] lg:min-w-[680px]'>
          <h2 id='login-notice-title' className='sr-only'>
            {lt("用户提醒", "Notice")}
          </h2>
          {closeButton}

          <div
            className='flex transition-transform duration-500 ease-out'
            style={{
              transform:
                defaultSlide === "contest" ? "translateX(-100%)" : "translateX(0)",
            }}
          >
            <div
              className='flex w-full shrink-0 flex-col bg-white'
              aria-hidden={defaultSlide !== "seedance"}
            >
              <div className='relative aspect-[16/9] max-h-[340px] w-full shrink-0 overflow-hidden bg-[#07101d]'>
                <video
                  ref={seedanceVideoRef}
                  className='h-full w-full scale-[1.05] object-contain'
                  src={seedanceNoticeVideo}
                  poster={seedanceNoticeImage}
                  autoPlay
                  muted
                  playsInline
                  preload='metadata'
                  onEnded={showContestSlide}
                  onLoadedMetadata={(event) => {
                    event.currentTarget.playbackRate = 0.9;
                  }}
                />
                <div className='pointer-events-none absolute inset-x-0 bottom-0 h-[56%] bg-gradient-to-t from-black/95 via-black/72 via-55% to-transparent' />
                <div className='pointer-events-none absolute bottom-[7%] left-[6.5%] flex items-baseline gap-2 text-[clamp(26px,3.05vw,40px)] font-black leading-none tracking-normal text-white'>
                  <span>Seedance 2.0</span>
                  <span className='text-[#e7ff63]'>{SEEDANCE20_HIGHLIGHT}</span>
                </div>
                <button
                  type='button'
                  onClick={showContestSlide}
                  className='absolute right-4 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/30 text-white backdrop-blur-sm transition hover:bg-white/40 focus:outline-none focus:ring-2 focus:ring-white/70'
                  aria-label='查看 Tanvas AI 创作公开赛'
                >
                  <ChevronRight className='h-6 w-6' />
                </button>
              </div>

              <div className='min-h-0 flex-1 overflow-y-auto bg-white px-[clamp(28px,4.5vw,56px)] pb-4 pt-[clamp(24px,3vw,36px)]'>
                <div className='max-w-none'>
                  <div className='text-[clamp(20px,2.3vw,28px)] font-black leading-[1.36] tracking-normal text-black'>
                    {seedanceHeadline}
                  </div>
                  <div className='mt-[clamp(14px,1.8vw,22px)] space-y-2 text-[clamp(13px,1.25vw,16px)] font-normal leading-[1.45] tracking-normal text-[#2f2f2f]'>
                    {seedancePromoLine}
                    <p>
                      <span>·  </span>
                      <strong className='font-black text-black'> 积分返还：</strong>
                      <span> 每冲刺</span>
                      <strong className='font-black text-black'>10000积分</strong>
                      <span>，加入社群联系客服，凭积分使用截图获得</span>
                      <strong className='font-black text-black'>1000积分</strong>
                      <span>额外返还，上不封顶！（仅限Seedance2.0模型）</span>
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={`grid shrink-0 bg-white px-[clamp(28px,4.5vw,56px)] pb-[clamp(24px,3.2vw,36px)] pt-2 ${
                  primaryText ? "gap-[clamp(20px,3vw,38px)] sm:grid-cols-2" : "sm:grid-cols-[minmax(280px,520px)] sm:justify-center"
                }`}
              >
                <div
                  className='relative'
                  onMouseEnter={() => secondaryButtonQrUrl && openSecondaryQrPopover()}
                  onMouseLeave={() => setSecondaryQrOpen(false)}
                  onFocus={() => secondaryButtonQrUrl && openSecondaryQrPopover()}
                  onBlur={() => setSecondaryQrOpen(false)}
                >
                  {qrPopover}
                  <Button
                    type='button'
                    onClick={handleSecondaryAction}
                    onPointerDown={() => secondaryButtonQrUrl && openSecondaryQrPopover()}
                    className='h-[clamp(46px,4.2vw,54px)] w-full rounded-lg border-2 border-black bg-white text-[clamp(14px,1.35vw,18px)] font-normal tracking-normal text-black shadow-none hover:bg-slate-50'
                  >
                    {secondaryText}
                  </Button>
                </div>
                {primaryText ? (
                  <Button
                    type='button'
                    onClick={() => handleAction(notice.primaryButtonUrl)}
                    className='h-[clamp(46px,4.2vw,54px)] rounded-lg bg-black text-[clamp(14px,1.35vw,18px)] font-normal tracking-normal text-white shadow-none hover:bg-slate-900'
                  >
                    {primaryText}
                  </Button>
                ) : null}
              </div>
            </div>

            <div
              className='flex w-full shrink-0 flex-col bg-white'
              aria-hidden={defaultSlide !== "contest"}
            >
              <div className='relative aspect-[16/9] max-h-[340px] w-full shrink-0 overflow-hidden bg-[#07101d]'>
                <img
                  className='h-full w-full object-cover'
                  src={tanvasAiNoticeImage}
                  alt=''
                  draggable={false}
                />
                <div className='pointer-events-none absolute inset-x-0 bottom-0 h-[54%] bg-gradient-to-t from-black/90 via-black/52 to-transparent' />
                <div className='pointer-events-none absolute bottom-[7%] left-[6%] right-[5%] text-[clamp(25px,2.65vw,35px)] font-black leading-none tracking-normal text-white'>
                  2026 Tanvas AI 全球AI创意自由创作公开赛
                </div>
                <button
                  type='button'
                  onClick={showSeedanceSlide}
                  className='absolute left-4 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/30 text-white backdrop-blur-sm transition hover:bg-white/40 focus:outline-none focus:ring-2 focus:ring-white/70'
                  aria-label='返回 Seedance 2.0 活动'
                >
                  <ChevronLeft className='h-6 w-6' />
                </button>
              </div>

              <div className='min-h-0 flex-1 overflow-y-auto bg-white px-[clamp(28px,4.5vw,56px)] pb-4 pt-[clamp(24px,3vw,36px)]'>
                <div className='text-[clamp(20px,2.3vw,28px)] font-black leading-[1.36] tracking-normal text-black'>
                  参赛赢百万算力 | 全年会员 | 商业签约 | 丰厚奖金
                </div>
                <div className='mt-[clamp(14px,1.8vw,22px)] space-y-2 text-[clamp(11px,1.25vw,14px)] font-medium leading-[1.45] tracking-normal text-[#4b4b4b]'>
                  <p>
                    <span className='mr-2'>📌</span>
                    <span>赛程设置： 初赛➡️晋级赛➡️决赛三轮选拔，7月31日于横琴举办线下颁奖典礼;</span>
                  </p>
                  <p>
                    <span className='mr-2'>🔹</span>
                    <span>5组分组设置（分组独立评审、分开评奖）：小学组、中学组、高中组、高校在读组、以及社会人士组;</span>
                  </p>
                  <p>
                    <span className='mr-2'>✍</span>
                    <span>全程配套Tanvas AI 免费线上系统教学+专属答疑，腾讯会议直播授课，小白也能快速上手AI创作。</span>
                  </p>
                </div>
              </div>

              <div className='grid shrink-0 gap-[clamp(20px,3vw,38px)] bg-white px-[clamp(28px,4.5vw,56px)] pb-[clamp(24px,3.2vw,36px)] pt-2 sm:grid-cols-2'>
                <div
                  className='relative'
                  onMouseEnter={openContestQrPopover}
                  onMouseLeave={() => setSecondaryQrOpen(false)}
                  onFocus={openContestQrPopover}
                  onBlur={() => setSecondaryQrOpen(false)}
                >
                  {contestQrPopover}
                  <Button
                    type='button'
                    onClick={openContestQrPopover}
                    onPointerDown={openContestQrPopover}
                    className='h-[clamp(46px,4.2vw,54px)] w-full rounded-lg border-2 border-black bg-white text-[clamp(14px,1.35vw,18px)] font-normal tracking-normal text-black shadow-none hover:bg-slate-50'
                  >
                    赛事报名 | 加入赛事交流群
                  </Button>
                </div>
                <Button
                  type='button'
                  onClick={handleContestDetailAction}
                  className='h-[clamp(46px,4.2vw,54px)] rounded-lg bg-black text-[clamp(14px,1.35vw,18px)] font-normal tracking-normal text-white shadow-none hover:bg-slate-900'
                >
                  获取赛事详细信息
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className='fixed inset-0 z-[1600] flex items-center justify-center bg-black/72 px-4 py-6'
      role='dialog'
      aria-modal='true'
      aria-labelledby='login-notice-title'
    >
      <div className='relative flex max-h-[calc(100vh-56px)] w-[min(94vw,840px)] flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.30)] lg:w-[min(70vw,840px)] lg:min-w-[680px]'>
        {closeButton}
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
          <div className='pointer-events-none absolute inset-x-0 bottom-0 h-[56%] bg-gradient-to-t from-black/95 via-black/72 via-55% to-transparent' />
          {isDefaultSeedanceNotice ? (
            <div className='pointer-events-none absolute bottom-[7%] left-[6.5%] flex items-baseline gap-2 text-[clamp(26px,3.05vw,40px)] font-black leading-none tracking-normal text-white'>
              <span>Seedance 2.0</span>
              <span className='text-[#e7ff63]'>{SEEDANCE20_HIGHLIGHT}</span>
            </div>
          ) : null}
        </div>

        {isDefaultSeedanceNotice ? (
          <div className='min-h-0 flex-1 overflow-y-auto bg-white px-[clamp(28px,4.5vw,56px)] pb-4 pt-[clamp(24px,3vw,36px)]'>
            <div className='max-w-none'>
              <div className='text-[clamp(20px,2.3vw,28px)] font-black leading-[1.36] tracking-normal text-black'>
                {seedanceHeadline}
              </div>
              <div className='mt-[clamp(14px,1.8vw,22px)] space-y-2 text-[clamp(13px,1.25vw,16px)] font-normal leading-[1.45] tracking-normal text-[#2f2f2f]'>
                {seedancePromoLine}
                <p>
                  <span>·  </span>
                  <strong className='font-black text-black'> 积分返还：</strong>
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
            onMouseEnter={() => secondaryButtonQrUrl && openSecondaryQrPopover()}
            onMouseLeave={() => setSecondaryQrOpen(false)}
            onFocus={() => secondaryButtonQrUrl && openSecondaryQrPopover()}
            onBlur={() => setSecondaryQrOpen(false)}
          >
            {qrPopover}
            <Button
              type='button'
              onClick={handleSecondaryAction}
              onPointerDown={() => secondaryButtonQrUrl && openSecondaryQrPopover()}
              className='h-[clamp(46px,4.2vw,54px)] w-full rounded-lg border-2 border-black bg-white text-[clamp(14px,1.35vw,18px)] font-normal tracking-normal text-black shadow-none hover:bg-slate-50'
            >
              {secondaryText}
            </Button>
          </div>
          {primaryText ? (
            <Button
              type='button'
              onClick={() => handleAction(notice.primaryButtonUrl)}
              className='h-[clamp(46px,4.2vw,54px)] rounded-lg bg-black text-[clamp(14px,1.35vw,18px)] font-normal tracking-normal text-white shadow-none hover:bg-slate-900'
            >
              {primaryText}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
