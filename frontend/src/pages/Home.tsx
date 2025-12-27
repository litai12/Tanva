import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import AccountBadge from '@/components/AccountBadge';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import Iridescence from '@/components/Iridescence';
import MetallicButton from '@/components/MetallicButton';
import { useAuthStore } from '@/stores/authStore';

export default function Home() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartY = useRef(0);
  const lastScrollTime = useRef(0);
  const iridescenceColor = useMemo(() => [0.6, 0.8, 1.2] as [number, number, number], []);

  // 暂时只允许第一页，禁用后两页
  const maxPage = 0;

  // 切换到指定页面
  const goToPage = useCallback((page: number) => {
    if (isAnimating || page < 0 || page > maxPage) return;
    setIsAnimating(true);
    setCurrentPage(page);
    setTimeout(() => setIsAnimating(false), 600);
  }, [isAnimating]);

  // 处理滚轮事件
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // 第三页不限制滚动
      if (currentPage === 2) return;

      const now = Date.now();
      if (now - lastScrollTime.current < 800) return;

      if (Math.abs(e.deltaY) > 30) {
        e.preventDefault();
        lastScrollTime.current = now;

        if (e.deltaY > 0 && currentPage < maxPage) {
          goToPage(currentPage + 1);
        } else if (e.deltaY < 0 && currentPage > 0) {
          goToPage(currentPage - 1);
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, [currentPage, goToPage]);

  // 处理触摸事件（移动端）
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (currentPage === 2) return;

      const deltaY = touchStartY.current - e.changedTouches[0].clientY;
      if (Math.abs(deltaY) > 50) {
        if (deltaY > 0 && currentPage < maxPage) {
          goToPage(currentPage + 1);
        } else if (deltaY < 0 && currentPage > 0) {
          goToPage(currentPage - 1);
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('touchstart', handleTouchStart);
      container.addEventListener('touchend', handleTouchEnd);
    }
    return () => {
      if (container) {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [currentPage, goToPage]);

  return (
    <div ref={containerRef} className="h-screen w-full overflow-hidden bg-gradient-to-b from-white to-sky-50 text-slate-800">
      {/* 固定的 Header - 完整横条，向中间收缩 */}
      <header className="fixed top-4 left-0 right-0 z-50 pointer-events-none flex justify-center">
        <div className="flex items-center justify-between gap-4 px-6 md:px-8 py-3 h-[60px] rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 pointer-events-auto max-w-4xl w-full mx-4">
          {/* 左侧：Logo */}
          <div className="flex items-center">
            <div 
              className="flex w-[110px] h-auto items-center pb-1 justify-center cursor-pointer hover:opacity-80 transition-opacity select-none"
              onClick={() => navigate('/')}
            >
              <img
                src="/LogoText.svg"
                alt="Tanvas"
                draggable="false"
                className="brightness-0 invert"
                style={{ imageRendering: 'auto', WebkitFontSmoothing: 'antialiased' }}
              />
            </div>
          </div>

          {/* 右侧：用户信息或登录/注册按钮 */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-3 text-sm text-white">
                <span>你好，{user.name || user.phone?.slice(-4) || user.email || user.id?.slice(-4) || '用户'}</span>
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-white/30 text-white bg-green-500/20 backdrop-blur-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  在线
                </span>
                <Button 
                  variant="ghost"
                  className="text-white hover:text-white/80 hover:bg-white/10 rounded-full h-8 px-3 text-sm border border-white/20"
                  onClick={async () => {
                    try {
                      await logout();
                      navigate('/auth/login', { replace: true });
                    } catch (error) {
                      console.error('退出登录失败:', error);
                    }
                  }}
                >
                  退出登录
                </Button>
              </div>
            ) : (
              <>
                <Button 
                  variant="ghost" 
                  className="text-white hover:text-white/80 hover:bg-white/10 rounded-full h-9 px-4 text-sm font-medium" 
                  onClick={() => navigate('/auth/login')}
                >
                  登录
                </Button>
                <Button 
                  className="bg-white/20 hover:bg-white/30 text-white border border-white/20 rounded-full h-9 px-4 text-sm font-medium" 
                  onClick={() => navigate('/auth/register')}
                >
                  注册
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 页面指示器 - 暂时隐藏 */}
      <div className="hidden fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3">
        {[0].map((i) => (
          <button
            key={i}
            onClick={() => goToPage(i)}
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              currentPage === i ? 'bg-gray-700 scale-125' : 'bg-gray-300 hover:bg-gray-400'
            }`}
          />
        ))}
      </div>

      {/* 三页内容容器 */}
      <div
        className="transition-transform duration-500 ease-out"
        style={{ transform: `translateY(-${currentPage * 100}vh)` }}
      >
        {/* 第一页 - 主标题 */}
        <section className="h-screen w-full flex flex-col items-center justify-center px-4 relative overflow-hidden bg-black">
          {/* 黑色背景底 */}
          <div className="absolute inset-0 bg-black z-0"></div>

          {/* Iridescence 背景 */}
          <Iridescence
            color={iridescenceColor}
            speed={0.8}
            amplitude={0.15}
            mouseReact={true}
            className="absolute inset-0 z-[1]"
          />

          <div className="text-center relative z-10">
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6 text-white drop-shadow-lg">探索创作之境</h1>
            <p className="text-xl text-slate-200 mb-12 drop-shadow-md">专业绘图与 AI 创作平台，轻松开启你的灵感旅程</p>
            <MetallicButton onClick={() => navigate('/app')} enableWebcam={false}>
              立即体验
            </MetallicButton>
          </div>
          {/* 向下滚动提示 */}
          <div className="absolute bottom-12 animate-bounce z-10">
            <svg className="w-6 h-6 text-white drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        </section>

        {/* 第二页 - 功能介绍 */}
        <section className="h-screen w-full flex flex-col items-center justify-center px-4 bg-gradient-to-b from-sky-50 to-white">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-12">强大的创作工具</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="p-6 rounded-2xl bg-white shadow-lg">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2">AI 智能创作</h3>
                <p className="text-slate-600 text-sm">借助 AI 的力量，快速生成创意内容</p>
              </div>
              <div className="p-6 rounded-2xl bg-white shadow-lg">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2">专业绘图</h3>
                <p className="text-slate-600 text-sm">节点式工作流，灵活组合各种工具</p>
              </div>
              <div className="p-6 rounded-2xl bg-white shadow-lg">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2">多样风格</h3>
                <p className="text-slate-600 text-sm">支持多种艺术风格，满足不同需求</p>
              </div>
            </div>
          </div>
        </section>

        {/* 第三页 - CTA 和 Footer */}
        <section className="min-h-screen w-full flex flex-col bg-gradient-to-b from-white to-sky-50">
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div className="mist-card-wrapper w-full sm:w-[800px] mx-auto">
              <div className="mist-glow"></div>
              <div className="mist-layer-1"></div>
              <div className="mist-layer-2"></div>
              <div className="w-full border rounded-xl py-16 px-12 hover:shadow transition text-center mist-card">
                <div className="mist-content">
                  <h3 className="text-2xl font-semibold mb-4">准备好开始了吗？</h3>
                  <p className="text-slate-600 mb-8">立即体验 AI 助手，开启你的创作之旅</p>
                  <Button
                    className="bg-gray-700 hover:bg-gray-500 text-white rounded-2xl h-12 px-8 text-lg"
                    onClick={() => navigate('/app')}
                  >
                    开始创作
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <footer className="border-t py-6 text-center text-sm text-slate-500">
            © {new Date().getFullYear()} Tanvas · v1.0.0
          </footer>
        </section>
      </div>
    </div>
  );
}
