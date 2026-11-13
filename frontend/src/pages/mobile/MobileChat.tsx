import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Clapperboard, ImagePlus, Loader2, Plus, Repeat2, Rows3, Video, X } from 'lucide-react';
import { mobileChatApi, type MobileAttachment, type MobileMessage } from '@/services/mobileChatApi';
import { MAX_MEDIA_UPLOAD_BYTES, uploadToOSS } from '@/services/ossUploadService';
import JobCard from './JobCard';
import ImageCard from './ImageCard';
import ImageSetCard from './ImageSetCard';
import TanvasMark from './TanvasMark';
import WelcomePrompt from './WelcomePrompt';
import whiteLogo from '@/assets/tanvas-mark-white.svg';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENTS = 9;
const SYNC_POLL_MS = 3000;
const FILM_PREFILL = '帮我把这个故事做成竖屏短片：\n';
const REMAKE_PREFILL = '复刻这条视频，保留节奏和镜头，人物和场景换成原创';
const IMAGE_PREFILL = '帮我生成一张图片：';
const DETAIL_PREFILL = '帮我做一套商品详情页（多屏，可拼成长图），商品是：';

type Draft = { localId: string; type: 'image' | 'video'; name: string; preview: string; url?: string; uploading: boolean; error?: string };
/** clientKey：本地占位消息的渲染 key，服务端回写后保持不变，打字动画不会被重新挂载打断。 */
type ViewMessage = MobileMessage & { statusText?: string; clientKey?: string };

export type MobileChatHandle = { prefill: (kind: 'film' | 'remake' | 'image') => void };
type Props = {
  conversationId: string | null;
  userName: string;
  onCreated: (id: string) => void;
  onTurnDone: () => void;
};

