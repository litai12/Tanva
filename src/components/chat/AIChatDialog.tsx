/**
 * AI生图对话框组件
 * 固定在屏幕底部中央的对话框，用于AI图像生成
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAIChatStore } from '@/stores/aiChatStore';
import { Send, X, Wand2, AlertCircle } from 'lucide-react';
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
  const [isExpanded, setIsExpanded] = useState(false);

  // 自动聚焦到输入框
  useEffect(() => {
    if (isVisible && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isVisible]);

  // 处理发送
  const handleSend = async () => {
    const trimmedInput = currentInput.trim();
    if (!trimmedInput || generationStatus.isGenerating) return;

    await generateImage(trimmedInput);
    clearInput();
    setIsExpanded(false);
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
    
    // 根据内容长度自动展开
    const hasContent = e.target.value.trim().length > 0;
    setIsExpanded(hasContent || generationStatus.isGenerating);
  };

  // 如果对话框不可见，不渲染
  if (!isVisible) return null;

  const canSend = currentInput.trim().length > 0 && !generationStatus.isGenerating;
  const showProgress = generationStatus.isGenerating && generationStatus.progress > 0;

  return (
    <div className="fixed bottom-5 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <div className={cn(
        "bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200/50 transition-all duration-300 ease-out",
        isExpanded ? "pb-4" : "pb-2"
      )}>
        
        {/* 头部区域 */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-purple-600" />
            <span className="text-sm font-medium text-gray-700">AI图像生成</span>
            {generationStatus.isGenerating && (
              <LoadingSpinner size="sm" className="text-purple-600" />
            )}
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
            onClick={hideDialog}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 进度条 */}
        {showProgress && (
          <div className="px-4 pb-2">
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
        <div className="px-4">
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
              rows={isExpanded ? 3 : 1}
            />
            
            {/* 发送按钮 */}
            <Button
              onClick={handleSend}
              disabled={!canSend}
              size="sm"
              className={cn(
                "absolute right-2 bottom-2 h-8 w-8 p-0 rounded-full transition-all duration-200",
                canSend 
                  ? "bg-purple-600 hover:bg-purple-700 text-white" 
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              )}
            >
              {generationStatus.isGenerating ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* 成功提示 */}
        {generationStatus.progress === 100 && !generationStatus.isGenerating && !generationStatus.error && (
          <div className="px-4 pt-2">
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="h-4 w-4 text-green-600 flex-shrink-0">✅</div>
              <div className="flex-1 text-sm text-green-800">
                <div className="font-medium">图像已生成！</div>
                <div className="text-xs mt-1">已自动下载到本地并添加到画布中央（原始分辨率）</div>
              </div>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {generationStatus.error && (
          <div className="px-4 pt-2">
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <span className="text-sm text-red-800">{generationStatus.error}</span>
            </div>
          </div>
        )}

        {/* 消息历史（展开时显示最近的消息） */}
        {isExpanded && messages.length > 0 && (
          <div className="px-4 pt-3 max-h-32 overflow-y-auto">
            <div className="space-y-2">
              {messages.slice(-3).map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "text-xs p-2 rounded-lg",
                    message.type === 'user' && "bg-blue-50 text-blue-800 ml-8",
                    message.type === 'ai' && "bg-green-50 text-green-800 mr-8",
                    message.type === 'error' && "bg-red-50 text-red-800"
                  )}
                >
                  <div className="flex items-center gap-1">
                    <span className="font-medium">
                      {message.type === 'user' ? '你' : message.type === 'ai' ? 'AI' : '错误'}:
                    </span>
                    <span>{message.content}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 底部提示 */}
        <div className="px-4 pt-2">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>按 Enter 发送，Shift + Enter 换行</span>
            <span>生成一张图像约 $0.039</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIChatDialog;