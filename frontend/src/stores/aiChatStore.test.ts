import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveXiaotFinalText,
  resolveXiaotTerminalContent,
} from "./xiaotTerminalContent.ts";

describe("resolveXiaotFinalText", () => {
  it("reads Markdown body from the final event message", () => {
    assert.equal(
      resolveXiaotFinalText({ message: "## 已完成\n\n- 小狗图片已生成" }),
      "## 已完成\n\n- 小狗图片已生成"
    );
  });

  it("falls back to data.text when the final message field is absent", () => {
    assert.equal(
      resolveXiaotFinalText({ data: { text: "**图片已生成**" } }),
      "**图片已生成**"
    );
  });
});

describe("resolveXiaotTerminalContent", () => {
  it("replaces the thinking placeholder when a textless task completes", () => {
    assert.equal(
      resolveXiaotTerminalContent("", "小T正在思考...", "completed"),
      "任务已完成"
    );
  });

  it("keeps the assistant reply when the task returns text", () => {
    assert.equal(
      resolveXiaotTerminalContent(
        "已生成小狗图片并放到画布上。",
        "小T正在思考...",
        "completed"
      ),
      "已生成小狗图片并放到画布上。"
    );
  });

  it("shows a stopped state when a textless task is aborted", () => {
    assert.equal(
      resolveXiaotTerminalContent("", "小T正在思考...", "stopped"),
      "任务已停止"
    );
  });
});
