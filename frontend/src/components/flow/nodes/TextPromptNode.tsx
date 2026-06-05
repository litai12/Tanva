import React from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type ReactFlowState, type Edge } from 'reactflow';
import { resolveTextFromSourceNode } from '../utils/textSource';
import useNodeInternalsSync from '../hooks/useNodeInternalsSync';
import { usePromptSiblingImages, type SiblingImage } from '../hooks/usePromptSiblingImages';
import PromptImageStrip from './PromptImageStrip';
import { useLocaleText } from '@/utils/localeText';
import { useCanvasStore } from '@/stores';
import { useProjectContentStore } from '@/stores/projectContentStore';
import {
  globalImageHistoryApi,
  type GlobalImageHistoryItem,
} from '@/services/globalImageHistoryApi';
import { getGlobalHistoryMediaType } from '@/components/global-history/historyMedia';
import { personalLibraryApi } from '@/services/personalLibraryApi';
import {
  usePersonalLibraryStore,
  type PersonalImageAsset,
} from '@/stores/personalLibraryStore';
import {
  hasPromptMentionTokenInText,
  isPromptMentionTokenBoundary,
  normalizePromptImageMentions,
  type PromptImageMention,
  type PromptMentionSource,
} from '../types';
import { useFlowNodeDarkTheme } from './flowNodeDarkTheme';
import SmartImage from '@/components/ui/SmartImage';

type Props = {
  id: string;
  data: {
    text?: string;
    mentions?: PromptImageMention[];
    boxW?: number;
    boxH?: number;
    title?: string;
  };
  selected?: boolean;
};

const DEFAULT_TITLE = 'Prompt';
const MIN_NODE_WIDTH = 180;
const MIN_NODE_HEIGHT = 120;
const PROMPT_MENTION_LINE_HEIGHT_PX = 17;
const MENTION_LIBRARY_FETCH_TIMEOUT_MS = 8000;
const MENTION_LIBRARY_RETRY_COOLDOWN_MS = 30000;
type MentionTab = 'flow' | 'project-library' | 'personal-library';

type MentionCandidate = {
  id: string;
  source: PromptMentionSource;
  title: string;
  subtitle?: string;
  previewUrl: string;
  tokenHint: string;
  flowImage?: SiblingImage;
  ref: PromptImageMention['ref'];
};

type MentionTokenRange = {
  start: number;
  end: number;
  mention: PromptImageMention;
};

type MentionPreviewItem = {
  id: string;
  token: string;
  label: string;
  previewUrl: string;
  isVideo: boolean;
};

const MENTION_TABS: MentionTab[] = ['flow', 'project-library', 'personal-library'];

const sanitizePromptMentionsForText = (
  text: string,
  mentions: PromptImageMention[]
): PromptImageMention[] => {
  if (!mentions.length) return [];
  return mentions.filter((mention) => {
    const token = typeof mention.token === 'string' ? mention.token.trim() : '';
    return token.startsWith('@') && hasPromptMentionTokenInText(text, token);
  });
};

const arePromptMentionsEqual = (
  left: PromptImageMention[],
  right: PromptImageMention[]
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (
      a.id !== b.id ||
      a.token !== b.token ||
      a.label !== b.label ||
      a.source !== b.source ||
      a.ref.nodeId !== b.ref.nodeId ||
      a.ref.handle !== b.ref.handle ||
      a.ref.historyId !== b.ref.historyId ||
      a.ref.assetId !== b.ref.assetId ||
      a.ref.url !== b.ref.url
    ) {
      return false;
    }
  }
  return true;
};

const isUsableRemoteImageRef = (value?: string | null): value is string => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return trimmed.startsWith('/') || trimmed.startsWith('projects/') || trimmed.startsWith('uploads/');
};

const getMentionTabLabel = (tab: MentionTab, lt: (zh: string, en: string) => string): string => {
  if (tab === 'flow') return lt('工作流', 'Workflow');
  if (tab === 'project-library') return lt('项目库', 'Project');
  return lt('资产库', 'Assets');
};

const isResolvedMentionAt = (
  text: string,
  atIndex: number,
  mentions: PromptImageMention[]
): boolean => {
  if (atIndex < 0 || mentions.length === 0) return false;
  return mentions.some((mention) => {
    const token = typeof mention.token === 'string' ? mention.token.trim() : '';
    if (!token || !token.startsWith('@')) return false;
    return text.startsWith(token, atIndex) && isPromptMentionTokenBoundary(text, token, atIndex);
  });
};

const getPromptMentionTokenRanges = (
  text: string,
  mentions: PromptImageMention[]
): MentionTokenRange[] => {
  if (!text || mentions.length === 0) return [];
  const usableMentions = mentions
    .map((mention) => ({
      mention,
      token: typeof mention.token === 'string' ? mention.token.trim() : '',
    }))
    .filter((item) => item.token.startsWith('@'))
    .sort((a, b) => b.token.length - a.token.length);
  if (usableMentions.length === 0) return [];

  const ranges: MentionTokenRange[] = [];
  let index = 0;
  while (index < text.length) {
    const match = usableMentions.find(
      (item) =>
        text.startsWith(item.token, index) &&
        isPromptMentionTokenBoundary(text, item.token, index)
    );
    if (!match) {
      index += 1;
      continue;
    }
    ranges.push({
      start: index,
      end: index + match.token.length,
      mention: match.mention,
    });
    index += match.token.length;
  }
  return ranges;
};

const getMentionDeletionRange = (
  text: string,
  mentions: PromptImageMention[],
  selectionStart: number,
  selectionEnd: number,
  key: 'Backspace' | 'Delete'
): { start: number; end: number } | null => {
  const ranges = getPromptMentionTokenRanges(text, mentions);
  if (ranges.length === 0) return null;

  if (selectionStart !== selectionEnd) {
    const affected = ranges.filter((range) => range.start < selectionEnd && range.end > selectionStart);
    if (affected.length === 0) return null;
    return {
      start: Math.min(selectionStart, ...affected.map((range) => range.start)),
      end: Math.max(selectionEnd, ...affected.map((range) => range.end)),
    };
  }

  const cursor = selectionStart;
  const range =
    key === 'Backspace'
      ? ranges.find((item) => item.start < cursor && cursor <= item.end)
      : ranges.find((item) => item.start <= cursor && cursor < item.end);
  return range ? { start: range.start, end: range.end } : null;
};

const getMentionRangeContainingCursor = (
  text: string,
  mentions: PromptImageMention[],
  cursor: number
): MentionTokenRange | null =>
  getPromptMentionTokenRanges(text, mentions).find(
    (range) => range.start < cursor && cursor < range.end
  ) ?? null;

