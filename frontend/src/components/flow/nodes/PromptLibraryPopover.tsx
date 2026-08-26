import React from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen, Check, ChevronDown, Edit3, Image as ImageIcon, Loader2,
  Play, Plus, Search, Star, Trash2, UploadCloud, Video, X,
} from 'lucide-react';
import { useLocaleText } from '@/utils/localeText';
import { imageUploadService } from '@/services/imageUploadService';
import {
  promptLibraryApi,
  type OfficialPromptFacets,
  type OfficialPromptItem,
  type PromptLibrarySort,
  type PromptMediaType,
  type UserPromptInput,
  type UserPromptItem,
} from '@/services/promptLibraryApi';
import './PromptLibraryPopover.css';

export type PromptLibraryApplyMode = 'replace' | 'append';

type PromptLibraryPopoverProps = {
  open: boolean;
  dark: boolean;
  onClose: () => void;
  onApply: (prompt: string, mode: PromptLibraryApplyMode) => void;
};

type LibraryTab = 'official' | 'custom';
type MediaFilter = 'all' | PromptMediaType;
type LegacyPrompt = { id: string; title: string; prompt: string; category: string };
type EditorDraft = UserPromptInput;

const PAGE_SIZE = 24;
const LEGACY_CUSTOM_KEY = 'tanva:prompt-library:custom:v1';
const LEGACY_FAVORITES_KEY = 'tanva:prompt-library:favorites:v1';
const EMPTY_FACETS: OfficialPromptFacets = {
  media: [], models: [], allMediaCount: 0, allModelCount: 0,
};
const EMPTY_DRAFT: EditorDraft = {
  title: '', description: '', promptText: '', mediaType: 'image', previewUrl: '',
};

const favoriteKey = (source: LibraryTab, id: string): string =>
  `${source === 'custom' ? 'custom' : 'official'}:${id}`;

const mediaLabel = (
  mediaType: MediaFilter,
  lt: (zh: string, en: string) => string,
): string => {
  if (mediaType === 'image') return lt('图片', 'Image');
  if (mediaType === 'video') return lt('视频', 'Video');
  return lt('全部', 'All');
};

const readLegacyPrompts = (): LegacyPrompt[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LEGACY_CUSTOM_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): LegacyPrompt[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
      const category = typeof record.category === 'string' ? record.category : 'image';
      return id && title && prompt ? [{ id, title, prompt, category }] : [];
    });
  } catch {
    return [];
  }
};

const readLegacyFavorites = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LEGACY_FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
};

let legacyMigrationPromise: Promise<{ items: UserPromptItem[]; favoriteKeys: string[] }> | null = null;

const migrateLegacyPrompts = (
  existing: UserPromptItem[],
): Promise<{ items: UserPromptItem[]; favoriteKeys: string[] }> => {
  if (legacyMigrationPromise) return legacyMigrationPromise;
  legacyMigrationPromise = (async () => {
    const legacy = readLegacyPrompts();
    if (!legacy.length) return { items: existing, favoriteKeys: [] };
    const legacyFavorites = readLegacyFavorites();
    const next = [...existing];
    const migratedFavoriteKeys: string[] = [];
    for (const item of legacy) {
      let saved = next.find((candidate) =>
        candidate.title.trim() === item.title && candidate.promptText.trim() === item.prompt,
      );
      if (!saved) {
        saved = await promptLibraryApi.createMine({
          title: item.title,
          promptText: item.prompt,
          mediaType: item.category === 'image' ? 'image' : 'video',
        });
        next.unshift(saved);
      }
      if (legacyFavorites.has(item.id)) {
        await promptLibraryApi.setFavorite('custom', saved.id, true);
        migratedFavoriteKeys.push(favoriteKey('custom', saved.id));
      }
    }
    window.localStorage.removeItem(LEGACY_CUSTOM_KEY);
    window.localStorage.removeItem(LEGACY_FAVORITES_KEY);
    return { items: next, favoriteKeys: migratedFavoriteKeys };
  })();
  return legacyMigrationPromise;
};

