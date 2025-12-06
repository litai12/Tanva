import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import AccountBadge from '@/components/AccountBadge';

export default function Home() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-sky-50 text-slate-800 flex flex-col">
      <header className="w-full py-3 px-4 relative z-20">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <img src="/LogoText.svg" alt="Tanvas" className="h-6 w-auto" />
          </div>
          <div className="flex items-center gap-4">
            <AccountBadge />
            <Button variant="ghost" className="text-gray-700 hover:text-gray-500 hover:bg-gray-100 rounded-2xl" onClick={() => navigate('/auth/login')}>登录</Button>
            <Button className="bg-gray-700 hover:bg-gray-500 text-white rounded-2xl" onClick={() => navigate('/auth/register')}>注册</Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-20 flex-1">
        <div className="text-center mb-20 relative z-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">探索创作之境</h1>
          <p className="mt-4 text-slate-600">专业绘图与 AI 创作平台，轻松开启你的灵感旅程</p>
        </div>
        <div className="mx-auto max-w-3xl px-4 mt-16">
          <div className="mist-card-wrapper w-full sm:w-[800px] mx-auto ">
            <div className="mist-glow"></div>
            <div className="mist-layer-1"></div>
            <div className="mist-layer-2"></div>
            <div className="w-full border rounded-xl py-16 px-12 hover:shadow transition text-center mist-card">
              <div className="mist-content">
                <h3 className="text-lg font-semibold mb-2">开始对话</h3>
                <p className="text-sm text-slate-600 mb-6">体验 AI 助手优化与生成</p>
                <Button className="bg-gray-700 hover:bg-gray-500 text-white rounded-2xl h-9 px-4" onClick={() => navigate('/app')}>立即体验</Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t py-6 mt-auto text-center text-sm text-slate-500">
        © {new Date().getFullYear()} Tanvas · v1.0.0
      </footer>
    </div>
  );
}
