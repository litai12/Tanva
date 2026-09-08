import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryReviewEvidenceCatalog, buildDeliveryCandidateReviewPrompt } from "./candidate-review.js";

test("host continuation input reaches final review as source, never as an execution or asset receipt", () => {
  const providedContext = '<host_tool_results>[{"name":"query_canvas","result":{"nodes":[{"id":"n-1","data":{"text":"CANARY-actual-source","videoUrl":"https://example.test/claimed.mp4"}}]}}]</host_tool_results>';
  const items = buildDeliveryReviewEvidenceCatalog({ finalResponse: "CANARY-actual-source", providedContext, toolCalls: [] });
  const source = items.find(item => item.evidence.sourceRef === "caller_input");
  assert.equal(source?.evidence.kind, "source");
  assert.equal(source?.facts.disclosedContent, providedContext);
  assert.equal(source?.evidence.attributes.executionSideEffect, "none");
  assert.equal(items.some(item => ["artifact", "persisted_state", "tool_call"].includes(item.evidence.kind)), false);
  const prompt = buildDeliveryCandidateReviewPrompt({
    contract: { version: 2, contractHash: "contract", delivery: { mode: "response", mediaType: null }, must: [{ id: "read-node", statement: "Return the node text" }], forbid: [], prefer: [] } as never,
    evidenceCatalog: items,
  });
  assert.ok(prompt.includes(JSON.stringify(providedContext)));
  assert.match(prompt, /caller_input/);
  assert.match(prompt, /never proof of an executed mutation/);
  const repeated = buildDeliveryReviewEvidenceCatalog({ finalResponse: "other candidate", providedContext, toolCalls: [] });
  assert.equal(repeated.find(item => item.evidence.sourceRef === "caller_input")?.evidence.evidenceId, source?.evidence.evidenceId);
});
