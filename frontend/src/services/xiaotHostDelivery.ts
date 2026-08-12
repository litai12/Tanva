import type {
  AgentGeneratedAsset,
  AgentPatchExecutionReport,
} from "./agentPatchExecution";

export interface XiaotHostDeliveryVerification {
  satisfied: boolean;
  assets: AgentGeneratedAsset[];
  error?: string;
}

export interface XiaotExpectedHostAsset {
  nodeId: string;
  kind: AgentGeneratedAsset["kind"];
}

export const verifyXiaotHostDelivery = (input: {
  report: AgentPatchExecutionReport;
  expectedAssets: XiaotExpectedHostAsset[];
}): XiaotHostDeliveryVerification => {
  const failures = input.report.results.filter((result) => !result.ok);
  if (failures.length > 0) {
    return {
      satisfied: false,
      assets: input.report.assets,
      error: failures
        .map((result) => result.error || `${result.op} 执行失败`)
        .join("；"),
    };
  }

  for (const expected of input.expectedAssets) {
    const runResult = input.report.results.find(
      (result) => result.op === "runNode" && result.nodeId === expected.nodeId
    );
    if (!runResult) {
      return {
        satisfied: false,
        assets: input.report.assets,
        error: `生成节点未执行：${expected.nodeId}`,
      };
    }
    if (!runResult.assets.some((asset) => asset.kind === expected.kind)) {
      return {
        satisfied: false,
        assets: input.report.assets,
        error: `生成节点没有返回 ${expected.kind} 的真实资产 URL：${expected.nodeId}`,
      };
    }
  }

  return { satisfied: true, assets: input.report.assets };
};

export const buildXiaotDeliveredContent = (
  assets: AgentGeneratedAsset[],
  fallbackText: string
): string => {
  const imageCount = assets.filter((asset) => asset.kind === "image").length;
  const videoCount = assets.filter((asset) => asset.kind === "video").length;
  const audioCount = assets.filter((asset) => asset.kind === "audio").length;
  const parts = [
    imageCount > 0 ? `${imageCount} 张图片` : "",
    videoCount > 0 ? `${videoCount} 个视频` : "",
    audioCount > 0 ? `${audioCount} 个音频` : "",
  ].filter(Boolean);
  if (parts.length > 0) return `已生成${parts.join("、")}并添加到画布。`;
  return fallbackText;
};
