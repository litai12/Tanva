import assert from "node:assert/strict";
import test from "node:test";
import {
  TANVA_CAPABILITY_MANIFEST,
  type AgentFlowPatch,
} from "./agentCanvasProtocol.ts";
import { XiaotImagePatchContract } from "./xiaotImagePatchContract.ts";

const addNode = (id: string, type: string): AgentFlowPatch => ({
  op: "addNode",
  node: { id, type, data: {} },
});

const connect = (source: string, target: string): AgentFlowPatch => ({
  op: "connectEdge",
  source,
  target,
  sourceHandle: "text",
  targetHandle: "text",
});

test("one-image contract keeps one prompt and one generator", () => {
  const contract = new XiaotImagePatchContract(1);
  const emitted = [
    ...contract.accept(addNode("p1", "textPrompt")),
    ...contract.accept(addNode("g1", "gptImage2")),
    ...contract.accept(connect("p1", "g1")),
    ...contract.accept({ op: "runNode", id: "g1" }),
    ...contract.accept(addNode("p2", "textPrompt")),
    ...contract.accept(addNode("g2", "gptImage2")),
    ...contract.accept(connect("p2", "g2")),
    ...contract.accept({ op: "runNode", id: "g2" }),
    ...contract.finish(),
  ];

  assert.deepEqual(
    emitted.map((patch) =>
      patch.op === "addNode" ? `${patch.op}:${patch.node?.id}` : `${patch.op}:${patch.id ?? patch.target}`
    ),
    ["addNode:g1", "addNode:p1", "connectEdge:g1", "runNode:g1"]
  );
  assert.deepEqual(contract.getStats(), {
    acceptedImageNodes: 1,
    suppressedImageNodes: 1,
    suppressedPromptNodes: 1,
  });
});

test("one generator accepts only one connected prompt", () => {
  const contract = new XiaotImagePatchContract(1);
  const emitted = [
    ...contract.accept(addNode("inline", "textPrompt")),
    ...contract.accept(addNode("g1", "generatePro")),
    ...contract.accept(connect("inline", "g1")),
    ...contract.accept(addNode("duplicate", "textPrompt")),
    ...contract.accept(connect("duplicate", "g1")),
    ...contract.finish(),
  ];

  assert.equal(
    emitted.filter((patch) => patch.op === "addNode" && patch.node?.type === "textPrompt").length,
    1
  );
  assert.equal(contract.getStats().suppressedPromptNodes, 1);
});

test("selected multiplier permits the same number of image generators", () => {
  const contract = new XiaotImagePatchContract(2);
  const emitted = [
    ...contract.accept(addNode("g1", "generatePro")),
    ...contract.accept(addNode("g2", "gptImage2")),
    ...contract.accept(addNode("g3", "seedream5")),
  ];

  assert.deepEqual(
    emitted.map((patch) => patch.node?.id),
    ["g1", "g2"]
  );
  assert.deepEqual(contract.getStats(), {
    acceptedImageNodes: 2,
    suppressedImageNodes: 1,
    suppressedPromptNodes: 0,
  });
});

test("an accepted image generator runs at most once", () => {
  const contract = new XiaotImagePatchContract(1);
  const emitted = [
    ...contract.accept(addNode("g1", "gptImage2")),
    ...contract.accept({ op: "runNode", id: "g1" }),
    ...contract.accept({ op: "runNode", id: "g1" }),
  ];

  assert.deepEqual(
    emitted.map((patch) => `${patch.op}:${patch.node?.id ?? patch.id}`),
    ["addNode:g1", "runNode:g1"]
  );
});

test("gptImage2 manifest declares one asynchronous image output", () => {
  const spec = TANVA_CAPABILITY_MANIFEST.nodeSpecs.find(
    (candidate) => candidate.type === "gptImage2"
  );

  assert.ok(spec);
  assert.deepEqual(spec.inputs, [
    { handle: "text", accepts: "text" },
    { handle: "img", accepts: "image" },
  ]);
  assert.deepEqual(spec.outputs, [{ handle: "img", emits: "image" }]);
});
