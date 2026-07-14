import type { Node } from "reactflow";

// 「一键整理」触发事件：FloatingHeader 里的按钮 dispatch，FlowOverlay 里监听执行。
export const FLOW_AUTO_LAYOUT_EVENT = "flow:auto-layout";

type XY = { x: number; y: number };
type Size = { w: number; h: number };

// 节点尺寸读取器（由调用方注入，复用 FlowOverlay 的 getNodeRenderSize）。
export type NodeSizeGetter = (node: Node) => Size;

export interface TidyLayoutOptions {
  getSize: NodeSizeGetter;
  // 被协作端锁定的节点：锁定的整理单元（含其组成员）整体不动，
  // 与拖拽路径「锁定节点本地也不产生位移」的语义一致。
  lockedIds?: ReadonlySet<string>;
  colGap?: number;
  rowGap?: number;
}

// 「按类别分列」整理，对齐 TapCanvas tidyByCategory 的交互语义：
// 列从左到右按 TIDY_CATEGORY_ORDER 排布，同类节点归为一列。
// 类别口径与节点面板分组一致（FlowOverlay 的 NODE_PANEL_GROUP_BY_TYPE，
// 因避免循环依赖无法直接导入，两表须保持同步）。
export type TidyCategory = "text" | "image" | "three" | "video" | "audio";

export const TIDY_CATEGORY_ORDER: TidyCategory[] = [
  "text",
  "image",
  "three",
  "video",
  "audio",
];

// node.type → 类别。未列出的 type（幽灵节点/未知类型）不参与整理，原地不动。
const TYPE_CATEGORY: Record<string, TidyCategory> = {
  // 文本
  textPrompt: "text",
  textPromptPro: "text",
  textChat: "text",
  htmlPpt: "text",
  promptOptimize: "text",
  textNote: "text",
  storyboardSplit: "text",
  // 图片
  image: "image",
  imagePro: "image",
  camera: "image",
  generate: "image",
  generateRef: "image",
  viewAngle: "image",
  generate4: "image",
  generatePro: "image",
  generatePro4: "image",
  midjourneyV7: "image",
  niji7: "image",
  nano2: "image",
  gptImage2: "image",
  seedream5: "image",
  analysis: "image",
  imageGrid: "image",
  imageSplit: "image",
  imageCompress: "image",
  // 3D
  three: "three",
  threePathTracer: "three",
  seed3d: "three",
  directorConsole: "three",
  // 视频
  video: "video",
  videoCompose: "video",
  sora2Video: "video",
  sora2Character: "video",
  wan26: "video",
  wan2R2V: "video",
  happyhorseR2V: "video",
  wan27Video: "video",
  omniFlashExtVideo: "video",
  klingVideo: "video",
  kling26Video: "video",
  kling30Video: "video",
  klingO1Video: "video",
  viduVideo: "video",
  viduQ3: "video",
  doubaoVideo: "video",
  seedance20Video: "video",
  seedVideo: "video",
  videoAnalyze: "video",
  videoFrameExtract: "video",
  videoToGif: "video",
  volcEnhanceVideo: "video",
  // 音频（含旧画布可能残留的历史 type）
  audioStudio: "audio",
  audioUpload: "audio",
  minimaxSpeech: "audio",
  tencentSpeech: "audio",
  minimaxMusic: "audio",
};

const GROUP_NODE_TYPE = "nodeGroup";

// 图片/视频节点通常数量多且尺寸相近，列内按网格换行避免单列过长；
// 其余类别保持竖排单列。
const GRID_CATEGORIES: ReadonlySet<TidyCategory> = new Set(["image", "video"]);
const MAX_PER_ROW = 3;
const ITEM_GAP = 24;

function getNodeParentId(node: Node): string | null {
  const anyNode = node as { parentId?: unknown; parentNode?: unknown };
  const raw =
    typeof anyNode.parentId === "string"
      ? anyNode.parentId
      : typeof anyNode.parentNode === "string"
        ? anyNode.parentNode
        : "";
  const trimmed = raw.trim();
  return trimmed || null;
}

// Tanva 组模型：成员记录在 nodeGroup.data.childNodeIds（打组时会清掉 parentNode），
// 成员坐标是画布绝对坐标，组移动时由拖拽逻辑给成员加同样的 delta。
function getGroupChildIds(node: Node): string[] {
  const raw = (node.data as { childNodeIds?: unknown } | undefined)
    ?.childNodeIds;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.filter((id): id is string => typeof id === "string" && !!id))
  );
}

