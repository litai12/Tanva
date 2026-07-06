import React from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Folder as FolderIcon,
  FolderPlus,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SmartImage from "../ui/SmartImage";
import {
  getAssetImageUrl,
  type MaterialAssetDto,
  type MaterialFolderDto,
} from "@/services/materialLibraryApi";
import { FOLDER_DEFS, useClickOutside } from "./materialLibraryShared";

const PAGE_SIZE = 24;

type NavItem = {
  id: string;
  label: string;
  count: number;
  match: (a: MaterialAssetDto) => boolean;
  folder?: MaterialFolderDto;
};

export type MaterialLibraryModalProps = {
  open: boolean;
  onClose: () => void;
  assets: MaterialAssetDto[];
  folders: MaterialFolderDto[];
  loading: boolean;
  tab: "personal" | "team";
  onTabChange: (t: "personal" | "team") => void;
  showTeamTab: boolean;
  uploading?: boolean;
  onApply: (a: MaterialAssetDto) => void;
  onRename: (a: MaterialAssetDto) => void;
  onMove: (a: MaterialAssetDto) => void;
  onCopy: (a: MaterialAssetDto) => void;
  onDelete: (a: MaterialAssetDto) => void;
  onToggleFavorite: (a: MaterialAssetDto) => void;
  onDeleteFolder: (folder: MaterialFolderDto) => void;
  onUploadClick: () => void;
  onNewFolderClick: () => void;
  onRefresh: () => void;
  onPreview: (url: string) => void;
};

// ── grid card ────────────────────────────────────────────────────────────────

function ModalAssetCard({
  asset,
  onApply,
  onRename,
  onMove,
  onCopy,
  onDelete,
  onToggleFavorite,
  onPreview,
}: {
  asset: MaterialAssetDto;
  onApply: (a: MaterialAssetDto) => void;
  onRename: (a: MaterialAssetDto) => void;
  onMove: (a: MaterialAssetDto) => void;
  onCopy: (a: MaterialAssetDto) => void;
  onDelete: (a: MaterialAssetDto) => void;
  onToggleFavorite: (a: MaterialAssetDto) => void;
  onPreview: (url: string) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = useClickOutside<HTMLDivElement>(
    () => setMenuOpen(false),
    menuOpen
  );
  const imageUrl = getAssetImageUrl(asset);
  const showOverlay = hovered || menuOpen;
  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100";

  return (
    <div
      className="relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
      style={{ cursor: imageUrl ? "zoom-in" : "default" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => imageUrl && onPreview(imageUrl)}
    >
      {imageUrl ? (
        <SmartImage
          src={imageUrl}
          alt={asset.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon size={26} className="text-gray-300" />
        </div>
      )}

      {asset.favorite && (
        <div className="absolute left-1.5 top-1.5">
          <Star size={16} className="text-amber-400" fill="#fbbf24" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-4">
        <div className="truncate text-xs text-white">{asset.name}</div>
      </div>

      {showOverlay && (
        <div className="absolute inset-0 flex flex-col justify-between bg-black/30 p-1.5">
          <div className="flex justify-end" ref={menuRef}>
            <div className="relative">
              <button
                className="flex h-6 w-6 items-center justify-center rounded bg-gray-900/80 text-white hover:bg-gray-900"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
              >
                <MoreHorizontal size={15} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full z-[2200] mt-1 w-32 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className={item}
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleFavorite(asset);
                    }}
                  >
                    <Star
                      size={13}
                      className={asset.favorite ? "text-amber-400" : ""}
                      fill={asset.favorite ? "#fbbf24" : "none"}
                    />
                    {asset.favorite ? "取消收藏" : "收藏"}
                  </button>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    className={item}
                    onClick={() => {
                      setMenuOpen(false);
                      onRename(asset);
                    }}
                  >
                    <Pencil size={13} /> 重命名
                  </button>
                  <button
                    className={item}
                    onClick={() => {
                      setMenuOpen(false);
                      onMove(asset);
                    }}
                  >
                    <FolderIcon size={13} /> 移动到...
                  </button>
                  <button
                    className={item}
                    onClick={() => {
                      setMenuOpen(false);
                      onCopy(asset);
                    }}
                  >
                    <Copy size={13} /> 创建副本
                  </button>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    className={cn(item, "text-red-600 hover:bg-red-50")}
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete(asset);
                    }}
                  >
                    <Trash2 size={13} /> 删除
                  </button>
                </div>
              )}
            </div>
          </div>
          <button
            className="w-full rounded-md bg-white py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-100"
            onClick={(e) => {
              e.stopPropagation();
              onApply(asset);
            }}
          >
            应用到画布
          </button>
        </div>
      )}
    </div>
  );
}

// ── modal ──────────────────────────────────────────────────────────────────────

