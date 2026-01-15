import React from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  type ReactFlowState,
  type Edge,
  type Node,
} from 'reactflow';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { imageSplitWorkerClient } from '@/services/imageSplitWorkerClient';
import {
  getFlowImageBlob,
  parseFlowImageAssetRef,
} from '@/services/flowImageAssetStore';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { imageUploadService } from '@/services/imageUploadService';

// 类型定义
type SplitRectItem = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LegacySplitImageItem = SplitRectItem & {
  imageData: string; // flow-asset / base64 / URL
};

type UpstreamImageItem = {
  id: string;
  imageData: string; // base64 或 URL
};

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'processing' | 'succeeded' | 'failed';
    inputImage?: string;
    inputImageUrl?: string;
    // 方案A：仅持久化裁切矩形，不持久化切片图片数据
    splitRects?: SplitRectItem[];
    sourceWidth?: number;
    sourceHeight?: number;
    // legacy：历史数据可能仍包含 splitImages
    splitImages?: LegacySplitImageItem[];
    outputCount?: number;
    error?: string;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

const MIN_OUTPUT_COUNT = 1;
const MAX_OUTPUT_COUNT = 50;
const DEFAULT_OUTPUT_COUNT = 9;

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

// 构建图片 src
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image')) return trimmed;
  if (trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('/api/assets/proxy') || trimmed.startsWith('/assets/proxy')) {
    return proxifyRemoteAssetUrl(trimmed);
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }
  if (/^(templates|projects|uploads|videos)\//i.test(trimmed)) {
    return proxifyRemoteAssetUrl(
      `/api/assets/proxy?key=${encodeURIComponent(trimmed.replace(/^\/+/, ''))}`
    );
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return proxifyRemoteAssetUrl(trimmed);
  }
  return `data:image/png;base64,${trimmed}`;
};

const readImageFromNode = (node: Node<any>, sourceHandle?: string | null): string | undefined => {
  if (!node) return undefined;
  const d = (node.data ?? {}) as Record<string, unknown>;

  // imageSplit：按 image1..imageN 读取
  if (node.type === 'imageSplit' && typeof sourceHandle === 'string') {
    const match = /^image(\d+)$/.exec(sourceHandle);
    if (match) {
      const key = `image${match[1]}`;
      const direct = normalizeString(d[key]);
      if (direct) return direct;

      const splitImages = d.splitImages as LegacySplitImageItem[] | undefined;
      const idx = Math.max(0, Number(match[1]) - 1);
      const fromList = splitImages?.[idx]?.imageData;
      return normalizeString(fromList);
    }
  }

  // imageGrid：读取拼合后的 outputImage
  if (node.type === 'imageGrid') {
    return normalizeString(d.outputImage);
  }

  // videoFrameExtract：读取单帧 image
  if (node.type === 'videoFrameExtract' && sourceHandle === 'image') {
    const frames = d.frames as Array<{ index: number; imageUrl: string; thumbnailDataUrl?: string }> | undefined;
    if (!frames || frames.length === 0) return undefined;
    const selectedFrameIndex = (d.selectedFrameIndex ?? 1) as number;
    const idx = Math.max(0, Number(selectedFrameIndex) - 1);
    const frame = frames[idx];
    if (!frame) return undefined;
    // 输出语义优先使用原图（imageUrl），缩略图仅用于预览
    return normalizeString(frame.imageUrl) || normalizeString(frame.thumbnailDataUrl);
  }

  // Generate4 / GeneratePro4：按 img1..img4 读取
  if ((node.type === 'generate4' || node.type === 'generatePro4') && typeof sourceHandle === 'string') {
    const match = /^img(\d+)$/.exec(sourceHandle);
    if (match) {
      const idx = Math.max(0, Number(match[1]) - 1);
      const imageUrls = d.imageUrls as string[] | undefined;
      const images = d.images as string[] | undefined;
      const thumbnails = d.thumbnails as string[] | undefined;
      return (
        normalizeString(imageUrls?.[idx]) ||
        normalizeString(images?.[idx]) ||
        normalizeString(thumbnails?.[idx])
      );
    }
  }

  // 通用：优先读 imageData / imageUrl / outputImage，其次读 thumbnail/thumbnailDataUrl（兼容“仅缩略图”的节点数据）
  return (
    normalizeString(d.imageData) ||
    normalizeString(d.imageUrl) ||
    normalizeString(d.outputImage) ||
    normalizeString(d.thumbnailDataUrl) ||
    normalizeString(d.thumbnail)
  );
};

