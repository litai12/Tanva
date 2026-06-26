/**
 * 版本冲突 → 取并集合并（current-user-wins）。
 *
 * 当客户端携带的 baseVersion 落后于服务端当前版本时，不再禁止保存，而是把
 * 远端当前快照与本次提交（incoming = 当前用户）做并集：
 *  - 所有按 id 索引的集合（flow 节点/边、assets、layers、aiChatSessions）按 id 并集；
 *    同 id 冲突时以 incoming（当前用户）为准，remote-only 追加，incoming-only 保留。
 *  - paperJson：按 paper item 的 data.id 做条目级并集；同 id 取 incoming，remote 中
 *    incoming 没有的 id 化条目追加；无 data.id 的手绘矢量以 incoming 为准。
 *  - 标量字段（canvas 视口、activeLayerId、meta、updatedAt）取 incoming。
 *
 * 纯函数，无副作用。任何解析异常都向 incoming 退化，绝不抛错。
 */

type AnyRecord = Record<string, any>;

/** 以 incoming 为基底按 id 并集；同 id incoming 胜，remote-only 追加，无 id 的 remote 项丢弃（current-user-wins）。 */
function unionById<T extends AnyRecord>(
  remote: T[] | undefined | null,
  incoming: T[] | undefined | null,
  idKey = 'id',
): T[] {
  const inc = Array.isArray(incoming) ? incoming : [];
  const rem = Array.isArray(remote) ? remote : [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const it of inc) {
    const id = it?.[idKey];
    if (id != null) seen.add(String(id));
    result.push(it);
  }
  for (const it of rem) {
    const id = it?.[idKey];
    if (id == null) continue; // 无 id 的远端项无法去重 → 让位给当前用户
    if (!seen.has(String(id))) {
      seen.add(String(id));
      result.push(it);
    }
  }
  return result;
}

/** paper exportJSON 节点是否为 [type, props] 这种条目对。 */
function isPair(node: any): node is [string, AnyRecord] {
  return (
    Array.isArray(node) &&
    node.length === 2 &&
    typeof node[0] === 'string' &&
    !!node[1] &&
    typeof node[1] === 'object' &&
    !Array.isArray(node[1])
  );
}

/** 递归收集一棵 paper 树里所有条目的 data.id。 */
function collectPaperItemIds(node: any, into: Set<string>): void {
  if (!Array.isArray(node)) return;
  if (isPair(node)) {
    const props = node[1];
    const id = props?.data?.id;
    if (id != null) into.add(String(id));
    if (Array.isArray(props?.children)) {
      for (const child of props.children) collectPaperItemIds(child, into);
    }
    return;
  }
  for (const item of node) collectPaperItemIds(item, into);
}

/**
 * 收集 remote 树里 incoming 没有的、且自带 data.id 的条目（整棵子树）。
 * - 条目有 data.id 且不在 incoming 集合 → 整条收入，不再下钻；
 * - 条目有 data.id 且已存在 → 下钻其 children 找嵌套的新条目；
 * - 条目无 data.id（通常是 Layer/Group 容器）→ 下钻 children。
 */
function collectRemoteOnlyItems(node: any, incomingIds: Set<string>, out: any[]): void {
  if (!Array.isArray(node)) return;
  if (isPair(node)) {
    const props = node[1];
    const id = props?.data?.id;
    if (id != null) {
      if (!incomingIds.has(String(id))) {
        out.push(node);
        return;
      }
    }
    if (Array.isArray(props?.children)) {
      for (const child of props.children) collectRemoteOnlyItems(child, incomingIds, out);
    }
    return;
  }
  for (const item of node) collectRemoteOnlyItems(item, incomingIds, out);
}

/** 把 remote-only 条目追加进 incoming 树的第一个图层 children。返回是否追加成功。 */
function appendItemsToFirstLayer(incomingTree: any, items: any[]): boolean {
  if (items.length === 0) return false;
  const layers = isPair(incomingTree) ? [incomingTree] : incomingTree;
  if (!Array.isArray(layers)) return false;
  for (const layer of layers) {
    if (isPair(layer)) {
      const props = layer[1];
      if (!Array.isArray(props.children)) props.children = [];
      for (const it of items) props.children.push(it);
      return true;
    }
  }
  return false;
}

/** paperJson 条目级并集：incoming 全保留，remote 中 incoming 没有的 id 化条目追加。解析失败回退 incoming。 */
export function mergePaperJson(
  remoteJson: string | undefined | null,
  incomingJson: string | undefined | null,
): string | undefined {
  // incoming 本次未带绘制层 → 不要用空内容抹掉远端绘制
  if (incomingJson == null || incomingJson === '') return remoteJson ?? incomingJson ?? undefined;
  if (remoteJson == null || remoteJson === '') return incomingJson;
  try {
    const remote = JSON.parse(remoteJson);
    const incoming = JSON.parse(incomingJson);
    const incomingIds = new Set<string>();
    collectPaperItemIds(incoming, incomingIds);
    const remoteOnly: any[] = [];
    collectRemoteOnlyItems(remote, incomingIds, remoteOnly);
    if (remoteOnly.length === 0) return incomingJson;
    appendItemsToFirstLayer(incoming, remoteOnly);
    return JSON.stringify(incoming);
  } catch {
    return incomingJson; // 解析失败 → current-user-wins
  }
}

/** 取两份项目快照的并集，同 id 冲突以 incoming（当前用户）为准。 */
export function mergeProjectSnapshots(remote: any, incoming: any): any {
  // 任一方不可用 → 直接用 incoming（当前用户）
  if (!incoming || typeof incoming !== 'object') return incoming;
  if (!remote || typeof remote !== 'object') return incoming;

  const merged: AnyRecord = { ...incoming };

  if (remote.flow || incoming.flow) {
    const rFlow = remote.flow || {};
    const iFlow = incoming.flow || {};
    merged.flow = {
      ...iFlow,
      nodes: unionById(rFlow.nodes, iFlow.nodes),
      edges: unionById(rFlow.edges, iFlow.edges),
    };
  }

  if (remote.assets || incoming.assets) {
    const rA = remote.assets || {};
    const iA = incoming.assets || {};
    merged.assets = {
      ...iA,
      images: unionById(rA.images, iA.images),
      models: unionById(rA.models, iA.models),
      texts: unionById(rA.texts, iA.texts),
      videos: unionById(rA.videos, iA.videos),
    };
  }

  if (remote.layers || incoming.layers) {
    merged.layers = unionById(remote.layers, incoming.layers);
  }

  if (remote.aiChatSessions || incoming.aiChatSessions) {
    merged.aiChatSessions = unionById(remote.aiChatSessions, incoming.aiChatSessions);
  }

  if (incoming.paperJson !== undefined || remote.paperJson !== undefined) {
    const mergedPaper = mergePaperJson(remote.paperJson, incoming.paperJson);
    if (mergedPaper !== undefined) merged.paperJson = mergedPaper;
  }

  // 标量（canvas 视口 / activeLayerId / meta / updatedAt / aiChatActiveSessionId）已由 {...incoming} 取 incoming
  return merged;
}