export default function MaterialLibraryModal(props: MaterialLibraryModalProps) {
  const {
    open,
    onClose,
    assets,
    folders,
    loading,
    tab,
    onTabChange,
    showTeamTab,
    uploading,
    onDeleteFolder,
    onUploadClick,
    onNewFolderClick,
    onRefresh,
  } = props;

  const [selectedNav, setSelectedNav] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [folderMenuId, setFolderMenuId] = React.useState<string | null>(null);
  const folderMenuRef = useClickOutside<HTMLDivElement>(
    () => setFolderMenuId(null),
    folderMenuId !== null
  );

  const navItems = React.useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { id: "all", label: "全部素材", count: assets.length, match: () => true },
      {
        id: "fav",
        label: "收藏",
        count: assets.filter((a) => a.favorite).length,
        match: (a) => !!a.favorite,
      },
    ];
    for (const def of FOLDER_DEFS) {
      items.push({
        id: `kind:${def.kind}`,
        label: def.label,
        count: assets.filter((a) => a.kind === def.kind && !a.folderId).length,
        match: (a) => a.kind === def.kind && !a.folderId,
      });
    }
    for (const folder of folders) {
      items.push({
        id: `folder:${folder.id}`,
        label: folder.name,
        count: assets.filter((a) => a.folderId === folder.id).length,
        match: (a) => a.folderId === folder.id,
        folder,
      });
    }
    return items;
  }, [assets, folders]);

  const activeNav = navItems.find((n) => n.id === selectedNav) ?? navItems[0];

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => activeNav.match(a))
      .filter((a) => (q ? a.name.toLowerCase().includes(q) : true));
  }, [assets, activeNav, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE);

  React.useEffect(() => setPage(0), [selectedNav, query, tab]);
  React.useEffect(() => {
    if (!navItems.some((n) => n.id === selectedNav)) setSelectedNav("all");
  }, [navItems, selectedNav]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1900] flex items-center justify-center bg-black/45"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        style={{ width: "min(1180px, 94vw)", height: "min(800px, 90vh)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3">
          <ImageIcon size={18} className="text-gray-500" />
          <span className="flex-1 text-sm font-semibold text-gray-900">素材库</span>
          <button
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left nav */}
          <div className="flex w-52 shrink-0 flex-col border-r border-gray-100">
            {showTeamTab && (
              <div className="px-3 pb-1.5 pt-2.5">
                <div className="flex rounded-lg bg-gray-100 p-0.5">
                  {(["personal", "team"] as const).map((t) => (
                    <button
                      key={t}
                      className={cn(
                        "flex-1 rounded-md py-1 text-xs font-medium transition-colors",
                        tab === t
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      )}
                      onClick={() => onTabChange(t)}
                    >
                      {t === "personal" ? "个人" : "团队"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {navItems.map((nav) => {
                const active = nav.id === activeNav.id;
                const isFav = nav.id === "fav";
                return (
                  <div
                    key={nav.id}
                    onClick={() => setSelectedNav(nav.id)}
                    className={cn(
                      "mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5",
                      active ? "bg-gray-900/[0.08]" : "hover:bg-gray-900/[0.04]"
                    )}
                  >
                    {isFav ? (
                      <Star
                        size={16}
                        className="shrink-0 text-amber-400"
                        fill={active ? "#fbbf24" : "none"}
                      />
                    ) : (
                      <FolderIcon size={16} className="shrink-0 text-gray-400" />
                    )}
                    <span
                      className={cn(
                        "flex-1 truncate text-sm text-gray-700",
                        active && "font-semibold"
                      )}
                    >
                      {nav.label}
                    </span>
                    <span className="text-xs text-gray-400">{nav.count}</span>
                    {nav.folder && (
                      <div
                        className="relative"
                        ref={
                          folderMenuId === nav.folder.id
                            ? folderMenuRef
                            : undefined
                        }
                      >
                        <button
                          className="flex h-[18px] w-[18px] items-center justify-center rounded text-gray-400 hover:bg-gray-200/70"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderMenuId((id) =>
                              id === nav.folder!.id ? null : nav.folder!.id
                            );
                          }}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                        {folderMenuId === nav.folder.id && (
                          <div
                            className="absolute right-0 top-full z-[2200] mt-1 w-28 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
                              onClick={() => {
                                setFolderMenuId(null);
                                onDeleteFolder(nav.folder!);
                              }}
                            >
                              <Trash2 size={13} /> 删除文件夹
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-100 p-3">
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
                onClick={onNewFolderClick}
              >
                <FolderPlus size={14} /> 新建文件夹
              </button>
            </div>
          </div>

          {/* Right content */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Toolbar */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex w-72 items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5">
                <Search size={13} className="text-gray-400" />
                <input
                  className="w-full bg-transparent text-xs outline-none placeholder:text-gray-400"
                  placeholder="搜索素材名称"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-xs text-gray-400">
                  {rangeStart}-{rangeEnd} / {filtered.length}
                </span>
                <button
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                  disabled={safePage <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="上一页"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  aria-label="下一页"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                  disabled={uploading}
                  onClick={onUploadClick}
                  title="上传素材"
                >
                  <Upload size={16} />
                </button>
                <button
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                  onClick={onRefresh}
                  title="刷新"
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            {/* Grid */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {loading && filtered.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  加载中…
                </div>
              ) : pageItems.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  {query.trim() ? "无匹配素材" : "该文件夹暂无素材"}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {pageItems.map((asset) => (
                    <ModalAssetCard
                      key={asset.id}
                      asset={asset}
                      onApply={props.onApply}
                      onRename={props.onRename}
                      onMove={props.onMove}
                      onCopy={props.onCopy}
                      onDelete={props.onDelete}
                      onToggleFavorite={props.onToggleFavorite}
                      onPreview={props.onPreview}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
