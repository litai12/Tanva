import { expect, it } from "vitest";
import { registerPendingAsyncContinuation, assertSuspendedContinuationOwnership, recordAsyncContinuationRegistrationDiagnostic } from "./public-agents-chat";

import { buildAgentsChatResponseFromTaskResult } from "../apiKey/public-agents-chat-response";
import { isOpenAiDurableContinuationPending } from "./public-openai-compat";

for (const runNodeCount of [0, 1]) {
  it(`registers a waiting_external host handoff with ${runNodeCount} runNode commands`, async () => {
    const identity = { logicalTaskId: "root-1", taskNodeId: "task-1", taskRevision: 4, reasonCode: "host_execution_required" };
    const result = { id: "root-1", kind: "chat", status: "succeeded", assets: [], raw: { text: "", meta: {
      requestTerminal: { version: 1, terminal: true, status: "suspended", reason: "host_execution_required" },
      logicalTaskState: { version: 1, ...identity, status: "waiting_external", physicalRunStatus: "handed_off", deliveryStatus: "pending", updatedAt: "2026-09-08T05:00:00.000Z", continuationTicket: null },
      hostExecutionHandoff: { version: 1, owner: "external_host", host: "tanva", protocolVersion: "1", commandCount: 1, runNodeCount, commandToolCallIds: ["command-1"] },
      runtime: { profile: "general", registeredToolNames: ["host_tool"], registeredTeamToolNames: [], requiredSkills: [], loadedSkills: [], allowedSubagentTypes: [], requireAgentsTeamExecution: false, physicalRunExit: { version: 1, kind: "waiting_external", ...identity, taskStatus: "waiting_for_evidence",
        continuationTicket: { version: 1, ...identity, ticketId: "ticket-1", nextTrigger: "external_evidence", resumeFromStatus: "waiting_for_evidence" },
      } },
    } } };
    // No DB or executor stub: a valid host handoff must return ownership before
    // attempting to enqueue another server-side physical continuation.
    const registration = await registerPendingAsyncContinuation({
      c: {} as never, userId: "owner-1", rootRequestId: "root-1",
      requestInput: {} as never, taskRequest: {} as never, result: result as never,
    });
    expect(registration).toMatchObject({ status: "external_handoff", effectOwner: "host_execution", ownership: { ticketId: "ticket-1", runNodeCount } });
    recordAsyncContinuationRegistrationDiagnostic(result as never, registration);
    const response = buildAgentsChatResponseFromTaskResult(result as never, { publicTurnId: "root-1" });
    expect(response.trace?.traceProjection?.status).not.toBe("failed");
    expect(response.trace?.continuationRegistration).toMatchObject({ status: "external_handoff", commandCount: 1, runNodeCount });
    expect(isOpenAiDurableContinuationPending({ logicalTaskStatus: "waiting_external", continuationRegistration: response.trace?.continuationRegistration })).toBe(false);
    expect(() => assertSuspendedContinuationOwnership({ result: result as never, registration })).not.toThrow();
  });
}
