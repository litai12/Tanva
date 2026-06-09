// 单轨：kling-o3(Omni) 的 videoMode / inputType 判定唯一来源。
// FlowOverlay 实际发送与 KlingO3VideoNode 计费预估共用本文件，避免两处逻辑漂移导致
// "预估按 A 算、实扣按 B 算"的积分不一致。

export type KlingO3ImageMode = "frame" | "reference";
export type KlingO3VideoMode = "video" | "reference" | "frame" | "image" | "text";

/**
 * 解析 kling-o3 发送给后端的 videoMode。
 * - 连了参考视频 → video（与图片/首尾帧互斥）。
 * - 用户显式选「图片参考」→ reference（≥1 张；0 张退化 text）。
 * - 用户显式选「首尾帧」→ 2 张 frame / 1 张 image / 0 张 text。
 * - 未显式选择 → 按图片数量自动判定（≥3 reference / ==2 frame / ==1 image / 0 text）。
 */
export function resolveKlingO3VideoMode(opts: {
  hasReferenceVideo: boolean;
  explicitImageType?: KlingO3ImageMode;
  referenceImageCount: number;
}): KlingO3VideoMode {
  const { hasReferenceVideo, explicitImageType, referenceImageCount } = opts;
  if (hasReferenceVideo) return "video";
  if (explicitImageType === "reference") {
    return referenceImageCount >= 1 ? "reference" : "text";
  }
  if (explicitImageType === "frame") {
    return referenceImageCount >= 2
      ? "frame"
      : referenceImageCount === 1
        ? "image"
        : "text";
  }
  if (referenceImageCount >= 3) return "reference";
  if (referenceImageCount >= 2) return "frame";
  if (referenceImageCount === 1) return "image";
  return "text";
}

/**
 * 计费上下文里的 inputType，与后端 ai.controller 一致：
 * 有视频 → video；否则有图 → image；否则 text。
 */
export function resolveKlingO3InputType(opts: {
  hasReferenceVideo: boolean;
  referenceImageCount: number;
}): "video" | "image" | "text" {
  if (opts.hasReferenceVideo) return "video";
  if (opts.referenceImageCount > 0) return "image";
  return "text";
}

/** 把 data.imageType 收敛成合法的显式模式（非法/缺省 → undefined）。 */
export function normalizeKlingO3ImageMode(raw: unknown): KlingO3ImageMode | undefined {
  return raw === "frame" || raw === "reference" ? raw : undefined;
}

/**
 * kling-o3 画质(mode) → 计费用 resolution。std=720P / pro=1080P / 4k=4K。
 * 仅用于「计费上下文」单轨：节点不向上游下发 resolution(避免被转成 size 字段与 omni 的
 * mode 画质冲突)，但线路计价按 resolution 分档，故前端预估与后端扣费都按 mode 派生同一
 * resolution，保证 std/pro/4k 计费一致且正确。后端 ai.controller 有等价映射，改一处务必同步另一处。
 */
export function klingO3BillingResolutionFromMode(
  mode: unknown
): "720P" | "1080P" | "4K" {
  const normalized = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  if (normalized === "pro") return "1080P";
  if (normalized === "4k") return "4K";
  return "720P";
}
