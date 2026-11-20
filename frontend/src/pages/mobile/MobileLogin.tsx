import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { authApi, type WechatOfficialLoginSession } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';
import whiteLogo from '@/assets/tanvas-mark-white.svg';
import WelcomePrompt from './WelcomePrompt';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const PHONE_RE = /^1\d{10}$/;

type LoginMode = 'sms' | 'password' | 'wechat';

const isWeChatBrowser = () =>
  typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '');

export default function MobileLogin() {
  const login = useAuthStore((s) => s.login);
  const loginWithSms = useAuthStore((s) => s.loginWithSms);
  const setAuthenticatedUser = useAuthStore((s) => s.setAuthenticatedUser);

  const [mode, setMode] = useState<LoginMode>('sms');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 微信登录态
  const [wechatSession, setWechatSession] = useState<WechatOfficialLoginSession | null>(null);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [wechatConsuming, setWechatConsuming] = useState(false);
  const [wechatError, setWechatError] = useState('');
  const wechatLoadingRef = useRef(false);
  const wechatConsumingRef = useRef(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const loadWechatSession = useCallback(async () => {
    if (wechatLoadingRef.current) return;
    wechatLoadingRef.current = true;
    setWechatLoading(true);
    setWechatError('');
    setError('');
    try {
      const session = await authApi.createWechatOfficialSession('/m');
      setWechatSession(session);
    } catch (e) {
      setWechatSession(null);
      setWechatError(errMsg(e, '微信登录二维码加载失败，请点击重试'));
    } finally {
      wechatLoadingRef.current = false;
      setWechatLoading(false);
    }
  }, []);

  // 切到微信登录 Tab 时自动拉取二维码
  useEffect(() => {
    if (mode !== 'wechat' || wechatSession || wechatLoading || wechatConsuming || wechatError) return;
    void loadWechatSession();
  }, [mode, wechatSession, wechatLoading, wechatConsuming, wechatError, loadWechatSession]);

  // 轮询微信扫码状态
  useEffect(() => {
    if (mode !== 'wechat' || !wechatSession?.id) return;
    if (wechatSession.status !== 'pending') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || wechatConsumingRef.current) return;
      try {
        const next = await authApi.getWechatOfficialSessionStatus(wechatSession.id);
        if (cancelled) return;
        setWechatSession(next);
        if (next.status === 'authorized') {
          wechatConsumingRef.current = true;
          setWechatConsuming(true);
          try {
            const result = await authApi.consumeWechatOfficialSession(next.id);
            if (!cancelled) setAuthenticatedUser(result.user, 'server');
          } catch (e) {
            if (!cancelled) {
              wechatConsumingRef.current = false;
              setWechatConsuming(false);
              setWechatError(errMsg(e, '微信登录完成失败，请重试'));
            }
          }
          return;
        }
        if (next.status === 'pending') {
          timer = setTimeout(poll, 2000);
        }
      } catch (e) {
        if (!cancelled) setWechatError(errMsg(e, '扫码状态查询失败，请刷新重试'));
      }
    };

    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [mode, wechatSession?.id, wechatSession?.status, setAuthenticatedUser]);

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError('');
  };

  const sendCode = async () => {
    if (!PHONE_RE.test(phone)) { setError('请输入正确的手机号'); return; }
    setError(''); setSending(true);
    try { await authApi.sendSms({ phone }); setCountdown(60); }
    catch (e) { setError(errMsg(e, '验证码发送失败')); }
    finally { setSending(false); }
  };

  const submit = async () => {
    if (!PHONE_RE.test(phone)) { setError('请输入正确的手机号'); return; }
    if (mode === 'sms') {
      if (!/^\d{4,6}$/.test(code)) { setError('请输入验证码'); return; }
    } else if (mode === 'password') {
      if (!password.trim()) { setError('请输入密码'); return; }
    } else if (mode === 'wechat' && wechatSession?.status === 'needs_phone_bind') {
      if (!/^\d{4,6}$/.test(code)) { setError('请输入验证码'); return; }
    }
    if (!agreed) { setError('请先阅读并同意用户协议与隐私政策'); return; }

    setError(''); setSubmitting(true);
    try {
      if (mode === 'sms') {
        await loginWithSms(phone, code);
      } else if (mode === 'password') {
        await login(phone, password);
      } else if (mode === 'wechat' && wechatSession?.id) {
        const result = await authApi.bindWechatOfficialSessionPhone(wechatSession.id, { phone, code });
        setAuthenticatedUser(result.user, 'server');
      }
    } catch (e) {
      setError(errMsg(e, '登录失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !submitting) void submit();
  };

  const field = 'h-12 min-w-0 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-[16px] text-white placeholder:text-white/35 outline-none focus:border-[#4C7DFF]';
  const inWeChat = isWeChatBrowser();
  const needsBindPhone = mode === 'wechat' && wechatSession?.status === 'needs_phone_bind';

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="flex min-h-full flex-col px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))]">
        <main className="flex flex-1 flex-col items-center justify-center py-8">
          <img src={whiteLogo} alt="Tanvas" draggable={false} className="h-[72px] w-[72px] select-none" />
          <h1 className="mt-3 text-center text-[26px] font-bold tracking-tight text-[#ECEAE6]">欢迎使用 Tanvas</h1>
          <div className="mt-2"><WelcomePrompt /></div>

          {/* 登录方式切换 */}
          <div className="mt-7 grid w-full max-w-[400px] grid-cols-3 rounded-2xl border border-white/10 bg-white/[0.05] p-1 text-xs">
            {([
              ['sms', '验证码登录'],
              ['password', '密码登录'],
              ['wechat', '微信登录'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => switchMode(key)}
                className={`h-9 rounded-xl font-medium transition-colors ${
                  mode === key
                    ? 'bg-[#F4F2EE] text-[#141414]'
                    : 'text-white/60 hover:text-white/85'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex w-full min-w-[min(272px,100%)] max-w-[400px] flex-col gap-3">
            {mode === 'wechat' && !needsBindPhone ? (
              <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-6">
                {wechatLoading || wechatConsuming ? (
                  <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.04] text-xs text-white/60">
                    <Loader2 className="h-6 w-6 animate-spin text-white/75" />
                    <span>{wechatConsuming ? '正在登录...' : '正在生成二维码...'}</span>
                  </div>
                ) : wechatSession?.qrCodeUrl && wechatSession.status !== 'expired' ? (
                  <div className="rounded-2xl bg-white p-2.5 shadow-sm">
                    <img
                      src={wechatSession.qrCodeUrl}
                      alt="微信登录二维码"
                      className="h-44 w-44 object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-48 w-48 flex-col items-center justify-center gap-3 rounded-2xl bg-white/[0.04] px-4 text-center">
                    <span className="text-xs text-white/60">
                      {wechatSession?.status === 'expired'
                        ? '二维码已过期'
                        : wechatError || '二维码暂不可用'}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setWechatSession(null); void loadWechatSession(); }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs text-white/90 hover:bg-white/15"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      刷新二维码
                    </button>
                  </div>
                )}

                <p className="mt-4 text-center text-xs leading-5 text-white/65">
                  {inWeChat
                    ? '长按上方二维码识别关注公众号，即可完成快捷登录'
                    : '请使用微信扫一扫（支持 iPad 扫码或截图相册识别）'}
                </p>
                {wechatSession?.qrCodeUrl && wechatSession.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => { setWechatSession(null); void loadWechatSession(); }}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white/75"
                  >
                    <RefreshCw className="h-3 w-3" />
                    换一个二维码
                  </button>
                )}
                {wechatError && wechatSession?.qrCodeUrl && (
                  <div className="mt-2 text-center text-xs text-[#FF7A6B]">{wechatError}</div>
                )}
              </div>
            ) : (
              <>
                {needsBindPhone && (
                  <div className="rounded-2xl border border-[#4C7DFF]/30 bg-[#4C7DFF]/10 px-3.5 py-2.5 text-xs leading-5 text-white/80">
                    已识别微信身份{wechatSession?.nickname ? `（${wechatSession.nickname}）` : ''}，请绑定手机号完成首次登录，后续扫码可直接登录。
                  </div>
                )}

                <input
                  className={field}
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={11}
                  placeholder="手机号"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={handleKeyDown}
                />

                {mode === 'password' ? (
                  <div className="relative">
                    <input
                      className={`${field} pr-12`}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/45 hover:text-white/80"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <input
                      className={field}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="验证码"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={handleKeyDown}
                    />
                    <button
                      type="button"
                      onClick={sendCode}
                      disabled={sending || countdown > 0}
                      className="h-12 shrink-0 rounded-2xl bg-white/10 px-4 text-sm text-white/90 disabled:text-white/40"
                    >
                      {countdown > 0 ? `${countdown}s` : sending ? '发送中' : '获取验证码'}
                    </button>
                  </div>
                )}

                {error && <div className="px-1 text-sm text-[#FF7A6B]">{error}</div>}

                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="mt-2 flex h-12 items-center justify-center gap-2 rounded-full bg-[#F4F2EE] text-[16px] font-medium text-[#141414] disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {needsBindPhone ? '绑定并登录' : '登录'}
                </button>

                <label className="mt-1 flex items-start gap-2 px-1 text-xs leading-5 text-white/45">
                  <input
                    type="checkbox"
                    className="mt-[3px] accent-[#4C7DFF]"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <span>
                    我已阅读并同意 <a className="text-white/70 underline" href="/legal/terms">用户协议</a> 与{' '}
                    <a className="text-white/70 underline" href="/legal/privacy">隐私政策</a>
                  </span>
                </label>
              </>
            )}
          </div>
        </main>

        <div className="pt-4 text-center text-xs text-white/40">
          还没有账号？<a className="text-white/70 underline" href="/auth/register">注册 Tanvas</a>
        </div>
      </div>
    </div>
  );
}
