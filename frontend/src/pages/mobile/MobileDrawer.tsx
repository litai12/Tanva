import { useMemo, useState } from 'react';
import { ChevronRight, Coins, Film, LogOut, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import type { MobileConversation } from '@/services/mobileChatApi';
import { TanvasWordmark } from './TanvasMark';

type Props = {
  open: boolean;
  onClose: () => void;
  conversations: MobileConversation[];
  activeId: string | null;
  userName: string;
  balance: number | null;
  onOpenConversation: (id: string) => void;
  onNewChat: () => void;
  onWorks: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
};

const RECENT_LIMIT = 8;

export default function MobileDrawer(props: Props) {
  const { open, onClose, conversations, activeId } = props;
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    return showAll || q ? list : list.slice(0, RECENT_LIMIT);
  }, [conversations, query, showAll]);
  const words = (props.userName || 'Tanvas').trim().split(/\s+/).filter(Boolean);
  // 英文名取首字母（robert lee → RL）；中文名取最后一个字。
  const initials = words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase()
    : /^[A-Za-z]/.test(words[0]) ? words[0].slice(0, 2).toUpperCase() : words[0].slice(-1);

  const navItem = 'flex h-14 w-full items-center gap-4 rounded-2xl px-3 text-[18px] active:bg-white/5';

  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose} />
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-[360px] flex-col bg-[#101010] transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-hidden={!open}>
        <div className="flex items-center justify-between px-5 pb-4 pt-[max(20px,env(safe-area-inset-top))]">
          {searching ? (
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索会话"
              className="mr-3 h-11 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-4 text-[16px] outline-none" />
          ) : (
            <TanvasWordmark height={21} className="-translate-y-px" />
          )}
          <button type="button" aria-label={searching ? '关闭搜索' : '搜索'}
            onClick={() => { setSearching((s) => !s); setQuery(''); }}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
            {searching ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <button type="button" onClick={props.onNewChat}
            className="mb-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#F4F2EE] px-5 text-[17px] font-medium text-[#141414] active:bg-white/80">
            <Plus className="h-5 w-5" />新建会话
          </button>
          {!searching && (
            <nav className="space-y-1">
              <button type="button" className={navItem} onClick={props.onWorks}>
                <Film className="h-6 w-6 text-white/80" />我的作品
              </button>
            </nav>
          )}

          <div className="mt-6 px-3 text-sm text-white/45">{query ? '搜索结果' : '最近对话'}</div>
          <div className="mt-2 space-y-0.5">
            {filtered.map((c) => (
              <div key={c.id} className={`relative flex items-center rounded-2xl ${c.id === activeId ? 'bg-white/[0.07]' : ''}`}>
                <button type="button" className="h-11 min-w-0 flex-1 truncate px-3 text-left text-[15px] text-white/85"
                  onClick={() => props.onOpenConversation(c.id)}>{c.title}</button>
                <button type="button" aria-label="更多" className="flex h-11 w-10 items-center justify-center text-white/40"
                  onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuFor === c.id && (
                  <div className="absolute right-2 top-10 z-10 w-32 overflow-hidden rounded-2xl border border-white/10 bg-[#222] text-sm shadow-xl">
                    <button type="button" className="block w-full px-4 py-3 text-left active:bg-white/5" onClick={() => {
                      setMenuFor(null);
                      const title = window.prompt('重命名会话', c.title);
                      if (title && title.trim()) props.onRename(c.id, title.trim());
                    }}>重命名</button>
                    <button type="button" className="block w-full px-4 py-3 text-left text-[#FF7A6B] active:bg-white/5" onClick={() => {
                      setMenuFor(null);
                      if (window.confirm('删除这个会话？已生成的作品仍可在「我的作品」查看。')) props.onDelete(c.id);
                    }}>删除</button>
                  </div>
                )}
              </div>
            ))}
            {!filtered.length && <div className="px-3 py-2 text-sm text-white/30">{query ? '没有匹配的会话' : '还没有会话'}</div>}
          </div>
          {!query && !showAll && conversations.length > RECENT_LIMIT && (
            <button type="button" className="mt-2 flex items-center gap-1 px-3 py-2 text-[15px] text-white/55" onClick={() => setShowAll(true)}>
              查看全部<ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="relative flex items-center justify-between px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3">
          <button type="button" aria-label="账号" onClick={() => setAccountOpen((v) => !v)}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#1E1E1E] text-[17px] font-semibold">
            {initials}
          </button>
          {accountOpen && (
            <div className="absolute bottom-[calc(100%-4px)] left-5 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#222] text-[15px] shadow-xl">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="truncate font-medium">{props.userName || 'Tanvas 用户'}</div>
                <div className="mt-1 flex items-center gap-1 text-xs text-white/50">
                  <Coins className="h-3.5 w-3.5" />{props.balance == null ? '—' : `${props.balance} 积分`}
                </div>
              </div>
              <a href={`/my-credits?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`} className="block px-4 py-3 active:bg-white/5">积分与充值</a>
              <a href="/membership" className="block px-4 py-3 active:bg-white/5">会员</a>
              <button type="button" onClick={props.onLogout} className="flex w-full items-center gap-2 px-4 py-3 text-left text-white/70 active:bg-white/5">
                <LogOut className="h-4 w-4" />退出登录
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