const readImagesFromNode = (node: Node<any>, sourceHandle?: string | null): UpstreamImageItem[] => {
  if (!node) return [];
  const d = (node.data ?? {}) as Record<string, unknown>;

  // videoFrameExtract：按 sourceHandle 决定单帧/范围/全部
  if (node.type === 'videoFrameExtract' && Array.isArray(d.frames)) {
    const frames = d.frames as Array<{ index: number; imageUrl: string; thumbnailDataUrl?: string }>;
    const selectedFrameIndex = (d.selectedFrameIndex ?? 1) as number;
    const rangeStart = (d.rangeStart ?? 1) as number;
    const rangeEnd = (d.rangeEnd ?? frames.length) as number;

    if (sourceHandle === 'image') {
      const idx = Math.max(0, Number(selectedFrameIndex) - 1);
      const frame = frames[idx];
      const value = normalizeString(frame?.thumbnailDataUrl) || normalizeString(frame?.imageUrl);
      return value ? [{ id: `${node.id}-frame-${idx + 1}`, imageData: value }] : [];
    }

    if (sourceHandle === 'images-range') {
      const start = Math.max(0, Number(rangeStart) - 1);
      const end = Math.min(frames.length, Math.max(start, Number(rangeEnd)));
      return frames
        .slice(start, end)
        .map((frame, i) => {
          const value = normalizeString(frame.imageUrl) || normalizeString(frame.thumbnailDataUrl);
          return value ? { id: `${node.id}-range-${start + i + 1}`, imageData: value } : null;
        })
        .filter(Boolean) as UpstreamImageItem[];
    }

    // 默认：全部帧（兼容未标注 sourceHandle 的旧边）
    return frames
      .map((frame, i) => {
        const value = normalizeString(frame.imageUrl) || normalizeString(frame.thumbnailDataUrl);
        return value ? { id: `${node.id}-images-${i + 1}`, imageData: value } : null;
      })
      .filter(Boolean) as UpstreamImageItem[];
  }

  // imageSplit：可输出单张（imageX）或整个 splitImages（兼容少数场景）
  if (node.type === 'imageSplit') {
    if (typeof sourceHandle === 'string') {
      const match = /^image(\d+)$/.exec(sourceHandle);
      if (match) {
        const key = `image${match[1]}`;
        const direct = normalizeString(d[key]);
        if (direct) return [{ id: `${node.id}-${key}`, imageData: direct }];

        const splitImages = d.splitImages as LegacySplitImageItem[] | undefined;
        const idx = Math.max(0, Number(match[1]) - 1);
        const fromList = normalizeString(splitImages?.[idx]?.imageData);
        return fromList ? [{ id: `${node.id}-split-${idx + 1}`, imageData: fromList }] : [];
      }
    }

    const splitImages = d.splitImages as LegacySplitImageItem[] | undefined;
    if (Array.isArray(splitImages) && splitImages.length > 0) {
      return splitImages
        .map((img, idx) => {
          const value = normalizeString(img?.imageData);
          return value ? { id: `${node.id}-split-${idx + 1}`, imageData: value } : null;
        })
        .filter(Boolean) as UpstreamImageItem[];
    }
  }

  // Generate4 / GeneratePro4：按 img1..img4 读取
  if ((node.type === 'generate4' || node.type === 'generatePro4') && typeof sourceHandle === 'string') {
    const match = /^img(\d+)$/.exec(sourceHandle);
    if (match) {
      const idx = Math.max(0, Number(match[1]) - 1);
      const imageUrls = d.imageUrls as string[] | undefined;
      const images = d.images as string[] | undefined;
      const thumbnails = d.thumbnails as string[] | undefined;
      const value =
        normalizeString(imageUrls?.[idx]) ||
        normalizeString(images?.[idx]) ||
        normalizeString(thumbnails?.[idx]);
      return value ? [{ id: `${node.id}-img-${idx + 1}`, imageData: value }] : [];
    }
  }

  const single = readImageFromNode(node, sourceHandle);
  return single ? [{ id: node.id, imageData: single }] : [];
};

// 检测像素是否为白色（允许一定容差）
const isWhitePixel = (r: number, g: number, b: number, threshold = 250): boolean => {
  return r >= threshold && g >= threshold && b >= threshold;
};

type SplitRectsResult = {
  rects: SplitRectItem[];
  sourceWidth: number;
  sourceHeight: number;
};

