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

// 类型定义
type SplitImageItem = {
  index: number;
  imageData: string; // base64
  x: number;
  y: number;
  width: number;
  height: number;
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
    splitImages?: SplitImageItem[];
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

      const splitImages = d.splitImages as SplitImageItem[] | undefined;
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

        const splitImages = d.splitImages as SplitImageItem[] | undefined;
        const idx = Math.max(0, Number(match[1]) - 1);
        const fromList = normalizeString(splitImages?.[idx]?.imageData);
        return fromList ? [{ id: `${node.id}-split-${idx + 1}`, imageData: fromList }] : [];
      }
    }

    const splitImages = d.splitImages as SplitImageItem[] | undefined;
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

const splitImageByGrid = async (imageSrc: string, count: number): Promise<SplitImageItem[]> => {
  const safeCount = Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, Math.floor(count || DEFAULT_OUTPUT_COUNT)));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const cols = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
        const rows = Math.max(1, Math.ceil(safeCount / cols));

        const splitImages: SplitImageItem[] = [];

        for (let i = 0; i < safeCount; i += 1) {
          const row = Math.floor(i / cols);
          const col = i % cols;

          const x0 = Math.round((col / cols) * img.width);
          const x1 = Math.round(((col + 1) / cols) * img.width);
          const y0 = Math.round((row / rows) * img.height);
          const y1 = Math.round(((row + 1) / rows) * img.height);

          const w = Math.max(1, x1 - x0);
          const h = Math.max(1, y1 - y0);

          const regionCanvas = document.createElement('canvas');
          regionCanvas.width = w;
          regionCanvas.height = h;
          const regionCtx = regionCanvas.getContext('2d');
          if (!regionCtx) continue;

          regionCtx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
          const base64 = regionCanvas.toDataURL('image/png').split(',')[1];
          splitImages.push({ index: i, imageData: base64, x: x0, y: y0, width: w, height: h });
        }

        resolve(splitImages);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageSrc;
  });
};

// 智能检测并分割图片
const detectAndSplitImage = async (imageSrc: string): Promise<SplitImageItem[]> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
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

        // 提取每个区域的图片
        const splitImages: SplitImageItem[] = [];
        regions.forEach((region, index) => {
          const regionCanvas = document.createElement('canvas');
          const regionCtx = regionCanvas.getContext('2d');
          if (!regionCtx) return;

          const regionWidth = region.maxX - region.minX + 1;
          const regionHeight = region.maxY - region.minY + 1;

          regionCanvas.width = regionWidth;
          regionCanvas.height = regionHeight;

          regionCtx.drawImage(
            img,
            region.minX, region.minY, regionWidth, regionHeight,
            0, 0, regionWidth, regionHeight
          );

          const base64 = regionCanvas.toDataURL('image/png').split(',')[1];
          splitImages.push({
            index,
            imageData: base64,
            x: region.minX,
            y: region.minY,
            width: regionWidth,
            height: regionHeight,
          });
        });

        resolve(splitImages);
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

  // 检查像素是否为非白色
  const isNonWhite = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (y * width + x) * 4;
    return !isWhitePixel(data[idx], data[idx + 1], data[idx + 2]);
  };

  // 使用扫描线算法查找连通区域
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (visited[pixelIdx] || !isNonWhite(x, y)) continue;

      // 发现新区域，使用 BFS 扩展
      const region: Region = { minX: x, minY: y, maxX: x, maxY: y };
      const queue: [number, number][] = [[x, y]];
      let head = 0;
      visited[pixelIdx] = 1;

      while (head < queue.length) {
        const [cx, cy] = queue[head++]!;

        // 更新边界
        region.minX = Math.min(region.minX, cx);
        region.minY = Math.min(region.minY, cy);
        region.maxX = Math.max(region.maxX, cx);
        region.maxY = Math.max(region.maxY, cy);

        // 检查四个方向的邻居
        const neighbors: [number, number][] = [
          [cx - 1, cy], [cx + 1, cy],
          [cx, cy - 1], [cx, cy + 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !isNonWhite(nx, ny)) continue;
          visited[nIdx] = 1;
          queue.push([nx, ny]);
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

function ImageSplitNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const edgesRef = React.useRef<Edge[]>(edges);

  const [splitImages, setSplitImages] = React.useState<SplitImageItem[]>(data.splitImages || []);
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

  const inputImageSrc = React.useMemo(
    () => buildImageSrc(connectedImage || data.inputImage || data.inputImageUrl),
    [connectedImage, data.inputImage, data.inputImageUrl]
  );

  // 更新节点数据
  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [id]);

  // 同步外部数据变化
  React.useEffect(() => {
    if (data.splitImages && JSON.stringify(data.splitImages) !== JSON.stringify(splitImages)) {
      setSplitImages(data.splitImages);
    }
  }, [data.splitImages]);

  React.useEffect(() => {
    const count = data.outputCount || DEFAULT_OUTPUT_COUNT;
    if (count !== outputCount) {
      setOutputCount(Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, count)));
    }
  }, [data.outputCount]);

  // 执行分割
  const handleSplit = React.useCallback(async () => {
    if (!inputImageSrc) {
      updateNodeData({ status: 'failed', error: '没有输入图片', splitImages: [] });
      setSplitImages([]);
      return;
    }

    setIsProcessing(true);
    updateNodeData({ status: 'processing', error: undefined });

    try {
      let images: SplitImageItem[] = [];

      // 优先：若输入来源是 imageGrid，直接还原其输入图片列表（更准确，也避免像素级误分割）
      if (upstreamImageGridInputs.length > 0) {
        images = upstreamImageGridInputs
          .slice(0, MAX_OUTPUT_COUNT)
          .map((item, i) => ({
            index: i,
            imageData: item.imageData,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          }));
      } else {
        images = await detectAndSplitImage(inputImageSrc);
      }

      // 对“整张图是一个连通块 / 无法识别区域”的情况做兜底：按输出数量做等分网格切图
      const tooManyPieces = images && images.length > Math.min(MAX_OUTPUT_COUNT, Math.max(outputCount, DEFAULT_OUTPUT_COUNT)) * 2;
      if (!images || images.length <= 1 || tooManyPieces) {
        images = await splitImageByGrid(inputImageSrc, outputCount);
      }
      images = (images || []).slice(0, MAX_OUTPUT_COUNT);
      setSplitImages(images);

      // 自动扩展输出端口数量
      const newOutputCount = Math.min(MAX_OUTPUT_COUNT, Math.max(outputCount, images.length));
      if (newOutputCount !== outputCount) {
        setOutputCount(newOutputCount);
      }

      // 构建每个输出端口对应的数据
      const imagePatch: Record<string, unknown> = {
        status: 'succeeded',
        splitImages: images,
        outputCount: newOutputCount,
        error: undefined
      };

      // 为每个分割图片创建对应的 imageX 字段
      images.forEach((img, i) => {
        imagePatch[`image${i + 1}`] = img.imageData;
      });

      updateNodeData(imagePatch);
    } catch (err) {
      updateNodeData({
        status: 'failed',
        error: err instanceof Error ? err.message : '分割失败',
        splitImages: []
      });
      setSplitImages([]);
    } finally {
      setIsProcessing(false);
    }
  }, [inputImageSrc, outputCount, updateNodeData, upstreamImageGridInputs]);

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

  // 当输出端口数量变化时，强制 React Flow 重新计算句柄位置
  React.useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputCount, boxW, boxH, updateNodeInternals]);

  // 一键生成 Image 节点并连接
  const handleGenerateImageNodes = React.useCallback(() => {
    if (splitImages.length === 0) return;

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
    const count = Math.min(splitImages.length, outputCount);

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
          imageData: splitImages[i].imageData,
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
  }, [rf, id, splitImages, outputCount, boxW, boxH]);

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
            disabled={splitImages.length === 0}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: splitImages.length > 0 ? '#059669' : '#9ca3af',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: splitImages.length > 0 ? 'pointer' : 'not-allowed',
              opacity: splitImages.length > 0 ? 1 : 0.6,
            }}
            title="一键生成 Image 节点并连接"
          >
            生成节点
          </button>
          <button
            onClick={handleSplit}
            disabled={isProcessing || !inputImageSrc}
            title={
              isProcessing
                ? '处理中...'
                : !inputImageSrc
                  ? (hasInputConnection ? '已连接但未读取到图片（检查上游输出/连线句柄）' : '请先连接输入图片')
                  : '开始分割'
            }
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: (isProcessing || !inputImageSrc) ? '#9ca3af' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: (isProcessing || !inputImageSrc) ? 'not-allowed' : 'pointer',
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
          ? `已分割 ${splitImages.length} 张图片`
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
      {splitImages.length > 0 && (
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
          {splitImages.slice(0, outputCount).map((img, i) => (
            <div key={i} style={{
              width: 48,
              height: 48,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <img
                src={buildImageSrc(img.imageData) || ''}
                alt={`分割 ${i + 1}`}
                decoding="async"
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <span style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontSize: 10,
                padding: '1px 3px',
              }}>
                {i + 1}
              </span>
            </div>
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
