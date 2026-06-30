import React from "react";
import {
  Boxes,
  Check,
  ChevronDown,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Music,
  Pencil,
  Scissors,
  Search,
  Type,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClickOutside } from "./materialLibraryShared";

// 节点轻量快照（由 FlowOverlay 通过 flow:nodes-snapshot 广播）
export interface NodeSnapshot {
  id: string;
  type: string;
  selected: boolean;
  label?: unknown;
  name?: unknown;
  kind?: unknown;
  imageUrl?: unknown;
  videoUrl?: unknown;
  audioUrl?: unknown;
}

type NodeCategory =
  | "text"
  | "image"
  | "storyboard"
  | "video"
  | "audio"
  | "directorConsole"
  | "group"
  | "other";

const CATEGORY_META: Record<
  NodeCategory,
  { label: string; Icon: LucideIcon }
> = {
  text: { label: "文本", Icon: Type },
  image: { label: "图像", Icon: ImageIcon },
  storyboard: { label: "分镜", Icon: LayoutGrid },
  video: { label: "视频", Icon: Video },
  audio: { label: "音频", Icon: Music },
  directorConsole: { label: "导演台", Icon: Film },
  group: { label: "组", Icon: Boxes },
  other: { label: "其他", Icon: Scissors },
};

const CATEGORY_ORDER: NodeCategory[] = [
  "text",
  "image",
  "storyboard",
  "video",
  "audio",
  "directorConsole",
  "group",
  "other",
];

const hasStr = (v: unknown): boolean =>
  typeof v === "string" && v.trim().length > 0;

function nodeCategory(node: NodeSnapshot): NodeCategory {
  const type = (node.type || "").toLowerCase();
  if (type === "groupnode" || type === "group") return "group";
  const kind = (hasStr(node.kind) ? (node.kind as string) : type)
    .trim()
    .toLowerCase();
  if (kind === "group") return "group";
  if (kind === "text" || type.includes("text")) return "text";
  if (
    kind === "video" ||
    kind === "videocompose" ||
    kind === "composevideo" ||
    type.includes("video") ||
    hasStr(node.videoUrl)
  )
    return "video";
  if (kind === "audio" || type.includes("audio") || hasStr(node.audioUrl))
    return "audio";
  if (kind === "storyboard" || kind === "novelstoryboard") return "storyboard";
  if (kind === "directorconsole" || type.includes("director"))
    return "directorConsole";
  if (
    kind === "image" ||
    kind === "imageedit" ||
    type === "image" ||
    hasStr(node.imageUrl)
  )
    return "image";
  return "other";
}

function nodeLabel(node: NodeSnapshot): string {
  return (
    (hasStr(node.label) && (node.label as string).trim()) ||
    (hasStr(node.name) && (node.name as string).trim()) ||
    node.type ||
    "未命名节点"
  );
}

