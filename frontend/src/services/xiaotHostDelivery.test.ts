import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildXiaotDeliveredContent,
  verifyXiaotHostDelivery,
} from "./xiaotHostDelivery.ts";

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
