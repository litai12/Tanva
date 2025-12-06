import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';

export default function LoginPage() {
  const [tab, setTab] = useState<'password' | 'sms'>('password');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const { login, loginWithSms, loading, error } = useAuthStore();
  const loadProjects = useProjectStore((s) => s.load);

  const isMock = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_AUTH_MODE) === 'mock';

  const ensureProjectPrepared = async () => {
    await loadProjects();
    const store = useProjectStore.getState();

    if (!store.currentProjectId) {
      if (store.projects.length === 0) {
        try {
          const created = await store.create('未命名');
          store.open(created.id);
        } catch (err) {
          console.error('自动创建项目失败:', err);
        }
      } else {
        const fallback = store.projects[0];
        if (fallback) {
          store.open(fallback.id);
        }
      }
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (tab === 'password') {
        await login(phone, password);
      } else {
        await loginWithSms(phone, code || '');
      }
      await ensureProjectPrepared();
      navigate('/app', { replace: true });
    } catch (err) {
      console.error('登录失败:', err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-sky-50">
      <Card className="w-full max-w-2xl p-8">
        <div className="flex items-center justify-center mb-6">
          <img src="/LogoText.svg" className="h-7 w-auto" />
        </div>
        <div className="flex gap-8">
          <div className="flex-1">
            <div className="flex gap-6 mb-6 text-sm">
              <button className={tab==='password'? 'text-gray-700 font-semibold':'text-slate-400'} onClick={()=>setTab('password')}>密码登录</button>
              <button className={tab==='sms'? 'text-gray-700 font-semibold':'text-slate-400'} onClick={()=>setTab('sms')}>验证码登录</button>
            </div>
            {/* 固定高度容器，避免切换时跳跃 */}
            <div className="relative min-h-[260px] transition-[min-height]">
              {tab === 'password' ? (
                <form onSubmit={onSubmit} className="space-y-4">
                  <Input placeholder="请输入手机号" value={phone} onChange={e=>setPhone(e.target.value)} required />
                  <Input placeholder="请输入密码" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
                  {error && <div className="text-red-500 text-sm">{error}</div>}
                  <Button type="submit" className="w-full bg-gray-700 hover:bg-gray-800 text-white rounded-2xl" disabled={loading}>{loading? '登录中...' : '登录'}</Button>
                  <div className="flex justify-between text-sm text-slate-500">
                    <Link to="#">忘记密码</Link>
                    <Link to="/auth/register">立即注册</Link>
                  </div>
                </form>
              ): (
                <form onSubmit={onSubmit} className="space-y-4">
                  <Input placeholder="请输入手机号" value={phone} onChange={e=>setPhone(e.target.value)} required />
                  <div className="flex gap-2">
                    <Input placeholder="请输入验证码" value={code} onChange={e=>setCode(e.target.value)} />
                    <Button
                      type="button"
                      variant="outline"
                      className="whitespace-nowrap flex-shrink-0 min-w-[64px] rounded-2xl"
                      onClick={async () => {
                        if (!phone) { alert('请输入手机号'); return; }
                        try {
                          await fetch('/api/auth/send-sms', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phone }),
                            credentials: 'include',
                          });
                          setCode('336699');
                          alert('已发送验证码（测试环境固定为 336699）');
                        } catch (e) {
                          alert('发送失败');
                        }
                      }}
                    >
                    发送
                  </Button>
                  </div>
                  {error && <div className="text-red-500 text-sm">{error}</div>}
                  <Button type="submit" className="w-full bg-gray-700 hover:bg-gray-500 text-white rounded-2xl" disabled={loading}>
                    {loading ? '登录中…' : '登录'}
                  </Button>
                </form>
              )}
            </div>
          </div>
          <div className="hidden md:block w-[1px] bg-slate-100" />
          <div className="hidden md:flex flex-col items-center justify-center w-64">
            <div className="h-40 w-40 bg-slate-100 rounded-md flex items-center justify-center text-slate-400">二维码（未开放）</div>
            <div className="mt-2 text-sm text-slate-500">扫码登录</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
