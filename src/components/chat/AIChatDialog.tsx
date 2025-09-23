/**
 * AI生图对话框组件
 * 固定在屏幕底部中央的对话框，用于AI图像生成
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import ImagePreviewModal from '@/components/ui/ImagePreviewModal';
import { useAIChatStore } from '@/stores/aiChatStore';
import { Send, AlertCircle, Image, X, History, Plus, Search, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AIStreamProgressEvent } from '@/types/ai';
import PromptOptimizationPanel from '@/components/chat/PromptOptimizationPanel';
import type { PromptOptimizationSettings } from '@/components/chat/PromptOptimizationPanel';
import promptOptimizationService from '@/services/promptOptimizationService';

const MinimalGlobeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5c2.1 2 3.5 5 3.5 8.5s-1.4 6.5-3.5 8.5c-2.1-2-3.5-5-3.5-8.5s1.4-6.5 3.5-8.5Z" />
    <path d="M4 12h16" />
  </svg>
);

const AIChatDialog: React.FC = () => {
  const {
    isVisible,
    currentInput,
    generationStatus,
    messages,
    sourceImageForEditing,
    sourceImagesForBlending,
    sourceImageForAnalysis,
    enableWebSearch,
    hideDialog,
    setCurrentInput,
    clearInput,
    processUserInput,
    setSourceImageForEditing,
    setSourceImageForAnalysis,
    addImageForBlending,
    removeImageFromBlending,
    getAIMode,
    initializeContext,
    getContextSummary,
    isIterativeMode,
    toggleWebSearch
  } = useAIChatStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hoverToggleZone, setHoverToggleZone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [manuallyClosedHistory, setManuallyClosedHistory] = useState(false);
  // 流式文本渲染状态（仅文本对话）
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [autoOptimizeEnabled, setAutoOptimizeEnabled] = useState(false);
  const [autoOptimizing, setAutoOptimizing] = useState(false);
  const [isPromptPanelOpen, setIsPromptPanelOpen] = useState(false);
  const promptButtonRef = useRef<HTMLButtonElement>(null);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggeredRef = useRef(false);
  const [promptSettings, setPromptSettings] = useState<PromptOptimizationSettings>({
    language: '中文',
    tone: '',
    focus: '',
    lengthPreference: 'balanced'
  });
  const LONG_PRESS_DURATION = 550;
  
  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    title: string;
  } | null>(null);

  // 🧠 初始化上下文记忆系统
  useEffect(() => {
    initializeContext();
  }, [initializeContext]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // 对话框关闭时重置手动关闭标志
  useEffect(() => {
    if (!isVisible) {
      setManuallyClosedHistory(false);
      setShowHistory(false);
      setIsPromptPanelOpen(false);
    }
  }, [isVisible]);

  // 面板外点击关闭
  useEffect(() => {
    if (!isPromptPanelOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (promptPanelRef.current && promptPanelRef.current.contains(target)) return;
      if (promptButtonRef.current && promptButtonRef.current.contains(target)) return;
      setIsPromptPanelOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isPromptPanelOpen]);

  // 智能历史记录显示：纯对话模式自动打开，绘图模式不打开
  useEffect(() => {
    if (messages.length > 0 && !showHistory && !isMaximized && !manuallyClosedHistory) {
      // 检查最后一条消息的类型
      const lastMessage = messages[messages.length - 1];
      
      // 如果是纯对话模式（没有图像数据），自动显示历史记录
      const isPureChat = lastMessage.type === 'ai' && !lastMessage.imageData && !lastMessage.sourceImageData && !lastMessage.sourceImagesData;
      
      if (isPureChat) {
        // 延迟一点显示，让用户看到消息已添加
        const timer = setTimeout(() => {
          setShowHistory(true);
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [messages.length, isMaximized, showHistory, manuallyClosedHistory]);

  // 自动滚动到最新消息
  useEffect(() => {
    if ((showHistory || isMaximized) && historyRef.current && (messages.length > 0 || isStreaming)) {
      // 延迟滚动，确保DOM已更新
      const timer = setTimeout(() => {
        if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showHistory, messages.length, isMaximized, isStreaming, streamingText]);

  // 自动聚焦到输入框
  useEffect(() => {
    if (isVisible && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isVisible]);

  // 取消自动关闭对话框功能 - AI生图完成后保持对话框打开
  // useEffect(() => {
  //   let closeTimer: NodeJS.Timeout | null = null;

  //   const handleImageAddedToCanvas = () => {
  //     // 只有在AI生图完成后（progress为100）且对话框可见且没有错误时才关闭
  //     if (isVisible &&
  //         !generationStatus.isGenerating &&
  //         generationStatus.progress === 100 &&
  //         generationStatus.error === null) {
  //       // 清除之前的定时器
  //       if (closeTimer) {
  //         clearTimeout(closeTimer);
  //       }

  //       // 延迟0.1秒关闭，快速响应让用户去看图片
  //       closeTimer = setTimeout(() => {
  //         hideDialog();
  //         console.log('🎯 AI生图完成，对话框已自动关闭');
  //         closeTimer = null;
  //       }, 100);
  //     }
  //   };

  //   // 监听图片上传事件
  //   window.addEventListener('triggerQuickImageUpload', handleImageAddedToCanvas);

  //   return () => {
  //     window.removeEventListener('triggerQuickImageUpload', handleImageAddedToCanvas);
  //     // 清理定时器
  //     if (closeTimer) {
  //       clearTimeout(closeTimer);
  //     }
  //   };
  // }, [isVisible, generationStatus.isGenerating, generationStatus.progress, generationStatus.error, hideDialog]);



  // 切换历史记录显示
  const toggleHistory = () => {
    const newShowHistory = !showHistory;
    setShowHistory(newShowHistory);
    // 记录用户手动操作，如果用户关闭了历史记录，标记为手动关闭
    if (!newShowHistory) {
      setManuallyClosedHistory(true);
    } else {
      setManuallyClosedHistory(false);
    }
  };

  // 订阅AI流式进度事件，按增量渲染文本（仅限“文本对话”）
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<AIStreamProgressEvent>).detail;
      if (!detail || detail.operationType !== '文本对话') return;
      if (detail.phase === 'starting') {
        setIsStreaming(true);
        setStreamingText('');
      } else if (detail.phase === 'text_delta' && detail.deltaText) {
        setIsStreaming(true);
        setStreamingText(prev => prev + detail.deltaText);
      } else if (detail.phase === 'completed' || detail.phase === 'error') {
        // 完成或出错时停止流式展示；最终内容会在消息历史中以正式消息出现
        setIsStreaming(false);
        // 可选：若未能落盘为正式消息，保留 fullText 以防闪烁
        // 当前逻辑由 generateTextResponse 在完成后 addMessage
      }
    };
    window.addEventListener('aiStreamProgress', handler as EventListener);
    return () => window.removeEventListener('aiStreamProgress', handler as EventListener);
  }, []);

  // 统一的图片上传处理
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // 如果当前已有图片，则添加到融合模式
    const hasExistingImages = sourceImageForEditing || sourceImagesForBlending.length > 0 || sourceImageForAnalysis;

    if (hasExistingImages) {
      // 已有图片：转换为融合模式或添加到融合模式
      if (sourceImageForEditing) {
        // 将单图编辑转换为多图融合
        addImageForBlending(sourceImageForEditing);
        setSourceImageForEditing(null);
      }
      if (sourceImageForAnalysis) {
        // 将分析图片转换为多图融合
        addImageForBlending(sourceImageForAnalysis);
        setSourceImageForAnalysis(null);
      }

      // 添加新选择的图片到融合数组
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const imageData = e.target?.result as string;
          addImageForBlending(imageData);
        };
        reader.readAsDataURL(file);
      });
    } else {
      // 没有现有图片：根据选择数量决定模式
      if (files.length === 1) {
        // 单图：默认设置为编辑模式（AI会智能判断是编辑还是分析）
        const reader = new FileReader();
        reader.onload = (e) => {
          const imageData = e.target?.result as string;
          setSourceImageForEditing(imageData);
        };
        reader.readAsDataURL(files[0]);
      } else {
        // 多图：设置为融合模式
        Array.from(files).forEach(file => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const imageData = e.target?.result as string;
            addImageForBlending(imageData);
          };
          reader.readAsDataURL(file);
        });
      }
    }

    // 清空input值，允许重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startPromptButtonLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setIsPromptPanelOpen(true);
    }, LONG_PRESS_DURATION);
  };

  const cancelPromptButtonLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePromptButtonPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (generationStatus.isGenerating || autoOptimizing) return;
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (event.pointerType === 'touch') {
      event.preventDefault();
    }
    longPressTriggeredRef.current = false;
    startPromptButtonLongPress();
  };

  const handlePromptButtonPointerUp = () => {
    if (generationStatus.isGenerating || autoOptimizing) return;
    cancelPromptButtonLongPress();
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    setAutoOptimizeEnabled((prev) => {
      const next = !prev;
      if (!next) {
        // 关闭功能时，同时隐藏面板
        setIsPromptPanelOpen(false);
      }
      return next;
    });
  };

  const handlePromptButtonPointerLeave = () => {
    cancelPromptButtonLongPress();
    longPressTriggeredRef.current = false;
  };

  const handlePromptButtonPointerCancel = () => {
    cancelPromptButtonLongPress();
    longPressTriggeredRef.current = false;
  };

  const handlePromptSettingsChange = (next: PromptOptimizationSettings) => {
    setPromptSettings(next);
  };

  const handleApplyOptimizedToInput = (optimized: string) => {
    setCurrentInput(optimized);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
    setIsPromptPanelOpen(false);
    setAutoOptimizeEnabled(false);
  };

  const handleSendOptimizedFromPanel = async (optimized: string) => {
    if (generationStatus.isGenerating || autoOptimizing) return;
    const trimmed = optimized.trim();
    if (!trimmed) return;

    setCurrentInput(trimmed);
    setIsPromptPanelOpen(false);
    setAutoOptimizeEnabled(false);
    await processUserInput(trimmed);
    clearInput();
  };

  // 移除源图像
  const handleRemoveSourceImage = () => {
    setSourceImageForEditing(null);
  };

  // 处理发送 - 使用AI智能工具选择
  const handleSend = async () => {
    const trimmedInput = currentInput.trim();
    if (!trimmedInput || generationStatus.isGenerating || autoOptimizing) return;

    let promptToSend = trimmedInput;

    if (autoOptimizeEnabled) {
      setAutoOptimizing(true);
      try {
        const response = await promptOptimizationService.optimizePrompt({
          input: trimmedInput,
          language: promptSettings.language,
          tone: promptSettings.tone || undefined,
          focus: promptSettings.focus || undefined,
          lengthPreference: promptSettings.lengthPreference
        });

        if (response.success && response.data) {
          promptToSend = response.data.optimizedPrompt;
          setCurrentInput(promptToSend);
        } else if (response.error) {
          console.warn('⚠️ 提示词自动扩写失败，将使用原始提示词继续。', response.error);
        }
      } catch (error) {
        console.error('❌ 自动扩写提示词时发生异常，将使用原始提示词继续。', error);
      } finally {
        setAutoOptimizing(false);
      }
    }

    await processUserInput(promptToSend);
    clearInput();
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 发送快捷键：Ctrl/Cmd + Enter；普通 Enter 保留换行
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === 'Escape') {
      hideDialog();
    }
  };

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentInput(e.target.value);
  };

  // 处理图片预览
  const handleImagePreview = (src: string, title: string) => {
    setPreviewImage({ src, title });
  };

  // 关闭图片预览
  const handleClosePreview = () => {
    setPreviewImage(null);
  };

  // 智能提示文字
  const getSmartPlaceholder = () => {
    const mode = getAIMode();
    switch (mode) {
      case 'blend':
        return `描述如何融合这${sourceImagesForBlending.length}张图像...`;
      case 'edit':
        return "描述你想要做什么，AI会智能判断是编辑还是分析...";
      case 'analyze':
        return "询问关于这张图片的问题，或留空进行全面分析...";
      default:
        return "输入任何内容，AI会智能判断是生图、对话还是其他操作...";
    }
  };

  // 外圈双击放大/缩小：只有点击非内容区域（padding、外框）时生效
  const handleOuterDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const x = e.clientX, y = e.clientY;
    const card = dialogRef.current;
    const content = contentRef.current;
    if (!card) { setIsMaximized(v => !v); return; }
    const cardRect = card.getBoundingClientRect();
    const insideCard = x >= cardRect.left && x <= cardRect.right && y >= cardRect.top && y <= cardRect.bottom;
    const distToCardEdge = Math.min(
      x - cardRect.left,
      cardRect.right - x,
      y - cardRect.top,
      cardRect.bottom - y
    );
    if (!insideCard) {
      // 外部区域不再触发（只接受向内偏移的区域）
      return;
    }
    if (content) {
      const cr = content.getBoundingClientRect();
      const insideContent = x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom;
      if (insideContent) {
        // 在最大化时，允许在内容区内双击也能缩小，但避免输入框/按钮等交互控件
        const tgt = e.target as HTMLElement;
        const interactive = tgt.closest('textarea, input, button, a, img, [role="textbox"], [contenteditable="true"]');
        const inTopBand = y <= cr.top + 24; // 内容顶部带
        // 允许靠近卡片内边缘的带状区域（24px）无论是否最大化
        const inInnerEdgeBand = distToCardEdge <= 24;
        if (isMaximized) { /* 最大化时，任何卡片内部双击均允许（除交互控件） */ }
        else if (!inTopBand && !inInnerEdgeBand) return; // 非最大化仅允许顶部带或内边缘带
        if (interactive) return;
      }
    }
    setIsMaximized(v => !v);
  };

  // 捕获阶段拦截双击：只执行对话框放大/缩小，并阻止事件继续到画布
  const handleDoubleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 忽略在交互控件上的双击（但仍阻止冒泡，防误触画布）
    const interactive = target.closest('textarea, input, button, a, img, [role="textbox"], [contenteditable="true"]');
    e.preventDefault();
    e.stopPropagation();
    // 尽力阻断同层监听
    // @ts-ignore
    e.nativeEvent?.stopImmediatePropagation?.();
    if (interactive) return;
    // 与外层逻辑保持一致：双击即切换大小
    setIsMaximized(v => !v);
  };

  // 全局兜底：允许在卡片外侧“环形区域”双击触发（更灵敏）
  // 注意：Hook 需在任何 early return 之前声明，避免 Hook 次序不一致
  useEffect(() => {
    const onDbl = (ev: MouseEvent) => {
      const card = dialogRef.current;
      if (!card) return;
      const x = ev.clientX, y = ev.clientY;
      const r = card.getBoundingClientRect();
      const content = contentRef.current;
      const cr = content ? content.getBoundingClientRect() : null;

      const insideCard = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const insideContent = cr ? (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) : false;
      const distToCardEdge = Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y);

      // 定义外侧环形区域（卡片外扩24px以内，但不包含卡片外太远区域）
      // 外环禁用，只允许卡片内触发

      // 触发条件：
      // 1) 卡片padding/边框区域
      // 2) 外侧环形区域
      // 3) 在最大化时，即使在内容区内，只要不是交互控件也允许
      const tgt = ev.target as HTMLElement;
      const interactive = tgt.closest('textarea, input, button, a, img, [role="textbox"], [contenteditable="true"]');
      const inTopBand = cr ? y <= cr.top + 24 : false;
      const inInnerEdgeBand = distToCardEdge <= 24;
      const allowInsideContent = ((isMaximized || inTopBand || inInnerEdgeBand) && !interactive);
      if (insideCard && (!insideContent || allowInsideContent)) {
        ev.stopPropagation();
        ev.preventDefault();
        setIsMaximized(v => !v);
      }

      // 外部屏蔽：卡片外侧一定范围内，阻止冒泡，防止 Flow 弹出节点面板
      const inOuterShield = x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24 && !insideCard;
      if (inOuterShield) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    };
    window.addEventListener('dblclick', onDbl, true);
    return () => window.removeEventListener('dblclick', onDbl, true);
  }, []);

  // 根据鼠标位置动态设置光标（zoom-in / zoom-out），明确可触发切换的区域
  // 放在 early return 之前，避免 Hook 顺序问题
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const card = dialogRef.current; const content = contentRef.current; const cont = containerRef.current;
      if (!card || !cont) return;
      const x = ev.clientX, y = ev.clientY;
      const r = card.getBoundingClientRect();
      const insideCard = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const cr = content ? content.getBoundingClientRect() : null;
      const insideContent = cr ? (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) : false;
      const distToCardEdge = Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y);
      const inTopBand = cr ? y <= cr.top + 28 : false;
      const inInnerEdgeBand = distToCardEdge <= 28;
      const target = ev.target as HTMLElement;
      const interactive = !!target?.closest('textarea, input, button, a, img, [role="textbox"], [contenteditable="true"]');

      let should = false;
      if (insideCard) {
        if (!insideContent) should = true; // 卡片padding/边框
        else if (!interactive && (isMaximized || inTopBand || inInnerEdgeBand)) should = true;
      }
      setHoverToggleZone(should);
      cont.style.cursor = should ? (isMaximized ? 'zoom-out' : 'zoom-in') : '';
    };
    window.addEventListener('mousemove', onMove, true);
    return () => window.removeEventListener('mousemove', onMove, true);
  }, [isMaximized]);

  // 捕获阶段拦截双击，避免触发 Flow 节点面板；并在非交互控件下切换大小
  // 放在 early return 之前，避免 Hook 顺序问题
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement;
      const interactive = target.closest('textarea, input, button, a, img, [role="textbox"], [contenteditable="true"]');
      if (interactive) {
        // 在交互控件上双击：只阻止冒泡，不切换
        ev.stopPropagation();
        return;
      }
      ev.stopPropagation();
      ev.preventDefault();
      setIsMaximized(v => !v);
    };
    const el = containerRef.current;
    if (el) el.addEventListener('dblclick', handler, true);
    return () => { if (el) el.removeEventListener('dblclick', handler, true); };
  }, []);

  // 如果对话框不可见，不渲染（统一画板下始终可见时显示）
  if (!isVisible) return null;

  const canSend = currentInput.trim().length > 0 && !generationStatus.isGenerating && !autoOptimizing;

  return (
    <div ref={containerRef} data-prevent-add-panel className={cn(
      "fixed z-50 transition-all duration-300 ease-out",
      isMaximized
        ? "top-32 left-16 right-16 bottom-4" // 最大化时，64px边距
        : "bottom-3 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4"
    )} onDoubleClick={handleOuterDoubleClick} onDoubleClickCapture={handleDoubleClickCapture}>
      <div
        ref={dialogRef}
        data-prevent-add-panel
        className={cn(
          "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 ease-out focus-within:border-blue-300 relative overflow-hidden",
          isMaximized ? "h-full flex flex-col rounded-2xl" : "p-4 rounded-2xl"
        )}
        onDoubleClick={handleOuterDoubleClick}
        onDoubleClickCapture={handleDoubleClickCapture}
      >
        {/* 进度条 - 贴着对话框顶部，避免触碰圆角 */}
        {generationStatus.isGenerating && (
          <div className="absolute top-0 left-4 right-4 h-1 z-50">
            <div className="w-full h-full bg-gray-200/20 rounded-full">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${generationStatus.progress}%` }}
              />
            </div>
          </div>
        )}
        
        {/* 内容区域 */}
        <div ref={contentRef} data-chat-content className={cn(
          isMaximized ? "p-4 h-full overflow-hidden" : ""
        )}>



          {/* 统一的图像预览区域 */}
          {(sourceImageForEditing || sourceImagesForBlending.length > 0 || sourceImageForAnalysis) && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-600">
                  {sourceImagesForBlending.length > 0 ?
                    <span className="font-bold">融合图像</span> :
                    sourceImageForEditing ? '编辑图像' :
                      sourceImageForAnalysis ? '分析图像' : '图像'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* 单图编辑显示 */}
                {sourceImageForEditing && (
                  <div className="relative group">
                    <img
                      src={sourceImageForEditing}
                      alt="编辑图像"
                      className="w-16 h-16 object-cover rounded border shadow-sm"
                    />
                    <button
                      onClick={handleRemoveSourceImage}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除图片"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}

                {/* 分析图像显示 - 隐藏无法显示的预览 */}
                {false && sourceImageForAnalysis && (
                  <div className="relative group">
                    <img
                      src={sourceImageForAnalysis}
                      alt="分析图像"
                      className="w-16 h-16 object-cover rounded border shadow-sm"
                    />
                    <button
                      onClick={() => setSourceImageForAnalysis(null)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除图片"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}

                {/* 多图融合显示 */}
                {sourceImagesForBlending.map((imageData, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={imageData}
                      alt={`融合图片 ${index + 1}`}
                      className="w-16 h-16 object-cover rounded border shadow-sm"
                    />
                    {/* 主场景标签 - 显示在第一张图片上 */}
                    {index === 0 && sourceImagesForBlending.length > 1 && (
                      <div className="absolute -top-0.5 -left-0.5 bg-blue-600 text-white px-1 py-0.5 rounded-full font-medium shadow-sm" style={{ fontSize: '0.6rem' }}>
                        主场景
                      </div>
                    )}
                    <button
                      onClick={() => removeImageFromBlending(index)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`删除图片 ${index + 1}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}

                {/* 添加更多图片按钮 */}
                {(sourceImagesForBlending.length < 4 && sourceImagesForBlending.length > 0) ||
                  (sourceImageForEditing && sourceImagesForBlending.length === 0) ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-16 h-16 border-2 border-dashed border-gray-300 hover:border-blue-400 rounded flex items-center justify-center transition-colors group"
                    title="添加更多图片"
                  >
                    <Plus className="w-6 h-6 text-gray-400 group-hover:text-blue-500" />
                  </button>
                ) : null}
              </div>
            </div>
          )}



          {/* 输入区域 */}
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDownCapture={(e) => {
              // 捕获阶段拦截，避免文本选中/聚焦导致的蓝色高亮
              try {
                const t = textareaRef.current; if (!t) return;
                const r = t.getBoundingClientRect();
                const x = (e as any).clientX, y = (e as any).clientY;
                const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
                if (!inside) return;
                const edgeDist = Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y);
                if (edgeDist <= 24) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              } catch {}
            }}
            onDoubleClick={(e) => {
              try {
                const t = textareaRef.current;
                if (!t) { e.preventDefault(); e.stopPropagation(); setIsMaximized(v => !v); return; }
                const r = t.getBoundingClientRect();
                const x = e.clientX, y = e.clientY;
                const insideText = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
                if (!insideText) { e.preventDefault(); e.stopPropagation(); setIsMaximized(v => !v); return; }
                // 判断是否在“外圈框”区域：靠近边缘的环（阈值 24px）
                const edgeDist = Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y);
                if (edgeDist <= 24) {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsMaximized(v => !v);
                }
              } catch {}
            }}
          >
            <div className="relative">

              <Textarea
                ref={textareaRef}
                value={currentInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={getSmartPlaceholder()}
                disabled={generationStatus.isGenerating}
                className={cn(
                  "resize-none pr-4 min-h-[80px] text-sm bg-transparent border-gray-300 focus:border-blue-400 focus:ring-0 transition-colors duration-200",
                  generationStatus.isGenerating && "opacity-75"
                )}
                rows={showHistory ? 3 : 1}
              />

              {/* 联网搜索开关 */}
              <Button
                onClick={toggleWebSearch}
                disabled={generationStatus.isGenerating}
                size="sm"
                variant="outline"
                className={cn(
                  // 移除最大化按钮后，收紧到右侧
                  "absolute right-36 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                  !generationStatus.isGenerating
                    ? enableWebSearch 
                      ? "hover:bg-blue-600 bg-blue-500 text-white border-blue-500"
                      : "hover:bg-liquid-glass-hover text-gray-700"
                    : "opacity-50 cursor-not-allowed text-gray-400"
                )}
                title={`联网搜索: ${enableWebSearch ? '开启' : '关闭'} - 让AI获取实时信息`}
              >
                <MinimalGlobeIcon className="h-3.5 w-3.5" />
              </Button>

              {/* 历史记录按钮 */}
              <div className="relative">
                <Button
                  onClick={isMaximized ? undefined : toggleHistory}
                  disabled={isMaximized || generationStatus.isGenerating || messages.length === 0}
                  size="sm"
                  variant="outline"
                  className={cn(
                    "absolute right-28 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    isMaximized
                      ? "opacity-30 cursor-not-allowed text-gray-400"
                      : !generationStatus.isGenerating && messages.length > 0
                        ? "hover:bg-liquid-glass-hover text-gray-700"
                        : "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={isMaximized ? "最大化时历史记录始终显示" : messages.length > 0 ? `查看聊天历史 (${messages.length}条消息)` : "暂无聊天历史"}
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* 提示词扩写按钮：单击切换自动扩写，长按打开配置面板 */}
              <Button
                ref={promptButtonRef}
                size="sm"
                variant="outline"
                disabled={generationStatus.isGenerating || autoOptimizing}
                className={cn(
                  "absolute right-20 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                  autoOptimizeEnabled
                    ? "bg-blue-500 text-white border-blue-500 hover:bg-blue-500/90"
                    : !generationStatus.isGenerating && !autoOptimizing
                      ? "hover:bg-liquid-glass-hover text-gray-700"
                      : "opacity-50 cursor-not-allowed text-gray-400"
                )}
                title={autoOptimizeEnabled ? "自动扩写已开启（单击关闭，长按打开设置面板）" : "单击开启自动扩写，长按打开扩写设置面板"}
                onPointerDown={handlePromptButtonPointerDown}
                onPointerUp={handlePromptButtonPointerUp}
                onPointerLeave={handlePromptButtonPointerLeave}
                onPointerCancel={handlePromptButtonPointerCancel}
                aria-pressed={autoOptimizeEnabled}
              >
                {autoOptimizing ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <BookOpen className="h-3.5 w-3.5" />
                )}
              </Button>

              {/* 统一的图片上传按钮 */}
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={generationStatus.isGenerating}
                size="sm"
                variant="outline"
                className={cn(
                  "absolute right-12 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                  !generationStatus.isGenerating
                    ? "hover:bg-liquid-glass-hover text-gray-700"
                    : "opacity-50 cursor-not-allowed text-gray-400"
                )}
                title="上传图片 - 单张编辑，多张融合"
              >
                <Image className="h-3.5 w-3.5" />
              </Button>

              {/* 发送按钮 */}
              <Button
                onClick={handleSend}
                disabled={!canSend}
                size="sm"
                variant="outline"
                className={cn(
                  "absolute right-4 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                  canSend
                    ? "hover:bg-liquid-glass-hover text-gray-700"
                    : "opacity-50 cursor-not-allowed text-gray-400"
                )}
              >
                {generationStatus.isGenerating ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            <PromptOptimizationPanel
              ref={promptPanelRef}
              isOpen={isPromptPanelOpen}
              currentInput={currentInput}
              settings={promptSettings}
              onSettingsChange={handlePromptSettingsChange}
              onApplyToInput={handleApplyOptimizedToInput}
              onSendOptimized={handleSendOptimizedFromPanel}
              autoOptimizeEnabled={autoOptimizeEnabled}
              anchorRef={promptButtonRef}
              containerRef={dialogRef}
            />

            {/* 统一的文件输入 - 支持多选 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />
          </div>



          {/* 错误提示 */}
          {generationStatus.error && (
            <div className="mt-4">
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <span className="text-sm text-red-800">{generationStatus.error}</span>
              </div>
            </div>
          )}

          {/* 消息历史（点击对话框时显示，最大化时始终显示） */}
          {(showHistory || isMaximized) && (messages.length > 0 || isStreaming) && (
            <div
              ref={historyRef}
              className={cn(
                "mt-4 overflow-y-auto custom-scrollbar",
                isMaximized ? "max-h-screen" : "max-h-80"
              )}
              style={{
                overflowY: 'auto',
                height: 'auto',
                maxHeight: isMaximized ? 'calc(100vh - 300px)' : '320px',
                // 强制细滚动条
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(156, 163, 175, 0.4) transparent'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-1.5 mr-1 pb-6">
                <div className="mb-2 flex justify-between items-center">
                  <span className="text-xs text-gray-500 font-medium">聊天历史记录</span>
                  {/* 🧠 上下文状态指示器 */}
                  <div className="flex items-center space-x-2">
                    {isIterativeMode() && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                        🔄 迭代模式
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {getContextSummary()}
                    </span>
                  </div>
                </div>
                {messages.slice(isMaximized ? -50 : -5).map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "p-2 transition-colors text-sm",
                      message.type === 'user' && "text-black ml-3 mr-1",
                      message.type === 'ai' && "text-black mr-3",
                      message.type === 'error' && "bg-red-50 text-red-800 mr-1 rounded-lg p-3"
                    )}
                  >
                    {/* 如果有图像或源图像，使用特殊布局 */}
                    {(message.imageData || message.sourceImageData || message.sourceImagesData) ? (
                      <div className={cn(
                        "inline-block rounded-lg p-3",
                        message.type === 'user' && "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                        message.type === 'ai' && "bg-liquid-glass-light backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass-light shadow-liquid-glass"
                      )}>
                        {/* AI消息标识 - 单独一行 */}
                        {message.type === 'ai' && (
                          <div className="flex items-center gap-2 mb-3">
                            <img src="/logo.png" alt="TAI Logo" className="w-4 h-4" />
                            <span className="text-sm font-bold text-black">TAI</span>
                            {/* 显示联网搜索标识 */}
                            {message.webSearchResult?.hasSearchResults && (
                              <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                <MinimalGlobeIcon className="w-3 h-3" />
                                <span>已联网</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* AI消息：同时显示文本回复和图像 */}
                        {message.type === 'ai' && message.imageData ? (
                          <div className="space-y-3">
                            {/* 文本回复部分 */}
                            <div className="text-sm leading-relaxed text-black break-words markdown-content">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  p: ({ children }) => <p className="mb-1 text-sm">{children}</p>,
                                  ul: ({ children }) => <ul className="list-disc list-inside mb-1 ml-2 text-sm">{children}</ul>,
                                  ol: ({ children }) => <ol className="list-decimal list-inside mb-1 ml-2 text-sm">{children}</ol>,
                                  li: ({ children }) => <li className="mb-0.5 text-sm">{children}</li>,
                                  h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-2">{children}</h1>,
                                  h2: ({ children }) => <h2 className="text-base font-bold mb-1 mt-1">{children}</h2>,
                                  h3: ({ children }) => <h3 className="text-base font-bold mb-1">{children}</h3>,
                                  code: ({ children, ...props }: any) => {
                                    const inline = !('className' in props && props.className?.includes('language-'));
                                    return inline
                                      ? <code className="bg-gray-100 px-1 rounded text-xs">{children}</code>
                                      : <pre className="bg-gray-100 p-1 rounded text-xs overflow-x-auto mb-1"><code>{children}</code></pre>;
                                  },
                                  blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-300 pl-2 italic text-xs mb-1">{children}</blockquote>,
                                  a: ({ href, children }) => <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                  em: ({ children }) => <em className="italic">{children}</em>,
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                            </div>
                            
                            {/* 图像部分 */}
                            <div className="flex justify-center">
                              <img
                                src={`data:image/png;base64,${message.imageData}`}
                                alt="AI生成的图像"
                                className="w-32 h-32 object-cover rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleImagePreview(`data:image/png;base64,${message.imageData}`, 'AI生成的图像');
                                }}
                                title="点击全屏预览"
                              />
                            </div>
                          </div>
                        ) : (
                          /* 其他情况使用横向布局（图片+文字） */
                          <div className="flex gap-3 items-start">
                            {/* 左边：图像 */}
                            <div className="flex-shrink-0">
                              {message.sourceImageData && (
                                <div className="mb-2">
                                  <img
                                    src={message.sourceImageData}
                                    alt="源图像"
                                    className="w-16 h-16 object-cover rounded border shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleImagePreview(message.sourceImageData!, '源图像');
                                    }}
                                    title="点击全屏预览"
                                  />
                                </div>
                              )}
                              {message.sourceImagesData && message.sourceImagesData.length > 0 && (
                                <div className="mb-2">
                                  <div className="grid grid-cols-2 gap-1 max-w-20">
                                    {message.sourceImagesData.map((imageData, index) => (
                                      <div key={index} className="relative">
                                        <img
                                          src={imageData}
                                          alt={`融合图像 ${index + 1}`}
                                          className="w-8 h-8 object-cover rounded border shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleImagePreview(imageData, `融合图像 ${index + 1}`);
                                          }}
                                          title={`点击全屏预览融合图像 ${index + 1}`}
                                        />
                                        {/* 主场景标签 - 显示在第一张图片上 */}
                                        {index === 0 && message.sourceImagesData && message.sourceImagesData.length > 1 && (
                                          <div className="absolute -top-0.5 -left-0.5 bg-blue-600 text-white text-xs px-1 py-0.5 rounded-full font-medium shadow-sm" style={{ fontSize: '0.6rem' }}>
                                            主
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* 右边：文字内容 */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm leading-relaxed text-black break-words markdown-content">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    p: ({ children }) => <p className="mb-1 text-sm">{children}</p>,
                                    ul: ({ children }) => <ul className="list-disc list-inside mb-1 ml-2 text-sm">{children}</ul>,
                                    ol: ({ children }) => <ol className="list-decimal list-inside mb-1 ml-2 text-sm">{children}</ol>,
                                    li: ({ children }) => <li className="mb-0.5 text-sm">{children}</li>,
                                    h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-2">{children}</h1>,
                                    h2: ({ children }) => <h2 className="text-base font-bold mb-1 mt-1">{children}</h2>,
                                    h3: ({ children }) => <h3 className="text-base font-bold mb-1">{children}</h3>,
                                    code: ({ children, ...props }: any) => {
                                      const inline = !('className' in props && props.className?.includes('language-'));
                                      return inline
                                        ? <code className="bg-gray-100 px-1 rounded text-xs">{children}</code>
                                        : <pre className="bg-gray-100 p-1 rounded text-xs overflow-x-auto mb-1"><code>{children}</code></pre>;
                                    },
                                    blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-300 pl-2 italic text-xs mb-1">{children}</blockquote>,
                                    a: ({ href, children }) => <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                    em: ({ children }) => <em className="italic">{children}</em>,
                                  }}
                                >
                                  {message.content}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* 没有图像时使用原来的纵向布局 */
                      <div>
                        {/* AI消息标识 */}
                        {message.type === 'ai' && (
                          <div className="flex items-center gap-2 mb-2">
                            <img src="/logo.png" alt="TAI Logo" className="w-4 h-4" />
                            <span className="text-sm font-bold text-black">TAI</span>
                            {/* 显示联网搜索标识 */}
                            {message.webSearchResult?.hasSearchResults && (
                              <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                <Search className="w-3 h-3" />
                                <span>已联网</span>
                              </div>
                            )}
                          </div>
                        )}
                        <div className={cn(
                          "text-sm text-black markdown-content leading-relaxed",
                          message.type === 'user' && "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass rounded-lg p-3 inline-block"
                        )}>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <p className="mb-1 text-sm">{children}</p>,
                              ul: ({ children }) => <ul className="list-disc list-inside mb-1 ml-2 text-sm">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside mb-1 ml-2 text-sm">{children}</ol>,
                              li: ({ children }) => <li className="mb-0.5 text-sm">{children}</li>,
                              h1: ({ children }) => <h1 className="text-base font-bold mb-1 mt-1">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-sm font-bold mb-0.5">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-bold mb-0.5">{children}</h3>,
                              code: ({ children, ...props }: any) => {
                                const inline = !('className' in props && props.className?.includes('language-'));
                                return inline
                                  ? <code className="bg-gray-100 px-0.5 rounded" style={{ fontSize: '0.7rem' }}>{children}</code>
                                  : <pre className="bg-gray-100 p-0.5 rounded overflow-x-auto mb-0.5" style={{ fontSize: '0.7rem' }}><code>{children}</code></pre>;
                              },
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-300 pl-1 italic mb-0.5">{children}</blockquote>,
                              a: ({ href, children }) => <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                              em: ({ children }) => <em className="italic">{children}</em>,
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                          
                          {/* 显示搜索来源 */}
                          {message.type === 'ai' && message.webSearchResult?.hasSearchResults && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                              <div className="text-xs text-gray-500 mb-1">信息来源：</div>
                              <div className="space-y-1">
                                {message.webSearchResult.sources.slice(0, 3).map((source: any, idx: number) => (
                                  <div key={idx} className="text-xs">
                                    <a 
                                      href={source.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:underline"
                                      title={source.snippet}
                                    >
                                      {source.title}
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* 流式文本临时气泡（仅文本对话） */}
                {isStreaming && streamingText && (
                  <div
                    className={cn(
                      "p-2 transition-colors text-sm text-black mr-3"
                    )}
                  >
                    {/* AI消息标识 */}
                    <div className="flex items-center gap-2 mb-2">
                      <img src="/logo.png" alt="TAI Logo" className="w-4 h-4" />
                      <span className="text-sm font-bold text-black">TAI</span>
                      <span className="text-xs text-gray-400">正在输入…</span>
                    </div>
                    <div className={cn(
                      "bg-liquid-glass-light backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass-light shadow-liquid-glass rounded-lg p-3"
                    )}>
                      <div className="text-sm leading-relaxed text-black break-words markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {streamingText}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}


        </div>
      </div>

      {/* 图片预览模态框 */}
      {previewImage && (
        <ImagePreviewModal
          isOpen={true}
          imageSrc={previewImage.src}
          imageTitle={previewImage.title}
          onClose={handleClosePreview}
        />
      )}
    </div>
  );
};

export default AIChatDialog;
