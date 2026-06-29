import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { ossUploadService } from '@/services/ossUploadService';
import { useProjectStore } from '@/stores/projectStore';
import { getDefaultAvatarColor, getDefaultAvatarInitial } from '@/utils/defaultAvatar';
import type { MentionCandidate } from '@/contexts/CanvasCommentsContext';

export interface ComposerHandle {
  /** 在输入框追加 @某人 并聚焦（用于「回复」自动引用作者）。 */
  addMention: (cand: MentionCandidate) => void;
}

interface Props {
  members: MentionCandidate[];
  placeholder: string;
  autoFocus?: boolean;
  initialValue?: string;
  initialImages?: string[];
  submitLabel?: React.ReactNode;
  variant?: 'default' | 'floatingDraft' | 'threadReply';
  hideCancel?: boolean;
  onSubmit: (body: string, mentions: string[], imageUrls: string[]) => Promise<unknown>;
  onCancel?: () => void;
}

const Avatar: React.FC<{ name: string | null; url: string | null }> = ({ name, url }) => {
  const fallback = getDefaultAvatarColor(name);
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: url ? `center/cover no-repeat url(${url})` : fallback.bg,
        color: fallback.text,
        fontSize: 11,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
      }}
    >
      {!url && getDefaultAvatarInitial(name)}
    </div>
  );
};

const MAX_IMAGES = 9;

