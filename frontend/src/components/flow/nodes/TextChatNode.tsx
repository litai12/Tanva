import React from 'react';
import { Check } from 'lucide-react';
import {
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  type ReactFlowState,
  type Edge,
} from 'reactflow';
import { aiImageService } from '@/services/aiImageService';
import { useAIChatStore, getTextModelForProvider } from '@/stores/aiChatStore';
import { resolveTextFromSourceNode } from '../utils/textSource';
import { useLocaleText } from '@/utils/localeText';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import { resolveFlowModelProvider, type FlowModelProvider } from '@/utils/flowModelProvider';
import RunCreditBadge from './RunCreditBadge';
import { useBackendCreditsPreview } from '../hooks/useBackendCreditsPreview';

type TextChatStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type Props = {
  id: string;
  data: {
    title?: string;
    status?: TextChatStatus;
    error?: string;
    responseText?: string;
    manualInput?: string;
    textChatSkillId?: string;
    enableWebSearch?: boolean;
    lastPrompt?: string;
    boxW?: number;
    boxH?: number;
    sizeVersion?: number;
    modelProvider?: FlowModelProvider;
    creditsPerCall?: number;
  };
  selected?: boolean;
};

const TEXT_CHAT_NODE_SIZE_VERSION = 2;
const DEFAULT_TITLE = 'Text Chat';
const DEFAULT_NODE_HEIGHT = 300;
const MIN_NODE_HEIGHT = 260;
const LEGACY_NODE_HEIGHT = 540;
const NODE_VERTICAL_PADDING = 24;
const MAX_TEXT_CHAT_PROMPT_LENGTH = 6000;
type TextChatSkillId = 'custom' | 'shotSplit' | 'promptOptimize' | 'translate';

type TextChatSkillOption = {
  id: TextChatSkillId;
  label: string;
  description: string;
  prompt: string;
};

const DEFAULT_TEXT_CHAT_SKILL_ID: TextChatSkillId = 'custom';

const normalizeTextChatSkillId = (value?: string): TextChatSkillId => {
  if (value === 'custom') return 'custom';
  if (value === 'promptOptimize') return 'promptOptimize';
  if (value === 'translate') return 'translate';
  if (value === 'shotSplit') return 'shotSplit';
  return DEFAULT_TEXT_CHAT_SKILL_ID;
};

const buildNodeRequestPrompt = (rawPrompt: string): string => {
  if (rawPrompt.length <= MAX_TEXT_CHAT_PROMPT_LENGTH) {
    return rawPrompt;
  }
  return `${rawPrompt.slice(0, MAX_TEXT_CHAT_PROMPT_LENGTH)}\n\n[Prompt truncated for stability]`;
};

const pickTextFromNode = (edge: Edge, rfInstance: ReturnType<typeof useReactFlow>): string | undefined => {
  const source = rfInstance.getNode(edge.source);
  return resolveTextFromSourceNode(source, edge.sourceHandle);
};

const sameTextList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const stopFlowPan = (event: React.SyntheticEvent<Element, Event>) => {
  event.stopPropagation();
  const native = event.nativeEvent as Event & {
    stopImmediatePropagation?: () => void;
  };
  if (native?.stopImmediatePropagation) {
    native.stopImmediatePropagation();
  }
};