const localId = () => `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const MobileChat = forwardRef<MobileChatHandle, Props>(function MobileChat({ conversationId, userName, onCreated, onTurnDone }, ref) {
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [multiline, setMultiline] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipLoadRef = useRef<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeId = useRef(conversationId);
  activeId.current = conversationId;

  // ------------------------------------------------------------ load & sync

  const sync = useCallback(async (id: string) => {
    clearTimeout(syncTimer.current);
    try {
      const data = await mobileChatApi.get(id);
      if (activeId.current !== id) return;
      setMessages((prev) => {
        const keys = new Map(prev.filter((m) => m.clientKey).map((m) => [m.id, m.clientKey]));
        return data.messages.map((m) => (keys.has(m.id) ? { ...m, clientKey: keys.get(m.id) } : m));
      });
      setLoadError('');
      // 断线或刷新时服务端可能仍在跑本轮：有 streaming 消息就继续同步。
      if (data.messages.some((m) => m.status === 'streaming')) syncTimer.current = setTimeout(() => void sync(id), SYNC_POLL_MS);
    } catch (e) {
      if (activeId.current === id) setLoadError(errMsg(e, '加载会话失败'));
    }
  }, []);

  useEffect(() => {
    clearTimeout(syncTimer.current);
    setLoadError('');
    if (!conversationId) { setMessages([]); return; }
    if (skipLoadRef.current === conversationId) { skipLoadRef.current = null; return; }
    setMessages([]);
    setLoading(true);
    void sync(conversationId).finally(() => setLoading(false));
    return () => clearTimeout(syncTimer.current);
  }, [conversationId, sync]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // ------------------------------------------------------------ composer

  const autosize = () => {
    const el = textRef.current;
    if (!el) return;
    const composer = el.closest('.tanva-mobile-composer');
    if (!composer) return;
    // Measure at the single-line width even when the expanded layout is active,
    // so changing layouts cannot repeatedly trigger a different measurement.
    const measure = el.cloneNode() as HTMLTextAreaElement;
    measure.value = el.value;
    measure.placeholder = '';
    measure.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;box-sizing:border-box;padding-left:0;padding-right:0;width:${Math.max(0, composer.clientWidth - 122)}px;height:auto;`;
    composer.appendChild(measure);
    const nextMultiline = measure.scrollHeight > 44;
    setMultiline(nextMultiline);
    // Measure the final text width without resetting the visible textarea height,
    // allowing its current height to transition smoothly to the new value.
    measure.style.width = `${Math.max(0, composer.clientWidth - 18 - (nextMultiline ? 20 : 104))}px`;
    const nextHeight = el.value ? Math.min(measure.scrollHeight, 132) : 44;
    measure.remove();
    el.style.height = `${nextHeight}px`;
  };
  useEffect(autosize, [text, multiline]);
  useEffect(() => {
    const composer = textRef.current?.closest('.tanva-mobile-composer');
    if (!composer) return;
    let width = composer.clientWidth;
    const observer = new ResizeObserver(() => {
      if (composer.clientWidth === width) return;
      width = composer.clientWidth;
      autosize();
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    prefill: (kind) => {
      setText(kind === 'film' ? FILM_PREFILL : kind === 'image' ? IMAGE_PREFILL : REMAKE_PREFILL);
      setHint(kind === 'remake' ? '点左侧 + 上传要复刻的视频' : '');
      setTimeout(() => { textRef.current?.focus(); autosize(); }, 320);
    },
  }), []);

  const pickFiles = (accept: string) => {
    if (!fileRef.current) return;
    fileRef.current.accept = accept;
    fileRef.current.click();
  };

  const addFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setHint('');
    const room = MAX_ATTACHMENTS - drafts.length;
    const picked = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > room) setHint(`最多添加 ${MAX_ATTACHMENTS} 个附件`);
    for (const file of picked) {
      const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
      if (!type) { setHint('只支持图片和视频'); continue; }
      if (file.size > (type === 'video' ? MAX_MEDIA_UPLOAD_BYTES : MAX_IMAGE_BYTES)) {
        setHint(type === 'video' ? '视频不能超过 200MB' : '图片不能超过 30MB'); continue;
      }
      // 预览走 objectURL（运行时临时态），提交的只有上传后的远程地址。
      const draft: Draft = { localId: localId(), type, name: file.name, preview: URL.createObjectURL(file), uploading: true };
      setDrafts((d) => [...d, draft]);
      uploadToOSS(file, { dir: 'mobile-chat/', fileName: file.name, contentType: file.type, maxSize: type === 'video' ? MAX_MEDIA_UPLOAD_BYTES : MAX_IMAGE_BYTES })
        .then((res) => setDrafts((d) => d.map((x) => x.localId === draft.localId
          ? { ...x, uploading: false, url: res.success ? res.url : undefined, error: res.success && res.url ? undefined : (res.error || '上传失败') } : x)))
        .catch((e) => setDrafts((d) => d.map((x) => x.localId === draft.localId ? { ...x, uploading: false, error: e?.message || '上传失败' } : x)));
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData;
    // 优先使用 files，兼容只通过 items 暴露截图的浏览器，避免同一文件重复添加。
    const files = clipboard.files.length > 0
      ? Array.from(clipboard.files)
      : Array.from(clipboard.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    // 混合剪贴板中的文字继续由输入框原生粘贴，保留光标位置和选区行为。
    if (!clipboard.getData('text/plain')) event.preventDefault();
    addFiles(files);
  };

  const removeDraft = (id: string) => setDrafts((d) => {
    const hit = d.find((x) => x.localId === id);
    if (hit) URL.revokeObjectURL(hit.preview);
    return d.filter((x) => x.localId !== id);
  });

  const uploading = drafts.some((d) => d.uploading);
  const ready = drafts.filter((d) => d.url && !d.error);
  const canSend = !sending && !uploading && (text.trim().length > 0 || ready.length > 0);

  const send = async () => {
    if (!canSend) return;
    const attachments: MobileAttachment[] = ready.map((d) => ({ type: d.type, url: d.url!, name: d.name }));
    const body = text.trim();
    setSending(true); setHint('');
    let id = conversationId;
    try {
      if (!id) {
        id = (await mobileChatApi.create()).id;
        skipLoadRef.current = id;
        activeId.current = id;
        onCreated(id);
      }
    } catch (e) {
      setHint(errMsg(e, '创建会话失败')); setSending(false); return;
    }
    const placeholderId = localId();
    const now = new Date().toISOString();
    setMessages((m) => [...m,
      { id: localId(), role: 'user', kind: 'text', content: body, attachments, jobId: null, status: 'done', createdAt: now },
      { id: placeholderId, clientKey: placeholderId, role: 'assistant', kind: 'text', content: '', attachments: [], jobId: null, status: 'streaming', createdAt: now, statusText: '思考中…' },
    ]);
    setText('');
    drafts.forEach((d) => URL.revokeObjectURL(d.preview));
    setDrafts([]);
    const convId = id!;
    try {
      await mobileChatApi.send(convId, { text: body, attachments }, (event, data) => {
        if (activeId.current !== convId) return;
        if (event === 'status') setMessages((m) => m.map((x) => x.id === placeholderId ? { ...x, statusText: data.text } : x));
        else if (event === 'delta' && typeof data.text === 'string') setMessages((m) => m.map((x) => x.id === placeholderId ? { ...x, content: x.content + data.text } : x));
        else if (event === 'text' && typeof data.content === 'string') setMessages((m) => m.map((x) => x.id === placeholderId ? { ...x, content: data.content } : x));
        else if (event === 'message' && data.message) setMessages((m) => [...m, data.message]);
        else if (event === 'final' && data.message) setMessages((m) => m.map((x) => x.id === placeholderId ? { ...data.message, clientKey: placeholderId } : x));
      });
    } catch (e) {
      setMessages((m) => m.map((x) => x.id === placeholderId ? { ...x, status: 'error', content: errMsg(e, '发送失败，请重试') } : x));
    } finally {
      setSending(false);
      onTurnDone();
      if (activeId.current === convId) void sync(convId);
    }
  };

  // ------------------------------------------------------------ render

  const empty = !conversationId && messages.length === 0;
  const firstName = (userName || '').trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center px-3 pb-10">
            <div className="flex max-w-full items-center justify-center">
              <img src={whiteLogo} alt="Tanvas" draggable={false} className="h-[50px] w-[50px] shrink-0 select-none" />
              <div className="min-w-0 break-words text-center font-sans text-[24px] font-bold leading-tight tracking-tight text-[#ECEAE6]">
                嗨，{firstName || '欢迎来到 Tanvas'}
              </div>
            </div>
            <div className="mt-3"><WelcomePrompt /></div>
          </div>
        ) : (
          <div className="mx-auto max-w-[640px] space-y-5 pb-6 pt-2">
            {loading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>}
            {loadError && <div className="py-6 text-center text-sm text-[#FF7A6B]">{loadError}</div>}
            {messages.map((m) => <MessageRow key={m.clientKey ?? m.id} message={m} />)}
          </div>
        )}
      </div>

      <div className="px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto w-full max-w-[900px]">
          {empty && drafts.length === 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto">
              <button type="button" onClick={() => { setText(FILM_PREFILL); setTimeout(() => textRef.current?.focus(), 0); }}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white/80">
                <Clapperboard className="h-4 w-4" />一键成片
              </button>
              <button type="button" onClick={() => { setText(REMAKE_PREFILL); pickFiles('video/*'); }}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white/80">
                <Repeat2 className="h-4 w-4" />一键复刻
              </button>
              <button type="button" onClick={() => { setText(IMAGE_PREFILL); setTimeout(() => textRef.current?.focus(), 0); }}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white/80">
                <ImagePlus className="h-4 w-4" />生成图片
              </button>
              <button type="button" onClick={() => { setText(DETAIL_PREFILL); setTimeout(() => textRef.current?.focus(), 0); }}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white/80">
                <Rows3 className="h-4 w-4" />详情页
              </button>
            </div>
          )}
          {hint && <div className="mb-2 px-2 text-xs text-[#F5B85B]">{hint}</div>}
          <div className="tanva-mobile-composer rounded-[32px] border border-white/[0.12] bg-[#1B1D1B] p-[9px]">
            {drafts.length > 0 && (
              <div className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1">
                {drafts.map((d) => (
                  <div key={d.localId} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                    {d.type === 'image'
                      ? <img src={d.preview} alt={d.name} className="h-full w-full object-cover" />
                      : <video src={d.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
                    {d.type === 'video' && <Video className="absolute bottom-1 left-1 h-3.5 w-3.5 text-white drop-shadow" />}
                    {(d.uploading || d.error) && (
                      <div className={`absolute inset-0 flex items-center justify-center ${d.error ? 'bg-[#5A1F1A]/80' : 'bg-black/50'}`}>
                        {d.uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="px-1 text-center text-[10px] leading-3">上传失败</span>}
                      </div>
                    )}
                    <button type="button" aria-label="移除" onClick={() => removeDraft(d.localId)}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={`tanva-mobile-composer-layout relative ${multiline ? 'is-multiline' : ''}`}
              onTransitionEnd={(event) => { if (event.target === event.currentTarget && event.propertyName === 'padding-left') autosize(); }}>
              <button type="button" aria-label="添加图片或视频" onClick={() => pickFiles('image/*,video/*')}
                className="tanva-mobile-composer-action absolute bottom-0 left-0 flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/[0.08]">
                <Plus className="h-6 w-6" strokeWidth={2.8} />
              </button>
              <textarea ref={textRef} rows={1} value={text} onChange={(e) => setText(e.target.value)}
                onPaste={handlePaste}
                placeholder={empty ? '描述你想创作的内容…' : '继续说…'}
                aria-label="消息"
                className="tanva-mobile-composer-input block min-w-0 max-h-[132px] min-h-[44px] w-full resize-none bg-transparent py-[10px] text-[16px] leading-6 text-white placeholder:text-white/40 outline-none" />
              <button type="button" aria-label="发送" onClick={send} disabled={!canSend}
                className={`tanva-mobile-send absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center rounded-full transition-colors ${canSend ? 'bg-white text-[#1B1D1B] hover:bg-[#E8E8E8]' : 'bg-white/20 text-white/65'}`}>
                {sending || uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-6 w-6" strokeWidth={2.5} />}
              </button>
            </div>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" multiple className="hidden"
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
});

export default MobileChat;

function MessageRow({ message: m }: { message: ViewMessage }) {
  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-2">
        {m.attachments.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
            {m.attachments.map((a) => a.type === 'image'
              ? <img key={a.url} src={a.url} alt={a.name || '图片'} className="h-24 w-24 rounded-2xl object-cover" />
              : (
                <div key={a.url} className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl bg-white/[0.08] text-white/70">
                  <Video className="h-6 w-6" /><span className="w-20 truncate text-center text-[10px]">{a.name || '视频'}</span>
                </div>
              ))}
          </div>
        )}
        {m.content && (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-[#2A2A2A] px-4 py-2.5 text-[16px] leading-7">
            {m.content}
          </div>
        )}
      </div>
    );
  }
  if (m.kind === 'job' && m.jobId) return <JobCard jobId={m.jobId} title={m.content || '成片任务'} />;
  if (m.kind === 'image_set' && m.imageSet) return <ImageSetCard message={m} />;
  if (m.kind === 'image' && m.jobId) return <ImageCard taskId={m.jobId} prompt={m.content} aspectRatio={m.aspectRatio || '1:1'} createdAt={m.createdAt} />;
  if (m.kind === 'error') {
    return <div className="rounded-2xl border border-[#FF7A6B]/25 bg-[#FF7A6B]/[0.08] px-4 py-3 text-sm leading-6 text-[#FFB3A8]">{m.content}</div>;
  }
  if (m.status === 'streaming' && !m.content) return <ThinkingLine startedAt={m.createdAt} statusText={m.statusText} />;
  if (m.status === 'error') {
    return (
      <div className="space-y-2">
        <div className="text-[15px] leading-7 text-[#FFB3A8]">{m.content}</div>
        {/余额|积分/.test(m.content) && (
          <a href="/my-credits" className="inline-flex h-9 items-center rounded-full bg-[#F4F2EE] px-4 text-sm font-medium text-[#141414]">去充值</a>
        )}
      </div>
    );
  }
  return <StreamingMarkdown content={m.content} streaming={m.status === 'streaming'} />;
}

const THINKING_HINTS = ['正在理解你的需求', '正在组织回复', '内容较多，还在思考', '马上就好'];

/** 还没有正文时的状态行：品牌标呼吸 + 状态文案 + 走秒，超过几秒轮换提示，让用户知道没卡住。 */
function ThinkingLine({ startedAt, statusText }: { startedAt: string; statusText?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const base = statusText && statusText !== '思考中…' ? statusText.replace(/…$/, '') : THINKING_HINTS[Math.min(Math.floor(seconds / 8), THINKING_HINTS.length - 1)];
  return (
    <div className="flex items-center gap-3 text-[15px] text-white/55">
      <TanvasMark size={20} className="animate-pulse" />
      <span key={base} className="tanva-fade-in tanva-dots">{base}</span>
      {seconds >= 3 && <span className="text-xs tabular-nums text-white/30">{seconds}s</span>}
    </div>
  );
}

/**
 * 打字机渲染：网络到达的文本先进目标，屏幕上按帧追赶（积压越多追得越快），
 * 不会一坨一坨跳出来；文本被服务端重置时直接对齐。流式期间末尾显示光标。
 */
function StreamingMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  // 只有本次会话里流式到达的消息才走打字机；历史消息直接整段显示。
  const live = useRef(streaming);
  if (streaming) live.current = true;
  const [shown, setShown] = useState(streaming ? '' : content);
  const target = useRef(content);
  target.current = content;
  const typing = live.current && shown !== content;
  useEffect(() => {
    if (!typing && !streaming) return;
    let raf = 0;
    const step = () => {
      setShown((prev) => {
        const goal = target.current;
        if (!goal.startsWith(prev)) return goal.slice(0, Math.min(goal.length, prev.length));
        const backlog = goal.length - prev.length;
        return backlog > 0 ? goal.slice(0, prev.length + Math.max(1, Math.ceil(backlog / 10))) : prev;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [typing, streaming]);
  const text = live.current ? shown : content;
  return (
    <div className={`break-words text-[16px] leading-7 text-[#E6E3DD]
      [&_a]:text-[#8FB0FF] [&_a]:underline [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5
      [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {(streaming || typing) && <span className="tanva-caret" aria-hidden />}
    </div>
  );
}

