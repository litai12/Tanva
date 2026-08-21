import type { HtmlPptDeck } from '@/utils/htmlPptDeck';

const safeFileStem = (title: string, fallback: string): string =>
  title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(html|pptx|md|txt)$/i, '') || fallback;

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
};

export const downloadTextArtifact = (
  title: string,
  markdown: string
): string => {
  const fileName = `${safeFileStem(title, '小T文档')}.md`;
  downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), fileName);
  return fileName;
};

export const exportPresentationArtifact = async (options: {
  title: string;
  deck: HtmlPptDeck;
  format: 'html' | 'pptx';
}): Promise<string> => {
  if (!options.deck.slides.length) throw new Error('当前演示文稿没有可导出的页面');
  if (options.format === 'pptx') {
    const { exportHtmlPptDeckAsPptx } = await import('@/utils/htmlPptExport');
    return exportHtmlPptDeckAsPptx({ deck: options.deck, title: options.title });
  }

  const { buildFullDeckHtml } = await import('@/components/flow/nodes/HtmlPptNode');
  const fileName = `${safeFileStem(options.title, 'Tanva-Presentation')}.html`;
  downloadBlob(
    new Blob([buildFullDeckHtml(options.deck, options.title)], {
      type: 'text/html;charset=utf-8',
    }),
    fileName
  );
  return fileName;
};
