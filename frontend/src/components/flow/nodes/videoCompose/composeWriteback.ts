/**
 * 视频合成结果写回画布的纯逻辑（适配 Tanva 单 `videoUrl` 节点形状）。
 *
 * 背景：合成节点点「合成视频」后，若先 `await` 把成片上传 OSS 再写回，会被一次
 * 几秒~几十秒的上传阻塞，用户看着「合成后加不到画布」。
 * 正解：先用 blob: URL 立即写回（合成即可见），后台转存 OSS，成功后把临时 URL
 * 换成持久 URL。
 */

/** 立即写回用的节点 patch：把刚合成的 blob: URL 设为当前主视频。 */
export function buildComposeInitialPatch(blobUrl: string): {
  videoUrl: string;
  videoName: string;
  mimeType: string;
  status: "ready";
  error: undefined;
} {
  return {
    videoUrl: blobUrl,
    videoName: "合成视频.mp4",
    mimeType: "video/mp4",
    status: "ready",
    error: undefined,
  };
}

/**
 * 后台转存成功后，把节点里临时 blob: URL 换成持久 OSS URL。
 * 基于「最新」节点数据计算：只在 `videoUrl` 恰好仍等于该 blob: 时替换，
 * 避免覆盖期间用户发生的其它改动。无需替换时返回 null（不触发多余 updateNodeData）。
 */
export function buildComposeUrlSwapPatch(
  freshData: unknown,
  blobUrl: string,
  durableUrl: string
): { videoUrl: string } | null {
  if (!freshData || typeof freshData !== "object") return null;
  const d = freshData as { videoUrl?: unknown };
  if (d.videoUrl === blobUrl) return { videoUrl: durableUrl };
  return null;
}
