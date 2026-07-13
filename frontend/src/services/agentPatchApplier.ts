// frontend/src/services/agentPatchApplier.ts
// 把小T下发的 flow_patch 翻译成画布 window 事件桥。乐观应用，失败仅 toast。
// 事件接线（FlowOverlay 侧监听）：
//   flow:agent-add-node / flow:agent-connect-edge / flow:agent-run-node（本文件新增约定）
//   flow:updateNodeData / flow:focus-node / triggerQuickImageUpload（画布既有事件，直接复用）
import { parseAgentFlowPatch } from "./agentCanvasProtocol";

const toast = (message: string, type: "error" | "warning" | "success" = "error") => {
  try {
    window.dispatchEvent(new CustomEvent("toast", { detail: { message, type } }));
  } catch {
    console.warn("[agentPatchApplier]", message);
  }
};

// agent 侧节点 id → 画布真实节点 id（addNode 成功后登记）
const idMap = new Map<string, string>();
const realId = (id: string): string => idMap.get(id) ?? id;

export function resetAgentPatchSession(): void {
  idMap.clear();
}

export function applyAgentPatch(raw: unknown): boolean {
  const p = parseAgentFlowPatch(raw);
  if (!p) {
    toast("小T下发的画布操作无法识别，已忽略");
    return false;
  }

  switch (p.op) {
    case "addNode": {
      const node = p.node!;
      const agentId = node.id;
      window.dispatchEvent(
        new CustomEvent("flow:agent-add-node", {
          detail: {
            type: node.type,
            data: node.data,
            position: node.position,
            done: (createdId: string | null) => {
              if (createdId) {
                idMap.set(agentId, createdId);
              } else {
                toast(`节点类型不可用：${node.type}`);
              }
            },
          },
        })
      );
      return true;
    }
    case "updateNodeData": {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id: realId(p.id!), patch: p.patch },
        })
      );
      return true;
    }
    case "connectEdge": {
      window.dispatchEvent(
        new CustomEvent("flow:agent-connect-edge", {
          detail: {
            source: realId(p.source!),
            target: realId(p.target!),
            sourceHandle: p.sourceHandle ?? null,
            targetHandle: p.targetHandle ?? null,
          },
        })
      );
      return true;
    }
    case "focusNode": {
      window.dispatchEvent(
        new CustomEvent("flow:focus-node", { detail: { id: realId(p.id!) } })
      );
      return true;
    }
    case "runNode": {
      window.dispatchEvent(
        new CustomEvent("flow:agent-run-node", { detail: { id: realId(p.id!) } })
      );
      return true;
    }
    case "placeImage": {
      const url = String(p.url || "").trim();
      if (!url) return false;
      const fileName = (p.name || "agent-image").trim() || "agent-image";
      // detail 形状照素材库「应用到画布」惯例（MaterialLibraryPanel applyAssetToCanvas）：
      // imageData 传 payload 对象（url/src/remoteUrl），每次全新 placementId 防去重覆盖。
      const placementId = `agent-image-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: {
            imageData: {
              id: placementId,
              url,
              src: url,
              remoteUrl: url,
              fileName,
            },
            fileName,
            operationType: "manual",
          },
        })
      );
      return true;
    }
    default:
      return false;
  }
}
