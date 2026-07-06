import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/authStore';
import { tokenRefreshManager } from '@/services/tokenRefreshManager';
import { Check, Eye, EyeOff, Loader2, MessageCircle, RefreshCw, X } from 'lucide-react';
import { authApi, type WechatOfficialLoginSession } from '@/services/authApi';
import { validateInviteCode } from '@/services/referralApi';
import { useTranslation } from 'react-i18next';

type LoginModalProps = {
  onSuccess?: () => void;
};

type LoginTab = 'wechat' | 'password' | 'sms';

export default function LoginModal({ onSuccess }: LoginModalProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<LoginTab>('wechat');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteCodeValid, setInviteCodeValid] = useState<boolean | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(0);
  const [wechatSession, setWechatSession] = useState<WechatOfficialLoginSession | null>(null);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [wechatError, setWechatError] = useState<string | null>(null);
  const [wechatConsuming, setWechatConsuming] = useState(false);
  const [wechatBinding, setWechatBinding] = useState(false);
  const wechatConsumingRef = useRef(false);

  const { login, loginWithSms, error: authError, setAuthenticatedUser } = useAuthStore();

  // 监听 auth-expired 事件
  useEffect(() => {
    const handleAuthExpired = () => {
      console.log('[LoginModal] 收到登录过期事件，显示弹窗');
      setTab('wechat');
      setIsOpen(true);
    };

    window.addEventListener('auth-expired', handleAuthExpired);
    return () => window.removeEventListener('auth-expired', handleAuthExpired);
  }, []);

  // 监听 tokenRefreshManager 事件
  useEffect(() => {
    const unsubscribe = tokenRefreshManager.subscribe((event) => {
      if (event === 'login-required') {
        console.log('[LoginModal] TokenRefreshManager 请求登录');
        setTab('wechat');
        setIsOpen(true);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setTab('wechat');
    setLocalError(null);
    setPhone('');
    setPassword('');
    setShowPassword(false);
    setCode('');
    setInviteCode('');
    setInviteCodeValid(null);
    setInviterName(null);
    setSendCooldown(0);
    setWechatSession(null);
    setWechatLoading(false);
    setWechatError(null);
    setWechatConsuming(false);
    setWechatBinding(false);
  }, []);

  const loadWechatSession = useCallback(async () => {
    setWechatLoading(true);
    setWechatError(null);
    try {
      const session = await authApi.createWechatOfficialSession('/app');
      setWechatSession(session);
    } catch (err: any) {
      setWechatError(err?.message || t('auth.login.wechatLoadFailed'));
    } finally {
      setWechatLoading(false);
    }
  }, [t]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === 'wechat') return;

    setLocalError(null);
    setIsSubmitting(true);

    try {
      if (tab === 'password') {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code);
      }

      tokenRefreshManager.onLoginSuccess();
      handleClose();
      onSuccess?.();
    } catch (err: any) {
      setLocalError(err?.message || t('auth.modal.loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [handleClose, login, loginWithSms, onSuccess, tab, phone, password, code, t]);

  const sendSmsCode = useCallback(async (targetPhone: string) => {
    if (sendCooldown > 0) return;
    if (!targetPhone) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: t('auth.login.phoneRequired'), type: 'error' } }));
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(targetPhone)) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: t('auth.login.phoneInvalid'), type: 'error' } }));
      return;
    }
    try {
      await authApi.sendSms({ phone: targetPhone });
      setLocalError(null);
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: t('auth.login.smsSent'), type: 'success' } }));
      setSendCooldown(60);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: err?.message || t('auth.register.sendFailed'), type: 'error' } }));
    }
  }, [sendCooldown, t]);

  const bindWechatPhone = useCallback(async () => {
    if (!wechatSession?.id) return;
    if (!phone || !code) {
      setWechatError(t('auth.login.wechatBindIncomplete'));
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
        setWechatError(result.message || t('auth.register.invalidInvite'));
        return;
      }
    } else if (inviteCode.trim() && inviteCodeValid === false) {
      setWechatError(t('auth.register.invalidInvite'));
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
      setAuthenticatedUser(result.user, 'server');
      tokenRefreshManager.onLoginSuccess();
      handleClose();
      onSuccess?.();
    } catch (err: any) {
      setWechatError(err?.message || t('auth.login.wechatBindFailed'));
    } finally {
      setWechatBinding(false);
    }
  }, [code, handleClose, inviteCode, inviteCodeValid, onSuccess, phone, setAuthenticatedUser, t, wechatSession?.id]);

  const handleInviteCodeBlur = useCallback(async () => {
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
  }, [inviteCode]);

  useEffect(() => {
    if (!isOpen || tab !== 'wechat' || wechatSession || wechatLoading || wechatConsuming || wechatError) return;
    void loadWechatSession();
  }, [isOpen, tab, wechatSession, wechatLoading, wechatConsuming, wechatError, loadWechatSession]);

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const poll = async () => {
      if (!wechatSession?.id || wechatConsumingRef.current || !isOpen || tab !== 'wechat') return;

      let failed = false;
      let stopped = false;

      try {
        const next = await authApi.getWechatOfficialSessionStatus(wechatSession.id);
        if (cancelled) return;

        setWechatSession(next);
        setWechatError(null);

        if (next.status === 'authorized') {
          wechatConsumingRef.current = true;
          setWechatConsuming(true);
          const result = await authApi.consumeWechatOfficialSession(next.id);
          if (cancelled) return;
          setAuthenticatedUser(result.user, 'server');
          tokenRefreshManager.onLoginSuccess();
          handleClose();
          onSuccess?.();
          return;
        }

        if (next.status === 'expired') {
          // 二维码已过期，停止轮询，等待用户手动刷新
          stopped = true;
          return;
        }
      } catch (err: any) {
        if (cancelled) return;
        failed = true;
        wechatConsumingRef.current = false;
        setWechatConsuming(false);
        setWechatError(t('auth.login.wechatPollFailed'));
      } finally {
        if (!cancelled && !stopped && !failed && isOpen && tab === 'wechat' && wechatSession?.id && !wechatConsumingRef.current) {
          timer = window.setTimeout(poll, 2000);
        }
        // 接口失败不自动重试，停止轮询，由用户点击二维码手动重试
      }
    };

    if (isOpen && tab === 'wechat' && wechatSession?.id && wechatSession.status !== 'expired') {
      timer = window.setTimeout(poll, 1500);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [handleClose, isOpen, onSuccess, setAuthenticatedUser, t, tab, wechatSession]);

  useEffect(() => {
    if (sendCooldown <= 0) return;
    const timer = setInterval(() => setSendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [sendCooldown]);

  if (!isOpen) return null;

  const displayError = localError || authError;

  const modalContent = (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <img src="/LogoText.svg" className="h-6 w-auto" alt="Tanva" />
            <span className="text-sm text-slate-500">{t('auth.modal.expiredTitle')}</span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* 提示信息 */}
        <div className="px-6 pt-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
            {t('auth.modal.expiredHint')}
          </div>
        </div>

        {/* 登录表单 */}
        <div className="p-6">
          {/* Tab 切换 */}
          <div className="flex gap-6 mb-6 text-sm">
            <button
              type="button"
              className={
                tab === 'wechat'
                  ? 'text-gray-700 font-semibold'
                  : 'text-slate-400 hover:text-slate-600'
              }
              onClick={() => {
                setLocalError(null);
                setTab('wechat');
              }}
            >
              微信登录
            </button>
            <button
              type="button"
              className={
                tab === 'password'
                  ? 'text-gray-700 font-semibold'
                  : 'text-slate-400 hover:text-slate-600'
              }
              onClick={() => {
                setLocalError(null);
                setTab('password');
              }}
            >
              {t('auth.login.passwordTab')}
            </button>
            <button
              type="button"
              className={
                tab === 'sms'
                  ? 'text-gray-700 font-semibold'
                  : 'text-slate-400 hover:text-slate-600'
              }
              onClick={() => {
                setLocalError(null);
                setTab('sms');
              }}
            >
              {t('auth.login.smsTab')}
            </button>
          </div>

          {tab === 'wechat' ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center px-2 py-2 text-center">
                <button
                  type="button"
                  className="group relative rounded-2xl bg-white p-3 shadow-sm"
                  onClick={() => {
                    setWechatSession(null);
                    setWechatConsuming(false);
                    setWechatError(null);
                    wechatConsumingRef.current = false;
                    void loadWechatSession();
                  }}
                  disabled={wechatLoading}
                >
                  {wechatSession?.qrCodeUrl ? (
                    <img
                      src={wechatSession.qrCodeUrl}
                      alt={t('auth.login.wechatScanAlt')}
                      className="h-44 w-44 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-44 w-44 items-center justify-center rounded-xl bg-slate-100 px-4 text-xs text-slate-500">
                      {wechatLoading ? t('auth.login.wechatLoading') : t('auth.login.wechatUnavailable')}
                    </div>
                  )}
                  <div className="absolute inset-3 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/40 group-hover:opacity-100">
                    <RefreshCw className={`h-5 w-5 text-white ${wechatLoading ? 'animate-spin' : ''}`} />
                  </div>
                </button>
                <p className="mt-4 text-sm text-slate-700">
                  {wechatConsuming
                    ? t('auth.login.wechatAuthorizing')
                    : wechatBinding
                    ? t('auth.login.wechatBinding')
                    : wechatSession?.status === 'needs_phone_bind'
                    ? wechatSession.displayName
                      ? t('auth.login.wechatBindHintWithName', {
                          name: wechatSession.displayName,
                        })
                      : t('auth.login.wechatBindHint')
                    : wechatSession?.status === 'expired'
                    ? t('auth.login.wechatExpired')
                    : t('auth.login.wechatHint')}
                </p>
                {wechatSession?.status === 'needs_phone_bind' ? (
                  <div className="mt-4 w-full space-y-3 text-left">
                    <Input
                      placeholder={t('auth.login.phonePlaceholder')}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Input
                        placeholder={t('auth.login.codePlaceholder')}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="whitespace-nowrap flex-shrink-0 min-w-[64px] rounded-xl"
                        onClick={() => void sendSmsCode(phone)}
                        disabled={sendCooldown > 0 || wechatBinding}
                      >
                        {sendCooldown > 0
                          ? t('auth.login.resendCode', { seconds: sendCooldown })
                          : t('auth.login.sendCode')}
                      </Button>
                    </div>
                    <Input
                      placeholder={t('auth.register.invitePlaceholder')}
                      value={inviteCode}
                      onChange={(e) => {
                        setInviteCode(e.target.value);
                        setInviteCodeValid(null);
                        setInviterName(null);
                      }}
                      onBlur={() => void handleInviteCodeBlur()}
                    />
                    {inviteCodeValid !== null ? (
                      <div className="flex items-center gap-2 text-xs">
                        {inviteCodeValid ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <span className="text-red-500">{t('auth.register.invalidInvite')}</span>
                        )}
                      </div>
                    ) : null}
                    {inviteCodeValid && inviterName ? (
                      <div className="text-xs text-slate-500">
                        {t('auth.register.inviteFrom', { name: inviterName })}
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      className="w-full bg-gray-700 hover:bg-gray-800 text-white rounded-xl"
                      onClick={() => void bindWechatPhone()}
                      disabled={wechatBinding}
                    >
                      {wechatBinding ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('auth.login.wechatBindSubmitLoading')}
                        </>
                      ) : (
                        t('auth.login.wechatBindSubmit')
                      )}
                    </Button>
                  </div>
                ) : null}
                {wechatError ? <p className="mt-3 text-xs text-red-500">{wechatError}</p> : null}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                placeholder={t('auth.login.phonePlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />

              {tab === 'password' ? (
                <div className="relative">
                  <Input
                    placeholder={t('auth.login.passwordPlaceholder')}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder={t('auth.login.codePlaceholder')}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="whitespace-nowrap flex-shrink-0 min-w-[64px] rounded-xl"
                    onClick={() => void sendSmsCode(phone)}
                    disabled={sendCooldown > 0}
                  >
                    {sendCooldown > 0
                      ? t('auth.login.resendCode', { seconds: sendCooldown })
                      : t('auth.login.sendCode')}
                  </Button>
                </div>
              )}

              {displayError && (
                <div className="text-red-500 text-sm">{displayError}</div>
              )}

              <Button
                type="submit"
                className="w-full bg-gray-700 hover:bg-gray-800 text-white rounded-xl"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('auth.login.submitting')}
                  </>
                ) : (
                  t('auth.modal.relogin')
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
