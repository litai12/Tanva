export const XIAOT_THINKING_CONTENT = "小T正在思考...";

export const resolveXiaotFinalText = (event: {
  message?: string;
  data?: Record<string, unknown>;
}): string => {
  if (typeof event.message === "string" && event.message.trim()) {
    return event.message;
  }

  const dataText = event.data?.text;
  return typeof dataText === "string" && dataText.trim() ? dataText : "";
};

export const resolveXiaotTerminalContent = (
  assembled: string,
  currentContent: string,
  terminalState: "completed" | "stopped"
): string => {
  if (assembled.trim()) return assembled;

  const current = currentContent.trim();
  if (current && current !== XIAOT_THINKING_CONTENT) return currentContent;

  return terminalState === "completed" ? "任务已完成" : "任务已停止";
};
