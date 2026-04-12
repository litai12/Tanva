import type { BananaImageRoute, SupportedAIProvider } from "@/types/ai";

type BananaProvider = "banana" | "banana-2.5" | "banana-3.1";

const BANANA_PROVIDERS = new Set<BananaProvider>([
  "banana",
  "banana-2.5",
  "banana-3.1",
]);

export const isBananaRouteProvider = (
  provider: SupportedAIProvider | string | null | undefined
): provider is BananaProvider => {
  return BANANA_PROVIDERS.has((provider || "").trim() as BananaProvider);
};

export const isTencentStableBananaRoute = (
  provider: SupportedAIProvider | string | null | undefined,
  route: BananaImageRoute | null | undefined
): boolean => {
  return isBananaRouteProvider(provider) && route === "stable";
};

export const getTencentBananaMaxReferenceImages = (
  provider: SupportedAIProvider | string | null | undefined
): number => {
  // 腾讯 VOD AIGC CreateAigcImageTask 文档：GG 2.5 最多 3 张参考图，GG 3.0/3.1 最多 14 张。
  return (provider || "").trim() === "banana-2.5" ? 3 : 14;
};

export const isTencentBananaAnalyzeSupported = (): boolean => {
  // 当前稳定通道（腾讯）仅承接生图任务（生成/编辑/融合），图像分析仍走非腾讯链路。
  return false;
};
