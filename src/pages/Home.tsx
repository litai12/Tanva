import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import AccountBadge from '@/components/AccountBadge';

export default function Home() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-sky-50 text-slate-800">
      <header className="max-w-6xl mx-auto flex items-center justify-between py-6 px-4">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="TAI" className="h-8 w-8" />
          <span className="font-semibold text-2xl tracking-wide">TAI</span>
        </div>
        <nav className="flex items-center gap-4">
          <AccountBadge />
          <Link className="text-slate-600 hover:text-slate-900" to="/docs">文档</Link>
          <Link className="text-sky-600 hover:underline" to="/oss">OSS Demo</Link>
          <Button variant="ghost" onClick={() => navigate('/auth/login')}>登录</Button>
          <Button onClick={() => navigate('/auth/register')}>注册</Button>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-12 pb-24">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">探索创作之境</h1>
          <p className="mt-4 text-slate-600">专业绘图与 AI 创作平台，轻松开启你的灵感旅程</p>
        </div>
        <div className="mx-auto max-w-3xl bg-white/70 backdrop-blur border rounded-2xl shadow-sm p-8">
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <div className="flex-1 min-w-[240px] border rounded-xl p-6 hover:shadow transition">
              <h3 className="text-lg font-semibold mb-2">开始对话</h3>
              <p className="text-sm text-slate-600 mb-4">体验 AI 助手优化与生成</p>
              <Button onClick={() => navigate('/app')}>立即体验</Button>
            </div>
            <div className="flex-1 min-w-[240px] border rounded-xl p-6 hover:shadow transition">
              <h3 className="text-lg font-semibold mb-2">账户中心</h3>
              <p className="text-sm text-slate-600 mb-4">登录或注册，进入工作区</p>
              <div className="flex gap-3">
                <Button onClick={() => navigate('/auth/login')}>登录</Button>
                <Button variant="outline" onClick={() => navigate('/auth/register')}>注册</Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t py-8 text-center text-sm text-slate-500">© {new Date().getFullYear()} TAI</footer>
    </div>
  );
}
