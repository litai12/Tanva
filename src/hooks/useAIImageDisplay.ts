/**
 * AI图像显示Hook
 * 处理AI生成图像在Paper.js画布中的显示，保持原始分辨率
 */

import { useEffect, useCallback } from 'react';
import paper from 'paper';
import type { AIImageResult } from '@/types/ai';

export const useAIImageDisplay = () => {
  
  // 在画布中央显示AI生成的图像（原始分辨率）
  const displayImageOnCanvas = useCallback((aiResult: AIImageResult) => {
    console.log('🖼️ 开始在画布中显示AI生成图像（原始分辨率）:', aiResult.id);

    if (!paper.project || !paper.project.activeLayer) {
      console.error('❌ Paper.js项目或活动图层未初始化');
      return;
    }

    try {
      // 构建完整的图像数据URL
      const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
      const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;

      // 创建新的图像元素用于加载
      const img = new Image();
      
      img.onload = () => {
        try {
          // 创建Paper.js Raster对象，初始隐藏避免闪烁
          const raster = new paper.Raster({
            source: img,
            visible: false
          });

          // 等待一帧让图片完全加载
          setTimeout(() => {
            // 存储原始尺寸信息
            const originalWidth = raster.width;
            const originalHeight = raster.height;
            const aspectRatio = originalWidth / originalHeight;

            // 设置图像数据属性
            raster.data = {
              type: 'ai-generated-image',
              aiResultId: aiResult.id,
              prompt: aiResult.prompt,
              model: aiResult.model,
              createdAt: aiResult.createdAt,
              metadata: aiResult.metadata,
              originalWidth,
              originalHeight,
              aspectRatio
            };

            // 将图片放置在画布中央，保持原始分辨率
            raster.position = paper.view.center;
            
            // 现在显示图片
            raster.visible = true;

            // 获取当前视图信息
            const viewBounds = paper.view.bounds;
            const viewCenter = paper.view.center;
            
            console.log('📐 视图信息:', {
              viewBounds: {
                x: viewBounds.x,
                y: viewBounds.y,
                width: viewBounds.width,
                height: viewBounds.height
              },
              viewCenter: { x: viewCenter.x, y: viewCenter.y },
              originalImageSize: { 
                width: originalWidth, 
                height: originalHeight 
              }
            });

            console.log('🎯 保持图像原始分辨率:', {
              originalSize: { 
                width: originalWidth, 
                height: originalHeight 
              },
              imageNaturalSize: {
                width: img.naturalWidth,
                height: img.naturalHeight
              }
            });

            // 创建一个透明矩形用于交互（使用原始尺寸和位置）
            const imageRect = new paper.Path.Rectangle({
              rectangle: raster.bounds,
              fillColor: null,
              strokeColor: null
            });

            // 创建Paper.js组来包含所有相关元素
            const imageGroup = new paper.Group([imageRect, raster]);
            imageGroup.data = {
              type: 'ai-generated-image',
              aiResultId: aiResult.id,
              isHelper: false
            };

            console.log('🎯 图像最终信息:', {
              position: { x: raster.position.x, y: raster.position.y },
              bounds: {
                x: raster.bounds.x,
                y: raster.bounds.y,
                width: raster.bounds.width,
                height: raster.bounds.height
              },
              preservedOriginalResolution: true
            });

            // 添加到活动图层
            paper.project.activeLayer.addChild(imageGroup);

            // 创建临时高亮边框以帮助用户找到图像
            const highlightBorder = new paper.Path.Rectangle({
              rectangle: raster.bounds.expand(10), // 比图像大10像素
              strokeColor: new paper.Color('#ff6b6b'), // 红色边框
              strokeWidth: 3,
              dashArray: [8, 4],
              fillColor: null
            });
            highlightBorder.data = {
              type: 'ai-image-highlight',
              isTemporary: true
            };

            // 添加高亮边框
            paper.project.activeLayer.addChild(highlightBorder);

            // 选中新创建的图像
            if (paper.project.selectedItems) {
              paper.project.deselectAll();
            }
            raster.selected = true;

            // 强制更新视图多次确保渲染
            paper.view.update();
            
            // 延迟移除高亮边框
            setTimeout(() => {
              if (highlightBorder && highlightBorder.parent) {
                highlightBorder.remove();
                paper.view.update();
              }
            }, 3000); // 3秒后移除高亮

            // 智能视图调整 - 确保原始分辨率图像可见
            const currentZoom = paper.view.zoom;
            const imageSize = Math.max(originalWidth, originalHeight);
            const viewSize = Math.min(viewBounds.width, viewBounds.height);
            
            // 如果图像比视图大很多，适当缩小视图以显示完整图像
            if (imageSize > viewSize * 0.8) {
              const suggestedZoom = (viewSize * 0.8) / imageSize * currentZoom;
              if (suggestedZoom < currentZoom) {
                console.log('📏 图像较大，适当调整视图缩放以显示完整图像');
                paper.view.zoom = Math.max(suggestedZoom, 0.1); // 最小缩放0.1
                paper.view.center = viewCenter;
                paper.view.update();
              }
            } else if (currentZoom < 0.3) {
              console.log('📏 画布缩放太小，自动调整到合适缩放级别');
              paper.view.zoom = 0.5;
              paper.view.center = viewCenter;
              paper.view.update();
            }

            console.log('✅ AI图像已成功显示在画布中', {
              id: aiResult.id,
              position: raster.position,
              bounds: raster.bounds,
              originalResolution: true,
              highlighted: true,
              message: '🔍 图像已放置在画布中央（保持原始分辨率），带有3秒红色高亮边框帮助定位'
            });
            
            // 向用户显示友好提示
            console.info('🎨 AI图像已生成并自动添加到画布！\n✅ 已自动下载到本地\n🎯 图像保持原始分辨率显示在画布中央');

            // 触发图像添加完成事件
            window.dispatchEvent(new CustomEvent('aiImageDisplayed', {
              detail: {
                aiResult,
                raster,
                position: raster.position
              }
            }));

          }, 50); // 延迟50ms确保图片加载完成

        } catch (error) {
          console.error('❌ 创建Paper.js图像对象失败:', error);
        }
      };

      img.onerror = (error) => {
        console.error('❌ 图像加载失败:', error);
        console.error('🔍 调试信息:', {
          imageDataUrl: imageDataUrl.substring(0, 100) + '...',
          imageDataLength: aiResult.imageData?.length,
          mimeType: mimeType
        });
      };

      // 开始加载图像
      img.src = imageDataUrl;

    } catch (error) {
      console.error('❌ 显示AI图像时发生错误:', error);
    }
  }, []);

  // 监听AI图像生成完成事件
  const handleAIImageGenerated = useCallback((event: CustomEvent<AIImageResult>) => {
    const aiResult = event.detail;
    console.log('📨 收到AI图像生成完成事件:', {
      id: aiResult.id,
      prompt: aiResult.prompt,
      imageDataLength: aiResult.imageData?.length,
      paperProject: !!paper.project,
      paperActiveLayer: !!paper.project?.activeLayer
    });
    
    // 延迟一下确保Paper.js准备就绪
    setTimeout(() => {
      displayImageOnCanvas(aiResult);
    }, 100);
  }, [displayImageOnCanvas]);

  // 注册事件监听器
  useEffect(() => {
    window.addEventListener('aiImageGenerated', handleAIImageGenerated as EventListener);
    
    return () => {
      window.removeEventListener('aiImageGenerated', handleAIImageGenerated as EventListener);
    };
  }, [handleAIImageGenerated]);

  // 手动显示图像的方法
  const showImage = useCallback((aiResult: AIImageResult) => {
    displayImageOnCanvas(aiResult);
  }, [displayImageOnCanvas]);

  // 清除所有AI生成的图像
  const clearAIImages = useCallback(() => {
    if (!paper.project || !paper.project.activeLayer) {
      return;
    }

    const aiImages = paper.project.activeLayer.children.filter(
      (item: paper.Item) => item.data && item.data.type === 'ai-generated-image'
    );

    aiImages.forEach((item: paper.Item) => item.remove());
    paper.view.update();

    console.log(`🗑️ 已清除 ${aiImages.length} 个AI生成的图像`);
  }, []);

  // 获取所有AI生成的图像
  const getAIImages = useCallback(() => {
    if (!paper.project || !paper.project.activeLayer) {
      return [];
    }

    return paper.project.activeLayer.children.filter(
      (item: paper.Item) => item.data && item.data.type === 'ai-generated-image'
    );
  }, []);

  return {
    showImage,
    clearAIImages,
    getAIImages,
    displayImageOnCanvas
  };
};