const getPromptMentionChipLabel = (mention: PromptImageMention): string => {
  const tokenLabel = mention.token.replace(/^@/, '').trim();
  const rawLabel = (mention.label || tokenLabel).trim();
  return rawLabel || tokenLabel;
};

const getPromptMentionDisplayLabel = (
  mention: PromptImageMention,
  mentionTitleById: Map<string, string>
): string =>
  getPromptMentionLookupKeys(mention)
    .map((key) => mentionTitleById.get(key))
    .find((label): label is string => Boolean(label)) ||
  getPromptMentionChipLabel(mention);

const pickPromptMentionTitle = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const normalizePromptMentionTokenLabel = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/^@+/, '').trim();

const getPromptMentionTokenHint = (label: string, fallback: string): string => {
  const normalized = normalizePromptMentionTokenLabel(label) || fallback;
  return `@${normalized}`;
};

const getProjectHistoryMentionTitle = (
  item: GlobalImageHistoryItem,
  index: number,
  lt: (zh: string, en: string) => string
): string => {
  const metadata = item.metadata ?? {};
  return pickPromptMentionTitle(
    metadata.title,
    metadata.name,
    metadata.displayName,
    metadata.fileName,
    metadata.filename,
    metadata.imageName,
    item.prompt,
    item.sourceProjectName
  ) ?? lt(`项目图${index + 1}`, `Project image ${index + 1}`);
};

const getMentionCandidateLookupKeys = (candidate: MentionCandidate): string[] => {
  const keys = [candidate.id];
  if (candidate.ref.nodeId) keys.push(`${candidate.source}:node:${candidate.ref.nodeId}`);
  if (candidate.ref.nodeId && candidate.ref.handle) keys.push(`${candidate.source}:node:${candidate.ref.nodeId}:handle:${candidate.ref.handle}`);
  if (candidate.ref.historyId) keys.push(`${candidate.source}:history:${candidate.ref.historyId}`);
  if (candidate.ref.assetId) keys.push(`${candidate.source}:asset:${candidate.ref.assetId}`);
  if (candidate.ref.url) keys.push(`${candidate.source}:url:${candidate.ref.url}`);
  return keys;
};

const getPromptMentionLookupKeys = (mention: PromptImageMention): string[] => {
  const keys = [mention.id];
  if (mention.ref.nodeId) keys.push(`${mention.source}:node:${mention.ref.nodeId}`);
  if (mention.ref.nodeId && mention.ref.handle) keys.push(`${mention.source}:node:${mention.ref.nodeId}:handle:${mention.ref.handle}`);
  if (mention.ref.historyId) keys.push(`${mention.source}:history:${mention.ref.historyId}`);
  if (mention.ref.assetId) keys.push(`${mention.source}:asset:${mention.ref.assetId}`);
  if (mention.ref.url) keys.push(`${mention.source}:url:${mention.ref.url}`);
  return keys;
};

const sortPromptMentionsByTextOrder = (
  text: string,
  mentions: PromptImageMention[]
): PromptImageMention[] =>
  mentions
    .slice()
    .sort((a, b) => {
      const ai = text.indexOf(a.token);
      const bi = text.indexOf(b.token);
      return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    });

function TextPromptNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const isFlowDark = useFlowNodeDarkTheme();
  const [value, setValue] = React.useState<string>(data.text || '');
  const [hover, setHover] = React.useState<string | null>(null);
  const [incomingTexts, setIncomingTexts] = React.useState<string[]>([]);
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizePreview, setResizePreview] = React.useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const edgesRef = React.useRef<Edge[]>(edges);
  const borderColor = selected ? '#2563eb' : isFlowDark ? '#333333' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : isFlowDark
      ? 'none'
      : '0 1px 2px rgba(0,0,0,0.04)';
  const nodeBackground = isFlowDark ? '#1c1c1c' : '#fff';
  const inputBackground = isFlowDark ? '#151515' : 'rgba(255,255,255,0.92)';
  const inputBorderColor = isFlowDark ? '#3a3a3a' : '#e5e7eb';
  const promptTextColor = isFlowDark ? '#e5e7eb' : '#1f2937';
  const promptCaretColor = isFlowDark ? '#f8fafc' : '#111827';
  const mutedTextColor = isFlowDark ? '#a3a3a3' : '#6b7280';
  const buttonBackground = isFlowDark ? '#252525' : '#fff';
  const buttonTextColor = isFlowDark ? '#d1d5db' : '#374151';
  const normalizedTitle = typeof data.title === 'string' && data.title.trim().length
    ? data.title.trim()
    : DEFAULT_TITLE;
  const [title, setTitle] = React.useState<string>(normalizedTitle);
  const [titleDraft, setTitleDraft] = React.useState<string>(normalizedTitle);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const mentionOverlayInnerRef = React.useRef<HTMLDivElement>(null);
  const siblingImages = usePromptSiblingImages(id);
  const nodeRootRef = React.useRef<HTMLDivElement | null>(null);
  const isComposingRef = React.useRef(false);
  const [isComposing, setIsComposing] = React.useState(false);
  const [atMention, setAtMention] = React.useState<{
    startIndex: number;
    query: string;
    selectedIdx: number;
  } | null>(null);
  const [activeMentionTab, setActiveMentionTab] = React.useState<MentionTab>('flow');
  const [dropdownPos, setDropdownPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const [mentions, setMentions] = React.useState<PromptImageMention[]>(
    () => normalizePromptImageMentions(data.mentions)
  );
  const mentionsRef = React.useRef<PromptImageMention[]>(mentions);
  const projectId = useProjectContentStore((state) => state.projectId);
  const personalAssets = usePersonalLibraryStore((state) => state.assets);
  const mergePersonalAssets = usePersonalLibraryStore((state) => state.mergeAssets);
  const [projectLibraryItems, setProjectLibraryItems] = React.useState<GlobalImageHistoryItem[]>([]);
  const [projectLibraryLoading, setProjectLibraryLoading] = React.useState(false);
  const [personalLibraryLoading, setPersonalLibraryLoading] = React.useState(false);
  const projectLibraryLoadedForRef = React.useRef<string | null>(null);
  const personalLibraryLoadedRef = React.useRef(false);
  const projectLibraryLoadingRef = React.useRef(false);
  const personalLibraryLoadingRef = React.useRef(false);
  const projectLibraryFailedAtRef = React.useRef(0);
  const personalLibraryFailedAtRef = React.useRef(0);
  const incomingCount = incomingTexts.length;
  const hasIncoming = incomingCount > 0;
  const shouldPassWheelToCanvas = React.useCallback((event: React.WheelEvent<HTMLTextAreaElement>) => {
    const store = useCanvasStore.getState();
    const isModifierWheel = event.ctrlKey || event.metaKey;
    return store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;
  }, []);
  const isPromptEditable = selected === true;
  React.useEffect(() => {
    mentionsRef.current = mentions;
  }, [mentions]);

  React.useEffect(() => {
    const normalized = normalizePromptImageMentions(data.mentions);
    setMentions((prev) => (arePromptMentionsEqual(prev, normalized) ? prev : normalized));
  }, [data.mentions]);

  const flowMentionCandidates = React.useMemo<MentionCandidate[]>(
    () =>
      siblingImages.map((img) => {
        const title = img.title || lt(`图${img.index}`, `Image ${img.index}`);
        return {
          id: `flow:${img.nodeId}:${img.sourceHandle || 'default'}:${img.index}`,
          source: 'flow' as const,
          title,
          subtitle: lt('当前工作流', 'Current workflow'),
          previewUrl: img.url,
          tokenHint: getPromptMentionTokenHint('', `图${img.index}`),
          flowImage: img,
          ref: { nodeId: img.nodeId, handle: img.sourceHandle },
        };
      }),
    [lt, siblingImages]
  );

  const projectMentionCandidates = React.useMemo<MentionCandidate[]>(
    () =>
      projectLibraryItems
        .filter((item) => getGlobalHistoryMediaType(item) === 'image')
        .map((item, index) => {
          const title = getProjectHistoryMentionTitle(item, index, lt);
          return {
            id: `project-library:${item.id}`,
            source: 'project-library' as const,
            title,
            subtitle: item.sourceProjectName || lt('项目库', 'Project library'),
            previewUrl: item.imageUrl,
            tokenHint: getPromptMentionTokenHint(title, `项目图${index + 1}`),
            ref: {
              historyId: item.id,
              url: item.imageUrl,
            },
          };
        })
        .filter((item) => isUsableRemoteImageRef(item.ref.url)),
    [lt, projectLibraryItems]
  );

  const personalMentionCandidates = React.useMemo<MentionCandidate[]>(
    () =>
      personalAssets
        .filter((asset): asset is PersonalImageAsset => asset.type === '2d' && isUsableRemoteImageRef(asset.url))
        .map((asset, index) => ({
          id: `personal-library:${asset.id}`,
          source: 'personal-library' as const,
          title: asset.name || asset.fileName || lt(`资产${index + 1}`, `Asset ${index + 1}`),
          subtitle: asset.fileName || lt('个人资产库', 'Personal assets'),
          previewUrl: asset.thumbnail || asset.url,
          tokenHint: getPromptMentionTokenHint(asset.name || asset.fileName || '', `资产${index + 1}`),
          ref: {
            assetId: asset.id,
            url: asset.url,
          },
        })),
    [lt, personalAssets]
  );

  const candidateGroups = React.useMemo<Record<MentionTab, MentionCandidate[]>>(
    () => ({
      flow: flowMentionCandidates,
      'project-library': projectMentionCandidates,
      'personal-library': personalMentionCandidates,
    }),
    [flowMentionCandidates, personalMentionCandidates, projectMentionCandidates]
  );
  const mentionTitleById = React.useMemo(() => {
    const next = new Map<string, string>();
    Object.values(candidateGroups).forEach((candidates) => {
      candidates.forEach((candidate) => {
        const title = candidate.title.trim();
        if (!title) return;
        getMentionCandidateLookupKeys(candidate).forEach((key) => {
          next.set(key, title);
        });
      });
    });
    return next;
  }, [candidateGroups]);
  const mentionCandidateById = React.useMemo(() => {
    const next = new Map<string, MentionCandidate>();
    Object.values(candidateGroups).forEach((candidates) => {
      candidates.forEach((candidate) => {
        getMentionCandidateLookupKeys(candidate).forEach((key) => {
          if (!next.has(key)) next.set(key, candidate);
        });
      });
    });
    return next;
  }, [candidateGroups]);

  const filterMentionCandidates = React.useCallback((
    candidates: MentionCandidate[],
    query: string
  ): MentionCandidate[] => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((candidate) => {
      const haystack = [
        candidate.title,
        candidate.subtitle,
        candidate.tokenHint,
        candidate.ref.assetId,
        candidate.ref.historyId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, []);

  const activeMentionCandidates = React.useMemo(
    () =>
      !isPromptEditable || !atMention
        ? []
        : filterMentionCandidates(candidateGroups[activeMentionTab], atMention.query),
    [activeMentionTab, atMention, candidateGroups, filterMentionCandidates, isPromptEditable]
  );
  const syncTypedCandidateMentions = React.useCallback((
    text: string,
    baseMentions: PromptImageMention[]
  ): PromptImageMention[] => {
    const byToken = new Map<string, PromptImageMention>();
    sanitizePromptMentionsForText(text, baseMentions).forEach((mention) => {
      byToken.set(mention.token, mention);
    });

    Object.values(candidateGroups).forEach((candidates) => {
      candidates.forEach((candidate) => {
        const token = typeof candidate.tokenHint === 'string' ? candidate.tokenHint.trim() : '';
        if (!token.startsWith('@')) return;
        if (!hasPromptMentionTokenInText(text, token)) return;
        const label = candidate.title.trim() || token.replace(/^@/, '');
        byToken.set(token, {
          id: candidate.id,
          token,
          label,
          source: candidate.source,
          mediaType: 'image',
          ref: candidate.ref,
        });
      });
    });

    return sortPromptMentionsByTextOrder(text, Array.from(byToken.values()));
  }, [candidateGroups]);
  const mentionTokenRanges = React.useMemo(
    () => getPromptMentionTokenRanges(value, mentions),
    [mentions, value]
  );
  const shouldRenderMentionOverlay = mentionTokenRanges.length > 0 && !isComposing;
  const mentionOverlayNodes = React.useMemo(() => {
    if (mentionTokenRanges.length === 0) return [value];
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    mentionTokenRanges.forEach((range, index) => {
      if (range.start > cursor) {
        nodes.push(value.slice(cursor, range.start));
      }
      const displayLabel = getPromptMentionDisplayLabel(range.mention, mentionTitleById);
      nodes.push(
        <span
          key={`${range.mention.id}-${range.start}-${index}`}
          className="tanva-prompt-mention-token"
          title={displayLabel}
        >
          <span className="tanva-prompt-mention-token-text">{range.mention.token}</span>
        </span>
      );
      cursor = range.end;
    });
    if (cursor < value.length) {
      nodes.push(value.slice(cursor));
    }
    return nodes.length ? nodes : [value];
  }, [mentionTitleById, mentionTokenRanges, value]);

  const mentionPreviewItems = React.useMemo<MentionPreviewItem[]>(() => {
    if (!mentions.length || !value) return [];
    const out: MentionPreviewItem[] = [];
    const seen = new Set<string>();

    for (const mention of mentions) {
      const token = typeof mention.token === 'string' ? mention.token.trim() : '';
      if (!token || !hasPromptMentionTokenInText(value, token)) continue;
      const candidate = getPromptMentionLookupKeys(mention)
        .map((key) => mentionCandidateById.get(key))
        .find((item): item is MentionCandidate => Boolean(item));
      const previewUrl =
        candidate?.previewUrl ||
        (mention.source !== 'flow' && typeof mention.ref.url === 'string'
          ? mention.ref.url.trim()
          : '');
      if (!previewUrl) continue;
      const dedupeKey = `${mention.id}::${token}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        id: dedupeKey,
        token,
        label: candidate?.title.trim() || getPromptMentionDisplayLabel(mention, mentionTitleById),
        previewUrl,
        isVideo: candidate?.flowImage?.isVideo === true,
      });
    }

    return out;
  }, [mentionCandidateById, mentionTitleById, mentions, value]);

  const mentionedFlowRefs = React.useMemo(() => {
    const next = new Set<string>();
    mentions.forEach((mention) => {
      if (mention.source === 'flow' && mention.ref.nodeId && hasPromptMentionTokenInText(value, mention.token)) {
        next.add(`${mention.ref.nodeId}:${mention.ref.handle || ''}`);
      }
    });
    return next;
  }, [mentions, value]);
  const insertableSiblingImages = React.useMemo(
    () => siblingImages.filter((img) => !mentionedFlowRefs.has(`${img.nodeId}:${img.sourceHandle || ''}`)),
    [mentionedFlowRefs, siblingImages]
  );

  const detectAtMention = React.useCallback((
    text: string,
    cursorPos: number,
    activeMentions: PromptImageMention[] = mentionsRef.current
  ) => {
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return null;
    if (isResolvedMentionAt(text, atIdx, activeMentions)) return null;
    const afterAt = before.slice(atIdx + 1);
    if (/[\s\n]/.test(afterAt)) return null;
    return { startIndex: atIdx, query: afterAt };
  }, []);

  const resizeStartRef = React.useRef<{ width: number; height: number; x: number; y: number } | null>(null);
  const resizePendingRef = React.useRef<{ width: number; height: number; offsetX: number; offsetY: number } | null>(null);
  const resizePreviewRafRef = React.useRef<number | null>(null);

  const applyIncomingText = React.useCallback((incoming: string) => {
    setValue((prev) => (prev === incoming ? prev : incoming));
    setMentions([]);
    const currentDataText = typeof data.text === 'string' ? data.text : '';
    const hasMentions = normalizePromptImageMentions(data.mentions).length > 0;
    if (currentDataText !== incoming || hasMentions) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { text: incoming, mentions: [] } }
      }));
    }
  }, [data.mentions, data.text, id]);

  const syncFromSource = React.useCallback((
    sourceId: string,
    sourceHandle?: string | null,
    optimisticPatch?: Record<string, unknown>
  ) => {
    const srcNode = rf.getNode(sourceId);
    const sourceForRead = srcNode && optimisticPatch
      ? { ...srcNode, data: { ...(srcNode.data as Record<string, unknown>), ...optimisticPatch } }
      : srcNode;
    const upstream = resolveTextFromSourceNode(sourceForRead, sourceHandle) || '';
    applyIncomingText(upstream);
  }, [rf, applyIncomingText]);

  const handleDisconnectInputs = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const currentEdges = rf.getEdges();
    const remain = currentEdges.filter(edge => !(edge.target === id && edge.targetHandle === 'text'));
    if (remain.length === currentEdges.length) return;
    setIncomingTexts([]);
    rf.setEdges(remain);
  }, [rf, id]);

  const collectIncomingTexts = React.useCallback((
    edgeList: Edge[],
    optimisticSource?: { sourceId: string; patch: Record<string, unknown> } | null
  ) => {
    const incomingEdges = edgeList
      .filter((edge) => edge.target === id && edge.targetHandle === 'text');
    if (!incomingEdges.length) return [];

    const decorated = incomingEdges.map((edge, index) => {
      const handle = edge.sourceHandle ?? undefined;
      let order = 1000 + index;
      if (typeof handle === 'string') {
        const promptMatch = handle.match(/^prompt(\d+)$/);
        if (promptMatch) {
          order = Number(promptMatch[1]);
        } else {
          const numericMatch = handle.match(/(\d+)/);
          if (numericMatch) {
            order = Number(numericMatch[1]);
          }
        }
      }
      return { edge, order, index };
    });

    decorated.sort((a, b) => (a.order - b.order) || (a.index - b.index));

    return decorated
      .map(({ edge }) => {
        const node = rf.getNode(edge.source);
        const sourceForRead = node && optimisticSource?.sourceId === edge.source
          ? {
              ...node,
              data: { ...(node.data as Record<string, unknown>), ...optimisticSource.patch },
            }
          : node;
        const resolved = resolveTextFromSourceNode(sourceForRead, edge.sourceHandle);
        return typeof resolved === 'string' && resolved.trim().length ? resolved.trim() : '';
      })
      .filter((text) => text.length > 0);
  }, [id, rf]);

  React.useEffect(() => {
    // keep internal state in sync if external changes happen
    if (isComposingRef.current) return;
    if ((data.text || '') !== value) setValue(data.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.text]);

  React.useEffect(() => {
    setTitle(normalizedTitle);
    if (!isEditingTitle) {
      setTitleDraft(normalizedTitle);
    }
  }, [normalizedTitle, isEditingTitle]);

  React.useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  React.useEffect(() => {
    if (isPromptEditable) return;
    if (textareaRef.current && document.activeElement === textareaRef.current) {
      textareaRef.current.blur();
    }
    isComposingRef.current = false;
    setIsComposing(false);
    setAtMention(null);
  }, [isPromptEditable]);

  React.useEffect(() => {
    projectLibraryLoadedForRef.current = null;
    projectLibraryFailedAtRef.current = 0;
    setProjectLibraryItems([]);
  }, [projectId]);

  const loadProjectLibraryImages = React.useCallback(() => {
    const currentProjectId = typeof projectId === 'string' ? projectId.trim() : '';
    if (!currentProjectId) return;
    if (projectLibraryLoadedForRef.current === currentProjectId) return;
    if (projectLibraryLoadingRef.current) return;
    if (
      projectLibraryFailedAtRef.current > 0 &&
      Date.now() - projectLibraryFailedAtRef.current < MENTION_LIBRARY_RETRY_COOLDOWN_MS
    ) {
      return;
    }
    projectLibraryLoadingRef.current = true;
    setProjectLibraryLoading(true);
    void globalImageHistoryApi
      .list(
        { limit: 30, sourceProjectId: currentProjectId },
        { timeoutMs: MENTION_LIBRARY_FETCH_TIMEOUT_MS }
      )
      .then((result) => {
        const items = Array.isArray(result.items) ? result.items : [];
        setProjectLibraryItems(items.filter((item) => getGlobalHistoryMediaType(item) === 'image'));
        projectLibraryLoadedForRef.current = currentProjectId;
        projectLibraryFailedAtRef.current = 0;
      })
      .catch((error) => {
        projectLibraryFailedAtRef.current = Date.now();
        console.warn('[TextPromptNode] 拉取项目库图片失败:', error);
      })
      .finally(() => {
        projectLibraryLoadingRef.current = false;
        setProjectLibraryLoading(false);
      });
  }, [projectId]);

  const loadPersonalLibraryImages = React.useCallback(() => {
    if (personalLibraryLoadedRef.current) return;
    if (personalLibraryLoadingRef.current) return;
    if (
      personalLibraryFailedAtRef.current > 0 &&
      Date.now() - personalLibraryFailedAtRef.current < MENTION_LIBRARY_RETRY_COOLDOWN_MS
    ) {
      return;
    }
    personalLibraryLoadingRef.current = true;
    setPersonalLibraryLoading(true);
    void personalLibraryApi
      .list('2d', { timeoutMs: MENTION_LIBRARY_FETCH_TIMEOUT_MS })
      .then((assets) => {
        if (Array.isArray(assets) && assets.length) {
          mergePersonalAssets(assets);
        }
        personalLibraryLoadedRef.current = true;
        personalLibraryFailedAtRef.current = 0;
      })
      .catch((error) => {
        personalLibraryFailedAtRef.current = Date.now();
        console.warn('[TextPromptNode] 拉取个人库图片失败:', error);
      })
      .finally(() => {
        personalLibraryLoadingRef.current = false;
        setPersonalLibraryLoading(false);
      });
  }, [mergePersonalAssets]);

  React.useEffect(() => {
    if (!atMention || !isPromptEditable) return;
    loadProjectLibraryImages();
    loadPersonalLibraryImages();
  }, [atMention, isPromptEditable, loadPersonalLibraryImages, loadProjectLibraryImages]);

  React.useEffect(() => {
    if (!atMention) return;
    setActiveMentionTab(flowMentionCandidates.length > 0 ? 'flow' : 'project-library');
    setAtMention((prev) => prev ? { ...prev, selectedIdx: 0 } : prev);
  }, [atMention?.startIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    edgesRef.current = edges;
    const texts = collectIncomingTexts(edges);
    setIncomingTexts(texts);
    if (texts.length) {
      applyIncomingText(texts.join('\n\n'));
    }
  }, [edges, collectIncomingTexts, applyIncomingText]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch: Record<string, unknown> }>).detail;
      if (!detail?.id || detail.id === id) return;
      const isSourceLinked = edgesRef.current.some(
        (edge) => edge.target === id && edge.targetHandle === 'text' && edge.source === detail.id
      );
      if (!isSourceLinked) return;

      const patch = detail.patch || {};
      const texts = collectIncomingTexts(edgesRef.current, { sourceId: detail.id, patch });
      setIncomingTexts(texts);
      if (texts.length) {
        applyIncomingText(texts.join('\n\n'));
        return;
      }

      const incoming = edgesRef.current.find((edge) => edge.target === id && edge.targetHandle === 'text' && edge.source === detail.id);
      const textPatch = typeof patch.text === 'string' ? patch.text : undefined;
      if (typeof textPatch === 'string') return applyIncomingText(textPatch);
      const promptPatch = typeof patch.prompt === 'string' ? patch.prompt : undefined;
      if (typeof promptPatch === 'string') return applyIncomingText(promptPatch);
      if (incoming) {
        syncFromSource(detail.id, incoming.sourceHandle, patch);
      }
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, applyIncomingText, syncFromSource, collectIncomingTexts]);

  const startTitleEditing = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setTitleDraft(title);
    setIsEditingTitle(true);
  }, [title]);

  const commitTitle = React.useCallback((raw: string) => {
    const trimmed = raw.trim();
    const nextTitle = trimmed.length ? trimmed : DEFAULT_TITLE;
    setTitle(nextTitle);
    setTitleDraft(nextTitle);
    setIsEditingTitle(false);
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { title: nextTitle } }
    }));
  }, [id]);

  const cancelTitleEditing = React.useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(title);
  }, [title]);

  const commitValue = React.useCallback((next: string, nextMentions?: PromptImageMention[]) => {
    // write through to node data via DOM event (handled in FlowOverlay)
    const sanitizedMentions = syncTypedCandidateMentions(
      next,
      nextMentions ?? mentionsRef.current
    );
    const ev = new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { text: next, mentions: sanitizedMentions } }
    });
    window.dispatchEvent(ev);
  }, [id, syncTypedCandidateMentions]);

  const getReusableMention = React.useCallback((candidate: MentionCandidate): PromptImageMention | null => {
    return mentionsRef.current.find((mention) => mention.id === candidate.id) ?? null;
  }, []);

  const buildUniqueToken = React.useCallback((label: string, currentText: string): string => {
    const existingTokens = new Set(mentionsRef.current.map((mention) => mention.token));
    const normalized = normalizePromptMentionTokenLabel(label) || '图';
    const baseToken = `@${normalized}`;
    if (!currentText.includes(baseToken) && !existingTokens.has(baseToken)) {
      return baseToken;
    }
    for (let i = 2; i < 1000; i += 1) {
      const token = `${baseToken}-${i}`;
      if (!currentText.includes(token) && !existingTokens.has(token)) return token;
    }
    return `${baseToken}-${Date.now()}`;
  }, []);

  const createMentionFromCandidate = React.useCallback((
    candidate: MentionCandidate,
    currentText: string
  ): PromptImageMention => {
    const label = candidate.title.trim();
    const reusable = getReusableMention(candidate);
    if (reusable) {
      return label && reusable.label !== label ? { ...reusable, label } : reusable;
    }

    const tokenLabel =
      normalizePromptMentionTokenLabel(candidate.tokenHint.replace(/^@/, '')) ||
      label ||
      '图';
    const token = buildUniqueToken(tokenLabel, currentText);

    return {
      id: candidate.id,
      token,
      label: label || token.replace(/^@/, ''),
      source: candidate.source,
      mediaType: 'image',
      ref: candidate.ref,
    };
  }, [buildUniqueToken, getReusableMention]);

  const upsertMention = React.useCallback((
    list: PromptImageMention[],
    mention: PromptImageMention
  ): PromptImageMention[] => {
    const existingIdx = list.findIndex((item) => item.id === mention.id);
    if (existingIdx >= 0) {
      const next = list.slice();
      next[existingIdx] = mention;
      return next;
    }
    return [...list, mention];
  }, []);

  const insertMentionCandidate = React.useCallback((
    candidate: MentionCandidate,
    range?: { start: number; end: number }
  ) => {
    const el = textareaRef.current;
    if (!el) return;
    const selectionStart = range?.start ?? (el.selectionStart ?? value.length);
    const selectionEnd = range?.end ?? (el.selectionEnd ?? value.length);
    const mention = createMentionFromCandidate(candidate, value);
    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionEnd);
    const inserted = mention.token;
    const next = before + inserted + after;
    const nextMentions = syncTypedCandidateMentions(
      next,
      upsertMention(mentionsRef.current, mention)
    );
    mentionsRef.current = nextMentions;
    setMentions(nextMentions);
    setValue(next);
    commitValue(next, nextMentions);
    setAtMention(null);
    requestAnimationFrame(() => {
      el.focus();
      const newCursor = selectionStart + inserted.length;
      el.setSelectionRange(newCursor, newCursor);
    });
  }, [commitValue, createMentionFromCandidate, syncTypedCandidateMentions, upsertMention, value]);

  const handleMentionSelect = React.useCallback((candidate: MentionCandidate) => {
    const el = textareaRef.current;
    if (!el || !atMention) return;
    const cursorPos = el.selectionStart ?? value.length;
    insertMentionCandidate(candidate, {
      start: atMention.startIndex,
      end: cursorPos,
    });
  }, [atMention, insertMentionCandidate, value.length]);

  const handleFlowStripSelect = React.useCallback((img: SiblingImage) => {
    const candidate = flowMentionCandidates.find((item) => {
      const flowImage = item.flowImage;
      if (!flowImage) return false;
      return flowImage.nodeId === img.nodeId &&
        flowImage.index === img.index &&
        (flowImage.sourceHandle || '') === (img.sourceHandle || '');
    });
    if (!candidate) return;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    insertMentionCandidate(candidate, { start, end });
  }, [flowMentionCandidates, insertMentionCandidate, value.length]);

  const handleMentionPreviewSelect = React.useCallback((item: MentionPreviewItem) => {
    const el = textareaRef.current;
    if (!el) return;
    const index = value.indexOf(item.token);
    if (index < 0) return;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(index, index + item.token.length);
    });
  }, [value]);

  const deleteTextRange = React.useCallback((start: number, end: number) => {
    const el = textareaRef.current;
    const safeStart = Math.max(0, Math.min(start, value.length));
    const safeEnd = Math.max(safeStart, Math.min(end, value.length));
    const next = value.slice(0, safeStart) + value.slice(safeEnd);
    const nextMentions = syncTypedCandidateMentions(next, mentionsRef.current);
    mentionsRef.current = nextMentions;
    setMentions(nextMentions);
    setValue(next);
    commitValue(next, nextMentions);
    setAtMention(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(safeStart, safeStart);
    });
  }, [commitValue, syncTypedCandidateMentions, value]);

  const handleAtomicMentionDelete = React.useCallback((
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ): boolean => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    const el = event.currentTarget;
    const range = getMentionDeletionRange(
      value,
      mentionsRef.current,
      el.selectionStart ?? 0,
      el.selectionEnd ?? 0,
      event.key
    );
    if (!range) return false;
    event.preventDefault();
    deleteTextRange(range.start, range.end);
    return true;
  }, [deleteTextRange, value]);

  const handleMentionKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleAtomicMentionDelete(event)) return;
    if (!atMention) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setAtMention(null);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAtMention(prev => prev ? { ...prev, selectedIdx: Math.min(prev.selectedIdx + 1, Math.max(0, activeMentionCandidates.length - 1)) } : null);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAtMention(prev => prev ? { ...prev, selectedIdx: Math.max(prev.selectedIdx - 1, 0) } : null);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const candidate = activeMentionCandidates[atMention.selectedIdx];
      if (candidate) {
        event.preventDefault();
        handleMentionSelect(candidate);
      }
    }
  }, [activeMentionCandidates, atMention, handleAtomicMentionDelete, handleMentionSelect]);

  const handleInsert = React.useCallback((text: string) => {
    if (isComposingRef.current) return;
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    const nextMentions = syncTypedCandidateMentions(next, mentionsRef.current);
    mentionsRef.current = nextMentions;
    setMentions(nextMentions);
    setValue(next);
    commitValue(next, nextMentions);
    // Restore focus and move cursor after inserted text
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }, [commitValue, syncTypedCandidateMentions, value]);

  const handleValueChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    const cursorPos = event.target.selectionStart ?? next.length;
    const nativeEvent = event.nativeEvent as InputEvent & { isComposing?: boolean };
    const nextMentions = syncTypedCandidateMentions(next, mentionsRef.current);
    if (!arePromptMentionsEqual(mentionsRef.current, nextMentions)) {
      mentionsRef.current = nextMentions;
      setMentions(nextMentions);
    }
    setValue(next);
    if (!isComposingRef.current && !nativeEvent.isComposing) {
      commitValue(next, nextMentions);
    }
    const mention = detectAtMention(next, cursorPos, nextMentions);
    if (mention) {
      setAtMention(prev => ({
        ...mention,
        selectedIdx: prev?.startIndex === mention.startIndex ? prev.selectedIdx : 0,
      }));
    } else {
      setAtMention(null);
    }
  }, [commitValue, detectAtMention, syncTypedCandidateMentions]);

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true;
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = React.useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    setIsComposing(false);
    const next = event.currentTarget.value;
    const nextMentions = syncTypedCandidateMentions(next, mentionsRef.current);
    mentionsRef.current = nextMentions;
    setMentions(nextMentions);
    setValue(next);
    commitValue(next, nextMentions);
  }, [commitValue, syncTypedCandidateMentions]);

  const handleTextareaSelect = React.useCallback((event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const cursorPos = el.selectionStart ?? 0;
    const selectionEnd = el.selectionEnd ?? cursorPos;
    if (cursorPos === selectionEnd) {
      const range = getMentionRangeContainingCursor(el.value, mentionsRef.current, cursorPos);
      if (range) {
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(range.end, range.end);
        });
        setAtMention(null);
        return;
      }
    }
    const mention = detectAtMention(el.value, cursorPos, mentionsRef.current);
    if (!mention) setAtMention(null);
  }, [detectAtMention]);

  const handleTextareaScroll = React.useCallback((event: React.UIEvent<HTMLTextAreaElement>) => {
    const inner = mentionOverlayInnerRef.current;
    if (!inner) return;
    const el = event.currentTarget;
    inner.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
  }, []);

  React.useEffect(() => {
    if (atMention && textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    } else if (!atMention) {
      setDropdownPos(null);
    }
  }, [atMention !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!atMention) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setAtMention(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [atMention]);

  React.useEffect(() => {
    if (!atMention) return;
    if (activeMentionCandidates.length === 0) return;
    if (atMention.selectedIdx < activeMentionCandidates.length) return;
    setAtMention((prev) => prev ? { ...prev, selectedIdx: 0 } : prev);
  }, [activeMentionCandidates.length, atMention]);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    const inner = mentionOverlayInnerRef.current;
    if (!textarea || !inner) return;
    inner.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  }, [shouldRenderMentionOverlay, value]);

  const commitResize = React.useCallback((width: number, height: number, x: number, y: number) => {
    const nextWidth = Math.max(MIN_NODE_WIDTH, Math.round(width));
    const nextHeight = Math.max(MIN_NODE_HEIGHT, Math.round(height));
    const nextX = Math.round(x);
    const nextY = Math.round(y);
    rf.setNodes((ns) => {
      const targetIndex = ns.findIndex((node) => node.id === id);
      if (targetIndex < 0) return ns;

      const targetNode = ns[targetIndex];
      const targetData = targetNode.data || {};
      const positionChanged = targetNode.position.x !== nextX || targetNode.position.y !== nextY;
      const sizeChanged = targetData.boxW !== nextWidth || targetData.boxH !== nextHeight;
      if (!positionChanged && !sizeChanged) {
        return ns;
      }

      const nextNodes = ns.slice();
      nextNodes[targetIndex] = {
        ...targetNode,
        position: positionChanged
          ? { x: nextX, y: nextY }
          : targetNode.position,
        data: sizeChanged
          ? { ...targetData, boxW: nextWidth, boxH: nextHeight }
          : targetData,
      };
      return nextNodes;
    });
  }, [id, rf]);

  React.useEffect(() => {
    return () => {
      if (resizePreviewRafRef.current !== null) {
        window.cancelAnimationFrame(resizePreviewRafRef.current);
        resizePreviewRafRef.current = null;
      }
      resizePendingRef.current = null;
      resizeStartRef.current = null;
    };
  }, []);

  const handleResizeStart = React.useCallback((_: unknown, params: { width: number; height: number; x: number; y: number }) => {
    resizeStartRef.current = {
      width: Math.max(MIN_NODE_WIDTH, Math.round(params.width)),
      height: Math.max(MIN_NODE_HEIGHT, Math.round(params.height)),
      x: Math.round(params.x),
      y: Math.round(params.y),
    };
    resizePendingRef.current = null;
    setResizePreview(null);
    setIsResizing(true);
  }, []);

  const shouldResize = React.useCallback((_: unknown, params: { width: number; height: number; x: number; y: number }) => {
    const start = resizeStartRef.current;
    if (!start) return false;

    resizePendingRef.current = {
      width: Math.max(MIN_NODE_WIDTH, Math.round(params.width)),
      height: Math.max(MIN_NODE_HEIGHT, Math.round(params.height)),
      offsetX: Math.round(params.x - start.x),
      offsetY: Math.round(params.y - start.y),
    };

    if (resizePreviewRafRef.current !== null) return false;
    resizePreviewRafRef.current = window.requestAnimationFrame(() => {
      resizePreviewRafRef.current = null;
      setResizePreview(resizePendingRef.current);
    });
    return false;
  }, []);

  const handleResizeEnd = React.useCallback((_: unknown, params: { width: number; height: number; x: number; y: number }) => {
    setIsResizing(false);
    if (resizePreviewRafRef.current !== null) {
      window.cancelAnimationFrame(resizePreviewRafRef.current);
      resizePreviewRafRef.current = null;
    }

    const start = resizeStartRef.current;
    const pending = resizePendingRef.current;
    resizeStartRef.current = null;
    resizePendingRef.current = null;
    setResizePreview(null);

    const finalPreview = pending || {
      width: Math.max(MIN_NODE_WIDTH, Math.round(params.width)),
      height: Math.max(MIN_NODE_HEIGHT, Math.round(params.height)),
      offsetX: start ? Math.round(params.x - start.x) : 0,
      offsetY: start ? Math.round(params.y - start.y) : 0,
    };

    const baseX = start?.x ?? Math.round(params.x);
    const baseY = start?.y ?? Math.round(params.y);
    commitResize(
      finalPreview.width,
      finalPreview.height,
      baseX + finalPreview.offsetX,
      baseY + finalPreview.offsetY
    );
  }, [commitResize]);

  useNodeInternalsSync(
    id,
    nodeRootRef,
    [data.boxW, data.boxH, isEditingTitle, isPromptEditable],
    { disabled: isResizing }
  );

  const renderedBoxW = isResizing && resizePreview ? resizePreview.width : (data.boxW || 240);
  const renderedBoxH = isResizing && resizePreview ? resizePreview.height : (data.boxH || 180);
  const renderedOffsetX = isResizing && resizePreview ? resizePreview.offsetX : 0;
  const renderedOffsetY = isResizing && resizePreview ? resizePreview.offsetY : 0;
  const activeMentionLoading =
    activeMentionTab === 'project-library'
      ? projectLibraryLoading
      : activeMentionTab === 'personal-library'
      ? personalLibraryLoading
      : false;
  const showMentionLoading = activeMentionLoading && activeMentionCandidates.length === 0;
  const showMentionRefreshing = activeMentionLoading && activeMentionCandidates.length > 0;

  return (
    <div ref={nodeRootRef} style={{
      width: renderedBoxW,
      height: renderedBoxH,
      padding: 8,
      background: nodeBackground,
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow,
      color: promptTextColor,
      transition: isResizing ? 'none' : 'border-color 0.15s ease, box-shadow 0.15s ease',
      transform: isResizing ? `translate(${renderedOffsetX}px, ${renderedOffsetY}px)` : undefined,
      willChange: isResizing ? 'transform, width, height' : undefined,
      contain: isResizing ? 'layout paint' : undefined,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'visible'
    }}>
      <NodeResizer
        isVisible
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResizeStart={handleResizeStart}
        shouldResize={shouldResize}
        onResizeEnd={handleResizeEnd}
      />
      <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="tanva-flow-node-title"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => commitTitle(titleDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitle(titleDraft);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitleEditing();
              }
            }}
            style={{
              fontWeight: 600,
              fontSize: 13,
              border: `1px solid ${inputBorderColor}`,
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
              width: '100%',
              background: buttonBackground,
              color: promptTextColor,
            }}
          />
        ) : (
          <span
            className="tanva-flow-node-title"
            onDoubleClick={startTitleEditing}
            title={lt("双击编辑标题", "Double-click to edit title")}
            style={{ cursor: 'text', userSelect: 'none' }}
          >
            {title}
          </span>
        )}
        {hasIncoming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: mutedTextColor }}>
              {lt(`已拼接 ${incomingCount} 条输入`, `${incomingCount} inputs merged`)}
            </span>
            <button
              onClick={handleDisconnectInputs}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${inputBorderColor}`,
                background: buttonBackground,
                color: buttonTextColor,
                cursor: 'pointer'
              }}
            >
              {lt("内置", "Builtin")}
            </button>
          </div>
        )}
      </div>
      <div
        style={{
          position: 'relative',
          width: '100%',
          flex: 1,
          maxHeight: '100%',
          minHeight: 60,
          border: `1px solid ${inputBorderColor}`,
          borderRadius: 6,
          background: inputBackground,
          overflow: 'hidden',
        }}
      >
        {shouldRenderMentionOverlay && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <div
              ref={mentionOverlayInnerRef}
              style={{
                boxSizing: 'border-box',
                display: 'block',
                minHeight: '100%',
                width: '100%',
                padding: 6,
                fontSize: 12,
                lineHeight: `${PROMPT_MENTION_LINE_HEIGHT_PX}px`,
                color: promptTextColor,
                WebkitTextFillColor: promptTextColor,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                letterSpacing: 0,
              }}
            >
              {mentionOverlayNodes}
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          className={[
            "tanva-flow-text-input",
            shouldRenderMentionOverlay ? "tanva-prompt-mentions-textarea" : "",
            isPromptEditable ? "nodrag nopan nowheel" : "",
          ].filter(Boolean).join(" ")}
          value={value}
          readOnly={!isPromptEditable}
          tabIndex={isPromptEditable ? 0 : -1}
          onChange={handleValueChange}
          onKeyDown={handleMentionKeyDown}
          onSelect={handleTextareaSelect}
          onScroll={handleTextareaScroll}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onWheelCapture={(event) => {
            if (!isPromptEditable) return;
            if (shouldPassWheelToCanvas(event)) return;
            event.stopPropagation();
            if (event.nativeEvent?.stopImmediatePropagation) {
              event.nativeEvent.stopImmediatePropagation();
            }
          }}
          onPointerDownCapture={(event) => {
            if (!isPromptEditable) return;
            event.stopPropagation();
            if (event.nativeEvent?.stopImmediatePropagation) {
              event.nativeEvent.stopImmediatePropagation();
            }
          }}
          onMouseDownCapture={(event) => {
            if (!isPromptEditable) return;
            event.stopPropagation();
          }}
          placeholder={lt("输入提示词", "Enter prompt")}
          style={{
            position: 'absolute',
            inset: 0,
            boxSizing: 'border-box',
            display: 'block',
            width: '100%',
            height: '100%',
            resize: 'none',
            maxHeight: '100%',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            fontSize: 12,
            lineHeight: `${PROMPT_MENTION_LINE_HEIGHT_PX}px`,
            border: 'none',
            borderRadius: 6,
            padding: 6,
            outline: 'none',
            pointerEvents: isPromptEditable ? 'auto' : 'none',
            background: 'transparent',
            color: shouldRenderMentionOverlay ? 'transparent' : promptTextColor,
            WebkitTextFillColor: shouldRenderMentionOverlay ? 'transparent' : promptTextColor,
            caretColor: promptCaretColor,
            fontFamily: 'inherit',
            letterSpacing: 0,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            cursor: isPromptEditable ? 'text' : 'default',
            zIndex: 2,
          }}
        />
      </div>
      {mentionPreviewItems.length > 0 && (
        <div className="prompt-mentioned-strip nodrag nopan" aria-label={lt('已引用图片', 'Referenced images')}>
          {mentionPreviewItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="prompt-mentioned-strip__card"
              title={item.label}
              onPointerDownCapture={(e) => { e.stopPropagation(); }}
              onMouseDownCapture={(e) => { e.stopPropagation(); }}
              onClick={(e) => {
                e.stopPropagation();
                handleMentionPreviewSelect(item);
              }}
            >
              <SmartImage
                src={item.previewUrl}
                alt={item.label}
                className="prompt-mentioned-strip__img"
                draggable={false}
              />
              {item.isVideo && (
                <span className="prompt-mentioned-strip__video-icon" aria-hidden="true">▶</span>
              )}
              <span className="prompt-mentioned-strip__label">{item.token.replace(/^@/, '')}</span>
            </button>
          ))}
        </div>
      )}
      {isPromptEditable && insertableSiblingImages.length > 0 && (
        <PromptImageStrip images={insertableSiblingImages} onInsert={handleInsert} onImageSelect={handleFlowStripSelect} />
      )}
      {atMention && dropdownPos && createPortal(
        <div
          className="nodrag nopan"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: Math.max(Math.min(dropdownPos.width, 320), 260),
            zIndex: 10000,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
            {MENTION_TABS.map((tab) => {
              const isActive = tab === activeMentionTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMentionTab(tab);
                    setAtMention((prev) => prev ? { ...prev, selectedIdx: 0 } : prev);
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: `1px solid ${isActive ? '#2563eb' : '#e5e7eb'}`,
                    background: isActive ? '#eff6ff' : '#fff',
                    color: isActive ? '#1d4ed8' : '#374151',
                    borderRadius: 6,
                    padding: '4px 6px',
                    fontSize: 11,
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getMentionTabLabel(tab, lt)}
                  {candidateGroups[tab].length > 0 ? ` ${candidateGroups[tab].length}` : ''}
                </button>
              );
            })}
          </div>
          {showMentionLoading ? (
            <div style={{ padding: '16px 8px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
              {lt('加载中...', 'Loading...')}
            </div>
          ) : activeMentionCandidates.length === 0 ? (
            <div style={{ padding: '16px 8px', textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
              {lt('暂无可引用图片', 'No images to reference')}
            </div>
          ) : (
            <>
              {showMentionRefreshing && (
                <div style={{ color: '#6b7280', fontSize: 11, lineHeight: 1.2, padding: '0 2px' }}>
                  {lt('更新中...', 'Refreshing...')}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {activeMentionCandidates.map((candidate, idx) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleMentionSelect(candidate); }}
                    style={{
                      padding: 4,
                      borderRadius: 6,
                      border: `2px solid ${idx === atMention.selectedIdx ? '#2563eb' : 'transparent'}`,
                      background: idx === atMention.selectedIdx ? '#eff6ff' : '#f9fafb',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: 3,
                      minWidth: 0,
                    }}
                    title={candidate.title}
                  >
                    <img
                      src={candidate.previewUrl}
                      alt={candidate.title}
                      style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 4, display: 'block', background: '#f3f4f6' }}
                      draggable={false}
                    />
                    <span style={{
                      fontSize: 11,
                      color: '#374151',
                      lineHeight: 1.15,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {candidate.tokenHint}
                    </span>
                    <span style={{
                      fontSize: 10,
                      color: '#6b7280',
                      lineHeight: 1.15,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {candidate.title}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-out')}
        onMouseLeave={() => setHover(null)}
      />
      {hover === 'prompt-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>prompt</div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>prompt</div>
      )}
    </div>
  );
}

export default React.memo(TextPromptNodeInner);
