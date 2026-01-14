import type { ProjectContentSnapshot } from "@/types/project";
import { isRemoteUrl } from "@/utils/imageSource";

export function getNonRemoteImageAssetIds(
  content: ProjectContentSnapshot | null | undefined
): string[] {
  const images = content?.assets?.images ?? [];
  if (!Array.isArray(images) || images.length === 0) return [];

  const ids: string[] = [];
  for (const image of images) {
    const url = typeof image?.url === "string" ? image.url.trim() : "";
    const src = typeof image?.src === "string" ? image.src.trim() : "";
    const hasRemote = isRemoteUrl(url) || isRemoteUrl(src);
    if (hasRemote && !image?.pendingUpload) continue;
    if (typeof image?.id === "string" && image.id.length > 0) {
      ids.push(image.id);
    } else {
      ids.push("unknown");
    }
  }
  return ids;
}

