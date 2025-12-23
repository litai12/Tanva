import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/authStore';
import { tokenRefreshManager } from '@/services/tokenRefreshManager';
import { X } from 'lucide-react';

type LoginModalProps = {
  onSuccess?: () => void;
};

export default function LoginModal({ onSuccess }: LoginModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'password' | 'sms'>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, loginWithSms, error: authError } = useAuthStore();

  // 监听 auth-expired 事件
  useEffect(() => {
    const handleAuthExpired = () => {
      console.log('[LoginModal] 收到登录过期事件，显示弹窗');
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
        setIsOpen(true);
      }
    });
    return unsubscribe;
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setLocalError(null);
    setPhone('');
    setPassword('');
    setCode('');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setIsSubmitting(true);

    try {
      if (tab === 'password') {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code);
      }

      // 登录成功，通知 tokenRefreshManager
      tokenRefreshManager.onLoginSuccess();

      // 关闭弹窗
      handleClose();

      // 触发成功回调
      onSuccess?.();
    } catch (err: any) {
      setLocalError(err?.message || '登录失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <span className="text-sm text-slate-500">登录已过期</span>
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
            您的登录状态已过期，请重新登录以继续操作。当前页面内容不会丢失。
          </div>
        </div>

        {/* 登录表单 */}
        <div className="p-6">
          {/* Tab 切换 */}
          <div className="flex gap-6 mb-6 text-sm">
            <button
              type="button"
              className={
                tab === 'password'
                  ? 'text-gray-700 font-semibold'
                  : 'text-slate-400 hover:text-slate-600'
              }
              onClick={() => setTab('password')}
            >
              密码登录
            </button>
            <button
              type="button"
              className={
                tab === 'sms'
                  ? 'text-gray-700 font-semibold'
                  : 'text-slate-400 hover:text-slate-600'
              }
              onClick={() => setTab('sms')}
            >
              验证码登录
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              placeholder="请输入手机号"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />

            {tab === 'password' ? (
              <Input
                placeholder="请输入密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="请输入验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  className="whitespace-nowrap flex-shrink-0 min-w-[64px] rounded-xl"
                  onClick={async () => {
                    if (!phone) {
                      setLocalError('请输入手机号');
                      return;
                    }
                    try {
                      await fetch('/api/auth/send-sms', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone }),
                        credentials: 'include',
                      });
                      setCode('336699');
                      alert('未发送验证码（未开放）');
                    } catch {
                      setLocalError('发送失败');
                    }
                  }}
                >
                  发送
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
              {isSubmitting ? '登录中...' : '重新登录'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
