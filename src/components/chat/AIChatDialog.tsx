/**
 * AI生图对话框组件
 * 固定在屏幕底部中央的对话框，用于AI图像生成
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAIChatStore } from '@/stores/aiChatStore';
import { Send, Wand2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const AIChatDialog: React.FC = () => {
  const {
    isVisible,
    currentInput,
    generationStatus,
    messages,
    hideDialog,
    setCurrentInput,
    clearInput,
    generateImage
  } = useAIChatStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  // 自动聚焦到输入框
  useEffect(() => {
    if (isVisible && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isVisible]);



  // 对话框获得焦点时显示聊天历史记录
  const handleDialogFocus = () => {
    if (messages.length > 0) {
      setShowHistory(true);
    }
  };

  // 对话框失去焦点时隐藏历史记录
  const handleDialogBlur = () => {
    setShowHistory(false);
  };

  // 处理发送
  const handleSend = async () => {
    const trimmedInput = currentInput.trim();
    if (!trimmedInput || generationStatus.isGenerating) return;

    await generateImage(trimmedInput);
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

  // 如果对话框不可见，不渲染
  if (!isVisible) return null;

  const canSend = currentInput.trim().length > 0 && !generationStatus.isGenerating;
  const showProgress = generationStatus.isGenerating && generationStatus.progress > 0;

  return (
    <div className="fixed bottom-5 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <div
        ref={dialogRef}
        className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200/50 transition-all duration-300 ease-out p-4 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
        tabIndex={0}
        onFocus={handleDialogFocus}
        onBlur={handleDialogBlur}
      >


        {/* 进度条 */}
        {showProgress && (
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-purple-600 h-1.5 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${generationStatus.progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              正在生成图像... {generationStatus.progress}%
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
              placeholder="描述你想要生成的图像..."
              disabled={generationStatus.isGenerating}
              className={cn(
                "resize-none pr-12 min-h-[60px] transition-all duration-200",
                generationStatus.isGenerating && "opacity-75"
              )}
              rows={showHistory ? 3 : 1}
            />

            {/* 发送按钮 */}
            <Button
              onClick={handleSend}
              disabled={!canSend}
              size="sm"
              className={cn(
                "absolute right-2 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                canSend
                  ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              )}
            >
              {generationStatus.isGenerating ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
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

        {/* 消息历史（点击对话框时显示） */}
        {showHistory && messages.length > 0 && (
          <div
            className="mt-4 max-h-48 overflow-y-auto"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#d1d5db #f3f4f6'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <div className="mb-3">
                <span className="text-xs text-gray-500 font-medium">聊天历史记录</span>
                <div className="text-xs text-gray-400 mt-1">点击其他区域收起</div>
              </div>
              {messages.slice(-5).map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "p-3 rounded-lg transition-colors",
                    message.type === 'user' && "bg-blue-50 text-blue-800 ml-4",
                    message.type === 'ai' && "bg-green-50 text-green-800 mr-4",
                    message.type === 'error' && "bg-red-50 text-red-800"
                  )}
                >
                  {/* 如果有图像，使用左右布局 */}
                  {message.imageData ? (
                    <div className="flex gap-3 items-start">
                      {/* 左边：图像 */}
                      <div className="flex-shrink-0">
                        <img
                          src={`data:image/png;base64,${message.imageData}`}
                          alt="AI生成的图像"
                          className="w-20 h-20 object-cover rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            // 可以在这里添加图像预览功能
                            console.log('点击查看大图');
                          }}
                          title="点击查看大图"
                        />
                      </div>

                      {/* 右边：文字内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-xs">
                            {message.type === 'user' ? '你' : message.type === 'ai' ? 'AI' : '错误'}
                          </span>
                          <span className="text-gray-400 text-xs">
                            {message.timestamp.toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <div className="text-sm leading-relaxed text-gray-700 break-words">
                          {message.content}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 没有图像时使用原来的纵向布局 */
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs">
                          {message.type === 'user' ? '你' : message.type === 'ai' ? 'AI' : '错误'}
                        </span>
                        <span className="text-gray-400 text-xs">
                          {message.timestamp.toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="text-sm">{message.content}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}


      </div>
    </div>
  );
};

export default AIChatDialog;