const splitRectsByGrid = async (imageSrc: string, count: number): Promise<SplitRectsResult> => {
  const safeCount = Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, Math.floor(count || DEFAULT_OUTPUT_COUNT)));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const cols = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
        const rows = Math.max(1, Math.ceil(safeCount / cols));

        const rects: SplitRectItem[] = [];

        for (let i = 0; i < safeCount; i += 1) {
          const row = Math.floor(i / cols);
          const col = i % cols;

          const x0 = Math.round((col / cols) * img.width);
          const x1 = Math.round(((col + 1) / cols) * img.width);
          const y0 = Math.round((row / rows) * img.height);
          const y1 = Math.round(((row + 1) / rows) * img.height);

          const w = Math.max(1, x1 - x0);
          const h = Math.max(1, y1 - y0);

          rects.push({ index: i, x: x0, y: y0, width: w, height: h });
        }

        resolve({ rects, sourceWidth: img.width, sourceHeight: img.height });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageSrc;
  });
};

// 智能检测并分割图片
const detectAndSplitRects = async (imageSrc: string): Promise<SplitRectsResult> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        // 先用小尺寸采样判断是否值得做“非白色连通域”检测：
        // 对于照片/满屏内容图，连通域扫描会遍历大量像素并产生巨大队列（内存与 CPU 开销很高），
        // 而最终也会回落到网格切分，因此直接跳过。
        const totalPixels = img.width * img.height;
        const MAX_PIXELS_FOR_REGION_DETECT = 2_000_000; // ~2MP
        const SAMPLE_SIZE = 96;
        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = Math.min(SAMPLE_SIZE, img.width);
        sampleCanvas.height = Math.min(SAMPLE_SIZE, img.height);
        const sampleCtx = sampleCanvas.getContext('2d');
        if (sampleCtx) {
          sampleCtx.drawImage(img, 0, 0, sampleCanvas.width, sampleCanvas.height);
          const sampled = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
          const sampledData = sampled.data;
          let white = 0;
          const total = sampledData.length / 4;
          for (let i = 0; i < sampledData.length; i += 4) {
            if (isWhitePixel(sampledData[i], sampledData[i + 1], sampledData[i + 2])) white += 1;
          }
          const whiteRatio = total > 0 ? white / total : 0;
          const looksLikeWhiteBackground = whiteRatio >= 0.55;
          if (!looksLikeWhiteBackground || totalPixels > MAX_PIXELS_FOR_REGION_DETECT) {
            resolve({ rects: [], sourceWidth: img.width, sourceHeight: img.height });
            return;
          }
        } else if (totalPixels > MAX_PIXELS_FOR_REGION_DETECT) {
          resolve({ rects: [], sourceWidth: img.width, sourceHeight: img.height });
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 canvas context'));
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data, width, height } = imageData;

        // 检测非白色区域的边界框
        const regions = findNonWhiteRegions(data, width, height);

        const rects: SplitRectItem[] = [];
        regions.forEach((region, index) => {
          const regionWidth = region.maxX - region.minX + 1;
          const regionHeight = region.maxY - region.minY + 1;

          rects.push({
            index,
            x: region.minX,
            y: region.minY,
            width: regionWidth,
            height: regionHeight,
          });
        });

        resolve({ rects, sourceWidth: img.width, sourceHeight: img.height });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageSrc;
  });
};

// 查找非白色区域
type Region = { minX: number; minY: number; maxX: number; maxY: number };

