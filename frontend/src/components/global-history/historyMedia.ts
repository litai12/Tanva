import type { GlobalImageHistoryItem } from '@/services/globalImageHistoryApi';

export type GlobalHistoryMediaType = 'image' | 'video';

const VIDEO_SOURCE_TYPES = new Set([
  'video',
  'klingVideo',
  'kling26Video',
  'kling30Video',
  'klingO1Video',
  'viduVideo',
  'viduQ3',
  'doubaoVideo',
  'seedance20Video',
  'wan26',
  'wan27Video',
  'wan2R2V',
  'happyhorseR2V',
  'sora2Video',
  'tencentSpeech',
]);

export const GLOBAL_HISTORY_SOURCE_TYPE_LABELS: Record<
  string,
  { zh: string; en: string }
> = {
  generate: { zh: '图片生成', en: 'Image Generate' },
  generatePro: { zh: '图片生成Pro', en: 'Image Generate Pro' },
  generatePro4: { zh: '图片生成Pro4', en: 'Image Generate Pro4' },
  midjourney: { zh: 'Midjourney', en: 'Midjourney' },
  '3d': { zh: '3D生成', en: '3D Generate' },
  camera: { zh: '相机', en: 'Camera' },
  image: { zh: '图片', en: 'Image' },
  imagePro: { zh: '图片Pro', en: 'Image Pro' },
  video: { zh: '视频', en: 'Video' },
  klingVideo: { zh: 'Kling 视频', en: 'Kling Video' },
  kling26Video: { zh: 'Kling 2.6 视频', en: 'Kling 2.6 Video' },
  kling30Video: { zh: 'Kling 3.0 视频', en: 'Kling 3.0 Video' },
  klingO1Video: { zh: 'Kling O3 视频', en: 'Kling O3 Video' },
  viduVideo: { zh: 'Vidu 视频', en: 'Vidu Video' },
  viduQ3: { zh: 'Vidu Q3 视频', en: 'Vidu Q3 Video' },
  doubaoVideo: { zh: '豆包视频', en: 'Doubao Video' },
  seedance20Video: { zh: 'Seedance 2.0 视频', en: 'Seedance 2.0 Video' },
  wan26: { zh: 'Wan 2.6 视频', en: 'Wan 2.6 Video' },
  wan27Video: { zh: 'Wan 2.7 视频', en: 'Wan 2.7 Video' },
  wan2R2V: { zh: 'Wan R2V 视频', en: 'Wan R2V Video' },
  happyhorseR2V: { zh: 'HappyHorse R2V 视频', en: 'HappyHorse R2V Video' },
  sora2Video: { zh: 'Sora 2 视频', en: 'Sora 2 Video' },
  tencentSpeech: { zh: '腾讯语音视频', en: 'Tencent Speech Video' },
};

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

export const getGlobalHistoryMediaType = (
  item: GlobalImageHistoryItem
): GlobalHistoryMediaType => {
  const metadata = item.metadata ?? {};
  const rawMediaType = pickString(metadata.mediaType, metadata.kind, metadata.type);
  if (rawMediaType && rawMediaType.toLowerCase() === 'video') return 'video';

  const contentType = pickString(metadata.contentType, metadata.mimeType);
  if (contentType && contentType.toLowerCase().startsWith('video/')) return 'video';

  if (pickString(metadata.videoUrl, metadata.video_url)) return 'video';
  if (VIDEO_SOURCE_TYPES.has(item.sourceType)) return 'video';
  if (/\.(mp4|webm|mov|m4v|m3u8)(?:[?#].*)?$/i.test(item.imageUrl || '')) {
    return 'video';
  }

  return 'image';
};

export const isGlobalHistoryVideoItem = (item: GlobalImageHistoryItem): boolean =>
  getGlobalHistoryMediaType(item) === 'video';

export const getGlobalHistoryMediaUrl = (item: GlobalImageHistoryItem): string =>
  pickString(item.metadata?.videoUrl, item.metadata?.video_url, item.imageUrl) ||
  item.imageUrl;

export const getGlobalHistoryVideoThumbnail = (
  item: GlobalImageHistoryItem
): string | undefined =>
  pickString(
    item.metadata?.videoThumbnailUrl,
    item.metadata?.videoThumbnail,
    item.metadata?.thumbnailUrl,
    item.metadata?.thumbnail,
    item.metadata?.posterUrl,
    item.metadata?.poster,
    item.metadata?.coverUrl,
    item.metadata?.cover
  );

const getUrlExtension = (value: string): string | undefined => {
  try {
    const parsed = new URL(
      value,
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    );
    const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match?.[1]?.toLowerCase();
  } catch {
    const match = value.split('?')[0]?.split('#')[0]?.match(/\.([a-z0-9]{2,5})$/i);
    return match?.[1]?.toLowerCase();
  }
};

export const getGlobalHistoryDownloadFileName = (
  item: GlobalImageHistoryItem
): string => {
  const isVideo = isGlobalHistoryVideoItem(item);
  const url = getGlobalHistoryMediaUrl(item);
  const ext = getUrlExtension(url) || (isVideo ? 'mp4' : 'png');
  return `${isVideo ? 'video' : 'image'}_${item.id}.${ext}`;
};
