import type {
  AgentGeneratedAsset,
  AgentPatchExecutionReport,
} from "./agentPatchExecution";
import type { AgentFlowPatch } from "./agentCanvasProtocol";

export interface XiaotHostDeliveryVerification {
  satisfied: boolean;
  assets: AgentGeneratedAsset[];
  error?: string;
}

export interface XiaotExpectedHostAsset {
  nodeId: string;
  kind: AgentGeneratedAsset["kind"];
}

export interface XiaotTurnDeliveryEvidence {
  streamCompletedSuccessfully: boolean;
  assistantText: string;
  patchCount: number;
  hostToolHandled: boolean;
  hostUiCount: number;
  hostDelivery: XiaotHostDeliveryVerification;
}

/**
 * A newly added executable media node is a pending side effect, not a completed
 * delivery. XiaoT normally emits runNode itself; the host deterministically
 * closes that protocol gap once when the model omitted it. Workflow-only
 * requests must opt out structurally through data.deferExecution=true on the
 * added node instead of relying on natural-language guesses in the host.
 */
export const buildMissingExecutableRunPatches = (input: {
  addedExecutableNodeIds: Iterable<string>;
  executedNodeIds: ReadonlySet<string>;
  deferredNodeIds: ReadonlySet<string>;
}): AgentFlowPatch[] =>
  Array.from(new Set(input.addedExecutableNodeIds))
    .filter(
      (nodeId) =>
        !input.executedNodeIds.has(nodeId) && !input.deferredNodeIds.has(nodeId)
    )
    .map((id) => ({ op: "runNode", id }));

/**
 * legacy_image_only is a compatibility fallback for turns that do not create
 * an executable canvas image node. Once the turn owns a canvas generator, the
 * generator is the single delivery path; running both would charge twice and
 * render duplicate chat media.
 */
export const shouldExecuteLegacyImageOnlyHostTool = (
  executableImageNodeIds: Iterable<string>
): boolean => executableImageNodeIds[Symbol.iterator]().next().done === true;

const stringifyXiaotEvidence = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const parseEmbeddedJson = (value: string): unknown => {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Agent Runtime prefixes the upstream OpenAI envelope with transport
    // context (for example "xiaot-agent stream error: {...}"). Parse the
    // envelope itself instead of regexing an escaped JSON rendering.
    for (let index = trimmed.indexOf("{"); index >= 0; index = trimmed.indexOf("{", index + 1)) {
      try {
        return JSON.parse(trimmed.slice(index));
      } catch {
        // A message can contain braces before the actual JSON envelope.
      }
    }
    return undefined;
  }
};

const extractXiaotErrorMessage = (
  value: unknown,
  seen = new Set<unknown>()
): string | undefined => {
  if (value === null || value === undefined || seen.has(value)) return undefined;
  seen.add(value);

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return undefined;
    const parsed = parseEmbeddedJson(raw);
    if (parsed !== undefined && parsed !== value) {
      const nested = extractXiaotErrorMessage(parsed, seen);
      if (nested) return nested;
    }
    return raw;
  }

  const record = readRecord(value);
  if (!record) return undefined;
  for (const key of ["error", "message", "data", "details", "cause"]) {
    const nested = extractXiaotErrorMessage(record[key], seen);
    if (nested) return nested;
  }
  return undefined;
};

export const isXiaotHostExecutionSuspensionMessage = (value: unknown): boolean => {
  const evidence = stringifyXiaotEvidence(value);
  return /xiaot_turn_suspended/i.test(evidence) &&
    /(host_execution_required|root_physical_execution_budget_exhausted)/i.test(evidence);
};

export const isXiaotModelRouteCreditsError = (value: unknown): boolean => {
  const evidence = stringifyXiaotEvidence(value);
  return /team_insufficient_credits/i.test(evidence) ||
    /积分不足/i.test(evidence) ||
    /insufficient credits?/i.test(evidence);
};

export const resolveXiaotAgentErrorMessage = (value: unknown): string => {
  return extractXiaotErrorMessage(value) || "小T处理失败";
};

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

/**
 * SSE completion is not delivery. Require at least one visible or executable
 * output channel after the host-side patch verifier has accepted its evidence.
 */
export const verifyXiaotTurnDelivery = (
  evidence: XiaotTurnDeliveryEvidence
): XiaotHostDeliveryVerification => {
  if (!evidence.streamCompletedSuccessfully) {
    return {
      satisfied: false,
      assets: evidence.hostDelivery.assets,
      error: "小T上游回合以错误终态结束，不能标记为已完成",
    };
  }
  if (!evidence.hostDelivery.satisfied) return evidence.hostDelivery;

  const hasDelivery =
    evidence.assistantText.trim().length > 0 ||
    evidence.patchCount > 0 ||
    evidence.hostToolHandled ||
    evidence.hostUiCount > 0;
  if (!hasDelivery) {
    return {
      satisfied: false,
      assets: evidence.hostDelivery.assets,
      error:
        "小T上游已结束，但没有返回正文、画布命令、宿主工具或可展示卡片",
    };
  }

  return evidence.hostDelivery;
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