const findNonWhiteRegions = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): Region[] => {
  // 创建访问标记数组
  const visited = new Uint8Array(width * height);
  const regions: Region[] = [];

  const isNonWhiteIdx = (pixelIdx: number): boolean => {
    if (pixelIdx < 0 || pixelIdx >= width * height) return false;
    const idx = pixelIdx * 4;
    return !isWhitePixel(data[idx], data[idx + 1], data[idx + 2]);
  };

  // 使用连通域（BFS）查找连通区域
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (visited[pixelIdx] || !isNonWhiteIdx(pixelIdx)) continue;

      // 发现新区域，使用 BFS 扩展
      const region: Region = { minX: x, minY: y, maxX: x, maxY: y };
      const queue: number[] = [pixelIdx];
      let head = 0;
      visited[pixelIdx] = 1;

      while (head < queue.length) {
        const idx = queue[head++]!;
        const cx = idx % width;
        const cy = Math.floor(idx / width);

        // 更新边界
        region.minX = Math.min(region.minX, cx);
        region.minY = Math.min(region.minY, cy);
        region.maxX = Math.max(region.maxX, cx);
        region.maxY = Math.max(region.maxY, cy);

        // 检查四个方向的邻居（避免每像素创建 neighbors 数组）
        if (cx > 0) {
          const nIdx = idx - 1;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
        if (cx + 1 < width) {
          const nIdx = idx + 1;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
        if (cy > 0) {
          const nIdx = idx - width;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
        if (cy + 1 < height) {
          const nIdx = idx + width;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }

      // 过滤太小的区域（噪点）
      const regionWidth = region.maxX - region.minX + 1;
      const regionHeight = region.maxY - region.minY + 1;
      if (regionWidth > 20 && regionHeight > 20) {
        regions.push(region);
      }
    }
  }

  // 按位置排序（从上到下，从左到右）
  regions.sort((a, b) => {
    const rowA = Math.floor(a.minY / 50);
    const rowB = Math.floor(b.minY / 50);
    if (rowA !== rowB) return rowA - rowB;
    return a.minX - b.minX;
  });

  return regions;
};

function SplitRectPreview({
  index,
  rect,
  sourceSrc,
  sourceWidth,
  sourceHeight,
}: {
  index: number;
  rect: SplitRectItem;
  sourceSrc?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}) {
  const thumbSize = 48;
  const canRender =
    !!sourceSrc &&
    typeof sourceWidth === 'number' &&
    typeof sourceHeight === 'number' &&
    sourceWidth > 0 &&
    sourceHeight > 0 &&
    rect.width > 0 &&
    rect.height > 0;

  const scale = canRender ? Math.max(thumbSize / rect.width, thumbSize / rect.height) : 1;
  const displayW = canRender ? sourceWidth! * scale : 0;
  const displayH = canRender ? sourceHeight! * scale : 0;
  const offsetX = canRender ? -rect.x * scale + (thumbSize - rect.width * scale) / 2 : 0;
  const offsetY = canRender ? -rect.y * scale + (thumbSize - rect.height * scale) / 2 : 0;

  return (
    <div style={{
      width: thumbSize,
      height: thumbSize,
      border: '1px solid #d1d5db',
      borderRadius: 4,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {canRender ? (
        <img
          src={sourceSrc}
          alt={`分割 ${index + 1}`}
          decoding="async"
          loading="lazy"
          draggable={false}
          style={{
            position: 'absolute',
            left: offsetX,
            top: offsetY,
            width: displayW,
            height: displayH,
          }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', background: '#f3f4f6' }} />
      )}
      <span style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: 10,
        padding: '1px 3px',
      }}>
        {index + 1}
      </span>
    </div>
  );
}

function ImageSplitNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const edgesRef = React.useRef<Edge[]>(edges);
  const projectId = useProjectContentStore((s) => s.projectId);

  const [splitRects, setSplitRects] = React.useState<SplitRectItem[]>(() => {
    if (Array.isArray(data.splitRects) && data.splitRects.length > 0) {
      return data.splitRects;
    }
    const legacy = Array.isArray(data.splitImages) ? data.splitImages : [];
    return legacy.map((it) => ({
      index: it.index,
      x: it.x,
      y: it.y,
      width: it.width,
      height: it.height,
    }));
  });
  const [sourceSize, setSourceSize] = React.useState<{ width: number; height: number }>(() => ({
    width: typeof data.sourceWidth === 'number' ? data.sourceWidth : 0,
    height: typeof data.sourceHeight === 'number' ? data.sourceHeight : 0,
  }));
  const [outputCount, setOutputCount] = React.useState<number>(
    Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, data.outputCount || DEFAULT_OUTPUT_COUNT))
  );
  const [hover, setHover] = React.useState<string | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  // 同步 edges ref
  React.useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const hasInputConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        ),
      [id]
    )
  );

  // 从连接的节点读取图片
  const connectedImage = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        // 兼容历史/导入的 edge：targetHandle 可能缺失或为 image；
        // 也兼容“边存在但 source 节点已删除/不含图片”的情况，尝试从所有入边中选取第一个可用图片。
        const candidateEdges = state.edges.filter(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (candidateEdges.length === 0) return undefined;

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const resolveFromNode = (
          nodeId: string,
          incomingEdge?: Edge,
          visited: Set<string> = new Set()
        ): string | undefined => {
          if (!nodeId) return undefined;
          if (visited.has(nodeId)) return undefined;
          visited.add(nodeId);

          const node = nodeById.get(nodeId);
          if (!node) return undefined;

          // Image 节点：其“显示的图片”可能来自上游连线而非自身 data，需要继续向上追溯
          if (node.type === 'image') {
            const upstream = state.edges.find(
              (e) => e.target === nodeId && e.targetHandle === 'img'
            );
            const upstreamResolved = upstream
              ? resolveFromNode(upstream.source, upstream, visited)
              : undefined;
            if (upstreamResolved) return upstreamResolved;
          }

          return readImageFromNode(node as Node<any>, incomingEdge?.sourceHandle);
        };

        for (const edge of candidateEdges) {
          const value = resolveFromNode(edge.source, edge);
          if (value) return value;
        }

        return undefined;
      },
      [id]
    )
  );

  // 若上游来自 imageGrid（直接连或经由 image 节点传递），优先读取其“输入图片列表”，避免用像素连通域误分割成大量碎片
  const upstreamImageGridInputs = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const candidateEdges = state.edges.filter(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (candidateEdges.length === 0) return [];

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const findImageGridNode = (nodeId: string, visited: Set<string>): Node<any> | undefined => {
          if (!nodeId) return undefined;
          if (visited.has(nodeId)) return undefined;
          visited.add(nodeId);

          const node = nodeById.get(nodeId);
          if (!node) return undefined;
          if (node.type === 'imageGrid') return node;

          if (node.type === 'image') {
            const upstream = state.edges.find((e) => e.target === nodeId && e.targetHandle === 'img');
            if (!upstream) return undefined;
            return findImageGridNode(upstream.source, visited);
          }

          return undefined;
        };

        const readImageGridInputs = (gridNode: Node<any>): UpstreamImageItem[] => {
          const gridId = gridNode.id;
          const result: UpstreamImageItem[] = [];

          const connectedEdges = state.edges.filter(
            (e) => e.target === gridId && e.targetHandle === 'images'
          );

          for (const edge of connectedEdges) {
            const sourceNode = nodeById.get(edge.source);
            if (!sourceNode) continue;
            readImagesFromNode(sourceNode as Node<any>, edge.sourceHandle).forEach((it) => result.push(it));
          }

          const manualImages = (gridNode.data as any)?.images as Array<{ id: string; imageData: string }> | undefined;
          if (Array.isArray(manualImages)) {
            manualImages.forEach((img) => {
              const value = normalizeString(img?.imageData);
              if (!value) return;
              if (!result.find((r) => r.id === img.id)) {
                result.push({ id: img.id, imageData: value });
              }
            });
          }

          return result;
        };

        for (const edge of candidateEdges) {
          const gridNode = findImageGridNode(edge.source, new Set());
          if (!gridNode) continue;
          const inputs = readImageGridInputs(gridNode);
          if (inputs.length > 0) return inputs;
        }

        return [];
      },
      [id]
    )
  );

  const rawInputImage = React.useMemo(() => {
    const persisted = normalizeString(data.inputImageUrl) || normalizeString(data.inputImage);
    // 方案A：当已有 splitRects 时，优先使用持久化的原图引用，保证“坐标系一致”（避免上传/去 EXIF 后坐标不匹配导致预览变形）
    if (persisted && Array.isArray(data.splitRects) && data.splitRects.length > 0) {
      return persisted;
    }
    return connectedImage || data.inputImage || data.inputImageUrl;
  }, [connectedImage, data.inputImage, data.inputImageUrl, data.splitRects]);
  const inputAssetId = React.useMemo(() => parseFlowImageAssetRef(rawInputImage), [rawInputImage]);
  const inputAssetUrl = useFlowImageAssetUrl(inputAssetId);

  const inputImageSrc = React.useMemo(() => {
    if (inputAssetId) return inputAssetUrl || undefined;
    return buildImageSrc(rawInputImage);
  }, [inputAssetId, inputAssetUrl, rawInputImage]);
  const canSplit = !!normalizeString(rawInputImage);

  // 更新节点数据
  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [id]);

  // 同步外部数据变化
  React.useEffect(() => {
    const nextRects = Array.isArray(data.splitRects) ? data.splitRects : [];
    if (nextRects.length > 0) {
      setSplitRects((prev) => (prev === nextRects ? prev : nextRects));
    } else {
      const legacy = Array.isArray(data.splitImages) ? data.splitImages : [];
      const derived = legacy.map((it) => ({
        index: it.index,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
      }));
      setSplitRects((prev) => (prev.length ? prev : derived));
    }

    const nextSourceWidth = typeof data.sourceWidth === 'number' ? data.sourceWidth : 0;
    const nextSourceHeight = typeof data.sourceHeight === 'number' ? data.sourceHeight : 0;
    if (nextSourceWidth > 0 && nextSourceHeight > 0) {
      setSourceSize((prev) => {
        if (prev.width === nextSourceWidth && prev.height === nextSourceHeight) return prev;
        return { width: nextSourceWidth, height: nextSourceHeight };
      });
    }
  }, [data.splitRects, data.splitImages, data.sourceWidth, data.sourceHeight]);

  React.useEffect(() => {
    const count = data.outputCount || DEFAULT_OUTPUT_COUNT;
    if (count !== outputCount) {
      setOutputCount(Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, count)));
    }
  }, [data.outputCount]);

  // 执行分割
  const handleSplit = React.useCallback(async () => {
    if (!normalizeString(rawInputImage)) {
      updateNodeData({ status: 'failed', error: '没有输入图片', splitRects: [] });
      setSplitRects([]);
      setSourceSize({ width: 0, height: 0 });
      return;
    }

    setIsProcessing(true);
    updateNodeData({ status: 'processing', error: undefined });

    try {
      const normalizePersistableRef = (value: string): string => {
        const trimmed = value.trim();
        if (!trimmed) return trimmed;

        if (trimmed.startsWith('/api/assets/proxy') || trimmed.startsWith('/assets/proxy')) {
          try {
            const url = new URL(trimmed, window.location.origin);
            const key = url.searchParams.get('key');
            if (key) return key.replace(/^\/+/, '');
            const remote = url.searchParams.get('url');
            if (remote) return remote;
          } catch {}
          return trimmed;
        }

        const withoutLeading = trimmed.replace(/^\/+/, '');
        if (/^(templates|projects|uploads|videos)\//i.test(withoutLeading)) {
          return withoutLeading;
        }

        return trimmed;
      };

      const rawInput = normalizeString(rawInputImage)!;
      const normalizedInputRef = normalizePersistableRef(rawInput);
      const isEmbedded =
        /^data:/i.test(normalizedInputRef) ||
        /^blob:/i.test(normalizedInputRef) ||
        !!parseFlowImageAssetRef(normalizedInputRef);
      const isHttp = /^https?:\/\//i.test(normalizedInputRef);
      const isKey = /^(templates|projects|uploads|videos)\//i.test(normalizedInputRef);
      const isPath =
        normalizedInputRef.startsWith('/') ||
        normalizedInputRef.startsWith('./') ||
        normalizedInputRef.startsWith('../') ||
        normalizedInputRef.startsWith('/api/assets/proxy') ||
        normalizedInputRef.startsWith('/assets/proxy');

      // 方案A：确保持久化的输入图片引用是“可复现/可寻址”的（远程URL/OSS key 等）
      let persistedInputRef = normalizedInputRef;
      let uploaded = false;
      if (isEmbedded || (!isHttp && !isKey && !isPath)) {
        const uploadResult = await imageUploadService.uploadImageSource(rawInput, {
          projectId: projectId ?? undefined,
          dir: projectId ? `projects/${projectId}/flow/images/` : 'uploads/flow/images/',
          fileName: `image_split_${id}_${Date.now()}.png`,
        });
        if (!uploadResult.success || !uploadResult.asset?.url) {
          throw new Error(uploadResult.error || '输入图片上传失败');
        }
        persistedInputRef = (uploadResult.asset.key || uploadResult.asset.url).trim();
        uploaded = true;
      }

      const preferredCount = upstreamImageGridInputs.length > 0
        ? Math.max(outputCount, upstreamImageGridInputs.length)
        : outputCount;
      const safeCount = Math.min(
        MAX_OUTPUT_COUNT,
        Math.max(MIN_OUTPUT_COUNT, Math.floor(preferredCount || DEFAULT_OUTPUT_COUNT))
      );

      let rects: SplitRectItem[] = [];
      let sourceWidth = 0;
      let sourceHeight = 0;

      // 优先使用 Worker + OffscreenCanvas（避免主线程卡顿）
      if (imageSplitWorkerClient.isSupported()) {
        const source = await (async () => {
          // 注意：当输入来源是 flow-asset/base64 等临时态时，会先上传并“去元数据/重新编码”，
          // 此时必须以 uploaded 后的最终图片作为切割输入，否则会出现坐标系不一致（预览/下游裁切变形）。
          if (!uploaded && inputAssetId) {
            const blob = await getFlowImageBlob(inputAssetId);
            if (!blob) throw new Error('图片资源不存在');
            return { kind: 'blob' as const, blob };
          }
          const url = buildImageSrc(persistedInputRef);
          if (!url) throw new Error('图片加载失败');
          return { kind: 'url' as const, url };
        })();

        const result = await imageSplitWorkerClient.splitImageRects(source, { outputCount: safeCount });
        if (!result.success || !Array.isArray(result.rects)) {
          throw new Error(result.error || '分割失败');
        }
        rects = result.rects.slice(0, MAX_OUTPUT_COUNT);
        sourceWidth = result.sourceWidth ?? 0;
        sourceHeight = result.sourceHeight ?? 0;
      } else {
        const splitSrc = buildImageSrc(persistedInputRef) || inputImageSrc;
        if (!splitSrc) throw new Error('图片加载失败');
        const detected = await detectAndSplitRects(splitSrc);
        rects = detected.rects;
        sourceWidth = detected.sourceWidth;
        sourceHeight = detected.sourceHeight;

        // 对“整张图是一个连通块 / 无法识别区域”的情况做兜底：按输出数量做等分网格切图
        const tooManyPieces =
          rects.length > Math.min(MAX_OUTPUT_COUNT, Math.max(safeCount, DEFAULT_OUTPUT_COUNT)) * 2;
        if (rects.length <= 1 || tooManyPieces) {
          const grid = await splitRectsByGrid(splitSrc, safeCount);
          rects = grid.rects;
          sourceWidth = grid.sourceWidth;
          sourceHeight = grid.sourceHeight;
        }
        rects = rects.slice(0, MAX_OUTPUT_COUNT);
      }

      setSplitRects(rects);
      if (sourceWidth > 0 && sourceHeight > 0) {
        setSourceSize({ width: sourceWidth, height: sourceHeight });
      }

      // 自动扩展输出端口数量
      const newOutputCount = Math.min(MAX_OUTPUT_COUNT, Math.max(outputCount, rects.length));
      if (newOutputCount !== outputCount) {
        setOutputCount(newOutputCount);
      }

      const patch: Record<string, unknown> = {
        status: 'succeeded',
        inputImageUrl: persistedInputRef,
        inputImage: undefined,
        splitRects: rects,
        sourceWidth: sourceWidth || undefined,
        sourceHeight: sourceHeight || undefined,
        outputCount: newOutputCount,
        error: undefined
      };

      // 清理旧字段（避免历史残留误读，也避免把临时图片数据落库）
      patch.splitImages = undefined;
      for (let i = 1; i <= MAX_OUTPUT_COUNT; i += 1) {
        patch[`image${i}`] = undefined;
      }

      updateNodeData(patch);
    } catch (err) {
      updateNodeData({
        status: 'failed',
        error: err instanceof Error ? err.message : '分割失败',
        splitRects: [],
        splitImages: undefined
      });
      setSplitRects([]);
      setSourceSize({ width: 0, height: 0 });
    } finally {
      setIsProcessing(false);
    }
  }, [id, inputAssetId, inputImageSrc, outputCount, projectId, rawInputImage, updateNodeData, upstreamImageGridInputs]);

  // 更新输出端口数量
  const handleOutputCountChange = React.useCallback((value: number) => {
    const count = Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, value));
    setOutputCount(count);
    updateNodeData({ outputCount: count });
  }, [updateNodeData]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<unknown, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const getHandleTopPercent = React.useCallback((index: number) => {
    if (outputCount <= 1) return 50;
    return 10 + (index / (outputCount - 1)) * 80;
  }, [outputCount]);

  const boxW = data.boxW || 320;
  const boxH = data.boxH || 400;
  const canGenerateNodes = Array.isArray(data.splitImages) && data.splitImages.length > 0;

  // 当输出端口数量变化时，强制 React Flow 重新计算句柄位置
  React.useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputCount, boxW, boxH, updateNodeInternals]);

  // 一键生成 Image 节点并连接
  const handleGenerateImageNodes = React.useCallback(() => {
    const legacy = Array.isArray(data.splitImages) ? data.splitImages : [];
    if (legacy.length === 0) {
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            message: '方案A：ImageSplit 仅保存裁切矩形，不支持一键生成独立图片节点',
            type: 'info',
          },
        })
      );
      return;
    }

    const currentNode = rf.getNode(id);
    if (!currentNode) return;

    const nodeX = currentNode.position.x;
    const nodeY = currentNode.position.y;
    const nodeWidth = boxW;
    const imageNodeWidth = 280;
    const imageNodeHeight = 240;
    const gapX = 100;
    const gapY = 20;

    const startX = nodeX + nodeWidth + gapX;
    const count = Math.min(legacy.length, outputCount);

    const totalHeight = count * imageNodeHeight + (count - 1) * gapY;
    const startY = nodeY + (boxH - totalHeight) / 2;

    const newNodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: { imageData: string; label: string; boxW: number; boxH: number };
    }> = [];

    const newEdges: Array<{
      id: string;
      source: string;
      sourceHandle: string;
      target: string;
      targetHandle: string;
    }> = [];

    for (let i = 0; i < count; i++) {
      const imageNodeId = `image-${id}-${i + 1}-${Date.now()}`;
      const y = startY + i * (imageNodeHeight + gapY);

      newNodes.push({
        id: imageNodeId,
        type: 'image',
        position: { x: startX, y },
        data: {
          imageData: legacy[i]!.imageData,
          label: `图片 ${i + 1}`,
          boxW: imageNodeWidth,
          boxH: imageNodeHeight,
        },
      });

      newEdges.push({
        id: `edge-${id}-${imageNodeId}`,
        source: id,
        sourceHandle: `image${i + 1}`,
        target: imageNodeId,
        targetHandle: 'img',
      });
    }

    rf.setNodes((nodes) => [...nodes, ...newNodes]);
    rf.setEdges((edges) => [...edges, ...newEdges]);
  }, [rf, id, data.splitImages, outputCount, boxW, boxH]);

  return (
    <div style={{
      width: boxW,
      minHeight: boxH,
      padding: 12,
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow,
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <NodeResizer
        isVisible
        minWidth={280}
        minHeight={300}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResize={(_, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id
            ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } }
            : n
          ));
        }}
      />

      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Image Split</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleGenerateImageNodes}
            disabled={!canGenerateNodes}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: canGenerateNodes ? '#059669' : '#9ca3af',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: canGenerateNodes ? 'pointer' : 'not-allowed',
              opacity: canGenerateNodes ? 1 : 0.6,
            }}
            title={canGenerateNodes ? '一键生成 Image 节点并连接（legacy）' : '方案A：不支持一键生成独立图片节点'}
          >
            生成节点
          </button>
          <button
            onClick={handleSplit}
            disabled={isProcessing || !canSplit}
            title={
              isProcessing
                ? '处理中...'
                : !canSplit
                  ? (hasInputConnection ? '已连接但未读取到图片（检查上游输出/连线句柄）' : '请先连接输入图片')
                  : '开始分割'
            }
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: (isProcessing || !canSplit) ? '#9ca3af' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: (isProcessing || !canSplit) ? 'not-allowed' : 'pointer',
            }}
          >
            {isProcessing ? '处理中...' : 'Split'}
          </button>
        </div>
      </div>

      {/* 输出数量配置 */}
      <div className="nodrag nopan" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: '#6b7280' }}>输出端口</label>
        <input
          type="number"
          min={MIN_OUTPUT_COUNT}
          max={MAX_OUTPUT_COUNT}
          value={outputCount}
          onChange={(e) => handleOutputCountChange(Number(e.target.value))}
          onPointerDown={stopNodeDrag}
          onPointerDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onClick={stopNodeDrag}
          onClickCapture={stopNodeDrag}
          className="nodrag nopan"
          style={{
            width: 60,
            fontSize: 12,
            padding: '2px 6px',
            border: '1px solid #e5e7eb',
            borderRadius: 6
          }}
        />
        <span style={{ fontSize: 11, color: '#9ca3af' }}>(1-50)</span>
      </div>

      {/* 输入图片预览 */}
      <div style={{
        background: '#f9fafb',
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        minHeight: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 6,
      }}>
        {inputImageSrc ? (
          <img
            src={inputImageSrc}
            alt="输入图片"
            style={{ maxWidth: '100%', maxHeight: 120, objectFit: 'contain' }}
          />
        ) : (
          <>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>等待输入图片...</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {hasInputConnection ? '已连接：是（但未读取到图片）' : '已连接：否'}
            </span>
          </>
        )}
      </div>

      {/* 状态显示 */}
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        状态: {data.status === 'succeeded'
          ? `已分割 ${splitRects.length} 张图片`
          : data.status === 'processing'
            ? '处理中...'
            : data.status === 'failed'
              ? '失败'
              : 'idle'}
      </div>

      {/* 错误信息 */}
      {data.status === 'failed' && data.error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{data.error}</div>
      )}

      {/* 分割结果预览 */}
      {splitRects.length > 0 && (
        <div style={{
          flex: 1,
          minHeight: 80,
          maxHeight: 150,
          overflow: 'auto',
          background: '#f0fdf4',
          borderRadius: 6,
          padding: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
        }}>
          {splitRects.slice(0, outputCount).map((rect, i) => (
            <SplitRectPreview
              key={`${rect.index}-${i}`}
              index={i}
              rect={rect}
              sourceSrc={inputImageSrc}
              sourceWidth={sourceSize.width}
              sourceHeight={sourceSize.height}
            />
          ))}
        </div>
      )}

      {/* 输入端口 */}
      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 动态输出端口 */}
      {Array.from({ length: outputCount }).map((_, i) => {
        const portId = `image${i + 1}`;
        const topPercent = getHandleTopPercent(i);
        return (
          <Handle
            key={portId}
            type="source"
            position={Position.Right}
            id={portId}
            style={{ top: `${topPercent}%`, transform: 'translateY(-50%)' }}
            onMouseEnter={() => setHover(`${portId}-out`)}
            onMouseLeave={() => setHover(null)}
          />
        );
      })}

      {/* 工具提示 */}
      {hover === 'img-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          输入图片
        </div>
      )}
      {hover?.endsWith('-out') && (
        <div className="flow-tooltip" style={{
          right: -8,
          top: `${getHandleTopPercent(parseInt(hover.replace('image', '').replace('-out', '')) - 1)}%`,
          transform: 'translate(100%, -50%)'
        }}>
          图片 #{hover.replace('image', '').replace('-out', '')}
        </div>
      )}
    </div>
  );
}

export default React.memo(ImageSplitNodeInner);
