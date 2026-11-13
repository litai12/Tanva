// 移动端 /m：对话（经小T / TapCanvas）+ 一键成片 / 一键复刻（Tanva video-productions 执行与计费）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Coins, Menu, SquarePen } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { mobileChatApi, type MobileConversation } from '@/services/mobileChatApi';
import MobileLogin from './MobileLogin';
import MobileDrawer from './MobileDrawer';
import MobileChat from './MobileChat';
import MobileWorks from './MobileWorks';
import TanvasMark from './TanvasMark';

/** iOS 软键盘弹出时按可视区域收缩，输入栏始终贴在键盘上方。 */
function useVisualViewportHeight() {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => { setHeight(vv.height); if (window.scrollY) window.scrollTo(0, 0); };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return height;
}

/** 移动端需要 viewport-fit=cover 才能读到安全区；离开 /m 时还原。 */
function useMobileViewportMeta() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const theme = document.createElement('meta');
    theme.name = 'theme-color'; theme.content = '#000000';
    document.head.appendChild(theme);
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    const prevTitle = document.title;
    document.title = 'Tanvas';
    return () => {
      if (meta && previous) meta.setAttribute('content', previous);
      theme.remove();
      document.title = prevTitle;
    };
  }, []);
}

/** /m 专用输入框样式与动效：骨架扫光、进度条流光、提示淡入、打字光标。 */
const MOBILE_CSS = `
.tanva-mobile-shell { background: #000; color-scheme: dark; }
.tanva-mobile-shell .overflow-x-auto,
.tanva-mobile-shell .overflow-x-scroll { scrollbar-width: none !important; }
.tanva-mobile-shell .overflow-x-auto::-webkit-scrollbar:horizontal,
.tanva-mobile-shell .overflow-x-scroll::-webkit-scrollbar:horizontal { display: none !important; }
.tanva-mobile-composer {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    0 2px 8px rgba(0, 0, 0, 0.16);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.tanva-mobile-composer:focus-within {
  border-color: rgba(255, 255, 255, 0.24);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.025);
}
.tanva-mobile-composer-layout {
  padding: 0 52px;
  transition: padding .24s cubic-bezier(.2, .8, .2, 1);
}
.tanva-mobile-composer-layout.is-multiline { padding: 0 10px 44px; }
.tanva-mobile-composer-input { caret-color: #fff; transition: height .24s cubic-bezier(.2, .8, .2, 1); }
.tanva-mobile-composer-input::-webkit-scrollbar { display: none; }
.tanva-mobile-composer-action,
.tanva-mobile-send { touch-action: manipulation; }
.tanva-mobile-composer-action:focus-visible,
.tanva-mobile-send:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
@keyframes tanva-sweep { 0% { background-position: -150% 0 } 100% { background-position: 250% 0 } }
.tanva-shimmer { background-image: linear-gradient(110deg, #18181c 30%, #26262c 50%, #18181c 70%); background-size: 200% 100%; animation: tanva-sweep 2.2s ease-in-out infinite; }
.tanva-bar { background-image: linear-gradient(90deg, rgba(255,255,255,.55) 0%, #fff 50%, rgba(255,255,255,.55) 100%); background-size: 200% 100%; animation: tanva-sweep 1.6s linear infinite; }
@keyframes tanva-fade { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
.tanva-fade-in { animation: tanva-fade .35s ease-out both; }
@keyframes tanva-blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }
.tanva-caret { display: inline-block; width: .5em; height: 1.05em; margin-left: 2px; vertical-align: -0.15em; border-radius: 2px; background: #ECEAE6; animation: tanva-blink 1s step-end infinite; }
@keyframes tanva-dots { 0%, 20% { content: '' } 40% { content: '.' } 60% { content: '..' } 80%, 100% { content: '...' } }
.tanva-dots::after { content: ''; animation: tanva-dots 1.4s infinite; }
@media (prefers-reduced-motion: reduce) {
  .tanva-shimmer, .tanva-bar, .tanva-fade-in, .tanva-caret, .tanva-dots::after { animation: none; }
  .tanva-mobile-composer-layout, .tanva-mobile-composer-input { transition: none; }
}
`;

export default function MobileApp() {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const init = useAuthStore((s) => s.init);
  const started = useRef(false);
  const [ready, setReady] = useState(Boolean(user));
  const height = useVisualViewportHeight();
  useMobileViewportMeta();

  useEffect(() => {
    if (started.current || user) { setReady(true); return; }
    started.current = true;
    init().catch(() => {}).finally(() => setReady(true));
  }, [init, user]);

  return (
    <div className="tanva-mobile-shell fixed inset-x-0 top-0 flex flex-col overflow-hidden bg-black text-[#ECEAE6] antialiased"
      style={{ height: height ? `${height}px` : '100dvh', WebkitTapHighlightColor: 'transparent' }}>
      <style>{MOBILE_CSS}</style>
      {!ready || initializing ? (
        <div className="flex flex-1 items-center justify-center"><TanvasMark size={48} className="animate-pulse" /></div>
      ) : user ? <MobileShell /> : <MobileLogin />}
    </div>
  );
}

function MobileShell() {
  const user = useAuthStore((s) => s.user)!;
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversations, setConversations] = useState<MobileConversation[]>([]);
  const [balance, setBalance] = useState<number | null>(null);

  const match = location.pathname.match(/^\/m\/c\/([^/]+)/);
  const conversationId = match ? decodeURIComponent(match[1]) : null;
  const inWorks = /^\/m\/works\/?$/.test(location.pathname);
  const inMaterials = /^\/m\/materials\/?$/.test(location.pathname);
  const userName = user.name || (user.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : '');

  const refresh = useCallback(() => {
    mobileChatApi.list().then(setConversations).catch(() => {});
    mobileChatApi.balance().then((b) => setBalance(b.balance)).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (drawerOpen) refresh(); }, [drawerOpen, refresh]);

  const go = (path: string, replace = false) => { setDrawerOpen(false); navigate(path, { replace }); };

  return (
    <>
      <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <button type="button" aria-label="菜单" onClick={() => setDrawerOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 truncate px-3 text-center text-[15px] text-white/70">
          {inWorks ? '我的作品' : inMaterials ? '我的素材' : conversationId ? conversations.find((c) => c.id === conversationId)?.title ?? '' : ''}
        </div>
        {conversationId ? (
          <button type="button" aria-label="新建会话" onClick={() => go('/m')}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
            <SquarePen className="h-5 w-5" />
          </button>
        ) : (
          <a href={`/my-credits?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`} className="flex h-12 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm text-white/80">
            <Coins className="h-4 w-4" />{balance == null ? '—' : balance}
          </a>
        )}
      </header>

      {inWorks || inMaterials ? <MobileWorks key={inMaterials ? 'materials' : 'works'} collection={inMaterials ? 'materials' : 'works'} /> : (
        <MobileChat conversationId={conversationId} userName={userName}
          onCreated={(id) => navigate(`/m/c/${id}`, { replace: !conversationId })}
          onTurnDone={refresh} />
      )}

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} conversations={conversations}
        activeId={conversationId} userName={userName} balance={balance}
        onOpenConversation={(id) => go(`/m/c/${id}`)}
        onNewChat={() => go('/m')}
        onWorks={() => go('/m/works')}
        onMaterials={() => go('/m/materials')}
        onRename={(id, title) => { void mobileChatApi.rename(id, title).then(refresh); }}
        onDelete={(id) => { void mobileChatApi.remove(id).then(() => { refresh(); if (id === conversationId) go('/m', true); }); }}
        onLogout={() => { setDrawerOpen(false); void logout(); }} />
    </>
  );
}
