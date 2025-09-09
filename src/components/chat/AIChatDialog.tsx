/**
 * AI生图对话框组件
 * 固定在屏幕底部中央的对话框，用于AI图像生成
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAIChatStore } from '@/stores/aiChatStore';
import { Send, AlertCircle, Image, X, History, Plus, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const AIChatDialog: React.FC = () => {
  const {
    isVisible,
    currentInput,
    generationStatus,
    messages,
    sourceImageForEditing,
    sourceImagesForBlending,
    sourceImageForAnalysis,
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
    isIterativeMode
  } = useAIChatStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  // 🧠 初始化上下文记忆系统
  useEffect(() => {
    initializeContext();
  }, [initializeContext]);

  // 智能历史记录显示：纯对话模式自动打开，绘图模式不打开
  useEffect(() => {
    if (messages.length > 0 && !showHistory && !isMaximized) {
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
  }, [messages.length, isMaximized, showHistory]);

  // 自动滚动到最新消息
  useEffect(() => {
    if ((showHistory || isMaximized) && historyRef.current && messages.length > 0) {
      // 延迟滚动，确保DOM已更新
      const timer = setTimeout(() => {
        if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showHistory, messages.length, isMaximized]);

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
    setShowHistory(!showHistory);
  };

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

  // 移除源图像
  const handleRemoveSourceImage = () => {
    setSourceImageForEditing(null);
  };

  // 处理发送 - 使用AI智能工具选择
  const handleSend = async () => {
    const trimmedInput = currentInput.trim();
    if (!trimmedInput || generationStatus.isGenerating) return;

    // 使用新的智能处理入口
    await processUserInput(trimmedInput);
    clearInput();
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      hideDialog();
    }
  };

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentInput(e.target.value);
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

  // 如果对话框不可见，不渲染
  if (!isVisible) return null;

  const canSend = currentInput.trim().length > 0 && !generationStatus.isGenerating;

  return (
    <div className={cn(
      "fixed z-50 transition-all duration-300 ease-out",
      isMaximized
        ? "top-32 left-16 right-16 bottom-4" // 最大化时，64px边距
        : "bottom-3 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4"
    )}>
      <div
        ref={dialogRef}
        className={cn(
          "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-150 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 ease-out focus-within:border-blue-300",
          isMaximized ? "h-full flex flex-col rounded-2xl" : "p-4 rounded-2xl"
        )}
      >
        {/* 内容区域 */}
        <div className={cn(
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
          <div onClick={(e) => e.stopPropagation()}>
            <div className="relative">

              <Textarea
                ref={textareaRef}
                value={currentInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={getSmartPlaceholder()}
                disabled={generationStatus.isGenerating}
                className={cn(
                  "resize-none pr-20 min-h-[80px] text-sm bg-transparent border-gray-300 focus:border-blue-400 focus:ring-0 transition-colors duration-200",
                  generationStatus.isGenerating && "opacity-75"
                )}
                rows={showHistory ? 3 : 1}
              />

              {/* 最大化按钮 */}
              <Button
                onClick={() => setIsMaximized(!isMaximized)}
                size="sm"
                variant="outline"
                className={cn(
                  "absolute right-28 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200 z-10",
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-150 border border-liquid-glass hover:bg-liquid-glass-hover shadow-liquid-glass text-gray-700"
                )}
                title={isMaximized ? "还原窗口" : "最大化窗口"}
              >
                {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>

              {/* 历史记录按钮 */}
              <div className="relative">
                <Button
                  onClick={isMaximized ? undefined : toggleHistory}
                  disabled={isMaximized || generationStatus.isGenerating || messages.length === 0}
                  size="sm"
                  variant="outline"
                  className={cn(
                    "absolute right-20 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-150 border border-liquid-glass shadow-liquid-glass",
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

              {/* 统一的图片上传按钮 */}
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={generationStatus.isGenerating}
                size="sm"
                variant="outline"
                className={cn(
                  "absolute right-12 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-150 border border-liquid-glass shadow-liquid-glass",
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
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-150 border border-liquid-glass shadow-liquid-glass",
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
          {(showHistory || isMaximized) && messages.length > 0 && (
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
              <div className="space-y-1.5 mr-1">
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
                        message.type === 'user' && "bg-blue-50"
                      )}>
                        {/* AI消息标识 - 单独一行 */}
                        {message.type === 'ai' && (
                          <div className="flex items-center gap-2 mb-3">
                            <img src="/logo.png" alt="TAI Logo" className="w-4 h-4" />
                            <span className="text-sm font-bold text-black">TAI</span>
                          </div>
                        )}

                        {/* AI生成图片时只显示图片，不显示文字 */}
                        {message.type === 'ai' && message.imageData ? (
                          <div className="flex justify-center">
                            <img
                              src={`data:image/png;base64,${message.imageData}`}
                              alt="AI生成的图像"
                              className="w-32 h-32 object-cover rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                // 可以在这里添加图像预览功能
                                console.log('点击查看大图');
                              }}
                              title="点击查看大图"
                            />
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
                                    className="w-16 h-16 object-cover rounded border shadow-sm cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSourceImageForEditing(message.sourceImageData!);
                                    }}
                                    title="点击重新使用此图像"
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
                                          className="w-8 h-8 object-cover rounded border shadow-sm cursor-pointer"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            addImageForBlending(imageData);
                                          }}
                                          title={`点击重新使用融合图像 ${index + 1}`}
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
                          </div>
                        )}
                        <div className={cn(
                          "text-sm text-black markdown-content leading-relaxed",
                          message.type === 'user' && "bg-blue-50 rounded-lg p-3 inline-block"
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
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}


        </div>
      </div>
    </div>
  );
};

export default AIChatDialog;