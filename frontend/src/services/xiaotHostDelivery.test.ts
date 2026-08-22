import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMissingExecutableRunPatches,
  buildXiaotDeliveredContent,
  isXiaotHostExecutionSuspensionMessage,
  isXiaotModelRouteCreditsError,
  resolveXiaotAgentErrorMessage,
  shouldExecuteLegacyImageOnlyHostTool,
  verifyXiaotHostDelivery,
  verifyXiaotTurnDelivery,
} from "./xiaotHostDelivery.ts";
import type { XiaotHostDeliveryVerification } from "./xiaotHostDelivery.ts";

describe("buildMissingExecutableRunPatches", () => {
  it("runs every newly added executable node that XiaoT did not run", () => {
    assert.deepEqual(
      buildMissingExecutableRunPatches({
        addedExecutableNodeIds: ["image-1", "video-1", "image-1"],
        executedNodeIds: new Set(["video-1"]),
        deferredNodeIds: new Set(),
      }),
      [{ op: "runNode", id: "image-1" }]
    );
  });

  it("preserves an explicit workflow-only deferExecution decision", () => {
    assert.deepEqual(
      buildMissingExecutableRunPatches({
        addedExecutableNodeIds: ["image-1"],
        executedNodeIds: new Set(),
        deferredNodeIds: new Set(["image-1"]),
      }),
      []
    );
  });
});

describe("shouldExecuteLegacyImageOnlyHostTool", () => {
  it("keeps direct chat generation as a fallback when no canvas generator exists", () => {
    assert.equal(shouldExecuteLegacyImageOnlyHostTool([]), true);
  });

  it("suppresses direct chat generation when the turn already owns a canvas generator", () => {
    assert.equal(
      shouldExecuteLegacyImageOnlyHostTool(["generatePro-1"]),
      false
    );
  });
});

describe("verifyXiaotHostDelivery", () => {
  it("requires a real image URL for every expected image node", () => {
    const result = verifyXiaotHostDelivery({
      report: {
        results: [
          {
            op: "runNode",
            ok: true,
            nodeId: "image-1",
            assets: [{ kind: "image", url: "https://assets.test/cover.png" }],
          },
        ],
        succeededCount: 1,
        failedCount: 0,
        assets: [{ kind: "image", url: "https://assets.test/cover.png" }],
      },
      expectedAssets: [{ nodeId: "image-1", kind: "image" }],
    });
    assert.equal(result.satisfied, true);
  });

  it("rejects a host command that has no materialized asset", () => {
    const result = verifyXiaotHostDelivery({
      report: {
        results: [{ op: "runNode", ok: true, nodeId: "image-1", assets: [] }],
        succeededCount: 1,
        failedCount: 0,
        assets: [],
      },
      expectedAssets: [{ nodeId: "image-1", kind: "image" }],
    });
    assert.equal(result.satisfied, false);
    assert.match(result.error || "", /真实资产 URL/);
  });
});

describe("isXiaotHostExecutionSuspensionMessage", () => {
  it("recognizes the structured TapCanvas host hand-off", () => {
    assert.equal(
      isXiaotHostExecutionSuspensionMessage(
        'xiaot-agent stream error: {"code":"xiaot_turn_suspended","details":{"requestTerminal":{"status":"suspended","reason":"host_execution_required"}}}'
      ),
      true
    );
    assert.equal(
      isXiaotHostExecutionSuspensionMessage(
        'xiaot-agent stream error: {"code":"xiaot_turn_suspended","details":{"requestTerminal":{"status":"suspended","reason":"root_physical_execution_budget_exhausted"}}}'
      ),
      true
    );
  });

  it("does not hide real upstream failures", () => {
    assert.equal(
      isXiaotHostExecutionSuspensionMessage(
        'xiaot-agent stream error: {"code":"upstream_timeout"}'
      ),
      false
    );
  });
});

describe("resolveXiaotAgentErrorMessage", () => {
  it("extracts the real message from an upstream 402 envelope", () => {
    const error =
      'xiaot-agent upstream error: status=402 body={"error":{"message":"积分不足，无法调用三方生成","code":"team_insufficient_credits"}}';
    assert.equal(resolveXiaotAgentErrorMessage(error), "积分不足，无法调用三方生成");
    assert.equal(isXiaotModelRouteCreditsError(error), true);
  });

  it("extracts a complete message from the Agent Runtime prefixed envelope", () => {
    const errorEvidence = {
      message:
        'xiaot-agent stream error: {"message":"root_physical_execution_budget_exhausted","type":"server_error","code":"xiaot_turn_suspended"}',
    };
    assert.equal(
      resolveXiaotAgentErrorMessage(errorEvidence),
      "root_physical_execution_budget_exhausted"
    );
  });

  it("does not collapse a real provider error to the first opening brace", () => {
    const errorEvidence = {
      message:
        'xiaot-agent stream error: {"message":"LLM provider 未完成交付","type":"server_error","code":"llm_provider_response_failed"}',
    };
    assert.equal(resolveXiaotAgentErrorMessage(errorEvidence), "LLM provider 未完成交付");
  });
});

describe("verifyXiaotTurnDelivery", () => {
  const emptyHostDelivery: XiaotHostDeliveryVerification = {
    satisfied: true,
    assets: [],
  };

  it("rejects a transport-complete turn with no delivery evidence", () => {
    const result = verifyXiaotTurnDelivery({
      streamCompletedSuccessfully: true,
      assistantText: "",
      patchCount: 0,
      hostToolHandled: false,
      hostUiCount: 0,
      hostDelivery: emptyHostDelivery,
    });
    assert.equal(result.satisfied, false);
    assert.match(result.error || "", /没有返回正文、画布命令、宿主工具或可展示卡片/);
  });

  it("accepts a real host patch report even when the assistant body is empty", () => {
    const result = verifyXiaotTurnDelivery({
      streamCompletedSuccessfully: true,
      assistantText: "",
      patchCount: 2,
      hostToolHandled: false,
      hostUiCount: 0,
      hostDelivery: emptyHostDelivery,
    });
    assert.equal(result.satisfied, true);
  });

  it("preserves a host execution failure", () => {
    const result = verifyXiaotTurnDelivery({
      streamCompletedSuccessfully: true,
      assistantText: "已创建图片节点",
      patchCount: 1,
      hostToolHandled: false,
      hostUiCount: 0,
      hostDelivery: {
        satisfied: false,
        assets: [],
        error: "节点生成失败",
      },
    });
    assert.equal(result.satisfied, false);
    assert.equal(result.error, "节点生成失败");
  });

  it("rejects an upstream error even when partial assistant text exists", () => {
    const result = verifyXiaotTurnDelivery({
      streamCompletedSuccessfully: false,
      assistantText: "上游暂停前已经输出的部分正文",
      patchCount: 0,
      hostToolHandled: false,
      hostUiCount: 0,
      hostDelivery: emptyHostDelivery,
    });
    assert.equal(result.satisfied, false);
    assert.match(result.error || "", /错误终态/);
  });
});

describe("buildXiaotDeliveredContent", () => {
  it("reports the materialized asset counts instead of upstream waiting text", () => {
    assert.equal(
      buildXiaotDeliveredContent(
        [{ kind: "image", url: "https://assets.test/cover.png" }],
        "正在等待真实交付证据"
      ),
      "已生成1 张图片并添加到画布。"
    );
  });
});