const TextChatNode: React.FC<Props> = ({ id, data, selected }) => {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const globalWebSearchEnabled = useAIChatStore((state) => state.enableWebSearch);
  const isDarkTheme = useAIChatStore((state) => state.chatTheme === 'black');
  const effectiveProvider = React.useMemo<FlowModelProvider>(
    () => resolveFlowModelProvider(data.modelProvider, aiProvider),
    [aiProvider, data.modelProvider]
  );
  const textModel = React.useMemo(
    () => getTextModelForProvider(effectiveProvider),
    [effectiveProvider]
  );
  const providerToggleOptions = React.useMemo<Array<{
    value: FlowModelProvider;
    label: string;
    description: string;
  }>>(
    () => [
      {
        value: 'banana-2.5',
        label: 'Fast',
        description: lt('Nano Banana/Gemini 2.5', 'Nano Banana/Gemini 2.5'),
      },
      {
        value: 'banana',
        label: 'Pro',
        description: lt('Nano Banana Pro/Gemini 3 Pro', 'Nano Banana Pro/Gemini 3 Pro'),
      },
      {
        value: 'banana-3.1',
        label: 'Ultra',
        description: lt('Nano Banana 2/Gemini 3.1', 'Nano Banana 2/Gemini 3.1'),
      },
    ],
    [lt]
  );
  const currentProviderValue = effectiveProvider;
  const currentProviderOption = React.useMemo(
    () =>
      providerToggleOptions.find((option) => option.value === currentProviderValue) ??
      providerToggleOptions[1],
    [currentProviderValue, providerToggleOptions]
  );
  const themePalette = React.useMemo(() => {
    if (!isDarkTheme) {
      return {
        nodeBg: '#fff',
        nodeBorder: selected ? '#2563eb' : '#e5e7eb',
        nodeShadow: selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)',
        title: '#111827',
        titleInputBg: '#fff',
        titleInputBorder: '#d1d5db',
        secondaryText: '#64748b',
        sectionLabel: '#1e293b',
        panelBg: '#f8fafc',
        panelBorder: '#e2e8f0',
        panelText: '#1f2937',
        panelMutedText: '#94a3b8',
        panelIndexText: '#94a3b8',
        textareaBg: '#fff',
        textareaBorder: '#d7dce5',
        textareaText: '#111827',
        runBg: '#111827',
        runBgDisabled: '#cbd5f5',
        runText: '#fff',
      };
    }

    return {
      nodeBg: 'linear-gradient(160deg, #1a1a1a 0%, #151515 55%, #101010 100%)',
      nodeBorder: selected ? '#4a4a4a' : '#303030',
      nodeShadow: selected ? '0 0 0 2px rgba(125,125,125,0.2), 0 14px 28px rgba(0,0,0,0.42)' : '0 10px 22px rgba(0,0,0,0.35)',
      title: '#ffffff',
      titleInputBg: '#202020',
      titleInputBorder: '#3a3a3a',
      secondaryText: '#7f7f7f',
      sectionLabel: '#7f7f7f',
      panelBg: '#121212',
      panelBorder: '#2f2f2f',
      panelText: '#ffffff',
      panelMutedText: '#7f7f7f',
      panelIndexText: '#7f7f7f',
      textareaBg: '#2a2a2a',
      textareaBorder: '#3d3d3d',
      textareaText: '#8a8a8a',
      runBg: '#2b2b2b',
      runBgDisabled: '#3c3c3c',
      runText: '#ffffff',
    };
  }, [isDarkTheme, selected]);

  // 获取生文积分（根据模型和路线动态计算）
  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: 'gemini-text',
    model: textModel,
    requestParams: {
      aiProvider: effectiveProvider,
      channelHint: bananaImageRoute === 'stable' ? 'tencent' : 'apimart',
    },
    enabled: true,
  });
  const resolvedRunCredits = backendCredits ?? data.creditsPerCall;

  const normalizedTitle = typeof data.title === 'string' && data.title.trim().length
    ? data.title.trim()
    : DEFAULT_TITLE;
  const [title, setTitle] = React.useState<string>(normalizedTitle);
  const [titleDraft, setTitleDraft] = React.useState<string>(normalizedTitle);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement | null>(null);
  const [manualInput, setManualInput] = React.useState<string>(data.manualInput || '');
  const [incomingTexts, setIncomingTexts] = React.useState<string[]>([]);
  const [isInvoking, setIsInvoking] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);
  const isComposingRef = React.useRef(false);

  const textChatSkillOptions = React.useMemo<TextChatSkillOption[]>(
    () => [
      {
        id: 'custom',
        label: lt('自定义', 'Custom'),
        description: lt('手动输入追加提示词', 'Manually enter an additional prompt'),
        prompt: '',
      },
      {
        id: 'shotSplit',
        label: lt('拆分镜头', 'Shot Split'),
        description: lt('把文本拆成可执行的镜头/分镜', 'Split text into actionable shots'),
        prompt: lt(
          `请把输入内容拆分为适合生图或视频生成的镜头列表。
输出要求：
1. 按镜头顺序编号。
2. 每个镜头包含：画面描述、主体动作、景别/构图、镜头运动、光线氛围、可直接用于生成的提示词。
3. 保留原始叙事逻辑，不要添加无关剧情。
4. 只输出拆分后的镜头内容，不要解释你的分析过程。`,
          `Split the input into a shot list suitable for image or video generation.
Output requirements:
1. Number each shot in sequence.
2. Each shot should include: visual description, subject action, framing/composition, camera movement, lighting/mood, and a ready-to-use generation prompt.
3. Preserve the original narrative logic and do not add unrelated story beats.
4. Return only the shot breakdown, without explaining your analysis process.`
        ),
      },
      {
        id: 'promptOptimize',
        label: lt('提示词优化', 'Prompt Optimize'),
        description: lt('优化成更清晰稳定的生成提示词', 'Refine into a clearer generation prompt'),
        prompt: lt(
          `请把输入内容优化为一段高质量、可直接用于生图或视频生成的提示词。
要求保留原意，并强化主体、场景、构图、光线、色彩、材质、风格和关键细节。
只输出优化后的提示词，不要解释，不要写标题，不要使用 Markdown。`,
          `Refine the input into a high-quality prompt ready for image or video generation.
Preserve the original intent and strengthen the subject, scene, composition, lighting, colors, materials, style, and key details.
Return only the optimized prompt. Do not explain, add headings, or use Markdown.`
        ),
      },
      {
        id: 'translate',
        label: lt('中英文转换', 'CN/EN Convert'),
        description: lt('中文转英文，英文转中文', 'Convert Chinese to English or English to Chinese'),
        prompt: lt(
          `请对输入内容进行中英文转换。
规则：
1. 如果主要是中文，转换为自然、准确、适合提示词使用的英文。
2. 如果主要是英文，转换为自然、准确的中文。
3. 保留原有结构、编号、参数、专有名词和模型关键词。
4. 只输出转换结果，不要解释，不要添加额外内容。`,
          `Convert the input between Chinese and English.
Rules:
1. If the input is mainly Chinese, convert it into natural, accurate English suitable for prompt use.
2. If the input is mainly English, convert it into natural, accurate Chinese.
3. Preserve the original structure, numbering, parameters, proper nouns, and model keywords.
4. Return only the converted result, without explanation or extra content.`
        ),
      },
    ],
    [lt]
  );
  const currentTextChatSkillId = normalizeTextChatSkillId(data.textChatSkillId);
  const currentTextChatSkill =
    textChatSkillOptions.find((option) => option.id === currentTextChatSkillId) ??
    textChatSkillOptions[0];
  const isCustomSkill = currentTextChatSkillId === 'custom';

  React.useEffect(() => {
    if (isComposingRef.current) return;
    const next = data.manualInput || '';
    setManualInput((prev) => (prev === next ? prev : next));
  }, [data.manualInput]);

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
    if (data.textChatSkillId === currentTextChatSkillId) return;
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { textChatSkillId: currentTextChatSkillId } }
    }));
  }, [currentTextChatSkillId, data.textChatSkillId, id]);

  React.useEffect(() => {
    if (data.sizeVersion === TEXT_CHAT_NODE_SIZE_VERSION) return;
    const patch: Record<string, unknown> = { sizeVersion: TEXT_CHAT_NODE_SIZE_VERSION };
    if (typeof data.boxH !== 'number' || data.boxH === LEGACY_NODE_HEIGHT) {
      patch.boxH = DEFAULT_NODE_HEIGHT;
    }
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [data.boxH, data.sizeVersion, id]);

  React.useEffect(() => {
    if (
      typeof data.modelProvider === 'string' &&
      data.modelProvider.trim().length > 0
    ) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { modelProvider: currentProviderValue } },
      })
    );
  }, [currentProviderValue, data.modelProvider, id]);

  const commitManualInput = React.useCallback((value: string) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { manualInput: value } }
    }));
  }, [id]);

  const status: TextChatStatus = data.status || 'idle';
  const responseText = typeof data.responseText === 'string' ? data.responseText : '';
  const enableWebSearch = data.enableWebSearch ?? globalWebSearchEnabled;
  const normalizedHeight = typeof data.boxH === 'number'
    ? (data.boxH === LEGACY_NODE_HEIGHT ? DEFAULT_NODE_HEIGHT : data.boxH)
    : DEFAULT_NODE_HEIGHT;
  const nodeHeight = Math.max(MIN_NODE_HEIGHT, normalizedHeight);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const nodeRootRef = React.useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = React.useState(nodeHeight);

  const updateAutoHeight = React.useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    const measured = element.scrollHeight + NODE_VERTICAL_PADDING;
    const nextHeight = Math.max(MIN_NODE_HEIGHT, Math.ceil(measured));
    setContentHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);

  React.useLayoutEffect(() => {
    updateAutoHeight();
    const element = contentRef.current;
    if (!element) return;

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => updateAutoHeight());
      observer.observe(element);
      return () => observer.disconnect();
    }

    const handler = () => updateAutoHeight();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handler);
      }
    };
  }, [updateAutoHeight]);

  const computedHeight = Math.max(nodeHeight, contentHeight);
  React.useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [computedHeight, id, updateNodeInternals]);

  React.useEffect(() => {
    const element = nodeRootRef.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (
          typeof document !== 'undefined' &&
          document.body?.classList.contains('tanva-flow-node-dragging')
        ) {
          return;
        }
        updateNodeInternals(id);
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [id, updateNodeInternals]);

  const readIncomingTexts = React.useCallback((optimisticSource?: {
    sourceId: string;
    patch: Record<string, unknown>;
  } | null): string[] => {
    return rf.getEdges()
      .filter((edge) => edge.target === id && edge.targetHandle === 'text')
      .map((edge) => {
        if (
          optimisticSource &&
          edge.source === optimisticSource.sourceId &&
          optimisticSource.patch &&
          typeof optimisticSource.patch === 'object'
        ) {
          const source = rf.getNode(edge.source);
          if (!source) return undefined;
          return resolveTextFromSourceNode(
            {
              ...source,
              data: {
                ...(source.data as Record<string, unknown>),
                ...optimisticSource.patch,
              },
            },
            edge.sourceHandle,
          );
        }
        return pickTextFromNode(edge, rf);
      })
      .filter((text): text is string => typeof text === 'string' && text.length > 0);
  }, [id, rf]);

  const updateIncomingTexts = React.useCallback((nextTexts: string[]) => {
    setIncomingTexts((prevTexts) =>
      sameTextList(prevTexts, nextTexts) ? prevTexts : nextTexts
    );
  }, []);

  React.useEffect(() => {
    updateIncomingTexts(readIncomingTexts());
  }, [edges, readIncomingTexts, updateIncomingTexts]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        id?: string;
        patch?: Record<string, unknown>;
      }>).detail;
      if (!detail?.id) return;

      const isConnectedSource = rf.getEdges().some(
        (edge) => edge.target === id && edge.targetHandle === 'text' && edge.source === detail.id
      );
      if (!isConnectedSource) return;

      if (detail.patch && typeof detail.patch === 'object') {
        updateIncomingTexts(readIncomingTexts({ sourceId: detail.id, patch: detail.patch }));
        return;
      }

      window.setTimeout(() => {
        updateIncomingTexts(readIncomingTexts());
      }, 0);
    };

    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, readIncomingTexts, rf, updateIncomingTexts]);

  const runChat = React.useCallback(async () => {
    const latestIncomingTexts = readIncomingTexts();
    updateIncomingTexts(latestIncomingTexts);
    const typed = manualInput.trim();
    const rawPayload = (() => {
      if (isCustomSkill) {
        const sources = [...latestIncomingTexts];
        if (typed.length) sources.push(typed);
        return sources.join('\n\n').trim();
      }

      const inputPayload = latestIncomingTexts
        .map((text, index) => `#${index + 1}\n${text}`)
        .join('\n\n')
        .trim();
      const skillPrompt = currentTextChatSkill.prompt.trim();
      return inputPayload
        ? `${skillPrompt}\n\n${lt('输入内容：', 'Input content:')}\n${inputPayload}`.trim()
        : skillPrompt;
    })();
    if (!rawPayload.length) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: lt('请输入或连接至少一个提示文本', 'Please enter or connect at least one prompt text') } }
      }));
      return;
    }
    const requestPrompt = buildNodeRequestPrompt(rawPayload);

    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { status: 'running', error: undefined } }
    }));
    setIsInvoking(true);

    try {
      const result = await aiImageService.generateTextResponse({
        prompt: requestPrompt,
        enableWebSearch,
        aiProvider: effectiveProvider,
        model: textModel,
        providerOptions: {
          banana: {
            imageRoute: bananaImageRoute,
          },
          bananaImageRoute,
        },
      });

      if (!result.success || !result.data) {
        const message = result.error?.message || lt('文本生成失败', 'Text generation failed');
        throw new Error(message);
      }

      const text = (result.data.text || '').trim();
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            status: 'succeeded',
            responseText: text,
            text,
            lastPrompt: requestPrompt,
            error: undefined,
          }
        }
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: message } }
      }));
    } finally {
      setIsInvoking(false);
    }
  }, [
    bananaImageRoute,
    currentTextChatSkill.prompt,
    effectiveProvider,
    enableWebSearch,
    id,
    isCustomSkill,
    lt,
    manualInput,
    readIncomingTexts,
    textModel,
    updateIncomingTexts,
  ]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>
      ).detail;
      if (!detail || detail.id !== id) return;
      void (async () => {
        try {
          await runChat();
          detail.done?.(true);
        } catch {
          detail.done?.(false);
        }
      })();
    };
    window.addEventListener('flow:run-node', handler as EventListener);
    return () =>
      window.removeEventListener('flow:run-node', handler as EventListener);
  }, [id, runChat]);

  const onSelectTextChatSkill = React.useCallback(
    (skill: TextChatSkillOption) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: {
            id,
            patch: {
              textChatSkillId: skill.id,
            },
          },
        })
      );
    },
    [id]
  );

  const onManualInputChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setManualInput(value);
    if (!isComposingRef.current) {
      commitManualInput(value);
    }
  }, [commitManualInput]);

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    const value = event.currentTarget.value;
    setManualInput(value);
    commitManualInput(value);
  }, [commitManualInput]);

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

  const contentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingTop: 4,
    paddingBottom: 4,
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: 10,
    border: `1px solid ${themePalette.panelBorder}`,
    background: themePalette.panelBg,
    padding: '10px 12px',
    fontSize: 12,
    color: themePalette.panelText,
    whiteSpace: 'pre-wrap',
  };

  const connectionStyle: React.CSSProperties = {
    ...panelStyle,
    minHeight: 48,
    maxHeight: 140,
    overflowY: 'auto',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: themePalette.sectionLabel,
  };

  return (
    <div
      ref={nodeRootRef}
      style={{
        width: data.boxW || 320,
        height: computedHeight,
        padding: 12,
        background: themePalette.nodeBg,
        border: `1px solid ${themePalette.nodeBorder}`,
        borderRadius: 12,
        boxShadow: themePalette.nodeShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        boxSizing: 'border-box',
      }}
    >
      <NodeResizer
        isVisible
        minWidth={260}
        minHeight={MIN_NODE_HEIGHT}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResizeEnd={(_, params) => {
          rf.setNodes((nodes) => nodes.map((node) => node.id === id
            ? { ...node, data: { ...node.data, boxW: params.width, boxH: params.height } }
            : node));
        }}
        onResize={(_, params) => {
          rf.setNodes((nodes) => nodes.map((node) => node.id === id
            ? { ...node, data: { ...node.data, boxW: params.width, boxH: params.height } }
            : node));
        }}
      />
      <div style={contentStyle} ref={contentRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
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
                onPointerDownCapture={stopFlowPan}
                onMouseDownCapture={stopFlowPan}
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: themePalette.title,
                  border: `1px solid ${themePalette.titleInputBorder}`,
                  borderRadius: 6,
                  padding: '2px 6px',
                  outline: 'none',
                  minWidth: 100,
                  maxWidth: 220,
                  background: themePalette.titleInputBg,
                }}
              />
            ) : (
              <div
                onDoubleClick={startTitleEditing}
                title={lt('双击编辑标题', 'Double click to edit title')}
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: themePalette.title,
                  cursor: 'text',
                  userSelect: 'none',
                  maxWidth: 220,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {title}
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onPointerDownCapture={stopFlowPan}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  className='nodrag nopan tanva-flow-provider-mode-badge'
                  title={lt('切换模型模式', 'Switch model mode')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1px 8px',
                    borderRadius: 50,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                    ...(isDarkTheme
                      ? {
                          color: '#ffffff',
                          background: '#343434',
                          border: '1px solid #4a4a4a',
                        }
                      : {
                          color:
                            currentProviderValue === 'banana-3.1'
                              ? '#0f172a'
                              : '#475569',
                          background:
                            currentProviderValue === 'banana-3.1'
                              ? '#e2e8f0'
                              : '#f1f5f9',
                          border: '1px solid #e2e8f0',
                        }),
                  }}
                >
                  {currentProviderOption.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='start'
                side='bottom'
                sideOffset={8}
                className='min-w-[200px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:!border-slate-200 dark:!bg-white/95'
              >
                <DropdownMenuLabel className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 dark:!text-slate-400'>
                  {lt('模型切换', 'Model switch')}
                </DropdownMenuLabel>
                {providerToggleOptions.map((option) => {
                  const isActive = currentProviderValue === option.value;
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (currentProviderValue !== option.value) {
                          window.dispatchEvent(
                            new CustomEvent('flow:updateNodeData', {
                              detail: { id, patch: { modelProvider: option.value } },
                            })
                          );
                        }
                      }}
                      onPointerDownCapture={stopFlowPan}
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                        isActive
                          ? 'bg-gray-100 text-gray-800 dark:!bg-gray-100 dark:!text-gray-800'
                          : 'text-slate-600 hover:bg-gray-100 dark:!text-slate-600 dark:hover:!bg-gray-100'
                      }`}
                    >
                      <div className='flex-1 space-y-0.5'>
                        <div className='font-medium leading-none'>{option.label}</div>
                        <div className='text-[11px] leading-snug text-slate-400 dark:!text-slate-400'>{option.description}</div>
                      </div>
                      {isActive && <Check className='h-3.5 w-3.5 text-slate-700 dark:!text-slate-700' />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <button
            onClick={runChat}
            disabled={status === 'running' || isInvoking}
            className='run-btn-with-credit'
            title={
              status === 'running' || isInvoking
                ? 'Running...'
                : resolvedRunCredits
                ? `${lt('消耗', 'Cost')}: ${resolvedRunCredits} ${lt('积分', 'credits')}`
                : lt('运行对话', 'Run chat')
            }
            style={{
              fontSize: 12,
              boxSizing: 'border-box',
              minHeight: 30,
              padding: '0 10px',
              background: status === 'running' || isInvoking ? themePalette.runBgDisabled : themePalette.runBg,
              color: themePalette.runText,
              borderRadius: 6,
              border: isDarkTheme ? '1px solid rgba(226, 232, 240, 0.24)' : 'none',
              cursor: status === 'running' || isInvoking ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              flexShrink: 0,
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {status === 'running' || isInvoking ? (
              <span className='run-text-trigger'>Running...</span>
            ) : (
              <>
                <span className='run-text-trigger'>Run</span>
                <RunCreditBadge credits={resolvedRunCredits} runButton />
              </>
            )}
          </button>
        </div>

        <div style={{ fontSize: 11, color: themePalette.secondaryText }}>{lt('已连接提示', 'Connected prompts')}: {incomingTexts.length} {lt('条', 'item(s)')}</div>
        <div style={{ ...connectionStyle, display: 'flex', flexDirection: 'column', gap: 8, color: incomingTexts.length ? themePalette.panelText : themePalette.panelMutedText }}>
          {incomingTexts.length
            ? incomingTexts.map((text, index) => (
              <div key={`${index}-${text.slice(0, 12)}`} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ color: themePalette.panelIndexText, fontWeight: 600, minWidth: 26 }}>#{index + 1}</span>
                <span style={{ flex: 1 }}>{text}</span>
              </div>
            ))
            : <span>{lt('连接多个 Prompt 节点以聚合输入', 'Connect multiple Prompt nodes to aggregate input')}</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={labelStyle}>{lt('Skill', 'Skill')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={status === 'running' || isInvoking}
                  onPointerDownCapture={stopFlowPan}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  className="nodrag nopan"
                  title={lt('切换 Text Chat Skill', 'Switch Text Chat skill')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minWidth: 104,
                    height: 26,
                    padding: '0 9px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: status === 'running' || isInvoking ? 'not-allowed' : 'pointer',
                    color: isDarkTheme ? '#f8fafc' : '#111827',
                    background: isDarkTheme ? '#262626' : '#f8fafc',
                    border: `1px solid ${isDarkTheme ? '#3d3d3d' : '#d7dce5'}`,
                    boxShadow: isDarkTheme ? '0 1px 2px rgba(15, 23, 42, 0.2)' : '0 1px 2px rgba(15, 23, 42, 0.04)',
                  }}
                >
                  {currentTextChatSkill.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                side='bottom'
                sideOffset={6}
                className='min-w-[230px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:!border-slate-200 dark:!bg-white/95'
              >
                <DropdownMenuLabel className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 dark:!text-slate-400'>
                  {lt('Skill', 'Skill')}
                </DropdownMenuLabel>
                {textChatSkillOptions.map((skill) => {
                  const isActive = currentTextChatSkill.id === skill.id;
                  return (
                    <DropdownMenuItem
                      key={skill.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!isActive) {
                          onSelectTextChatSkill(skill);
                        }
                      }}
                      onPointerDownCapture={stopFlowPan}
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                        isActive
                          ? 'bg-gray-100 text-gray-800 dark:!bg-gray-100 dark:!text-gray-800'
                          : 'text-slate-600 hover:bg-gray-100 dark:!text-slate-600 dark:hover:!bg-gray-100'
                      }`}
                    >
                      <div className='flex-1 space-y-0.5'>
                        <div className='font-medium leading-none'>{skill.label}</div>
                        <div className='text-[11px] leading-snug text-slate-400 dark:!text-slate-400'>{skill.description}</div>
                      </div>
                      {isActive && <Check className='h-3.5 w-3.5 text-slate-700 dark:!text-slate-700' />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isCustomSkill && (
            <textarea
              className="nodrag nopan nowheel"
              value={manualInput}
              onChange={onManualInputChange}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder={lt("输入附加提示信息", "Enter additional prompt information")}
              disabled={status === 'running' || isInvoking}
              style={{
                width: '100%',
                minHeight: 80,
                resize: 'vertical',
                fontSize: 12,
                lineHeight: 1.4,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${themePalette.textareaBorder}`,
                background: themePalette.textareaBg,
                color: themePalette.textareaText,
                fontFamily: 'inherit',
                boxShadow: isDarkTheme ? '0 1px 2px rgba(15, 23, 42, 0.2)' : '0 1px 2px rgba(15, 23, 42, 0.04)',
              }}
              onWheelCapture={stopFlowPan}
              onPointerDownCapture={stopFlowPan}
              onMouseDownCapture={stopFlowPan}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={labelStyle}>{lt('回复结果', 'Response')}</div>
          <div style={{ ...panelStyle, minHeight: 64, maxHeight: 180, overflowY: 'auto' }}>
            {responseText || lt('运行后将在此处展示回复内容', 'Run to see response text here')}
          </div>
        </div>

      </div>

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
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          prompt
        </div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          prompt
        </div>
      )}
    </div>
  );
};

export default React.memo(TextChatNode);
