/**
 * AI图像显示Hook
 * 处理AI生成图像在Paper.js画布中的显示，保持原始分辨率
 */

import { useEffect, useCallback } from 'react';
import paper from 'paper';
import type { AIImageResult } from '@/types/ai';

export const useAIImageDisplay = () => {

  // 在画布中央显示AI生成的图像（原始分辨率）
  const displayImageOnCanvas = useCallback((aiResult: AIImageResult, retryCount: number = 0) => {
    console.log('🖼️ [DEBUG] displayImageOnCanvas被调用，参数:', {
      aiResultId: aiResult.id,
      prompt: aiResult.prompt,
      imageDataLength: aiResult.imageData?.length,
      paperProject: !!paper.project,
      paperActiveLayer: !!paper.project?.activeLayer,
      paperLayers: paper.project?.layers?.length || 0
    });

    // 确保Paper.js已初始化
    if (!paper.project) {
      if (retryCount < 10) {  // 最多重试10次
        console.error(`❌ Paper.js项目未初始化，第${retryCount + 1}次重试，延迟500ms...`);
        setTimeout(() => {
          displayImageOnCanvas(aiResult, retryCount + 1);
        }, 500);
      } else {
        console.error('❌ Paper.js项目初始化失败，已达最大重试次数');
      }
      return;
    }

    // 确保有活动图层
    if (!paper.project.activeLayer) {
      console.log('⚠️ 没有活动图层，尝试创建或激活默认图层...');
      if (paper.project.layers && paper.project.layers.length > 0) {
        paper.project.layers[0].activate();
        console.log('✅ 已激活第一个图层');
      } else {
        const newLayer = new paper.Layer();
        newLayer.activate();
        console.log('✅ 已创建并激活新图层');
      }
    }

    console.log('✅ Paper.js环境检查通过，开始处理图片...');

    try {
      // 构建完整的图像数据URL
      const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
      const imageDataUrl = `data:${mimeType};base64,${aiResult.imageData}`;

      // 创建新的图像元素用于加载
      const img = new Image();

      img.onload = () => {
        console.log('📷 [DEBUG] HTML Image加载完成，开始创建Paper.js Raster...');
        try {
          // 创建Paper.js Raster对象
          const raster = new paper.Raster({
            source: img,
            position: new paper.Point(0, 0)  // 直接设置位置
          });

          console.log('🎨 [DEBUG] Paper.js Raster创建完成，等待onLoad...');

          // 在onLoad回调中处理图片
          raster.onLoad = () => {
            console.log('🎯 [DEBUG] Paper.js Raster.onLoad触发，开始处理图片...');
            // 存储原始尺寸信息
            const originalWidth = raster.width;
            const originalHeight = raster.height;
            const aspectRatio = originalWidth / originalHeight;

            // 限制最大显示尺寸为400px（与快速上传工具一致）
            const maxSize = 400;
            let displayWidth = originalWidth;
            let displayHeight = originalHeight;

            if (originalWidth > maxSize || originalHeight > maxSize) {
              const scale = Math.min(maxSize / originalWidth, maxSize / originalHeight);
              displayWidth = originalWidth * scale;
              displayHeight = originalHeight * scale;
            }

            // 设置显示尺寸（与快速上传工具一致）
            raster.size = new paper.Size(displayWidth, displayHeight);

            // 确保位置在坐标原点
            raster.position = new paper.Point(0, 0);

            // 生成唯一ID
            const imageId = `ai_${aiResult.id}`;

            // 设置图像数据属性（与快速上传工具一致）
            raster.data = {
              type: 'image',
              imageId: imageId,
              originalWidth: originalWidth,
              originalHeight: originalHeight,
              fileName: `ai_generated_${aiResult.prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`,
              uploadMethod: 'ai-generated',
              aspectRatio: aspectRatio
            };

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

            // 创建选择边框（默认隐藏，与2D上传工具一致）
            const selectionBorder = new paper.Path.Rectangle({
              rectangle: raster.bounds,
              strokeColor: new paper.Color('#3b82f6'),
              strokeWidth: 2,
              fillColor: null,
              selected: false,
              visible: false  // 默认隐藏
            });
            selectionBorder.data = {
              isSelectionBorder: true,
              isHelper: true
            };

            // 添加四个角的调整控制点（默认隐藏）
            const handleSize = 8;
            const handleColor = new paper.Color('#3b82f6');
            const bounds = raster.bounds;

            const handles = [
              { direction: 'nw', position: [bounds.left, bounds.top] },
              { direction: 'ne', position: [bounds.right, bounds.top] },
              { direction: 'sw', position: [bounds.left, bounds.bottom] },
              { direction: 'se', position: [bounds.right, bounds.bottom] }
            ];

            const handleElements: paper.Path[] = [];
            handles.forEach(({ direction, position }) => {
              const handle = new paper.Path.Rectangle({
                point: [position[0] - handleSize / 2, position[1] - handleSize / 2],
                size: [handleSize, handleSize],
                fillColor: handleColor,
                strokeColor: 'white',
                strokeWidth: 1,
                selected: false,
                visible: false  // 默认隐藏
              });
              handle.data = {
                isResizeHandle: true,
                direction,
                imageId: `ai_${aiResult.id}`,
                isHelper: true
              };
              handleElements.push(handle);
            });

            // 创建透明矩形用于交互
            const imageRect = new paper.Path.Rectangle({
              rectangle: raster.bounds,
              fillColor: null,
              strokeColor: null
            });

            // 创建Paper.js组来包含所有相关元素（与快速上传工具一致的顺序）
            const imageGroup = new paper.Group([imageRect, raster, selectionBorder, ...handleElements]);
            imageGroup.data = {
              type: 'image',
              imageId: imageId,
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
            console.log('📋 [DEBUG] 图片组已添加到活动图层');

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
              message: '🔍 图像已放置在坐标原点(0,0)，带有3秒红色高亮边框帮助定位'
            });



            // 触发图像添加完成事件
            window.dispatchEvent(new CustomEvent('aiImageDisplayed', {
              detail: {
                aiResult,
                raster,
                position: raster.position
              }
            }));

            // 按照快速上传工具的格式创建图像实例
            const newImageInstance = {
              id: imageId,
              imageData: {
                id: imageId,
                src: imageDataUrl,
                fileName: `ai_generated_${aiResult.prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`
              },
              bounds: {
                x: raster.bounds.x,
                y: raster.bounds.y,
                width: raster.bounds.width,
                height: raster.bounds.height
              },
              isSelected: false,
              visible: true,
              layerId: paper.project.activeLayer.name
            };

            // 使用与快速上传工具相同的事件名
            console.log('🎪 [DEBUG] 触发quickImageAdded事件，数据:', newImageInstance);
            window.dispatchEvent(new CustomEvent('quickImageAdded', {
              detail: newImageInstance
            }));

            // 强制更新视图
            paper.view.update();
          }; // raster.onLoad结束

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

    console.log('🚀 开始调用displayImageOnCanvas...');

    // 增加延迟时间，确保Paper.js完全准备就绪
    setTimeout(() => {
      console.log('⏰ 延迟1000ms后开始显示图片...');
      displayImageOnCanvas(aiResult);
    }, 1000);  // 增加到1秒延迟
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
      (item: paper.Item) => item.data && item.data.type === 'image' && item.data.uploadMethod === 'ai-generated'
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
      (item: paper.Item) => item.data && item.data.type === 'image' && item.data.uploadMethod === 'ai-generated'
    );
  }, []);

  return {
    showImage,
    clearAIImages,
    getAIImages,
    displayImageOnCanvas
  };
};