// 组容器类别 = 组内成员出现最多的类别；平票按 TIDY_CATEGORY_ORDER 取靠前者。
function majorityCategory(members: Node[]): TidyCategory | null {
  const counts = new Map<TidyCategory, number>();
  for (const m of members) {
    const cat = TYPE_CATEGORY[String(m.type ?? "")];
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  let best: TidyCategory | null = null;
  let bestCount = 0;
  for (const cat of TIDY_CATEGORY_ORDER) {
    const c = counts.get(cat) ?? 0;
    if (c > bestCount) {
      best = cat;
      bestCount = c;
    }
  }
  return best;
}

// 计算「按类别分列」后的新坐标。传入全量节点（组成员用于给组定类别并随组平移）。
// 返回值含：整理单元（组容器 + 未入组根节点）的目标位置，以及组成员按组 delta
// 平移后的位置（成员坐标是绝对坐标，不随组自动跟随，须显式平移；带 parentId 的
// 旧数据成员是相对坐标、会随父自动移动，不在返回值里）。
// 以整理单元原包围盒左上角 (minX, minY) 为锚点，整理后整体不远离原位。
export function computeTidyByCategoryLayout(
  allNodes: Node[],
  options: TidyLayoutOptions
): Map<string, XY> {
  const colGap = options.colGap ?? 120;
  const rowGap = options.rowGap ?? 40;
  const getSize = options.getSize;
  const lockedIds = options.lockedIds;
  const isLocked = (id: string): boolean => !!lockedIds?.has(id);
  const positions = new Map<string, XY>();
  if (!allNodes.length) return positions;

  const nodeIds = new Set(allNodes.map((n) => n.id));
  const nodeById = new Map(allNodes.map((n) => [n.id, n] as const));

  // 组成员归属（childNodeIds 模型；成员被多个组引用时首个组胜出）。
  const memberToGroup = new Map<string, string>();
  const membersByGroup = new Map<string, Node[]>();
  for (const n of allNodes) {
    if (n.type !== GROUP_NODE_TYPE) continue;
    const members: Node[] = [];
    for (const cid of getGroupChildIds(n)) {
      if (memberToGroup.has(cid)) continue;
      const child = nodeById.get(cid);
      if (!child || child.type === GROUP_NODE_TYPE) continue;
      memberToGroup.set(cid, n.id);
      members.push(child);
    }
    membersByGroup.set(n.id, members);
  }

  // 整理单元：组容器，或「未入组根节点」（不是任何组的成员，且无 parent /
  // parent 指向已不存在的幽灵组）。锁定单元整体不参与整理；组容器或任一成员
  // 被锁都视为整组锁定，避免组被拆开（容器动了、被锁成员留在原地）。
  const isGroupLocked = (groupId: string): boolean => {
    if (isLocked(groupId)) return true;
    return (membersByGroup.get(groupId) ?? []).some((m) => isLocked(m.id));
  };
  const isUnit = (n: Node): boolean => {
    if (n.type === GROUP_NODE_TYPE) return true;
    if (memberToGroup.has(n.id)) return false;
    const pid = getNodeParentId(n);
    return !pid || !nodeIds.has(pid);
  };

  const categoryOfUnit = (n: Node): TidyCategory | null => {
    if (n.type === GROUP_NODE_TYPE)
      return majorityCategory(membersByGroup.get(n.id) ?? []);
    return TYPE_CATEGORY[String(n.type ?? "")] ?? null;
  };

  const units: Array<{ node: Node; category: TidyCategory }> = [];
  for (const n of allNodes) {
    if (!isUnit(n)) continue;
    if (n.type === GROUP_NODE_TYPE ? isGroupLocked(n.id) : isLocked(n.id))
      continue;
    const category = categoryOfUnit(n);
    if (!category) continue;
    units.push({ node: n, category });
  }
  if (!units.length) return positions;

  const posX = (n: Node): number => Number(n.position?.x ?? 0) || 0;
  const posY = (n: Node): number => Number(n.position?.y ?? 0) || 0;

  const anchorX = Math.min(...units.map((u) => posX(u.node)));
  const anchorY = Math.min(...units.map((u) => posY(u.node)));

  const buckets = new Map<TidyCategory, Node[]>();
  for (const u of units) {
    const list = buckets.get(u.category);
    if (list) list.push(u.node);
    else buckets.set(u.category, [u.node]);
  }

  let colX = anchorX;
  for (const cat of TIDY_CATEGORY_ORDER) {
    const col = buckets.get(cat);
    if (!col || !col.length) continue;
    // 列内保持当前视觉顺序（先 y 后 x），同位置按 id 兜底保证确定性。
    col.sort(
      (a, b) =>
        posY(a) - posY(b) || posX(a) - posX(b) || a.id.localeCompare(b.id)
    );

    const maxPerRow = GRID_CATEGORIES.has(cat) ? MAX_PER_ROW : 1;
    let y = anchorY;
    let rowX = colX;
    let rowMaxH = 0;
    let inRow = 0;
    let colWidth = 0;
    for (const n of col) {
      const { w, h } = getSize(n);
      if (inRow >= maxPerRow) {
        y += rowMaxH + rowGap;
        rowX = colX;
        rowMaxH = 0;
        inRow = 0;
      }
      positions.set(n.id, { x: rowX, y });
      rowX += w + ITEM_GAP;
      if (h > rowMaxH) rowMaxH = h;
      inRow += 1;
      const rowWidth = rowX - ITEM_GAP - colX;
      if (rowWidth > colWidth) colWidth = rowWidth;
    }
    colX += colWidth + colGap;
  }

  // 组成员随组平移（绝对坐标 + 同 delta，与组拖拽逻辑一致；含折叠组的隐藏成员，
  // 保证展开后相对位置不变）。含锁定成员的组在 units 阶段已整组跳过，不会到这里。
  for (const [groupId, members] of membersByGroup) {
    const target = positions.get(groupId);
    if (!target) continue;
    const group = nodeById.get(groupId)!;
    const dx = target.x - posX(group);
    const dy = target.y - posY(group);
    if (!dx && !dy) continue;
    for (const m of members) {
      if (getNodeParentId(m)) continue; // 相对坐标的旧数据成员随父自动移动
      positions.set(m.id, { x: posX(m) + dx, y: posY(m) + dy });
    }
  }

  return positions;
}
