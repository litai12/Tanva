/**
 * AI图像显示Hook
 * 处理AI生成图像在Paper.js画布中的显示，保持原始分辨率
 */

import { useEffect, useCallback } from 'react';
import paper from 'paper';
import type { AIImageResult } from '@/types/ai';
import { ensureImageGroupStructure } from '@/utils/paperImageGroup';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';

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

      // 创建加载指示器（转圈动画）
      const loadingIndicatorSize = 48;
      const targetPosition = new paper.Point(0, 0);
      const loadingGroup = new paper.Group();
      loadingGroup.position = targetPosition;
      loadingGroup.data = { type: 'loading-indicator', aiResultId: aiResult.id };

      // 创建背景圆形
      const bgCircle = new paper.Path.Circle({
        center: new paper.Point(0, 0),
        radius: loadingIndicatorSize / 2,
        fillColor: new paper.Color(1, 1, 1, 0.9),
        strokeColor: new paper.Color(0.9, 0.9, 0.9),
        strokeWidth: 1
      });
      loadingGroup.addChild(bgCircle);

      // 创建旋转的弧形（loading spinner）
      const arcRadius = loadingIndicatorSize / 2 - 8;
      const loadingArc = new paper.Path.Arc({
        from: new paper.Point(0, -arcRadius),
        through: new paper.Point(arcRadius, 0),
        to: new paper.Point(0, arcRadius),
        strokeColor: new paper.Color('#3b82f6'),
        strokeWidth: 3,
        strokeCap: 'round'
      });
      loadingGroup.addChild(loadingArc);

      // 添加到画布
      paper.project.activeLayer.addChild(loadingGroup);
      paper.view.update();

      // 启动旋转动画
      let animationFrameId: number | null = null;
      const animateLoading = () => {
        if (loadingGroup && loadingGroup.parent) {
          loadingArc.rotate(6, new paper.Point(0, 0));
          paper.view.update();
          animationFrameId = requestAnimationFrame(animateLoading);
        }
      };
      animationFrameId = requestAnimationFrame(animateLoading);

      // 移除加载指示器的函数
      const removeLoadingIndicator = () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        if (loadingGroup && loadingGroup.parent) {
          loadingGroup.remove();
          paper.view.update();
        }
      };

      // 创建新的图像元素用于加载
      const img = new Image();
      img.crossOrigin = 'anonymous';

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
            // 移除加载指示器
            removeLoadingIndicator();

            console.log('🎯 [DEBUG] Paper.js Raster.onLoad触发，开始处理图片...');
            // 存储原始尺寸信息
            const originalWidth = raster.width;
            const originalHeight = raster.height;
            const aspectRatio = originalWidth / originalHeight;

            // 🎯 保持原始分辨率，不设置raster.size避免质量损失
            // 只通过bounds控制显示区域
            const maxDisplaySize = 768; // 最大显示尺寸（与快速上传工具保持一致）
            let displayWidth = originalWidth;
            let displayHeight = originalHeight;

            if (originalWidth > maxDisplaySize || originalHeight > maxDisplaySize) {
              const scale = Math.min(maxDisplaySize / originalWidth, maxDisplaySize / originalHeight);
              displayWidth = originalWidth * scale;
              displayHeight = originalHeight * scale;
            }

            // 🎯 关键修复：不设置raster.size，保持原始分辨率
            // raster.size = new paper.Size(displayWidth, displayHeight); // ❌ 移除这行
            
            // 通过bounds控制显示区域，保持原始分辨率
            raster.bounds = new paper.Rectangle(
              -displayWidth / 2,
              -displayHeight / 2,
              displayWidth,
              displayHeight
            );

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

            const imageMetadata = {
              originalWidth: originalWidth,
              originalHeight: originalHeight,
              fileName: `ai_generated_${aiResult.prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`,
              uploadMethod: 'ai-generated',
              aspectRatio
            };

            const { group: imageGroup } = ensureImageGroupStructure({
              raster,
              imageId,
              metadata: imageMetadata,
              ensureImageRect: true,
              ensureSelectionArea: true
            });

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
            if (imageGroup.parent !== paper.project.activeLayer) {
              paper.project.activeLayer.addChild(imageGroup);
            }
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
              isTemporary: true,
              isHelper: true  // 🔥 修复：标记为辅助元素，避免被图层面板检测为有效元素
            };

            // 添加高亮边框
            paper.project.activeLayer.addChild(highlightBorder);

            // 取消所有Paper.js原生选择状态（避免显示原生选择框）
            if (paper.project.selectedItems) {
              paper.project.deselectAll();
            }
            // 注意：不要设置 raster.selected = true，这会显示Paper.js原生的选择框
            // 我们使用自定义的选择框（selectionBorder）来显示选中状态

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
                fileName: imageMetadata.fileName
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
          // 移除加载指示器
          removeLoadingIndicator();
          console.error('❌ 创建Paper.js图像对象失败:', error);
        }
      };

      img.onerror = (error) => {
        // 移除加载指示器
        removeLoadingIndicator();
        console.error('❌ 图像加载失败:', error);
        console.error('🔍 调试信息:', {
          imageDataUrl: imageDataUrl.substring(0, 100) + '...',
          imageDataLength: aiResult.imageData?.length,
          mimeType: mimeType
        });
      };

      // 开始加载图像
      img.src = proxifyRemoteAssetUrl(imageDataUrl);

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
