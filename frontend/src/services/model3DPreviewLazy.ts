import type { Model3DPreviewOptions } from './model3DPreviewService';

// 懒加载门面:model3DPreviewService 依赖 three,面板首屏不应背这个体积,首次生成预览时才拉chunk
export const model3DPreviewService = {
  async generatePreviewFromUrl(
    url: string,
    options: Model3DPreviewOptions = {},
  ): Promise<string | null> {
    const mod = await import('./model3DPreviewService');
    return mod.model3DPreviewService.generatePreviewFromUrl(url, options);
  },
  async generatePreviewAndUpload(
    url: string,
    options: Model3DPreviewOptions = {},
  ): Promise<string | null> {
    const mod = await import('./model3DPreviewService');
    return mod.model3DPreviewService.generatePreviewAndUpload(url, options);
  },
};
