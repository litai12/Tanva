import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPresentationDeck,
  buildPresentationInstruction,
  normalizeCreatePresentationArguments,
} from "./xiaotPresentationTool.ts";

test("normalizes presentation requests and defaults to Tanva Studio", () => {
  const request = normalizeCreatePresentationArguments(
    { title: "品牌提案", slideCount: 99 },
    "为客户制作一套发布会演示"
  );

  assert.equal(request.style, "tanva");
  assert.equal(request.slideCount, 24);
  assert.equal(request.aspectRatio, "16:9");
  assert.equal(request.autoRun, true);

  const deck = buildPresentationDeck(request);
  assert.equal(deck.slides.length, 24);
  assert.match(deck.themeCss, /#111111/i);
});

test("architecture mode adds evidence and non-fabrication guardrails", () => {
  const request = normalizeCreatePresentationArguments(
    {
      title: "滨水文化中心建筑设计汇报",
      slideCount: 12,
      style: "architectural",
      outline: ["场地判断", "体量演变", "功能与流线"],
    },
    "依据上传的总平面与效果图完成汇报"
  );

  assert.equal(request.architectureMode, true);
  const instruction = buildPresentationInstruction(request);
  assert.match(instruction, /不得虚构容积率、面积、结构、造价/);
  assert.match(instruction, /体量演变、功能\/流线\/气候策略与材料逻辑/);
  assert.match(instruction, /1\. 场地判断/);

  const deck = buildPresentationDeck(request);
  assert.equal(deck.slides.length, 12);
  assert.equal(deck.slides[0]?.title, "场地判断");
  assert.equal(deck.slides[1]?.title, "体量演变");
});

test("slide count is never smaller than a useful deck", () => {
  const request = normalizeCreatePresentationArguments(
    { slideCount: 1, aspectRatio: "4:3", autoRun: false },
    "做一个简短汇报"
  );

  assert.equal(request.slideCount, 3);
  assert.equal(request.aspectRatio, "4:3");
  assert.equal(request.autoRun, false);
});
