import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { Loader2, Eye, EyeOff, Check, MessageCircle, RefreshCw } from "lucide-react";
import { authApi, type WechatOfficialLoginSession } from "@/services/authApi";
import { validateInviteCode } from "@/services/referralApi";
import ForgotPasswordModal from "@/components/auth/ForgotPasswordModal";
import { useTranslation } from "react-i18next";
import watchaIcon from "@/assets/1752064513_guan-cha-insights.webp";

export default function LoginPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"wechat" | "password" | "sms">("wechat");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeValid, setInviteCodeValid] = useState<boolean | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false); // 默认不勾选，必须手动同意
  const [wechatSession, setWechatSession] = useState<WechatOfficialLoginSession | null>(null);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [wechatError, setWechatError] = useState<string | null>(null);
  const [wechatConsuming, setWechatConsuming] = useState(false);
  const [wechatBinding, setWechatBinding] = useState(false);
  const wechatConsumingRef = useRef(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, loginWithSms, error, user, setAuthenticatedUser } = useAuthStore();
  const watchaError = searchParams.get("watcha_error");
  const hasAgreedTerms = tab === "wechat" ? true : agreeTerms;

  useEffect(() => {
    if (user) {
      navigate("/app", { replace: true });
    }
  }, [user, navigate]);

  // 已有登录态（cookie/本地缓存）时静默探测并直接跳转项目页。
  // 不用 authStore.init()：它失败时会写入 error，会把「加载失败」渲染进登录表单。
  const probedRef = useRef(false);
  useEffect(() => {
    if (probedRef.current || useAuthStore.getState().user) return;
    probedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { user: me, source } = await authApi.meDetailed();
        if (!cancelled && me) setAuthenticatedUser(me, source || "server");
      } catch {
        // 未登录/探测失败：停留在登录页即可
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setAuthenticatedUser]);

  useEffect(() => {
    if (!watchaError) return;
    window.dispatchEvent(
      new CustomEvent("toast", {
        detail: {
          message: watchaError,
          type: "error",
        },
      })
    );
  }, [watchaError]);

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const poll = async () => {
      if (!wechatSession?.id || wechatConsumingRef.current) return;

      let failed = false;
      let stopped = false;

      try {
        const next = await authApi.getWechatOfficialSessionStatus(wechatSession.id);
        if (cancelled) return;
        setWechatSession(next);
        setWechatError(null);

        if (next.status === "authorized") {
          wechatConsumingRef.current = true;
          setWechatConsuming(true);
          const result = await authApi.consumeWechatOfficialSession(next.id);
          if (cancelled) return;
          setAuthenticatedUser(result.user, "server");
          navigate(result.returnTo || "/app", { replace: true });
          return;
        }
        if (next.status === "expired") {
          // 二维码已过期，停止轮询，等待用户手动刷新
          stopped = true;
          return;
        }
      } catch (err: any) {
        if (cancelled) return;
        failed = true;
        wechatConsumingRef.current = false;
        setWechatConsuming(false);
        setWechatError(t("auth.login.wechatPollFailed"));
      } finally {
        if (!cancelled && !stopped && !failed && wechatSession?.id && !wechatConsumingRef.current) {
          timer = window.setTimeout(poll, 2000);
        }
        // 接口失败不自动重试，停止轮询，由用户点击二维码手动重试
      }
    };

    if (wechatSession?.id) {
      timer = window.setTimeout(poll, 1500);
    }

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [wechatSession?.id, navigate, setAuthenticatedUser, t]);

  const _isMock =
    (typeof import.meta !== "undefined" &&
      (import.meta as any).env?.VITE_AUTH_MODE) === "mock";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "wechat") return;
    if (!hasAgreedTerms) {
      alert(t("auth.agreements.mustAgree"));
      return;
    }
    setIsSubmitting(true);
    try {
      if (tab === "password") {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code || "");
      }
      // 登录成功后，useEffect 会处理跳转到 /app
    } catch (err) {
      console.error("登录失败:", err);
      setIsSubmitting(false);
    }
  };

  const onWatchaLogin = () => {
    window.location.href = authApi.getWatchaAuthorizeUrl("/app");
  };

  const sendSmsCode = async (targetPhone: string) => {
    if (sendCooldown > 0) return;
    if (!targetPhone) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: t("auth.login.phoneRequired"),
            type: "error",
          },
        })
      );
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(targetPhone)) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: t("auth.login.phoneInvalid"),
            type: "error",
          },
        })
      );
      return;
    }
    try {
      await authApi.sendSms({ phone: targetPhone });
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: t("auth.login.smsSent"),
            type: "success",
          },
        })
      );
      setSendCooldown(60);
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: err?.message || t("auth.register.sendFailed"),
            type: "error",
          },
        })
      );
    }
  };

  const handleInviteCodeBlur = async () => {
    if (!inviteCode.trim()) {
      setInviteCodeValid(null);
      setInviterName(null);
      return;
    }
    const result = await validateInviteCode(inviteCode.trim());
    setInviteCodeValid(result.valid);
    if (result.valid && result.inviterName) {
      setInviterName(result.inviterName);
    } else {
      setInviterName(null);
    }
  };

  const submitWechatBind = async () => {
    if (!wechatSession?.id) return;
    if (!phone || !code) {
      setWechatError(t("auth.login.wechatBindIncomplete"));
      return;
    }
    if (inviteCode.trim() && inviteCodeValid === null) {
      const result = await validateInviteCode(inviteCode.trim());
      setInviteCodeValid(result.valid);
      if (result.valid && result.inviterName) {
        setInviterName(result.inviterName);
      } else {
        setInviterName(null);
      }
      if (!result.valid) {
        setWechatError(result.message || t("auth.register.invalidInvite"));
        return;
      }
    } else if (inviteCode.trim() && inviteCodeValid === false) {
      setWechatError(t("auth.register.invalidInvite"));
      return;
    }
    setWechatBinding(true);
    setWechatError(null);
    try {
      const result = await authApi.bindWechatOfficialSessionPhone(wechatSession.id, {
        phone,
        code,
        inviteCode: inviteCode.trim() || undefined,
      });
      setAuthenticatedUser(result.user, "server");
      navigate(result.returnTo || "/app", { replace: true });
    } catch (err: any) {
      setWechatError(err?.message || t("auth.login.wechatBindFailed"));
    } finally {
      setWechatBinding(false);
    }
  };

  const loadWechatSession = async () => {
    setWechatLoading(true);
    setWechatError(null);
    try {
      const session = await authApi.createWechatOfficialSession("/app");
      setWechatSession(session);
    } catch (err: any) {
      setWechatError(err?.message || t("auth.login.wechatLoadFailed"));
    } finally {
      setWechatLoading(false);
    }
  };

  useEffect(() => {
    // wechatError 存在时不自动重建会话（避免接口失败无限重试），由用户点击二维码手动重试
    if (tab !== "wechat" || wechatSession || wechatLoading || wechatConsuming || wechatError) return;
    void loadWechatSession();
  }, [tab, wechatSession, wechatLoading, wechatConsuming, wechatError]);

  // 发送验证码的冷却（秒）
  const [sendCooldown, setSendCooldown] = useState(0);
  useEffect(() => {
    if (sendCooldown <= 0) return;
    const t = setInterval(
      () => setSendCooldown((s) => Math.max(0, s - 1)),
      1000
    );
    return () => clearInterval(t);
  }, [sendCooldown]);

  return (
    <div className='relative flex min-h-screen items-start justify-center overflow-y-auto overflow-x-hidden px-4 py-6 sm:items-center sm:px-6 sm:py-10'>
      {/* 视频背景 */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className='absolute inset-0 w-full h-full object-cover z-[1]'
      >
        <source src='/OpenVideo.mp4' type='video/mp4' />
        {t("auth.videoUnsupported")}
      </video>

      {/* 黑色透明蒙版 */}
      <div className='absolute inset-0 bg-black/50 z-[2]'></div>

      <Card className='relative z-10 my-auto w-full max-w-2xl border border-white/20 bg-white/10 p-4 shadow-2xl backdrop-blur-md sm:p-8'>
        <div className='mb-6 flex items-center justify-center sm:mb-10'>
          <img
            src='/LogoText.svg'
            className='h-7 w-auto brightness-0 invert drop-shadow-lg sm:h-8'
          />
        </div>
        <div className='flex justify-center'>
          <div className='w-full max-w-xl'>
            <div className='mb-6 grid grid-cols-3 gap-2 text-center text-sm sm:mb-8 sm:flex sm:items-center sm:justify-center sm:gap-6'>
              <button
                className={
                  tab === "wechat"
                    ? "rounded-full bg-white/14 px-3 py-2 text-white font-semibold drop-shadow-md transition-all duration-200 sm:bg-transparent sm:px-0 sm:py-0"
                    : "rounded-full px-3 py-2 text-white/70 transition-all duration-200 hover:text-white sm:px-0 sm:py-0"
                }
                onClick={() => setTab("wechat")}
              >
                微信登录
              </button>
              <button
                className={
                  tab === "password"
                    ? "rounded-full bg-white/14 px-3 py-2 text-white font-semibold drop-shadow-md transition-all duration-200 sm:bg-transparent sm:px-0 sm:py-0"
                    : "rounded-full px-3 py-2 text-white/70 transition-all duration-200 hover:text-white sm:px-0 sm:py-0"
                }
                onClick={() => setTab("password")}
              >
                {t("auth.login.passwordTab")}
              </button>
              <button
                className={
                  tab === "sms"
                    ? "rounded-full bg-white/14 px-3 py-2 text-white font-semibold drop-shadow-md transition-all duration-200 sm:bg-transparent sm:px-0 sm:py-0"
                    : "rounded-full px-3 py-2 text-white/70 transition-all duration-200 hover:text-white sm:px-0 sm:py-0"
                }
                onClick={() => setTab("sms")}
              >
                {t("auth.login.smsTab")}
              </button>
            </div>
            {/* 固定高度容器，避免切换时跳跃 */}
            <div className='relative min-h-[280px] transition-[min-height] sm:min-h-[320px] sm:px-16'>
	              {tab === "wechat" ? (
	                <div className='mx-auto flex max-w-sm flex-col items-center px-1 py-3 text-center sm:px-5 sm:py-6'>
	                  {wechatSession?.status !== "needs_phone_bind" ? (
	                    <button
	                      type='button'
	                      className='group relative rounded-2xl bg-white p-2 shadow-xl sm:p-3'
	                      onClick={() => {
	                        setWechatSession(null);
	                        setWechatConsuming(false);
	                        wechatConsumingRef.current = false;
	                        void loadWechatSession();
	                      }}
	                      disabled={wechatLoading}
	                    >
	                      {wechatSession?.qrCodeUrl ? (
	                        <img
	                          src={wechatSession.qrCodeUrl}
	                          alt={t("auth.login.wechatScanAlt")}
	                          className='h-40 w-40 rounded-xl object-cover sm:h-44 sm:w-44'
	                        />
	                      ) : (
	                        <div className='flex h-40 w-40 items-center justify-center rounded-xl bg-slate-100 px-4 text-xs text-slate-500 sm:h-44 sm:w-44'>
	                          {wechatLoading ? t("auth.login.wechatLoading") : t("auth.login.wechatUnavailable")}
	                        </div>
	                      )}
	                      <div className='absolute inset-3 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/40 group-hover:opacity-100'>
	                        <RefreshCw className={`h-5 w-5 text-white ${wechatLoading ? 'animate-spin' : ''}`} />
	                      </div>
	                    </button>
	                  ) : null}
                  <p className='mt-4 text-sm text-white/90'>
                    {wechatConsuming
                      ? t("auth.login.wechatAuthorizing")
                      : wechatBinding
                      ? t("auth.login.wechatBinding")
                      : wechatSession?.status === "needs_phone_bind"
                      ? wechatSession.displayName
                        ? t("auth.login.wechatBindHintWithName", {
                            name: wechatSession.displayName,
                          })
                        : t("auth.login.wechatBindHint")
                      : wechatSession?.status === "expired"
                      ? t("auth.login.wechatExpired")
                      : t("auth.login.wechatHint")}
                  </p>
                  {wechatSession?.status === "needs_phone_bind" ? (
                    <div className='mt-5 w-full space-y-3 text-left'>
                      <Input
                        placeholder={t("auth.login.phonePlaceholder")}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                      />
                      <div className='flex flex-col gap-3 sm:flex-row'>
                        <Input
                          placeholder={t("auth.login.codePlaceholder")}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 flex-1'
                        />
                        <Button
                          type='button'
                          variant='outline'
                          className='h-12 w-full rounded-xl border-white/30 bg-white/20 text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/30 sm:min-w-[112px] sm:w-auto sm:flex-shrink-0 sm:whitespace-nowrap'
                          onClick={() => void sendSmsCode(phone)}
                          disabled={sendCooldown > 0 || wechatBinding}
                        >
                          {sendCooldown > 0
                            ? t("auth.login.resendCode", { seconds: sendCooldown })
                            : t("auth.login.sendCode")}
                        </Button>
                      </div>
                      <Input
                        placeholder={t("auth.register.invitePlaceholder")}
                        value={inviteCode}
                        onChange={(e) => {
                          setInviteCode(e.target.value);
                          setInviteCodeValid(null);
                          setInviterName(null);
                        }}
                        onBlur={() => void handleInviteCodeBlur()}
                        className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                      />
                      {inviteCodeValid !== null ? (
                        <div className='flex items-center gap-2 text-xs'>
                          {inviteCodeValid ? (
                            <Check className='h-4 w-4 text-emerald-300' />
                          ) : (
                            <span className='text-red-300'>{t("auth.register.invalidInvite")}</span>
                          )}
                        </div>
                      ) : null}
                      {inviteCodeValid && inviterName ? (
                        <div className='text-xs text-white/80'>
                          {t("auth.register.inviteFrom", { name: inviterName })}
                        </div>
                      ) : null}
                      <Button
                        type='button'
                        className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
                        onClick={() => void submitWechatBind()}
                        disabled={wechatBinding}
                      >
                        {wechatBinding ? (
                          <>
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                            {t("auth.login.wechatBindSubmitLoading")}
                          </>
                        ) : (
                          t("auth.login.wechatBindSubmit")
                        )}
                      </Button>
                    </div>
                  ) : null}
                  {wechatError ? (
                    <p className='mt-3 text-xs text-red-300'>{wechatError}</p>
                  ) : null}
                </div>
              ) : tab === "password" ? (
                <form onSubmit={onSubmit} className='space-y-5 sm:space-y-6'>
                  <Input
                    placeholder={t("auth.login.phonePlaceholder")}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                  />
                  <div className='relative'>
                    <Input
                      placeholder={t("auth.login.passwordPlaceholder")}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 pr-10'
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors'
                    >
                      {showPassword ? <Eye className='h-5 w-5' /> : <EyeOff className='h-5 w-5' />}
                    </button>
                  </div>
                  {error && (
                    <div className='text-red-400 text-sm drop-shadow-md'>
                      {error}
                    </div>
                  )}
                  <Button
                    type='submit'
                    className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
                    disabled={isSubmitting || !hasAgreedTerms}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {t("auth.login.submitting")}
                      </>
                    ) : (
                      t("auth.login.submit")
                    )}
                  </Button>
                  <div>
                    <div className='flex items-center gap-3 mb-3'>
                      <div className='h-px flex-1 bg-white/40' />
                      <p className='text-xs text-white/70 whitespace-nowrap'>{t("auth.login.otherMethods")}</p>
                      <div className='h-px flex-1 bg-white/40' />
                    </div>
                    <div className='flex justify-center'>
                      <button
                        type='button'
                        onClick={onWatchaLogin}
                        className='p-0 bg-transparent border-0 shadow-none hover:opacity-85 transition-opacity'
                        aria-label={t("auth.login.watchaName")}
                        title={t("auth.login.watchaName")}
                      >
                        <img src={watchaIcon} alt='Watcha' className='h-8 w-8 rounded-full object-cover' />
                      </button>
                    </div>
                  </div>
                  <div className='flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4'>
                    <button
                      onClick={() => setIsForgotPasswordOpen(true)}
                      className='text-left text-white/80 transition-all duration-200 hover:text-white'
                    >
                      {t("auth.login.forgotPassword")}
                    </button>
                    <Link
                      to='/auth/register'
                      className='text-left text-white/80 transition-all duration-200 hover:text-white sm:text-right'
                    >
                      {t("auth.login.registerNow")}
                    </Link>
                  </div>

                  {/* 协议勾选 */}
                  <div className='flex items-start justify-center gap-2 pt-2 sm:items-center'>
                    <button
                      type='button'
                      onClick={() => setAgreeTerms(!agreeTerms)}
                      className={`mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 transition-all sm:mt-0 ${
                        agreeTerms
                          ? 'bg-white border-white'
                          : 'bg-transparent border-white/50'
                      }`}
                    >
                      {agreeTerms && <Check className='w-3 h-3 text-black' />}
                    </button>
                    <label
                      onClick={() => setAgreeTerms(!agreeTerms)}
                      className='cursor-pointer text-left text-xs leading-5 text-white/70'
                    >
                      {t("auth.agreements.prefix")}
                      {" "}
                      <Link to='/legal/terms' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.terms")}</Link>
                      {t("auth.agreements.comma")}
                      <Link to='/legal/privacy' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.privacy")}</Link>
                      {" "}
                      {t("auth.agreements.and")}
                      {" "}
                      <Link to='/legal/community' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.community")}</Link>
                    </label>
                  </div>
                </form>
              ) : (
                <form onSubmit={onSubmit} className='space-y-5 sm:space-y-6'>
                  <Input
                    placeholder={t("auth.login.phonePlaceholder")}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12'
                  />
                  <div className='flex flex-col gap-3 sm:flex-row'>
                    <Input
                      placeholder={t("auth.login.codePlaceholder")}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className='bg-white/20 border-white/30 text-white placeholder:text-white/70 focus:bg-white/25 focus:border-white/50 transition-all duration-200 rounded-xl h-12 flex-1'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      className='h-12 w-full rounded-xl border-white/30 bg-white/20 text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/30 sm:min-w-[112px] sm:w-auto sm:flex-shrink-0 sm:whitespace-nowrap'
                      onClick={() => void sendSmsCode(phone)}
                      disabled={sendCooldown > 0}
                    >
                      {sendCooldown > 0
                        ? t("auth.login.resendCode", { seconds: sendCooldown })
                        : t("auth.login.sendCode")}
                    </Button>
                  </div>
                  {error && (
                    <div className='text-red-400 text-sm drop-shadow-md'>
                      {error}
                    </div>
                  )}
                  <Button
                    type='submit'
                    className='w-full bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-xl h-12 font-medium backdrop-blur-sm transition-all duration-200 disabled:opacity-70 hover:shadow-lg'
                    disabled={isSubmitting || !hasAgreedTerms}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {t("auth.login.submitting")}
                      </>
                    ) : (
                      t("auth.login.submit")
                    )}
                  </Button>
                  <div>
                    <div className='flex items-center gap-3 mb-3'>
                      <div className='h-px flex-1 bg-white/40' />
                      <p className='text-xs text-white/70 whitespace-nowrap'>{t("auth.login.otherMethods")}</p>
                      <div className='h-px flex-1 bg-white/40' />
                    </div>
                    <div className='flex justify-center'>
                      <button
                        type='button'
                        onClick={onWatchaLogin}
                        className='p-0 bg-transparent border-0 shadow-none hover:opacity-85 transition-opacity'
                        aria-label={t("auth.login.watchaName")}
                        title={t("auth.login.watchaName")}
                      >
                        <img src={watchaIcon} alt='Watcha' className='h-9 w-9 rounded-full object-cover' />
                      </button>
                    </div>
                  </div>

                  {/* 协议勾选 */}
                  <div className='flex items-start justify-center gap-2 pt-2 sm:items-center'>
                    <button
                      type='button'
                      onClick={() => setAgreeTerms(!agreeTerms)}
                      className={`mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 transition-all sm:mt-0 ${
                        agreeTerms
                          ? 'bg-white border-white'
                          : 'bg-transparent border-white/50'
                      }`}
                    >
                      {agreeTerms && <Check className='w-3 h-3 text-black' />}
                    </button>
                    <label
                      onClick={() => setAgreeTerms(!agreeTerms)}
                      className='cursor-pointer text-left text-xs leading-5 text-white/70'
                    >
                      {t("auth.agreements.prefix")}
                      {" "}
                      <Link to='/legal/terms' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.terms")}</Link>
                      {t("auth.agreements.comma")}
                      <Link to='/legal/privacy' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.privacy")}</Link>
                      {" "}
                      {t("auth.agreements.and")}
                      {" "}
                      <Link to='/legal/community' className='text-white hover:underline mx-1' target='_blank' onClick={(e) => e.stopPropagation()}>{t("auth.agreements.community")}</Link>
                    </label>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 忘记密码模态框 */}
      <ForgotPasswordModal
        isOpen={isForgotPasswordOpen}
        onClose={() => setIsForgotPasswordOpen(false)}
        onSuccess={() => {
          // 密码重置成功后可以自动切换到密码登录标签页
          setTab("password");
        }}
      />
    </div>
  );
}
