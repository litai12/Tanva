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
          <Link className="text-purple-600 hover:underline" to="/veo-test">🎬 Veo 测试</Link>
          <Button variant="ghost" onClick={() => navigate('/auth/login')}>登录</Button>
          <Button onClick={() => navigate('/auth/register')}>注册</Button>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-12 pb-24">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">探索创作之境</h1>
          <p className="mt-4 text-slate-600">专业绘图与 AI 创作平台，轻松开启你的灵感旅程</p>
        </div>
        <div className="mx-auto max-w-3xl px-4">
          <div className="w-full sm:w-[480px] border rounded-xl p-8 hover:shadow transition mx-auto text-center">
            <h3 className="text-lg font-semibold mb-2">开始对话</h3>
            <p className="text-sm text-slate-600 mb-6">体验 AI 助手优化与生成</p>
            <Button onClick={() => navigate('/app')}>立即体验</Button>
          </div>
        </div>
      </main>

      <footer className="border-t py-8 text-center text-sm text-slate-500">© {new Date().getFullYear()} TAI · v1.0.0</footer>
    </div>
  );
}