/** 带 @ 自动补全 + 图片附件的评论输入框。提交时回传文本、mention userId、图片 URL。 */
const CommentComposer = forwardRef<ComposerHandle, Props>(
  (
    {
      members,
      placeholder,
      autoFocus,
      initialValue,
      initialImages,
      submitLabel,
      variant = 'default',
      hideCancel = false,
      onSubmit,
      onCancel,
    },
    ref,
  ) => {
    const projectId = useProjectStore((s) => s.currentProjectId);
    const [value, setValue] = useState(initialValue ?? '');
    const [mentionIds, setMentionIds] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [images, setImages] = useState<string[]>(initialImages ?? []);
    const [uploading, setUploading] = useState(false);
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    useImperativeHandle(ref, () => ({
      addMention: (cand: MentionCandidate) => {
        setValue((v) => {
          const needsSpace = v.length > 0 && !v.endsWith(' ');
          return `${v}${needsSpace ? ' ' : ''}@${cand.name ?? cand.id} `;
        });
        setMentionIds((prev) => new Set(prev).add(cand.id));
        requestAnimationFrame(() => taRef.current?.focus());
      },
    }));

    const candidates = useMemo(() => {
      if (query == null) return [];
      const qy = query.toLowerCase();
      return members.filter((m) => (m.name ?? '').toLowerCase().includes(qy)).slice(0, 6);
    }, [query, members]);

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      setValue(v);
      const caret = e.target.selectionStart ?? v.length;
      const before = v.slice(0, caret);
      const m = before.match(/@([^\s@]*)$/);
      setQuery(m ? m[1] : null);
    };

    const pickMention = (cand: MentionCandidate) => {
      const ta = taRef.current;
      const caret = ta?.selectionStart ?? value.length;
      const before = value.slice(0, caret).replace(/@([^\s@]*)$/, `@${cand.name ?? cand.id} `);
      const after = value.slice(caret);
      setValue(before + after);
      setMentionIds((prev) => new Set(prev).add(cand.id));
      setQuery(null);
      requestAnimationFrame(() => ta?.focus());
    };

    const handleFiles = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = MAX_IMAGES - images.length;
      const picked = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, room);
      if (picked.length === 0) return;
      setUploading(true);
      try {
        const urls: string[] = [];
        for (const file of picked) {
          const res = await ossUploadService.uploadToOSS(file, {
            dir: projectId ? `projects/${projectId}/comments/` : 'uploads/comments/',
            fileName: file.name || `comment-${Date.now()}.png`,
            contentType: file.type || 'image/png',
          });
          const url = res?.url?.trim();
          if (res?.success && url) urls.push(url);
        }
        if (urls.length) setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    };

    const submit = async () => {
      const body = value.trim();
      if ((!body && images.length === 0) || busy || uploading) return;
      setBusy(true);
      try {
        const kept = [...mentionIds].filter((id) => {
          const m = members.find((x) => x.id === id);
          return m && value.includes(`@${m.name ?? m.id}`);
        });
        await onSubmit(body, kept, images);
        setValue('');
        setMentionIds(new Set());
        setImages([]);
      } finally {
        setBusy(false);
      }
    };

    const hasContent = value.trim().length > 0 || images.length > 0;
    const canSend = hasContent && !uploading;
    const isFloatingDraft = variant === 'floatingDraft';
    const isThreadReply = variant === 'threadReply';
    const isExpanded = (isFloatingDraft || isThreadReply) && hasContent;
    const displayPlaceholder = isFloatingDraft && !isExpanded ? '\u8bc4\u8bba\u5185\u5bb9' : placeholder;

    const input = (
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => void handleFiles(e.target.files)}
      />
    );

    return (
      <div style={{ position: 'relative', width: '100%' }}>
        {images.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {images.map((url) => (
              <div key={url} style={{ position: 'relative', width: 52, height: 52 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    background: `center/cover no-repeat url(${url})`,
                    border: '1px solid #e2e8f0',
                  }}
                />
                <button
                  onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: 'none',
                    background: '#0f172a',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {input}

        {!isFloatingDraft && !isThreadReply ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || images.length >= MAX_IMAGES}
              title="添加图片"
              style={{
                border: '1px solid #e2e8f0',
                background: 'white',
                color: '#64748b',
                borderRadius: 8,
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: uploading || images.length >= MAX_IMAGES ? 'default' : 'pointer',
                flex: '0 0 auto',
              }}
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
            </button>
            <textarea
              ref={taRef}
              value={value}
              autoFocus={autoFocus}
              placeholder={placeholder}
              onChange={onChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape' && onCancel) onCancel();
              }}
              rows={2}
              style={{
                flex: 1,
                resize: 'none',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 13,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => void submit()}
              disabled={busy || !canSend}
              title="发送 (⌘/Ctrl+Enter)"
              style={{
                border: 'none',
                background: canSend ? '#2563eb' : '#cbd5e1',
                color: 'white',
                borderRadius: 8,
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: canSend ? 'pointer' : 'default',
                flex: '0 0 auto',
              }}
            >
              {submitLabel ?? <Send size={15} />}
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: isExpanded ? 'column' : 'row',
              alignItems: isExpanded ? 'stretch' : 'center',
              overflow: 'hidden',
              minHeight: isThreadReply ? (isExpanded ? 78 : 38) : isExpanded ? 88 : 38,
              border: isThreadReply ? 'none' : '1px solid rgba(226, 232, 240, 0.95)',
              borderRadius: isThreadReply ? 8 : isExpanded ? 10 : 12,
              background: isThreadReply ? '#f3f4f6' : 'rgba(255, 255, 255, 0.96)',
              boxShadow: isThreadReply ? 'none' : '0 8px 22px rgba(15, 23, 42, 0.13)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: isExpanded ? 'flex-start' : 'center',
                flex: isExpanded ? '0 0 auto' : 1,
                minHeight: isThreadReply ? (isExpanded ? 42 : 38) : isExpanded ? 48 : 38,
                padding: isThreadReply
                  ? isExpanded
                    ? '8px 10px 4px 12px'
                    : '0 0 0 14px'
                  : isExpanded
                    ? '10px 12px 4px 12px'
                    : '0 0 0 14px',
              }}
            >
              <textarea
                ref={taRef}
                value={value}
                autoFocus={autoFocus}
                placeholder={displayPlaceholder}
                onChange={onChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                  if (e.key === 'Escape' && onCancel) onCancel();
                }}
                rows={isExpanded ? 2 : 1}
                style={{
                  flex: 1,
                  height: isThreadReply ? 20 : isExpanded ? 36 : 20,
                  resize: 'none',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  fontSize: isThreadReply ? 12 : isExpanded ? 12 : 12,
                  lineHeight: isThreadReply ? '20px' : isExpanded ? '21px' : '20px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  color: '#111827',
                  overflow: 'hidden',
                }}
              />
            </div>
            {isExpanded && <div style={{ height: 1, background: isThreadReply ? '#e5e7eb' : '#edf2f7', flex: '0 0 auto' }} />}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isExpanded ? 'space-between' : 'center',
                height: isThreadReply ? (isExpanded ? 36 : 38) : isExpanded ? 39 : 38,
                padding: isThreadReply ? (isExpanded ? '0 8px 0 10px' : '0 7px') : isExpanded ? '0 9px 0 10px' : '0 7px',
                flex: '0 0 auto',
              }}
            >
              {isExpanded && (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || images.length >= MAX_IMAGES}
                  title="添加图片"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#4b5563',
                    borderRadius: 6,
                    width: 22,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: uploading || images.length >= MAX_IMAGES ? 'default' : 'pointer',
                    flex: '0 0 auto',
                    padding: 0,
                  }}
                >
                  {uploading ? <Loader2 size={17} className="animate-spin" /> : <ImagePlus size={18} />}
                </button>
              )}
              <button
                onClick={() => void submit()}
                disabled={busy || !canSend}
                title="发送 (⌘/Ctrl+Enter)"
                style={{
                  border: 'none',
                  background: isThreadReply ? '#050505' : canSend ? '#050505' : '#d9d9d9',
                  color: '#ffffff',
                  borderRadius: '50%',
                  width: isThreadReply ? 28 : isExpanded ? 30 : 28,
                  height: isThreadReply ? 28 : isExpanded ? 30 : 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: canSend ? 'pointer' : 'default',
                  flex: '0 0 auto',
                  padding: 0,
                  lineHeight: 0,
                }}
              >
                {submitLabel ?? <Send size={isThreadReply ? 15 : isExpanded ? 16 : 15} style={{ display: 'block' }} />}
              </button>
            </div>
          </div>
        )}

        {onCancel && !hideCancel && (
          <button
            onClick={onCancel}
            style={{
              marginTop: 4,
              fontSize: 12,
              color: '#64748b',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        )}

        {candidates.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              width: 200,
              zIndex: 5,
              overflow: 'hidden',
            }}
          >
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => pickMention(c)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  textAlign: 'left',
                }}
              >
                <Avatar name={c.name} url={c.avatarUrl} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name ?? c.id.slice(0, 8)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
CommentComposer.displayName = 'CommentComposer';

export default CommentComposer;
