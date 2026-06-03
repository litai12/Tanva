const INLINE_IMAGE_PATTERNS = [
  /data:image\//i,
  /url\(\s*['"]?\s*data:/i,
  /\bsrc\s*=\s*['"]\s*data:image\//i,
  /\bblob:/i,
  /;base64/i,
  /base64,/i,
  /iVBORw0KGgo[A-Za-z0-9+/=]{24,}/,
  /\/9j\/[A-Za-z0-9+/=]{24,}/,
  /R0lGOD[A-Za-z0-9+/=]{24,}/,
  /UklGR[A-Za-z0-9+/=]{24,}/,
] as const;

const ACTIVE_CODE_PATTERNS = [
  /<script\b/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
  /<base\b/i,
] as const;

export function getHtmlPptUnsafeCodeReason(value: string): string | null {
  const source = String(value || "");
  if (!source) return null;

  if (INLINE_IMAGE_PATTERNS.some((pattern) => pattern.test(source))) {
    return "HTML PPT code cannot contain data:, blob:, or base64 image references.";
  }

  if (ACTIVE_CODE_PATTERNS.some((pattern) => pattern.test(source))) {
    return "HTML PPT slides only support inert HTML/CSS fragments in the sandbox.";
  }

  return null;
}

export function assertSafeHtmlPptCode(value: string, label = "HTML PPT code") {
  const reason = getHtmlPptUnsafeCodeReason(value);
  if (reason) {
    throw new Error(`${label}: ${reason}`);
  }
}

export function containsNonPersistableHtmlPptAsset(value: unknown): boolean {
  if (typeof value === "string") {
    return INLINE_IMAGE_PATTERNS.some((pattern) => pattern.test(value));
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsNonPersistableHtmlPptAsset(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((child) =>
      containsNonPersistableHtmlPptAsset(child)
    );
  }

  return false;
}