export default function CanvasNodeTab() {
  const [nodes, setNodes] = React.useState<NodeSnapshot[]>([]);
  const [query, setQuery] = React.useState("");
  const [catFilter, setCatFilter] = React.useState<NodeCategory | "all">("all");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const filterRef = useClickOutside<HTMLDivElement>(
    () => setFilterOpen(false),
    filterOpen
  );

  // 订阅快照 + 打开时主动索取一次
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && Array.isArray(detail.nodes)) setNodes(detail.nodes);
    };
    window.addEventListener("flow:nodes-snapshot", handler as EventListener);
    try {
      window.dispatchEvent(new CustomEvent("flow:request-nodes-snapshot"));
    } catch {
      /* ignore */
    }
    return () =>
      window.removeEventListener(
        "flow:nodes-snapshot",
        handler as EventListener
      );
  }, []);

  const categoriesPresent = React.useMemo(() => {
    const counts = new Map<NodeCategory, number>();
    nodes.forEach((n) => {
      const c = nodeCategory(n);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return CATEGORY_ORDER.filter((k) => counts.has(k)).map((k) => ({
      key: k,
      count: counts.get(k) ?? 0,
    }));
  }, [nodes]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      if (catFilter !== "all" && nodeCategory(n) !== catFilter) return false;
      if (!q) return true;
      return (
        nodeLabel(n).toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q)
      );
    });
  }, [nodes, query, catFilter]);

  const focusNode = React.useCallback((id: string) => {
    try {
      window.dispatchEvent(
        new CustomEvent("flow:focus-node", { detail: { id } })
      );
    } catch {
      /* ignore */
    }
  }, []);

  // 节点命名：写入 data.label（经 flow:updateNodeData 合并 + 协作广播 + 落库）
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const editInputRef = React.useRef<HTMLInputElement>(null);

  const startRename = React.useCallback((node: NodeSnapshot) => {
    setEditingId(node.id);
    setEditValue(nodeLabel(node));
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 30);
  }, []);

  const commitRename = React.useCallback(() => {
    const id = editingId;
    if (!id) return;
    const name = editValue.trim();
    setEditingId(null);
    if (!name) return;
    // 乐观更新本地列表，避免等待快照回流
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, label: name } : n))
    );
    try {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { label: name } },
        })
      );
    } catch {
      /* ignore */
    }
  }, [editingId, editValue]);

  const filterLabel =
    catFilter === "all" ? "全部" : CATEGORY_META[catFilter]?.label ?? "全部";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between px-3.5 pb-2 pt-1">
        <span className="text-xs font-semibold text-gray-400">画布元素</span>
        <div className="relative" ref={filterRef}>
          <button
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            onClick={() => setFilterOpen((v) => !v)}
          >
            {filterLabel}
            <ChevronDown size={12} />
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full z-[1200] mt-1 w-36 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  setCatFilter("all");
                  setFilterOpen(false);
                }}
              >
                <Check
                  size={13}
                  className={catFilter === "all" ? "opacity-100" : "opacity-0"}
                />
                <span className="flex-1">全部</span>
                <span className="text-gray-400">{nodes.length}</span>
              </button>
              {categoriesPresent.map(({ key, count }) => (
                <button
                  key={key}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                  onClick={() => {
                    setCatFilter(key);
                    setFilterOpen(false);
                  }}
                >
                  <Check
                    size={13}
                    className={catFilter === key ? "opacity-100" : "opacity-0"}
                  />
                  <span className="flex-1">{CATEGORY_META[key].label}</span>
                  <span className="text-gray-400">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 pb-2">
        <div className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5">
          <Search size={13} className="text-gray-400" />
          <input
            className="w-full bg-transparent text-xs outline-none placeholder:text-gray-400"
            placeholder="搜索节点"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="text-gray-400 hover:text-gray-600"
              onClick={() => setQuery("")}
              aria-label="清除"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <div className="px-3.5 py-3 text-xs text-gray-400">
            {nodes.length === 0 ? "画布暂无节点" : "无匹配节点"}
          </div>
        ) : (
          filtered.map((n) => {
            const Meta = CATEGORY_META[nodeCategory(n)];
            const Icon = Meta?.Icon || Scissors;
            const editing = editingId === n.id;
            return (
              <div
                key={n.id}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                  editing ? "cursor-default" : "cursor-pointer",
                  n.selected
                    ? "bg-gray-900/[0.08]"
                    : "hover:bg-gray-900/[0.04]"
                )}
                onClick={() => !editing && focusNode(n.id)}
                onDoubleClick={() => startRename(n)}
                title={editing ? undefined : nodeLabel(n)}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-500">
                  <Icon size={14} />
                </span>
                {editing ? (
                  <input
                    ref={editInputRef}
                    className="flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-gray-500"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <span className="flex-1 truncate text-xs text-gray-700">
                      {nodeLabel(n)}
                    </span>
                    <button
                      className="shrink-0 rounded p-1 text-gray-400 opacity-0 hover:bg-gray-200/70 hover:text-gray-700 group-hover:opacity-100"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(n);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Count */}
      <div className="shrink-0 border-t border-gray-100 px-3.5 py-2 text-xs text-gray-400">
        共 {nodes.length} 节点
      </div>
    </div>
  );
}
