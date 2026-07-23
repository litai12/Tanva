import {
  IMAGE_GEN_NODE_TYPES,
  type AgentFlowPatch,
} from "./agentCanvasProtocol.ts";

export type XiaotImagePatchContractStats = {
  acceptedImageNodes: number;
  suppressedImageNodes: number;
  suppressedPromptNodes: number;
};

/**
 * Enforces the host-selected image multiplier on XiaoT canvas patches.
 * Text prompts are held until their target is known so prompts belonging to
 * rejected image generators never become orphan nodes on the canvas.
 */
export class XiaotImagePatchContract {
  private readonly acceptedImageIds = new Set<string>();
  private readonly rejectedImageIds = new Set<string>();
  private readonly rejectedPromptIds = new Set<string>();
  private readonly pendingPrompts = new Map<string, AgentFlowPatch>();
  private readonly imagePromptIds = new Map<string, string>();
  private readonly runImageIds = new Set<string>();
  private readonly imageOutputCount: number;
  private suppressedImageNodes = 0;
  private suppressedPromptNodes = 0;

  constructor(imageOutputCount: number) {
    this.imageOutputCount = Math.min(8, Math.max(1, Math.floor(imageOutputCount)));
  }

  accept(patch: AgentFlowPatch): AgentFlowPatch[] {
    if (patch.op === "addNode" && patch.node) {
      if (patch.node.type === "textPrompt") {
        this.pendingPrompts.set(patch.node.id, patch);
        return [];
      }

      if (IMAGE_GEN_NODE_TYPES.has(patch.node.type)) {
        if (this.acceptedImageIds.size >= this.imageOutputCount) {
          this.rejectedImageIds.add(patch.node.id);
          this.suppressedImageNodes += 1;
          return [];
        }
        this.acceptedImageIds.add(patch.node.id);
      }
      return [patch];
    }

    if (patch.op === "connectEdge" && patch.source && patch.target) {
      if (
        this.rejectedImageIds.has(patch.source) ||
        this.rejectedImageIds.has(patch.target) ||
        this.rejectedPromptIds.has(patch.source)
      ) {
        this.rejectPendingPrompt(patch.source);
        return [];
      }

      const pendingPrompt = this.pendingPrompts.get(patch.source);
      if (this.acceptedImageIds.has(patch.target)) {
        const currentPromptId = this.imagePromptIds.get(patch.target);
        if (currentPromptId && currentPromptId !== patch.source) {
          this.rejectPendingPrompt(patch.source);
          return [];
        }
        this.imagePromptIds.set(patch.target, patch.source);
        if (pendingPrompt) {
          this.pendingPrompts.delete(patch.source);
          return [pendingPrompt, patch];
        }
      }

      if (pendingPrompt) {
        this.pendingPrompts.delete(patch.source);
        return [pendingPrompt, patch];
      }
      return [patch];
    }

    if (patch.id) {
      if (
        this.rejectedImageIds.has(patch.id) ||
        this.rejectedPromptIds.has(patch.id)
      ) {
        return [];
      }
      const pendingPrompt = this.pendingPrompts.get(patch.id);
      if (pendingPrompt) {
        this.pendingPrompts.delete(patch.id);
        return [pendingPrompt, patch];
      }
      if (patch.op === "runNode" && this.acceptedImageIds.has(patch.id)) {
        if (this.runImageIds.has(patch.id)) return [];
        this.runImageIds.add(patch.id);
      }
    }

    return [patch];
  }

  finish(): AgentFlowPatch[] {
    const remaining = Array.from(this.pendingPrompts.values());
    this.pendingPrompts.clear();

    // When image generators were rejected, unconnected prompts are part of the
    // same over-produced workflow. Do not leave them behind as orphan nodes.
    if (this.suppressedImageNodes > 0) {
      this.suppressedPromptNodes += remaining.length;
      return [];
    }

    return remaining;
  }

  getAcceptedImageIds(): string[] {
    return Array.from(this.acceptedImageIds);
  }

  getStats(): XiaotImagePatchContractStats {
    return {
      acceptedImageNodes: this.acceptedImageIds.size,
      suppressedImageNodes: this.suppressedImageNodes,
      suppressedPromptNodes: this.suppressedPromptNodes,
    };
  }

  private rejectPendingPrompt(id: string): void {
    if (!this.pendingPrompts.delete(id)) return;
    this.rejectedPromptIds.add(id);
    this.suppressedPromptNodes += 1;
  }
}
