import type { PromptImageMention } from '../types';

/** flow:wirePromptMention 事件的 detail 形状 */
export type WirePromptMentionDetail = {
  promptNodeId: string;
  mention: PromptImageMention;
};

/**
 * 各「可接收图片输入」的生成类节点 -> 其图片输入 target handle 的有序列表。
 * handle id 来自各节点组件实测；纯输出口/合并口已排除。
 */
export const IMAGE_INPUT_HANDLES_BY_TYPE: Record<string, string[]> = {
  generate: ['img'],
  generatePro: ['img'],
  generatePro4: ['img'],
  generate4: ['img1', 'img2', 'img3', 'img4'],
  generateRef: ['image1', 'image2'],
  imageGrid: ['images'],
  imagePro: ['img'],
  viewAngle: ['img'],
  analysis: ['img'],
  htmlPpt: ['img'],
  imageSplit: ['img'],
  imageCompress: ['img'],
  happyhorseR2V: ['image-1'],
};

/** 能接收图片输入、可作为 Prompt 下游连接目标的节点类型集合。 */
export const IMAGE_INPUT_CAPABLE_TYPES: Set<string> = new Set(
  Object.keys(IMAGE_INPUT_HANDLES_BY_TYPE),
);

/** 返回某类型节点的图片输入 handle 列表（未知类型回退 ['img']）。 */
export function getImageInputHandles(nodeType: string | undefined): string[] {
  if (!nodeType) return ['img'];
  return IMAGE_INPUT_HANDLES_BY_TYPE[nodeType] ?? ['img'];
}

/**
 * 在目标节点的图片输入 handle 中挑第一个未被占用的；全被占用返回 null（调用方应跳过，避免覆盖已有图片）。
 */
export function pickFreeImageInputHandle(
  nodeType: string | undefined,
  occupiedHandles: Set<string>,
): string | null {
  for (const handle of getImageInputHandles(nodeType)) {
    if (!occupiedHandles.has(handle)) return handle;
  }
  return null;
}
