/**
 * 下载工具函数
 */

/**
 * 下载图片文件
 * @param imageData - 图片数据URL或base64数据
 * @param fileName - 下载的文件名
 */
export const downloadImage = (imageData: string, fileName: string = 'image') => {
  try {
    // 创建一个临时的a标签
    const link = document.createElement('a');
    
    // 处理不同格式的图片数据
    let downloadUrl = imageData;
    
    // 如果是base64格式但没有data URL前缀，添加前缀
    if (!imageData.startsWith('data:') && !imageData.startsWith('http')) {
      downloadUrl = `data:image/png;base64,${imageData}`;
    }
    
    // 设置下载属性
    link.href = downloadUrl;
    link.download = fileName.includes('.') ? fileName : `${fileName}.png`;
    
    // 添加到DOM，触发下载，然后移除
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('✅ 图片下载成功:', link.download);
  } catch (error) {
    console.error('❌ 图片下载失败:', error);
    // 如果下载失败，尝试在新窗口打开图片
    try {
      window.open(imageData, '_blank');
    } catch (openError) {
      console.error('❌ 无法打开图片:', openError);
    }
  }
};

/**
 * 从Canvas下载图片
 * @param canvas - Canvas元素
 * @param fileName - 下载的文件名
 * @param quality - 图片质量(0-1)，默认0.92
 */
export const downloadCanvasAsImage = (
  canvas: HTMLCanvasElement, 
  fileName: string = 'canvas-image',
  quality: number = 0.92
) => {
  try {
    const dataURL = canvas.toDataURL('image/png', quality);
    downloadImage(dataURL, fileName);
  } catch (error) {
    console.error('❌ Canvas下载失败:', error);
  }
};

/**
 * 获取建议的文件名
 * @param originalName - 原始文件名
 * @param prefix - 前缀
 */
export const getSuggestedFileName = (originalName?: string, prefix: string = 'download') => {
  if (originalName && originalName.includes('.')) {
    return originalName;
  }
  
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  const baseName = originalName || prefix;
  return `${baseName}_${timestamp}.png`;
};

/**
 * 下载文件（支持URL和Blob）
 * @param url - 文件URL
 * @param fileName - 下载的文件名
 */
export const downloadFile = async (url: string, fileName: string = 'download') => {
  try {
    // 如果是data URL或blob URL，直接下载
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log('✅ 文件下载成功:', fileName);
      return;
    }

    // 如果是HTTP/HTTPS URL，先fetch再下载
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // 清理blob URL
    URL.revokeObjectURL(blobUrl);
    
    console.log('✅ 文件下载成功:', fileName);
  } catch (error) {
    console.error('❌ 文件下载失败:', error);
    // 如果下载失败，尝试在新窗口打开
    try {
      window.open(url, '_blank');
    } catch (openError) {
      console.error('❌ 无法打开文件:', openError);
      throw error;
    }
  }
};