function PromptMediaPreview({
  type, url, thumbnailUrl, title, hoverLabel,
}: {
  type: PromptMediaType;
  url: string | null;
  thumbnailUrl?: string | null;
  title: string;
  hoverLabel: string;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [videoFailed, setVideoFailed] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
    setVideoFailed(false);
    setHovered(false);
    setPlaying(false);
  }, [url, thumbnailUrl]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hovered && !videoFailed) {
      void video.play().catch(() => setPlaying(false));
      return;
    }
    video.pause();
    if (video.readyState > 0) {
      try { video.currentTime = 0; } catch {}
    }
    setPlaying(false);
  }, [hovered, videoFailed]);

  React.useEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, []);

  if (!url) {
    return (
      <div className={`tanva-prompt-library__placeholder is-${type}`}>
        {type === 'video' ? <Video size={28} /> : <ImageIcon size={28} />}
        <span>{title}</span>
      </div>
    );
  }

  if (type === 'video') {
    return (
      <div
        className={`tanva-prompt-library__media-shell is-video${playing ? ' is-playing' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {thumbnailUrl && !imageFailed ? (
          <img
            className="tanva-prompt-library__media tanva-prompt-library__poster"
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="tanva-prompt-library__placeholder is-video">
            <Video size={28} />
            <span>{title}</span>
          </div>
        )}
        {!videoFailed ? (
          <video
            ref={videoRef}
            className="tanva-prompt-library__media tanva-prompt-library__hover-video"
            src={hovered ? url : undefined}
            muted
            playsInline
            loop
            preload="auto"
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => { setVideoFailed(true); setPlaying(false); }}
          />
        ) : null}
        {!videoFailed ? (
          <span className="tanva-prompt-library__preview-cue" title={hoverLabel} aria-hidden="true">
            {hovered && !playing ? <Loader2 size={17} className="is-spinning" /> : <Play size={17} fill="currentColor" />}
          </span>
        ) : null}
      </div>
    );
  }

  if (imageFailed) {
    return (
      <div className="tanva-prompt-library__placeholder is-image">
        <ImageIcon size={28} />
        <span>{title}</span>
      </div>
    );
  }
  return <img className="tanva-prompt-library__media" src={thumbnailUrl || url} alt="" loading="lazy" draggable={false} onError={() => setImageFailed(true)} />;
}

function SkeletonCards() {
  return (
    <div className="tanva-prompt-library__grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="tanva-prompt-library__skeleton" key={index}><span /><i /><i /></div>
      ))}
    </div>
  );
}

export default function PromptLibraryPopover({ open, dark, onClose, onApply }: PromptLibraryPopoverProps): React.ReactPortal | null {
  const { lt } = useLocaleText();
  const titleInputRef = React.useRef<HTMLInputElement | null>(null);
  const officialRequestRef = React.useRef(0);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = React.useRef(false);
  const [tab, setTab] = React.useState<LibraryTab>('official');
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [mediaType, setMediaType] = React.useState<MediaFilter>('all');
  const [model, setModel] = React.useState('');
  const [sort, setSort] = React.useState<PromptLibrarySort>('time_desc');
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [applyMode, setApplyMode] = React.useState<PromptLibraryApplyMode>('replace');
  const [favorites, setFavorites] = React.useState<Set<string>>(new Set());
  const [officialItems, setOfficialItems] = React.useState<OfficialPromptItem[]>([]);
  const [officialFacets, setOfficialFacets] = React.useState<OfficialPromptFacets>(EMPTY_FACETS);
  const [officialTotal, setOfficialTotal] = React.useState(0);
  const [officialPage, setOfficialPage] = React.useState(1);
  const [mine, setMine] = React.useState<UserPromptItem[]>([]);
  const [loadingOfficial, setLoadingOfficial] = React.useState(false);
  const [loadingMine, setLoadingMine] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<EditorDraft>(EMPTY_DRAFT);
  const [coverFile, setCoverFile] = React.useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = React.useState('');
  const [error, setError] = React.useState('');
  const [formError, setFormError] = React.useState('');

  const resetEditor = React.useCallback(() => {
    setEditorOpen(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setCoverFile(null);
    setCoverPreviewUrl((current) => {
      if (current.startsWith('blob:')) URL.revokeObjectURL(current);
      return '';
    });
    setFormError('');
  }, []);

  React.useEffect(() => () => {
    if (coverPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(coverPreviewUrl);
  }, [coverPreviewUrl]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (editorOpen) resetEditor(); else onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [editorOpen, onClose, open, resetEditor]);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setLoadingMine(true);
    let active = true;
    Promise.all([promptLibraryApi.listMine(), promptLibraryApi.listFavorites()])
      .then(async ([items, saved]) => {
        const migrated = await migrateLegacyPrompts(items);
        if (!active) return;
        setMine(migrated.items);
        setFavorites(new Set([
          ...saved.map((item) => `${item.source}:${item.promptId}`),
          ...migrated.favoriteKeys,
        ]));
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : lt('个人提示词加载失败', 'Failed to load your prompts'));
      })
      .finally(() => { if (active) setLoadingMine(false); });
    return () => { active = false; };
  }, [lt, open]);

  React.useEffect(() => {
    if (!open) return;
    const requestId = ++officialRequestRef.current;
    setLoadingOfficial(true);
    setError('');
    promptLibraryApi.listOfficial({
      query: debouncedQuery || undefined,
      model: model || undefined,
      mediaType: mediaType === 'all' ? undefined : mediaType,
      sort,
      page: 1,
      pageSize: PAGE_SIZE,
    }).then((result) => {
      if (officialRequestRef.current !== requestId) return;
      setOfficialItems(result.items);
      setOfficialFacets(result.facets);
      setOfficialTotal(result.total);
      setOfficialPage(result.page);
    }).catch((reason) => {
      if (officialRequestRef.current !== requestId) return;
      setOfficialItems([]);
      setError(reason instanceof Error ? reason.message : lt('官方提示词加载失败', 'Failed to load official prompts'));
    }).finally(() => {
      if (officialRequestRef.current === requestId) setLoadingOfficial(false);
    });
  }, [debouncedQuery, lt, mediaType, model, open, sort]);

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setFavoritesOnly(false);
      resetEditor();
    }
  }, [open, resetEditor]);

  React.useEffect(() => {
    if (!editorOpen) return;
    const frame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editorOpen]);

  const filteredOfficial = React.useMemo(() => favoritesOnly
    ? officialItems.filter((item) => favorites.has(favoriteKey('official', item.id)))
    : officialItems,
  [favorites, favoritesOnly, officialItems]);

  const filteredMine = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return mine.filter((item) => {
      if (mediaType !== 'all' && item.mediaType !== mediaType) return false;
      if (favoritesOnly && !favorites.has(favoriteKey('custom', item.id))) return false;
      if (!normalizedQuery) return true;
      return `${item.title} ${item.description || ''} ${item.promptText}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [favorites, favoritesOnly, mediaType, mine, query]);

  const displayedItems = tab === 'official' ? filteredOfficial : filteredMine;
  const isLoading = tab === 'official' ? loadingOfficial : loadingMine;
  const hasMore = officialItems.length < officialTotal;

  const loadMoreOfficial = React.useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    const requestId = officialRequestRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError('');
    try {
      const result = await promptLibraryApi.listOfficial({
        query: debouncedQuery || undefined,
        model: model || undefined,
        mediaType: mediaType === 'all' ? undefined : mediaType,
        sort,
        page: officialPage + 1,
        pageSize: PAGE_SIZE,
      });
      if (officialRequestRef.current !== requestId) return;
      setOfficialItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !existing.has(item.id))];
      });
      setOfficialPage(result.page);
      setOfficialTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : lt('下一页加载失败', 'Failed to load more prompts'));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [debouncedQuery, hasMore, lt, mediaType, model, officialPage, sort]);

  React.useEffect(() => {
    if (!open || tab !== 'official' || favoritesOnly || loadingOfficial || !hasMore) return;
    const root = contentRef.current;
    const target = loadMoreSentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreOfficial();
    }, {
      root,
      rootMargin: '360px 0px 360px 0px',
      threshold: 0.01,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [favoritesOnly, hasMore, loadMoreOfficial, loadingOfficial, open, officialItems.length, tab]);

  const toggleFavorite = React.useCallback(async (source: LibraryTab, id: string) => {
    const key = favoriteKey(source, id);
    const nextValue = !favorites.has(key);
    setFavorites((current) => {
      const next = new Set(current);
      if (nextValue) next.add(key); else next.delete(key);
      return next;
    });
    try {
      await promptLibraryApi.setFavorite(source === 'custom' ? 'custom' : 'official', id, nextValue);
    } catch (reason) {
      setFavorites((current) => {
        const next = new Set(current);
        if (nextValue) next.delete(key); else next.add(key);
        return next;
      });
      setError(reason instanceof Error ? reason.message : lt('常用状态保存失败', 'Failed to save favorite'));
    }
  }, [favorites, lt]);

  const startCreate = React.useCallback(() => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, mediaType: mediaType === 'all' ? 'image' : mediaType });
    setCoverFile(null);
    setCoverPreviewUrl('');
    setFormError('');
    setEditorOpen(true);
  }, [mediaType]);

  const startEdit = React.useCallback((item: UserPromptItem) => {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      description: item.description || '',
      promptText: item.promptText,
      mediaType: item.mediaType,
      previewUrl: item.previewUrl || '',
    });
    setCoverFile(null);
    setCoverPreviewUrl(item.previewUrl || '');
    setFormError('');
    setEditorOpen(true);
  }, []);

  const chooseCover = React.useCallback((file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError(lt('请选择图片作为封面', 'Choose an image for the cover'));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setFormError(lt('封面图片不能超过 12MB', 'Cover image must be 12MB or smaller'));
      return;
    }
    setFormError('');
    setCoverFile(file);
    setCoverPreviewUrl((current) => {
      if (current.startsWith('blob:')) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  }, [lt]);

  const removeCover = React.useCallback(() => {
    setCoverFile(null);
    setDraft((current) => ({ ...current, previewUrl: '' }));
    setCoverPreviewUrl((current) => {
      if (current.startsWith('blob:')) URL.revokeObjectURL(current);
      return '';
    });
  }, []);

  const saveCustomItem = React.useCallback(async () => {
    const title = draft.title.trim();
    const promptText = draft.promptText.trim();
    if (!title || !promptText) {
      setFormError(lt('请填写名称和提示词内容', 'Add both a name and prompt content'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      let previewUrl = draft.previewUrl?.trim() || '';
      if (coverFile) {
        const uploaded = await imageUploadService.uploadImageFile(coverFile, {
          dir: 'prompt-library/covers/',
          maxFileSize: 12 * 1024 * 1024,
          fileName: coverFile.name,
        });
        if (!uploaded.success || !uploaded.asset?.url) {
          throw new Error(uploaded.error || lt('封面上传失败', 'Cover upload failed'));
        }
        previewUrl = uploaded.asset.url;
      }
      const input: UserPromptInput = {
        title,
        description: draft.description?.trim() || '',
        promptText,
        mediaType: draft.mediaType,
        previewUrl,
      };
      if (editingId) {
        const updated = await promptLibraryApi.updateMine(editingId, input);
        setMine((current) => current.map((item) => item.id === updated.id ? updated : item));
      } else {
        const created = await promptLibraryApi.createMine(input);
        setMine((current) => [created, ...current]);
      }
      resetEditor();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : lt('保存失败，请重试', 'Save failed, please retry'));
    } finally {
      setSaving(false);
    }
  }, [coverFile, draft, editingId, lt, resetEditor]);

  const deleteCustomItem = React.useCallback(async (item: UserPromptItem) => {
    if (!window.confirm(lt(`确认删除“${item.title}”吗？`, `Delete “${item.title}”?`))) return;
    setError('');
    try {
      await promptLibraryApi.removeMine(item.id);
      setMine((current) => current.filter((candidate) => candidate.id !== item.id));
      setFavorites((current) => {
        const next = new Set(current);
        next.delete(favoriteKey('custom', item.id));
        return next;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : lt('删除失败，请重试', 'Delete failed, please retry'));
    }
  }, [lt]);

  const applyPrompt = React.useCallback((prompt: string) => {
    onApply(prompt, applyMode);
    onClose();
  }, [applyMode, onApply, onClose]);

  if (!open || typeof document === 'undefined') return null;
  const mediaCount = (kind: PromptMediaType): number =>
    officialFacets.media.find((facet) => facet.kind === kind)?.count || 0;

  return createPortal(
    <div
      className={`tanva-prompt-library-overlay notranslate nodrag nopan${dark ? ' is-dark' : ''}`}
      translate="no"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="tanva-prompt-library"
        role="dialog"
        aria-modal="true"
        aria-label={lt('提示词库', 'Prompt library')}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="tanva-prompt-library__header">
          <div className="tanva-prompt-library__heading">
            <div><h2>{lt('提示词库', 'Prompt library')}</h2><p>{lt('从案例预览中选择灵感，直接带进当前 Prompt', 'Choose from visual examples and bring one into this Prompt')}</p></div>
          </div>
          <button type="button" className="tanva-prompt-library__icon-button" aria-label={lt('关闭', 'Close')} onClick={onClose}><X size={21} /></button>
        </header>

        <div className="tanva-prompt-library__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'official'} className={tab === 'official' ? 'is-active' : ''} onClick={() => { setTab('official'); resetEditor(); }}>
            {lt('官方案例', 'Official')}<span>{officialFacets.allMediaCount || officialTotal}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'custom'} className={tab === 'custom' ? 'is-active' : ''} onClick={() => { setTab('custom'); resetEditor(); }}>
            {lt('我的提示词', 'Mine')}<span>{mine.length}</span>
          </button>
        </div>

        <div className="tanva-prompt-library__toolbar">
          <label className="tanva-prompt-library__search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={lt('搜索名称、描述或提示词', 'Search title, description, or prompt')} />
            {query ? <button type="button" aria-label={lt('清空搜索', 'Clear')} onClick={() => setQuery('')}><X size={14} /></button> : null}
          </label>
          <button type="button" className={`tanva-prompt-library__favorite-filter${favoritesOnly ? ' is-active' : ''}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((current) => !current)}>
            <Star size={16} fill={favoritesOnly ? 'currentColor' : 'none'} />{lt('常用', 'Saved')}
          </button>
          {tab === 'custom' ? <button type="button" className="tanva-prompt-library__new-button" onClick={startCreate}><Plus size={16} />{lt('新建', 'New')}</button> : null}
        </div>

        <div className="tanva-prompt-library__filters">
          <div className="tanva-prompt-library__media-tabs" role="group" aria-label={lt('素材类型', 'Media type')}>
            {(['all', 'image', 'video'] as const).map((value) => (
              <button type="button" key={value} className={mediaType === value ? 'is-active' : ''} onClick={() => setMediaType(value)}>
                {value === 'image' ? <ImageIcon size={14} /> : value === 'video' ? <Video size={14} /> : null}
                {mediaLabel(value, lt)}
                {tab === 'official' ? <small>{value === 'all' ? officialFacets.allMediaCount : mediaCount(value)}</small> : null}
              </button>
            ))}
          </div>
          {tab === 'official' ? (
            <div className="tanva-prompt-library__selects">
              <label><span>{lt('模型', 'Model')}</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">{lt('全部模型', 'All models')}</option>{officialFacets.models.map((item) => <option value={item.slug} key={item.slug}>{item.name} · {item.count}</option>)}</select><ChevronDown size={13} /></label>
              <label><span>{lt('排序', 'Sort')}</span><select value={sort} onChange={(event) => setSort(event.target.value as PromptLibrarySort)}><option value="time_desc">{lt('最新', 'Newest')}</option><option value="time_asc">{lt('最早', 'Oldest')}</option><option value="name_asc">{lt('名称', 'Name')}</option></select><ChevronDown size={13} /></label>
              <span className="tanva-prompt-library__result-count">{officialTotal.toLocaleString()} {lt('条', 'items')}</span>
            </div>
          ) : <span className="tanva-prompt-library__account-hint">{lt('已保存到当前账号', 'Saved to your account')}</span>}
        </div>

        {error ? <div className="tanva-prompt-library__error" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}><X size={13} /></button></div> : null}

        <div ref={contentRef} className="tanva-prompt-library__content">
          {editorOpen ? (
            <section className="tanva-prompt-library__editor" aria-label={editingId ? lt('编辑提示词', 'Edit prompt') : lt('新建提示词', 'Create prompt')}>
              <div className="tanva-prompt-library__editor-heading">
                <div><strong>{editingId ? lt('编辑我的提示词', 'Edit my prompt') : lt('新建我的提示词', 'Create my prompt')}</strong><span>{lt('保存后可在任意设备登录当前账号使用', 'Available on every device signed in to this account')}</span></div>
                <button type="button" onClick={resetEditor} aria-label={lt('取消编辑', 'Cancel')}><X size={18} /></button>
              </div>
              <div className="tanva-prompt-library__editor-grid">
                <label><span>{lt('名称', 'Title')} *</span><input ref={titleInputRef} maxLength={120} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={lt('例如：电影感产品特写', 'e.g. Cinematic product close-up')} /></label>
                <label><span>{lt('素材类型', 'Media type')}</span><select value={draft.mediaType} onChange={(event) => setDraft((current) => ({ ...current, mediaType: event.target.value as PromptMediaType }))}><option value="image">{lt('图片', 'Image')}</option><option value="video">{lt('视频', 'Video')}</option></select></label>
                <label className="is-wide"><span>{lt('描述', 'Description')}</span><input maxLength={1000} value={draft.description || ''} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder={lt('一句话说明适用场景（可选）', 'Describe the use case (optional)')} /></label>
                <label className="is-wide"><span>{lt('提示词', 'Prompt')} *</span><textarea maxLength={50000} value={draft.promptText} onChange={(event) => setDraft((current) => ({ ...current, promptText: event.target.value }))} placeholder={lt('输入要复用的完整提示词…', 'Enter the complete reusable prompt…')} /></label>
                <div className="tanva-prompt-library__cover-field">
                  <span>{lt('卡片封面', 'Card cover')}</span>
                  {coverPreviewUrl ? (
                    <div className="tanva-prompt-library__cover-preview">
                      <img src={coverPreviewUrl} alt={lt('封面预览', 'Cover preview')} />
                      <div>
                        <label className="tanva-prompt-library__cover-action">
                          <UploadCloud size={15} />{lt('更换封面', 'Replace cover')}
                          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => chooseCover(event.target.files?.[0] || null)} />
                        </label>
                        <button type="button" className="tanva-prompt-library__cover-remove" onClick={removeCover}><Trash2 size={14} />{lt('移除', 'Remove')}</button>
                      </div>
                    </div>
                  ) : (
                    <label
                      className="tanva-prompt-library__cover-dropzone"
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
                      onDrop={(event) => { event.preventDefault(); chooseCover(event.dataTransfer.files?.[0] || null); }}
                    >
                      <UploadCloud size={24} />
                      <strong>{lt('点击或拖入封面图片', 'Click or drop a cover image')}</strong>
                      <small>{lt('支持 JPG、PNG、WebP、GIF，最大 12MB', 'JPG, PNG, WebP, or GIF up to 12MB')}</small>
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => chooseCover(event.target.files?.[0] || null)} />
                    </label>
                  )}
                </div>
              </div>
              <div className="tanva-prompt-library__editor-actions">
                <span role="alert">{formError}</span>
                <button type="button" className="is-secondary" onClick={resetEditor}>{lt('取消', 'Cancel')}</button>
                <button type="button" className="is-primary" disabled={saving} onClick={() => void saveCustomItem()}>{saving ? <Loader2 size={15} className="is-spinning" /> : <Check size={15} />}{lt('保存到账号', 'Save to account')}</button>
              </div>
            </section>
          ) : isLoading ? <SkeletonCards /> : displayedItems.length > 0 ? (
            <div className="tanva-prompt-library__grid" role="list">
              {tab === 'official' ? (displayedItems as OfficialPromptItem[]).map((item) => {
                const orderedMedia = [...item.media].sort((a, b) => a.order - b.order);
                const media = orderedMedia.find((candidate) => candidate.kind === item.mediaType) || orderedMedia[0];
                const saved = favorites.has(favoriteKey('official', item.id));
                return (
                  <article className="tanva-prompt-library__card" role="listitem" key={item.id} onClick={() => applyPrompt(item.promptText)}>
                    <div className="tanva-prompt-library__preview">
                      <PromptMediaPreview type={item.mediaType} url={media?.url || null} thumbnailUrl={media?.thumbnailUrl} title={item.title} hoverLabel={lt('悬浮预览视频', 'Hover to preview video')} />
                      <span className={`tanva-prompt-library__type is-${item.mediaType}`}>{item.mediaType === 'video' ? <Play size={11} fill="currentColor" /> : <ImageIcon size={11} />}{mediaLabel(item.mediaType, lt)}</span>
                      <button type="button" className={`tanva-prompt-library__favorite${saved ? ' is-active' : ''}`} aria-label={saved ? lt('取消常用', 'Remove favorite') : lt('设为常用', 'Add favorite')} onClick={(event) => { event.stopPropagation(); void toggleFavorite('official', item.id); }}><Star size={17} fill={saved ? 'currentColor' : 'none'} /></button>
                      <div className="tanva-prompt-library__card-copy"><strong>{item.title}</strong><span>{item.models[0]?.name || item.authorLabel}</span></div>
                    </div>
                    <p>{item.description || item.promptText}</p>
                  </article>
                );
              }) : (displayedItems as UserPromptItem[]).map((item) => {
                const saved = favorites.has(favoriteKey('custom', item.id));
                return (
                  <article className="tanva-prompt-library__card is-custom" role="listitem" key={item.id} onClick={() => applyPrompt(item.promptText)}>
                    <div className="tanva-prompt-library__preview">
                      <PromptMediaPreview type={item.previewUrl ? 'image' : item.mediaType} url={item.previewUrl} title={item.title} hoverLabel={lt('悬浮预览视频', 'Hover to preview video')} />
                      <span className={`tanva-prompt-library__type is-${item.mediaType}`}>{item.mediaType === 'video' ? <Play size={11} fill="currentColor" /> : <ImageIcon size={11} />}{mediaLabel(item.mediaType, lt)}</span>
                      <div className="tanva-prompt-library__card-copy"><strong>{item.title}</strong><span>{lt('我的提示词', 'My prompt')}</span></div>
                    </div>
                    <p>{item.description || item.promptText}</p>
                    <div className="tanva-prompt-library__custom-actions">
                      <button type="button" className={saved ? 'is-active' : ''} onClick={(event) => { event.stopPropagation(); void toggleFavorite('custom', item.id); }}><Star size={14} fill={saved ? 'currentColor' : 'none'} />{lt('常用', 'Saved')}</button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); startEdit(item); }}><Edit3 size={14} />{lt('编辑', 'Edit')}</button>
                      <button type="button" className="is-danger" onClick={(event) => { event.stopPropagation(); void deleteCustomItem(item); }}><Trash2 size={14} />{lt('删除', 'Delete')}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="tanva-prompt-library__empty">
              <span><BookOpen size={28} /></span>
              <strong>{favoritesOnly ? lt('这里还没有常用提示词', 'No saved prompts here yet') : lt('没有找到匹配内容', 'No matching prompts')}</strong>
              <p>{tab === 'custom' ? lt('新建一条并保存到账号，之后可以随时复用。', 'Create one and save it to your account for reuse.') : lt('调整搜索词、模型或素材类型后再试。', 'Try another search, model, or media type.')}</p>
              {tab === 'custom' && !favoritesOnly ? <button type="button" onClick={startCreate}><Plus size={15} />{lt('新建提示词', 'Create prompt')}</button> : null}
            </div>
          )}
          {tab === 'official' && !loadingOfficial && !favoritesOnly && officialItems.length > 0 ? (
            hasMore ? (
              <div ref={loadMoreSentinelRef} className={`tanva-prompt-library__auto-load${loadingMore ? ' is-loading' : ''}`} aria-live="polite">
                {loadingMore ? <><span /><span /><span /><small>{lt('正在加载更多案例', 'Loading more examples')}</small></> : null}
              </div>
            ) : <p className="tanva-prompt-library__end">{lt(`已加载全部 ${officialTotal.toLocaleString()} 条`, `All ${officialTotal.toLocaleString()} prompts loaded`)}</p>
          ) : null}
        </div>

        <footer className="tanva-prompt-library__footer">
          <div><span>{lt('点击卡片时', 'On card click')}</span><div role="group">{(['replace', 'append'] as const).map((value) => <button type="button" key={value} className={applyMode === value ? 'is-active' : ''} onClick={() => setApplyMode(value)}>{value === 'replace' ? lt('替换', 'Replace') : lt('追加', 'Append')}</button>)}</div></div>
          <span>{tab === 'official' ? lt('数据源 · TapCanvas Prompt Library', 'Source · TapCanvas Prompt Library') : lt('账号云端保存', 'Saved to your account')}</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
