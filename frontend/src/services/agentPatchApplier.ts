// frontend/src/services/agentPatchApplier.ts
// 把小T下发的 flow_patch 翻译成画布 window 事件桥。乐观应用，失败仅 toast。
// 事件接线（FlowOverlay 侧监听）：
//   flow:agent-add-node / flow:agent-connect-edge / flow:agent-run-node（本文件新增约定）
//   flow:updateNodeData / flow:focus-node / triggerQuickImageUpload（画布既有事件，直接复用）
import {
  parseAgentFlowPatch,
  NODE_FORCED_DATA,
  NODE_DEFAULT_DATA,
} from "./agentCanvasProtocol";

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

// 串行执行队列：op 与 op 之间必须让出一次 React 提交渲染。
// 原因：FlowOverlay 用 useNodesState，addNode 的 setNodes 要等重渲染后才进
// ReactFlow store；紧跟着的 connectEdge（isValidConnection）与 runNode 都读
// rf.getNodes()，同一 tick 看不到新节点会静默 no-op。且 createNodeAtWorldCenter
// 的节点 id 是 `${type}_${Date.now()}`，同毫秒连建两个同类型节点会撞 id。
// 让步用双 requestAnimationFrame（第一帧排在本次提交之后，第二帧确保渲染已 flush）；
// 无 rAF 环境（如测试）退化为 setTimeout 60ms。
let chain: Promise<void> = Promise.resolve();
let session = 0;

const yieldToRender = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 60);
    }
  });

const enqueue = (task: () => void | Promise<void>): void => {
  const taskSession = session;
  chain = chain
    .then(async () => {
      // 会话已重置（resetAgentPatchSession）则丢弃旧队列中未执行的操作
      if (taskSession !== session) return;
      // task 可返回 promise（如 connectEdge 等监听器连线完成），await 之保证
      // 真正串行化（connect 落地后再推进到 runNode）
      await task();
      await yieldToRender();
    })
    .catch((err) => {
      console.warn("[agentPatchApplier] 队列任务执行失败:", err);
    });
};

export function resetAgentPatchSession(): void {
  idMap.clear();
  session += 1;
  chain = Promise.resolve();
  sessionKey = null;
}

// idMap 生命周期跟随「聊天会话」而非「单轮运行」：小T第 2 轮可能继续引用它
// 第 1 轮自造的 agent 节点 id，若每轮清空 idMap，realId() 回退原样会去操作
// 不存在的节点（静默 no-op）。仅当聊天会话切换时才全清（含丢弃旧队列）。
let sessionKey: string | null = null;

export function ensureAgentPatchSession(key: string): void {
  if (sessionKey === key) return;
  resetAgentPatchSession();
  sessionKey = key;
}

// 把 agent 自造 id 解析成画布真实 id（addNode 落地后经 done 回调登记）；
// 未登记（尚未落地/非本会话）则回退原值。供缺图对账时定位真实节点。
export function resolveAgentNodeId(agentId: string): string {
  return realId(agentId);
}

// 等待当前已入队的所有画布操作执行完（含 addNode 的 done 回调登记 idMap）。
// 缺图对账须在队列 drain 后进行，否则 idMap 尚未填好、节点也未真正落地。
export function flushAgentPatchQueue(): Promise<void> {
  return chain;
}

// 校验同步返回（false = patch 无法识别/缺参），实际画布操作串行入队异步执行。
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
      // 建这些 type 时注入版本/模式 data。合并优先级：
      //   defaults（缺省填充，agent 给了就用 agent 的）
      //   < node.data（小T/用户意图，如 seedanceMode 首尾帧）
      //   < hardForced（版本必须钉死，覆盖一切，防小T给错版本）
      const hardForced = NODE_FORCED_DATA[node.type];
      const defaults = NODE_DEFAULT_DATA[node.type];
      const nodeData =
        hardForced || defaults
          ? { ...(defaults ?? {}), ...(node.data ?? {}), ...(hardForced ?? {}) }
          : node.data;
      enqueue(() => {
        window.dispatchEvent(
          new CustomEvent("flow:agent-add-node", {
            detail: {
              type: node.type,
              data: nodeData,
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
      });
      return true;
    }
    case "updateNodeData": {
      const { id, patch } = p;
      enqueue(() => {
        window.dispatchEvent(
          new CustomEvent("flow:updateNodeData", {
            detail: { id: realId(id!), patch },
          })
        );
      });
      return true;
    }
    case "connectEdge": {
      const { source, target, sourceHandle, targetHandle } = p;
      // FlowOverlay.onAgentConnectEdge 是 async（连线前轮询等 handle ~1.5s）。
      // 用 done 回调让入队任务等到监听器真正连完再推进，避免 connect 还没落地
      // 就跑 runNode。2s 超时兜底防死等（监听器异常/未接线时不卡队列）。
      enqueue(
        () =>
          new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              resolve();
            };
            const timer = window.setTimeout(finish, 2000);
            window.dispatchEvent(
              new CustomEvent("flow:agent-connect-edge", {
                detail: {
                  source: realId(source!),
                  target: realId(target!),
                  sourceHandle: sourceHandle ?? null,
                  targetHandle: targetHandle ?? null,
                  done: finish,
                },
              })
            );
          })
      );
      return true;
    }
    case "focusNode": {
      const { id } = p;
      enqueue(() => {
        window.dispatchEvent(
          new CustomEvent("flow:focus-node", { detail: { id: realId(id!) } })
        );
      });
      return true;
    }
    case "runNode": {
      const { id } = p;
      enqueue(() => {
        window.dispatchEvent(
          new CustomEvent("flow:agent-run-node", { detail: { id: realId(id!) } })
        );
      });
      return true;
    }
    case "placeImage": {
      const url = String(p.url || "").trim();
      if (!url) return false;
      const fileName = (p.name || "agent-image").trim() || "agent-image";
      enqueue(() => {
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
      });
      return true;
    }
    default:
      return false;
  }
}
