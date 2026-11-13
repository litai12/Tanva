import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, Loader2, X } from 'lucide-react';
import { getPublicAssetBaseUrl, proxifyRemoteAssetUrl } from '@/utils/assetProxy';

type Props = {
  url: string;
  kind: 'image' | 'video';
  className?: string;
  iconOnly?: boolean;
  label?: string;
};

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

/** 连续这么久没收到数据就中止，给出重试，而不是一直转圈。 */
const STALL_MS = 30_000;
const isWeChat = () => typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);

/** 自家 TOS 桶已对 tanvas.cn 放行 CORS：只直连下载，不经 101 代理占用服务器带宽。 */
function isOwnBucket(url: string): boolean {
  try {
    const base = getPublicAssetBaseUrl();
    return !!base && new URL(url, window.location.href).host === new URL(base).host;
  } catch { return false; }
}

type Progress = { loaded: number; total: number | null };
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** 流式读取并上报进度；STALL_MS 内无新数据即中止。 */
async function download(fetchUrl: string, signal: AbortSignal, onProgress: (p: Progress) => void): Promise<Blob> {
  const stall = new AbortController();
  const abort = () => stall.abort();
  signal.addEventListener('abort', abort, { once: true });
  let timer = window.setTimeout(abort, STALL_MS);
  const bump = () => { window.clearTimeout(timer); timer = window.setTimeout(abort, STALL_MS); };
  try {
    // no-store：避免复用 <video> 预览留下的非 CORS 缓存响应。
    const response = await fetch(fetchUrl, { signal: stall.signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('读取文件失败，请重试');
    const header = Number(response.headers.get('content-length'));
    const total = Number.isFinite(header) && header > 0 ? header : null;
    if (!response.body) return await response.blob();
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    onProgress({ loaded, total });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength; bump();
      onProgress({ loaded, total });
    }
    return new Blob(chunks, { type: response.headers.get('content-type') || '' });
  } catch (e: unknown) {
    if (stall.signal.aborted && !signal.aborted) throw new Error('网络长时间无响应，请重试或换个网络');
    throw e;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** 微信内置浏览器既不能系统分享文件，也不能下载 blob：不预下载，引导到浏览器保存。 */
function WeChatGuide({ url, kind }: Pick<Props, 'url' | 'kind'>) {
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied('已复制，粘贴到浏览器打开即可保存'); }
    catch { setCopied('复制失败，请长按下方链接手动复制'); }
  };
  if (kind === 'image') return <p className="text-sm leading-6 text-white/65">长按图片，选择「保存图片」到相册。</p>;
  return <>
    <p className="mb-3 text-sm leading-6 text-white/70">微信内无法直接保存视频。点右上角「···」选择「在默认浏览器中打开」后再保存，或复制视频链接到浏览器打开。</p>
    <button type="button" onClick={() => void copy()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#F4F2EE] px-4 text-sm font-medium text-[#141414]">
      <Copy className="h-4 w-4" />复制视频链接
    </button>
    {copied && <p role="status" className="mt-2 text-xs leading-5 text-white/60">{copied}</p>}
    {copied.startsWith('复制失败') && <p className="mt-1 select-all break-all text-xs text-white/50">{url}</p>}
  </>;
}

function SavePanel({ url, kind, onClose }: Pick<Props, 'url' | 'kind'> & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const weChat = isWeChat();
  const name = kind === 'image' ? '图片' : '视频';

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (weChat) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setFile(null); setError(''); setProgress(null);
    const prepare = async () => {
      let blob: Blob;
      try {
        blob = await download(url, controller.signal, setProgress);
      } catch (e: unknown) {
        // 自家桶只直连；第三方地址可能没有 CORS，才回退后端代理。
        if (controller.signal.aborted || isOwnBucket(url) || (e instanceof Error && e.message.startsWith('网络'))) throw e;
        blob = await download(proxifyRemoteAssetUrl(url, { forceProxy: true }), controller.signal, setProgress);
      }
      if (!blob.size) throw new Error('文件为空，请重试');
      // 部分对象存储返回通用 MIME，使用实际资源路径补全文件类型。
      const extension = new URL(url, window.location.href).pathname.split('.').pop()?.toLowerCase();
      const pathType = Object.entries(EXTENSIONS).find(([, ext]) => ext === (extension === 'jpeg' ? 'jpg' : extension))?.[0];
      const type = blob.type.split(';')[0].toLowerCase();
      const mime = !type || type === 'application/octet-stream' ? pathType : type;
      if (!mime?.startsWith(`${kind}/`)) throw new Error('无法识别媒体格式，请重试');
      const next = new File([blob], `tanvas-${Date.now()}.${EXTENSIONS[mime] || extension || 'bin'}`, { type: mime });
      if (!controller.signal.aborted) setFile(next);
    };
    void prepare().catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '文件准备失败，请重试');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, kind, attempt, weChat]);

  useEffect(() => {
    if (!file) { setDownloadUrl(''); return; }
    const objectUrl = URL.createObjectURL(file);
    setDownloadUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  let canShare = false;
  try {
    canShare = !!file && typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch { /* 部分内置浏览器会拒绝文件分享能力查询，继续提供页内保存方式。 */ }

  const share = async () => {
    if (!file || sharing) return;
    // 文件在面板内提前准备，分享必须直接由这次点击触发，保留浏览器用户激活。
    setSharing(true); setError('');
    try { await navigator.share({ files: [file] }); }
    catch (e: unknown) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setError('系统分享未能打开，请重试或保存为文件');
      }
    } finally { setSharing(false); }
  };

  return createPortal(
    <dialog ref={dialog} aria-label={`保存${name}`} onCancel={(event) => { event.preventDefault(); if (!sharing) onClose(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_32px)] max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#1E1E1E] p-5 text-white shadow-xl backdrop:bg-black/75">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">保存{name}</h2>
        <button type="button" aria-label="关闭保存面板" disabled={sharing} onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 disabled:opacity-50"><X className="h-5 w-5" /></button>
      </div>
      {kind === 'image'
        ? <img src={url} alt="待保存图片" className="mb-4 max-h-[45dvh] w-full object-contain" />
        : <video src={`${url}#t=0.1`} aria-label="待保存视频" controls playsInline preload="metadata"
            className="mb-4 max-h-[40dvh] w-full rounded-xl bg-black object-contain" />}
      {weChat ? <WeChatGuide url={url} kind={kind} /> : loading ? <div role="status" aria-live="polite">
        <p className="mb-2 flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          {!progress ? `正在连接…`
            : progress.total ? `正在下载${name} ${Math.floor((progress.loaded / progress.total) * 100)}%（${mb(progress.loaded)} / ${mb(progress.total)} MB）`
              : `正在下载${name} ${mb(progress.loaded)} MB`}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full bg-[#F4F2EE] transition-[width] duration-200 ${progress?.total ? '' : 'w-1/3 animate-pulse'}`}
            style={progress?.total ? { width: `${Math.min(100, (progress.loaded / progress.total) * 100)}%` } : undefined} />
        </div>
      </div> : <>
        {canShare && <>
          <p className="mb-3 text-sm leading-6 text-white/70">保存到相册，或分享给他人。</p>
          <button type="button" disabled={sharing} onClick={() => void share()} className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#F4F2EE] px-4 text-sm font-medium text-[#141414] disabled:opacity-50">
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}系统分享
          </button>
        </>}
        {kind === 'image'
          ? <p className="text-sm leading-6 text-white/65">长按图片保存。</p>
          : <p className="text-sm leading-6 text-white/65">下载后在“文件”中查看。</p>}
        {file && downloadUrl && <a href={downloadUrl} download={file.name} className="mt-3 flex min-h-11 items-center justify-center rounded-full bg-white/10 px-4 text-sm">保存为文件</a>}
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-[#FF7A6B]">{error}</p>}
      {!weChat && !loading && !file && <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 min-h-11 rounded-full bg-white/10 px-5 text-sm">重新准备文件</button>}
    </dialog>, document.body,
  );
}

export default function MediaSaveButton({ url, kind, className, iconOnly, label }: Props) {
  const [open, setOpen] = useState(false);
  const text = label || (kind === 'image' ? '保存图片' : '保存视频');
  return <>
    <button type="button" aria-label={text} onClick={() => setOpen(true)} className={className}>
      <Download className="h-4 w-4" />{!iconOnly && text}
    </button>
    {open && <SavePanel url={url} kind={kind} onClose={() => setOpen(false)} />}
  </>;
}
