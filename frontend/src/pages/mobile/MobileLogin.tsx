import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authApi } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';
import whiteLogo from '@/assets/tanvas-mark-white.svg';
import WelcomePrompt from './WelcomePrompt';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const PHONE_RE = /^1\d{10}$/;

export default function MobileLogin() {
  const loginWithSms = useAuthStore((s) => s.loginWithSms);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const sendCode = async () => {
    if (!PHONE_RE.test(phone)) { setError('请输入正确的手机号'); return; }
    setError(''); setSending(true);
    try { await authApi.sendSms({ phone }); setCountdown(60); }
    catch (e) { setError(errMsg(e, '验证码发送失败')); }
    finally { setSending(false); }
  };

  const submit = async () => {
    if (!PHONE_RE.test(phone)) { setError('请输入正确的手机号'); return; }
    if (!/^\d{4,6}$/.test(code)) { setError('请输入验证码'); return; }
    if (!agreed) { setError('请先阅读并同意用户协议与隐私政策'); return; }
    setError(''); setSubmitting(true);
    try { await loginWithSms(phone, code); }
    catch (e) { setError(errMsg(e, '登录失败')); }
    finally { setSubmitting(false); }
  };

  const field = 'h-12 min-w-0 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-[16px] text-white placeholder:text-white/35 outline-none focus:border-[#4C7DFF]';

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="flex min-h-full flex-col px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))]">
      <main className="flex flex-1 flex-col items-center justify-center py-8">
        <img src={whiteLogo} alt="Tanvas" draggable={false} className="h-[72px] w-[72px] select-none" />
        <h1 className="mt-3 text-center text-[26px] font-bold tracking-tight text-[#ECEAE6]">欢迎使用 Tanvas</h1>
        <div className="mt-2"><WelcomePrompt /></div>

      <div className="mt-8 flex w-full min-w-[min(272px,100%)] max-w-[400px] flex-col gap-3">
        <input className={field} inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="手机号"
          value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} />
        <div className="flex gap-3">
          <input className={field} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="验证码"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button type="button" onClick={sendCode} disabled={sending || countdown > 0}
            className="h-12 shrink-0 rounded-2xl bg-white/10 px-4 text-sm text-white/90 disabled:text-white/40">
            {countdown > 0 ? `${countdown}s` : sending ? '发送中' : '获取验证码'}
          </button>
        </div>
        {error && <div className="px-1 text-sm text-[#FF7A6B]">{error}</div>}
        <button type="button" onClick={submit} disabled={submitting}
          className="mt-2 flex h-12 items-center justify-center gap-2 rounded-full bg-[#F4F2EE] text-[16px] font-medium text-[#141414] disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}登录
        </button>
        <label className="mt-1 flex items-start gap-2 px-1 text-xs leading-5 text-white/45">
          <input type="checkbox" className="mt-[3px] accent-[#4C7DFF]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            我已阅读并同意 <a className="text-white/70 underline" href="/legal/terms">用户协议</a> 与{' '}
            <a className="text-white/70 underline" href="/legal/privacy">隐私政策</a>
          </span>
        </label>
      </div>
      </main>

      <div className="pt-4 text-center text-xs text-white/40">
        还没有账号？<a className="text-white/70 underline" href="/auth/register">注册 Tanvas</a>
      </div>
      </div>
    </div>
  );
}
