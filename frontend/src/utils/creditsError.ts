/**
 * Detect backend / client error text for insufficient account credits (积分).
 */
export function isInsufficientCreditsErrorMessage(message: unknown): boolean {
  const s = typeof message === "string" ? message : String(message ?? "");
  if (!s.trim()) return false;
  const lower = s.toLowerCase();
  return (
    s.includes("积分不足") ||
    lower.includes("insufficient credit") ||
    lower.includes("not enough credit")
  );
}
