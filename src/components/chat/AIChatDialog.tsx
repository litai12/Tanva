/**
 * AI生图对话框组件
 * 固定在屏幕底部中央的对话框，用于AI图像生成
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAIChatStore } from '@/stores/aiChatStore';
import { Send, AlertCircle, Image, X, History, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const AIChatDialog: React.FC = () => {
  const {
    isVisible,
    currentInput,
    generationStatus,
    messages,
    sourceImageForEditing,
    sourceImagesForBlending,
    hideDialog,
    setCurrentInput,
    clearInput,
    generateImage,
    editImage,
    blendImages,
    setSourceImageForEditing,
    addImageForBlending,
    removeImageFromBlending,
    clearImagesForBlending,
    getAIMode
  } = useAIChatStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  // 自动聚焦到输入框
  useEffect(() => {
    if (isVisible && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isVisible]);



  // 切换历史记录显示
  const toggleHistory = () => {
    setShowHistory(!showHistory);
  };

  // 统一的图片上传处理
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // 如果当前已有图片，则添加到融合模式
    const hasExistingImages = sourceImageForEditing || sourceImagesForBlending.length > 0;

    if (hasExistingImages) {
      // 已有图片：转换为融合模式或添加到融合模式
      if (sourceImageForEditing) {
        // 将单图编辑转换为多图融合
        addImageForBlending(sourceImageForEditing);
        setSourceImageForEditing(null);
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
        // 单图：设置为编辑模式
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

  // 处理发送 - 智能模式切换
  const handleSend = async () => {
    const trimmedInput = currentInput.trim();
    if (!trimmedInput || generationStatus.isGenerating) return;

    const aiMode = getAIMode();

    switch (aiMode) {
      case 'blend':
        // 多图融合模式
        await blendImages(trimmedInput, sourceImagesForBlending);
        clearImagesForBlending();
        break;
      case 'edit':
        // 单图编辑模式
        await editImage(trimmedInput, sourceImageForEditing!);
        setSourceImageForEditing(null);
        break;
      default:
        // 文本生图模式
        await generateImage(trimmedInput);
    }

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
        return "描述如何编辑这张图像...";
      default:
        return "描述你想要生成的图像...";
    }
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
      >



        {/* 统一的图像预览区域 */}
        {(sourceImageForEditing || sourceImagesForBlending.length > 0) && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-600">
                {sourceImagesForBlending.length > 0 ? '融合图像' : '编辑图像'}
              </span>
              {sourceImagesForBlending.length > 0 && (
                <span className="text-xs text-blue-600">({sourceImagesForBlending.length}张)</span>
              )}
              <Button
                onClick={() => {
                  setSourceImageForEditing(null);
                  clearImagesForBlending();
                }}
                size="sm"
                variant="outline"
                className="h-5 w-5 p-0 rounded-full text-xs"
                title="清空所有图像"
              >
                <X className="h-2.5 w-2.5" />
              </Button>
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

              {/* 多图融合显示 */}
              {sourceImagesForBlending.map((imageData, index) => (
                <div key={index} className="relative group">
                  <img
                    src={imageData}
                    alt={`融合图片 ${index + 1}`}
                    className="w-16 h-16 object-cover rounded border shadow-sm"
                  />
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
              {getAIMode() === 'blend' ? '正在融合图像...' :
                getAIMode() === 'edit' ? '正在编辑图像...' : '正在生成图像...'} {generationStatus.progress}%
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
                "resize-none pr-20 min-h-[80px] transition-all duration-200 text-sm",
                generationStatus.isGenerating && "opacity-75"
              )}
              rows={showHistory ? 3 : 1}
            />

            {/* 历史记录按钮 */}
            <Button
              onClick={toggleHistory}
              disabled={generationStatus.isGenerating || messages.length === 0}
              size="sm"
              variant="outline"
              className={cn(
                "absolute right-20 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                showHistory ? "bg-blue-100 border-blue-300" : "",
                !generationStatus.isGenerating && messages.length > 0
                  ? "hover:bg-gray-100 border-gray-300"
                  : "opacity-50 cursor-not-allowed"
              )}
              title={messages.length > 0 ? "查看聊天历史" : "暂无聊天历史"}
            >
              <History className="h-3.5 w-3.5" />
            </Button>

            {/* 统一的图片上传按钮 */}
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={generationStatus.isGenerating}
              size="sm"
              variant="outline"
              className={cn(
                "absolute right-12 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                (sourceImageForEditing || sourceImagesForBlending.length > 0) ? "bg-blue-100 border-blue-300" : "",
                !generationStatus.isGenerating
                  ? "hover:bg-gray-100 border-gray-300"
                  : "opacity-50 cursor-not-allowed"
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
              className={cn(
                "absolute right-4 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
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
                  {/* 如果有图像或源图像，使用特殊布局 */}
                  {(message.imageData || message.sourceImageData || message.sourceImagesData) ? (
                    <div className="flex gap-3 items-start">
                      {/* 左边：图像 */}
                      <div className="flex-shrink-0">
                        {message.sourceImageData && (
                          <div className="mb-2">
                            <img
                              src={message.sourceImageData}
                              alt="源图像"
                              className="w-16 h-16 object-cover rounded-lg border shadow-sm cursor-pointer opacity-75"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSourceImageForEditing(message.sourceImageData!);
                              }}
                              title="点击重新使用此图像"
                            />
                            <div className="text-xs text-gray-500 text-center mt-1">源图</div>
                          </div>
                        )}
                        {message.sourceImagesData && message.sourceImagesData.length > 0 && (
                          <div className="mb-2">
                            <div className="grid grid-cols-2 gap-1 max-w-20">
                              {message.sourceImagesData.map((imageData, index) => (
                                <img
                                  key={index}
                                  src={imageData}
                                  alt={`融合图像 ${index + 1}`}
                                  className="w-9 h-9 object-cover rounded border shadow-sm cursor-pointer opacity-75"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addImageForBlending(imageData);
                                  }}
                                  title={`点击重新使用融合图像 ${index + 1}`}
                                />
                              ))}
                            </div>
                            <div className="text-xs text-gray-500 text-center mt-1">融合图({message.sourceImagesData.length}张)</div>
                          </div>
                        )}
                        {message.imageData && (
                          <div>
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
                            <div className="text-xs text-gray-500 text-center mt-1">结果</div>
                          </div>
                        )}
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