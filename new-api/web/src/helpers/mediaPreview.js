/*
Best-effort media extraction for log request-chain payloads.

These payloads are raw request/response JSON *strings* (often sanitized so that
large base64 blobs are replaced by `[base64 ~N chars]` markers). We do not try to
authoritatively parse them — we regex-scan for renderable media URLs so we can show
an input reference-image preview ("媒体预览"). Display-only: extracted URLs are only
ever assigned to <img>/<video> src, never persisted or rendered as HTML.
*/

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'heic', 'heif', 'tiff',
]);
const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi', 'ogv', 'mpeg', 'mpg',
]);

// Cap how many tiles we render so a single trace can't flood the modal with
// remote requests / leak excessive viewing activity to upstream hosts.
const MAX_IMAGES = 12;
const MAX_VIDEOS = 8;

// URL token stops at JSON/quote/bracket boundaries; trailing punctuation trimmed after.
// We deliberately only match http(s) URLs — `data:`/base64 references are skipped
// to avoid pushing large blobs into the DOM (trace bodies sanitize base64 anyway,
// and real input references in this system are always URLs).
const URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}\\]+/gi;

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return '';
  }
};

// Raw JSON encodes slashes as `\/`; un-escape so URLs match cleanly.
const normalize = (input) => {
  if (input == null) return '';
  const s = typeof input === 'string' ? input : safeStringify(input);
  if (!s) return '';
  return s.replace(/\\\//g, '/');
};

const classifyUrl = (url) => {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  const extMatch = clean.match(/\.([a-z0-9]{1,5})$/);
  const ext = extMatch ? extMatch[1] : '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  // Extension-less URLs: only classify on a strong path hint, otherwise skip
  // (don't eagerly embed arbitrary links).
  if (/\/(images?|img|thumbnails?|covers?|gen\/images?)\//.test(clean)) return 'image';
  if (/\/(videos?|vid|gen\/videos?)\//.test(clean)) return 'video';
  return null;
};

/**
 * Scan one or more payload strings/objects for renderable media URLs.
 * @returns {{images: string[], videos: string[], totalImages: number, totalVideos: number}}
 */
export const collectMediaUrls = (...inputs) => {
  const images = [];
  const videos = [];
  const seen = new Set();

  const push = (url, kind) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    if (kind === 'video') videos.push(url);
    else images.push(url);
  };

  for (const input of inputs) {
    const s = normalize(input);
    if (!s) continue;

    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(s)) !== null) {
      const url = m[0].replace(/[.,;:]+$/, '');
      const kind = classifyUrl(url);
      if (kind) push(url, kind);
    }
  }

  return {
    images: images.slice(0, MAX_IMAGES),
    videos: videos.slice(0, MAX_VIDEOS),
    totalImages: images.length,
    totalVideos: videos.length,
  };
};

export default collectMediaUrls;
