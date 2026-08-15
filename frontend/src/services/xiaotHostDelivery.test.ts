import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildXiaotDeliveredContent,
  verifyXiaotHostDelivery,
  verifyXiaotTurnDelivery,
} from "./xiaotHostDelivery.ts";
import type { XiaotHostDeliveryVerification } from "./xiaotHostDelivery.ts";

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
