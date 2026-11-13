import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, X } from 'lucide-react';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';

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

function SavePanel({ url, kind, onClose }: Pick<Props, 'url' | 'kind'> & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const name = kind === 'image' ? '图片' : '视频';

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFile(null); setError('');
    const prepare = async () => {
      const fetchUrl = proxifyRemoteAssetUrl(url, { forceProxy: true });
      const response = await fetch(fetchUrl, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('读取文件失败，请重试');
      const blob = await response.blob();
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
  }, [url, kind, attempt]);

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
        setError('系统保存菜单未能打开，请重试或使用下方保存方式');
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
      {kind === 'image' && <img src={url} alt="待保存图片" className="mb-4 max-h-[45dvh] w-full object-contain" />}
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-white/70"><Loader2 className="h-4 w-4 animate-spin" />正在准备{name}…</p> : <>
        {canShare && <>
          <p className="mb-3 text-sm leading-6 text-white/70">打开系统菜单后，选择“存储{kind === 'image' ? '图像' : '视频'}”或“保存到相册”。可用选项由手机系统和浏览器提供。</p>
          <button type="button" disabled={sharing} onClick={() => void share()} className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#F4F2EE] px-4 text-sm font-medium text-[#141414] disabled:opacity-50">
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}打开系统保存菜单
          </button>
        </>}
        {kind === 'image'
          ? <p className="text-sm leading-6 text-white/65">也可长按上方图片，选择“保存图片”。微信内可尝试右上角菜单中的“在浏览器打开”。</p>
          : <p className="text-sm leading-6 text-white/65">{canShare ? '也可' : '当前浏览器未提供相册保存菜单，可'}下载到手机文件，再从文件管理中将视频保存到相册。</p>}
        {file && downloadUrl && <a href={downloadUrl} download={file.name} className="mt-3 flex min-h-11 items-center justify-center rounded-full bg-white/10 px-4 text-sm">下载到手机文件</a>}
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-[#FF7A6B]">{error}</p>}
      {!loading && !file && <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 min-h-11 rounded-full bg-white/10 px-5 text-sm">重新准备文件</button>}
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
