type ObjectUrlOwner = "canvas" | "ai-chat" | "temporary";
type UnknownRecord = Record<string, unknown>;
type ChatSnapshot = {
  sourceImageForEditing?: unknown;
  sourceImageForAnalysis?: unknown;
  sourceImagesForBlending?: unknown;
  messages?: unknown;
};
type RuntimeWindow = Window & {
  tanvaImageInstances?: Array<{ imageData?: UnknownRecord }>;
  paper?: {
    project?: { getItems?: (query: UnknownRecord) => unknown[] };
    Raster?: unknown;
  };
  __tanvaAiChatStoreGetState?: () => ChatSnapshot;
  __tanvaContextManagerGetCachedImages?: () => { latest?: unknown } | null;
};

const isBrowser = typeof window !== "undefined" && typeof URL !== "undefined";

const ownersByUrl = new Map<string, Set<ObjectUrlOwner>>();

export const isBlobObjectUrl = (value?: unknown): value is string =>
  typeof value === "string" && value.trim().startsWith("blob:");

const normalizeObjectUrl = (value?: unknown): string | null => {
  if (!isBlobObjectUrl(value)) return null;
  return value.trim();
};

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;

export const registerObjectUrl = (
  value: string,
  owner: ObjectUrlOwner
): string => {
  const url = normalizeObjectUrl(value);
  if (!url) return value;
  const owners = ownersByUrl.get(url) ?? new Set<ObjectUrlOwner>();
  owners.add(owner);
  ownersByUrl.set(url, owners);
  return url;
};

export const releaseObjectUrlOwner = (
  value: string | null | undefined,
  owner: ObjectUrlOwner
): void => {
  const url = normalizeObjectUrl(value);
  if (!url) return;
  const owners = ownersByUrl.get(url);
  if (!owners) return;
  owners.delete(owner);
  if (owners.size === 0) ownersByUrl.delete(url);
};

export const isObjectUrlOwnedBy = (
  value: string | null | undefined,
  owner: ObjectUrlOwner
): boolean => {
  const url = normalizeObjectUrl(value);
  if (!url) return false;
  return ownersByUrl.get(url)?.has(owner) === true;
};

export const revokeObjectUrl = (value: string | null | undefined): void => {
  const url = normalizeObjectUrl(value);
  if (!url || !isBrowser) return;
  try {
    URL.revokeObjectURL(url);
  } catch {}
  ownersByUrl.delete(url);
};

const getRasterSourceString = (raster: unknown): string => {
  const record = asRecord(raster);
  if (!record) return "";
  try {
    const tracked = record.__tanvaSourceRef;
    if (typeof tracked === "string" && tracked.trim()) return tracked.trim();
    const source = record.source;
    if (typeof source === "string" && source.trim()) return source.trim();
    const src = asRecord(source)?.src;
    if (typeof src === "string" && src.trim()) return src.trim();
  } catch {}
  return "";
};

export const isObjectUrlStillReferenced = (url: string): boolean => {
  const objectUrl = normalizeObjectUrl(url);
  if (!objectUrl || typeof window === "undefined") return false;
  const runtimeWindow = window as RuntimeWindow;

  try {
    const instances = runtimeWindow.tanvaImageInstances;
    if (Array.isArray(instances)) {
      const usedByInstances = instances.some((inst) => {
        const d = inst?.imageData;
        return d?.localDataUrl === objectUrl || d?.url === objectUrl || d?.src === objectUrl;
      });
      if (usedByInstances) return true;
    }
  } catch {}

  try {
    const paperScope = runtimeWindow.paper;
    const project = paperScope?.project;
    const rasterClass = paperScope?.Raster;
    if (project?.getItems && rasterClass) {
      const rasters = project.getItems({ class: rasterClass });
      if (rasters.some((raster) => getRasterSourceString(raster) === objectUrl)) {
        return true;
      }
    }
  } catch {}

  try {
    const chat = runtimeWindow.__tanvaAiChatStoreGetState?.();
    if (chat?.sourceImageForEditing === objectUrl) return true;
    if (chat?.sourceImageForAnalysis === objectUrl) return true;
    if (
      Array.isArray(chat?.sourceImagesForBlending) &&
      chat.sourceImagesForBlending.some((value: unknown) => value === objectUrl)
    ) {
      return true;
    }
    if (
      Array.isArray(chat?.messages) &&
      chat.messages.some((message) => {
        const msg = asRecord(message);
        if (!msg) return false;
        if (msg.sourceImageData === objectUrl) return true;
        if (msg.imageData === objectUrl) return true;
        if (msg.thumbnail === objectUrl) return true;
        const sourceImagesData = msg.sourceImagesData;
        return Array.isArray(sourceImagesData) &&
          sourceImagesData.some((value: unknown) => value === objectUrl);
      })
    ) {
      return true;
    }
  } catch {}

  try {
    const cached = runtimeWindow.__tanvaContextManagerGetCachedImages?.();
    if (cached?.latest === objectUrl) return true;
  } catch {}

  try {
    const images = Array.from(document.images || []);
    if (
      images.some((img) => {
        try {
          return (
            img.currentSrc === objectUrl ||
            (typeof img.src === "string" && img.src === objectUrl)
          );
        } catch {
          return false;
        }
      })
    ) {
      return true;
    }
  } catch {}

  return false;
};

export const revokeObjectUrlsWhenUnused = (
  values: Iterable<string>,
  options?: {
    maxAttempts?: number;
    delayMs?: number;
    owner?: ObjectUrlOwner;
  }
): void => {
  const urls = new Set<string>();
  for (const value of values) {
    const url = normalizeObjectUrl(value);
    if (url) urls.add(url);
  }
  if (urls.size === 0) return;

  const maxAttempts = options?.maxAttempts ?? 30;
  const delayMs = options?.delayMs ?? 500;

  const attemptRevoke = (pending: Set<string>, attempt: number) => {
    const stillUsed = new Set<string>();
    pending.forEach((url) => {
      if (isObjectUrlStillReferenced(url)) {
        stillUsed.add(url);
        return;
      }
      if (options?.owner) releaseObjectUrlOwner(url, options.owner);
      revokeObjectUrl(url);
    });

    if (stillUsed.size === 0 || attempt >= maxAttempts) return;
    if (typeof window === "undefined") return;
    try {
      window.setTimeout(() => attemptRevoke(stillUsed, attempt + 1), delayMs);
    } catch {}
  };

  attemptRevoke(urls, 0);
};

export const collectObjectUrlsFromImageData = (imageData: unknown): string[] => {
  if (!imageData || typeof imageData !== "object") return [];
  const data = imageData as Record<string, unknown>;
  return [data.localDataUrl, data.src, data.url, data.remoteUrl].filter(
    isBlobObjectUrl
  );
};
