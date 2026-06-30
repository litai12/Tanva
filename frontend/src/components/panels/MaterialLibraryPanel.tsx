import React from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  Copy,
  Folder as FolderIcon,
  FolderPlus,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SmartImage from "../ui/SmartImage";
import ImagePreviewModal from "../ui/ImagePreviewModal";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { useProjectStore } from "@/stores/projectStore";
import { uploadToOSS } from "@/services/ossUploadService";
import {
  createMaterialAsset,
  createMaterialFolder,
  createTeamMaterialAsset,
  deleteMaterialAsset,
  deleteMaterialFolder,
  deleteTeamMaterialAsset,
  getAssetImageUrl,
  listMaterialAssets,
  listMaterialFolders,
  listTeamMaterialAssets,
  updateMaterialAsset,
  updateTeamMaterialAsset,
  type MaterialAssetDto,
  type MaterialFolderDto,
  type MaterialKindDto,
} from "@/services/materialLibraryApi";
import {
  FOLDER_DEFS,
  FolderSelectModal,
  NewFolderModal,
  RenameModal,
  formatDate,
  toast,
  useClickOutside,
} from "./materialLibraryShared";
import MaterialLibraryModal from "./MaterialLibraryModal";

// ── apply asset to canvas (image node) ─────────────────────────────────────────

export function applyAssetToCanvas(asset: MaterialAssetDto): boolean {
  const imageUrl = getAssetImageUrl(asset);
  if (!imageUrl) {
    toast("该素材暂无图片", "error");
    return false;
  }
  const data = (asset.latestVersion?.data ?? {}) as Record<string, unknown>;
  const fileName = `${asset.name}`;
  const payload = {
    id: asset.id,
    url: imageUrl,
    src: imageUrl,
    remoteUrl: imageUrl,
    fileName,
    width: typeof data.width === "number" ? data.width : undefined,
    height: typeof data.height === "number" ? data.height : undefined,
    contentType:
      typeof data.contentType === "string" ? data.contentType : undefined,
  };
  window.dispatchEvent(
    new CustomEvent("triggerQuickImageUpload", {
      detail: { imageData: payload, fileName, operationType: "manual" },
    })
  );
  toast(`已添加「${asset.name}」到画布`, "success");
  return true;
}

// scope-aware mutation helpers (route by asset scope, never misroute team↔personal)
const assetUpdate = (asset: MaterialAssetDto) =>
  asset.teamId ? updateTeamMaterialAsset : updateMaterialAsset;
const assetDelete = (asset: MaterialAssetDto) =>
  asset.teamId ? deleteTeamMaterialAsset : deleteMaterialAsset;

// ── Row action menu ────────────────────────────────────────────────────────────

function RowActionMenu({
  asset,
  onRename,
  onMove,
  onCopy,
  onDelete,
  onToggleFavorite,
  size = 20,
}: {
  asset: MaterialAssetDto;
  onRename: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  size?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100";
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex items-center justify-center rounded text-gray-500 hover:bg-gray-200/70 hover:text-gray-800"
        style={{ width: size, height: size }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="更多操作"
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-[1200] mt-1 w-32 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={item}
            onClick={() => {
              setOpen(false);
              onToggleFavorite();
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
              setOpen(false);
              onRename();
            }}
          >
            <Pencil size={13} /> 重命名
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false);
              onMove();
            }}
          >
            <FolderIcon size={13} /> 移动到...
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false);
              onCopy();
            }}
          >
            <Copy size={13} /> 创建副本
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            className={cn(item, "text-red-600 hover:bg-red-50")}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={13} /> 删除
          </button>
        </div>
      )}
    </div>
  );
}

// ── Hover preview card ─────────────────────────────────────────────────────────

function AssetPreviewCard({
  asset,
  anchorY,
  anchorX,
  onClose,
  onCancelHide,
  onApply,
  onPreview,
}: {
  asset: MaterialAssetDto;
  anchorY: number;
  anchorX: number;
  onClose: () => void;
  onCancelHide: () => void;
  onApply: () => void;
  onPreview: (url: string) => void;
}) {
  const imageUrl = getAssetImageUrl(asset);
  return createPortal(
    <div
      onMouseEnter={onCancelHide}
      onMouseLeave={onClose}
      className="fixed z-[1400] w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      style={{ left: anchorX, top: anchorY, transform: "translateY(-50%)" }}
    >
      {imageUrl ? (
        <SmartImage
          src={imageUrl}
          alt={asset.name}
          onClick={() => onPreview(imageUrl)}
          className="block h-44 w-full cursor-zoom-in object-cover"
        />
      ) : (
        <div className="flex h-44 w-full items-center justify-center bg-gray-50 text-xs text-gray-400">
          无预览图
        </div>
      )}
      <div className="px-3 pb-3 pt-2.5">
        <div className="mb-0.5 truncate text-sm font-semibold text-gray-900">
          {asset.name}
        </div>
        <div className="mb-2.5 text-xs text-gray-400">
          创建于 {formatDate(asset.createdAt)}
        </div>
        <button
          className="w-full rounded-md bg-gray-900 py-1.5 text-sm text-white hover:bg-gray-800"
          onClick={() => {
            onApply();
            onClose();
          }}
        >
          应用到画布
        </button>
      </div>
    </div>,
    document.body
  );
}

// ── Asset row ──────────────────────────────────────────────────────────────────

function AssetRow({
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
  const [previewPos, setPreviewPos] = React.useState({ x: 0, y: 0 });
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageUrl = getAssetImageUrl(asset);

  const scheduleHide = () => {
    hideTimer.current = setTimeout(() => setHovered(false), 300);
  };
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };
  React.useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-2.5 py-1.5 pl-9 pr-2.5",
        hovered ? "bg-gray-900/5" : ""
      )}
      onMouseEnter={(e) => {
        cancelHide();
        const rect = e.currentTarget.getBoundingClientRect();
        setPreviewPos({ x: rect.left - 268, y: rect.top + rect.height / 2 });
        setHovered(true);
      }}
      onMouseLeave={scheduleHide}
      onDoubleClick={() => onApply(asset)}
    >
      {imageUrl ? (
        <SmartImage
          src={imageUrl}
          alt={asset.name}
          className="h-8 w-8 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded bg-gray-100" />
      )}
      <span className="flex-1 truncate text-xs text-gray-700">{asset.name}</span>
      {asset.favorite && (
        <Star size={12} className="shrink-0 text-amber-400" fill="#fbbf24" />
      )}
      <RowActionMenu
        asset={asset}
        onRename={() => onRename(asset)}
        onMove={() => onMove(asset)}
        onCopy={() => onCopy(asset)}
        onDelete={() => onDelete(asset)}
        onToggleFavorite={() => onToggleFavorite(asset)}
      />
      {hovered && (
        <AssetPreviewCard
          asset={asset}
          anchorX={previewPos.x}
          anchorY={previewPos.y}
          onClose={() => setHovered(false)}
          onCancelHide={cancelHide}
          onApply={() => onApply(asset)}
          onPreview={onPreview}
        />
      )}
    </div>
  );
}

// ── Folder row (fixed kind & custom) ───────────────────────────────────────────

function FolderRow({
  label,
  assets,
  loading,
  onMenu,
  rowProps,
}: {
  label: string;
  assets: MaterialAssetDto[];
  loading: boolean;
  onMenu?: React.ReactNode;
  rowProps: Omit<React.ComponentProps<typeof AssetRow>, "asset">;
}) {
  const [open, setOpen] = React.useState(false);
  const cover = assets.find((a) => !!getAssetImageUrl(a));
  const coverUrl = cover ? getAssetImageUrl(cover) : "";
  return (
    <>
      <div
        className="flex cursor-pointer items-center gap-2 px-3.5 py-1.5 hover:bg-gray-900/[0.03]"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          size={14}
          className="shrink-0 text-gray-400 transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        />
        {coverUrl ? (
          <SmartImage
            src={coverUrl}
            alt={label}
            className="h-7 w-7 shrink-0 rounded object-cover"
          />
        ) : (
          <FolderIcon size={20} className="shrink-0 text-gray-400" />
        )}
        <span className="flex-1 truncate text-sm text-gray-700">{label}</span>
        {assets.length > 0 && (
          <span className="text-xs text-gray-400">{assets.length}</span>
        )}
        {onMenu}
      </div>
      {open && (
        <div className="ml-5 border-l border-gray-100">
          {loading ? (
            <div className="px-3.5 py-1.5 text-xs text-gray-400">加载中...</div>
          ) : assets.length === 0 ? (
            <div className="px-3.5 py-2 text-xs text-gray-400">
              该文件夹暂无素材
            </div>
          ) : (
            assets.map((a) => <AssetRow key={a.id} asset={a} {...rowProps} />)
          )}
        </div>
      )}
    </>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function MaterialLibraryPanel() {
  const showPanel = useUIStore((s) => s.showMaterialLibraryPanel);
  const setShowPanel = useUIStore((s) => s.setShowMaterialLibraryPanel);
  const activeTeam = useTeamStore((s) => s.getActiveTeam());
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const projectId = useProjectStore((s) => s.currentProjectId) ?? null;

  const teamId =
    activeTeam && !activeTeam.isPersonal ? activeTeam.id : null;
  const showTeamTab = !!teamId;

  const [tab, setTab] = React.useState<"personal" | "team">("personal");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [assets, setAssets] = React.useState<MaterialAssetDto[]>([]);
  const [teamAssets, setTeamAssets] = React.useState<MaterialAssetDto[]>([]);
  const [folders, setFolders] = React.useState<MaterialFolderDto[]>([]);
  const [teamFolders, setTeamFolders] = React.useState<MaterialFolderDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [teamLoading, setTeamLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [folderSelectOpen, setFolderSelectOpen] = React.useState(false);
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);
  const [pendingUploadKind, setPendingUploadKind] =
    React.useState<MaterialKindDto | null>(null);
  const [movingAsset, setMovingAsset] = React.useState<MaterialAssetDto | null>(
    null
  );
  const [renamingAsset, setRenamingAsset] =
    React.useState<MaterialAssetDto | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const addMenuRef = useClickOutside<HTMLDivElement>(
    () => setAddMenuOpen(false),
    addMenuOpen
  );

  // Normalize tab if active team disappears / becomes personal.
  React.useEffect(() => {
    if (!showTeamTab && tab === "team") setTab("personal");
  }, [showTeamTab, tab]);

  const reloadPersonal = React.useCallback(() => {
    setLoading(true);
    Promise.all([listMaterialAssets(), listMaterialFolders()])
      .then(([a, f]) => {
        setAssets(a);
        setFolders(f);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const reloadTeam = React.useCallback(() => {
    if (!teamId) return;
    setTeamLoading(true);
    Promise.all([
      listTeamMaterialAssets({ teamId }),
      listMaterialFolders({ teamId }),
    ])
      .then(([a, f]) => {
        setTeamAssets(a);
        setTeamFolders(f);
      })
      .catch(() => {})
      .finally(() => setTeamLoading(false));
  }, [teamId]);

  const reload = React.useCallback(() => {
    if (tab === "team" && teamId) reloadTeam();
    else reloadPersonal();
  }, [tab, teamId, reloadTeam, reloadPersonal]);

  React.useEffect(() => {
    if (!showPanel) return;
    reloadPersonal();
  }, [showPanel, reloadPersonal]);

  React.useEffect(() => {
    if (!showPanel || tab !== "team" || !teamId) return;
    reloadTeam();
  }, [showPanel, tab, teamId, reloadTeam]);

  // ── operations ───────────────────────────────────────────────────────────────

  const handleApply = React.useCallback(
    (asset: MaterialAssetDto) => applyAssetToCanvas(asset),
    []
  );

  const handleRename = React.useCallback(
    async (asset: MaterialAssetDto, newName: string) => {
      try {
        await assetUpdate(asset)(asset.id, { name: newName });
        reload();
      } catch {
        toast("重命名失败", "error");
      }
    },
    [reload]
  );

  const handleDelete = React.useCallback(
    async (asset: MaterialAssetDto) => {
      try {
        await assetDelete(asset)(asset.id);
        reload();
        toast(`已删除「${asset.name}」`, "success");
      } catch {
        toast("删除失败", "error");
      }
    },
    [reload]
  );

  // Move within the same scope: PATCH kind+folderId (keeps id/favorite/timestamps).
  const handleMove = React.useCallback(
    async (asset: MaterialAssetDto, targetKind: MaterialKindDto) => {
      try {
        await assetUpdate(asset)(asset.id, {
          kind: targetKind,
          folderId: null,
        });
        reload();
        const label =
          FOLDER_DEFS.find((f) => f.kind === targetKind)?.label || targetKind;
        toast(`已移动到「${label}」`, "success");
      } catch {
        toast("移动失败，请重试", "error");
      } finally {
        setMovingAsset(null);
      }
    },
    [reload]
  );

  const handleCopy = React.useCallback(
    async (asset: MaterialAssetDto) => {
      const imageUrl = getAssetImageUrl(asset);
      try {
        if (asset.teamId) {
          await createTeamMaterialAsset({
            teamId: asset.teamId,
            kind: asset.kind,
            name: `${asset.name} 副本`,
            initialData: { imageUrl },
          });
        } else {
          await createMaterialAsset({
            kind: asset.kind,
            name: `${asset.name} 副本`,
            initialData: { imageUrl },
          });
        }
        reload();
        toast("已创建副本", "success");
      } catch {
        toast("创建副本失败", "error");
      }
    },
    [reload]
  );

  const handleToggleFavorite = React.useCallback(
    async (asset: MaterialAssetDto) => {
      const next = !asset.favorite;
      const setter = asset.teamId ? setTeamAssets : setAssets;
      setter((prev) =>
        prev.map((a) => (a.id === asset.id ? { ...a, favorite: next } : a))
      );
      try {
        await assetUpdate(asset)(asset.id, { favorite: next });
      } catch {
        setter((prev) =>
          prev.map((a) => (a.id === asset.id ? { ...a, favorite: !next } : a))
        );
        toast("收藏操作失败", "error");
      }
    },
    []
  );

  const handleUploadFolderConfirm = React.useCallback((kind: MaterialKindDto) => {
    setPendingUploadKind(kind);
    setFolderSelectOpen(false);
    setTimeout(() => fileInputRef.current?.click(), 60);
  }, []);

  const handleFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !pendingUploadKind) return;
      e.target.value = "";
      setUploading(true);
      try {
        const uploaded = await uploadToOSS(file, {
          dir: "material-library/",
          projectId,
          fileName: file.name,
        });
        if (!uploaded.success || !uploaded.url)
          throw new Error(uploaded.error || "upload failed");
        const initialData: Record<string, unknown> = {
          imageUrl: uploaded.url,
          url: uploaded.url,
        };
        if (uploaded.key) initialData.ossKey = uploaded.key;
        const name = file.name.replace(/\.[^.]+$/, "");
        if (tab === "team" && teamId) {
          await createTeamMaterialAsset({
            teamId,
            kind: pendingUploadKind,
            name,
            initialData,
          });
        } else {
          await createMaterialAsset({ kind: pendingUploadKind, name, initialData });
        }
        toast("上传成功", "success");
        reload();
      } catch {
        toast("上传失败，请重试", "error");
      } finally {
        setUploading(false);
        setPendingUploadKind(null);
      }
    },
    [pendingUploadKind, projectId, tab, teamId, reload]
  );

  const handleCreateFolder = React.useCallback(
    async (name: string) => {
      try {
        if (tab === "team" && teamId) {
          const folder = await createMaterialFolder({ teamId, name });
          setTeamFolders((prev) => [...prev, folder]);
        } else {
          const folder = await createMaterialFolder({ name });
          setFolders((prev) => [...prev, folder]);
        }
        toast(`已创建文件夹「${name}」`, "success");
      } catch {
        toast("创建文件夹失败", "error");
      }
    },
    [tab, teamId]
  );

  const handleDeleteFolder = React.useCallback(
    async (folder: MaterialFolderDto) => {
      try {
        await deleteMaterialFolder(folder.id);
        if (tab === "team")
          setTeamFolders((prev) => prev.filter((f) => f.id !== folder.id));
        else setFolders((prev) => prev.filter((f) => f.id !== folder.id));
        reload();
        toast(`已删除文件夹「${folder.name}」`, "success");
      } catch {
        toast("删除文件夹失败", "error");
      }
    },
    [tab, reload]
  );

  // ── derived ──────────────────────────────────────────────────────────────────

  const currentAssets = tab === "team" ? teamAssets : assets;
  const currentFolders = tab === "team" ? teamFolders : folders;
  const currentLoading = tab === "team" ? teamLoading : loading;
  const q = query.trim().toLowerCase();
  const filteredAssets = q
    ? currentAssets.filter((a) => a.name.toLowerCase().includes(q))
    : currentAssets;

  const rowProps = {
    onApply: handleApply,
    onRename: (a: MaterialAssetDto) => setRenamingAsset(a),
    onMove: (a: MaterialAssetDto) => setMovingAsset(a),
    onCopy: handleCopy,
    onDelete: handleDelete,
    onToggleFavorite: handleToggleFavorite,
    onPreview: (url: string) => setPreviewUrl(url),
  };

  if (!showPanel) return null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="tanva-material-library-panel fixed right-0 top-0 z-[1000] flex h-full w-80 flex-col overflow-hidden border-l border-gray-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-1 px-3 py-2.5">
          <span className="flex-1 text-sm font-semibold text-gray-900">素材库</span>
          <button
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            title="弹窗查看 / 管理素材库"
            onClick={() => setModalOpen(true)}
          >
            <Maximize2 size={15} />
          </button>
          <div className="relative" ref={addMenuRef}>
            <button
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
              aria-label="新建"
              onClick={() => setAddMenuOpen((v) => !v)}
            >
              <Plus size={15} />
            </button>
            {addMenuOpen && (
              <div className="absolute right-0 top-full z-[1200] mt-1 w-32 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                  onClick={() => {
                    setAddMenuOpen(false);
                    setFolderSelectOpen(true);
                  }}
                >
                  <Upload size={13} /> 上传
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                  onClick={() => {
                    setAddMenuOpen(false);
                    setNewFolderOpen(true);
                  }}
                >
                  <FolderPlus size={13} /> 新建文件夹
                </button>
              </div>
            )}
          </div>
          <button
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="关闭"
            onClick={() => setShowPanel(false)}
          >
            <X size={15} />
          </button>
        </div>

        {/* Personal / Team tabs */}
        {showTeamTab && (
          <div className="shrink-0 px-3 pb-2">
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
                  onClick={() => setTab(t)}
                >
                  {t === "personal" ? "个人" : "团队"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="shrink-0 px-3 pb-2">
          <div className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5">
            <Search size={13} className="text-gray-400" />
            <input
              className="w-full bg-transparent text-xs outline-none placeholder:text-gray-400"
              placeholder="搜索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {/* Favorites toggle (personal only) */}
          {tab === "personal" && (
            <div
              className={cn(
                "mx-1 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5",
                favoritesOnly ? "bg-gray-900/[0.06]" : "hover:bg-gray-900/[0.03]"
              )}
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              <Star
                size={18}
                className="shrink-0 text-amber-400"
                fill={favoritesOnly ? "#fbbf24" : "none"}
              />
              <span
                className={cn(
                  "flex-1 text-sm text-gray-700",
                  favoritesOnly && "font-semibold"
                )}
              >
                收藏
              </span>
            </div>
          )}

          <div className="mx-3.5 my-1.5 border-b border-gray-100" />
          <div className="px-3.5 pb-1 text-xs text-gray-400">
            {favoritesOnly ? "已收藏" : "文件夹"}
          </div>

          {q ? (
            filteredAssets.length === 0 ? (
              <div className="px-3.5 py-2 text-xs text-gray-400">无匹配素材</div>
            ) : (
              filteredAssets.map((a) => (
                <AssetRow key={a.id} asset={a} {...rowProps} />
              ))
            )
          ) : favoritesOnly ? (
            currentAssets.filter((a) => a.favorite).length === 0 ? (
              <div className="px-3.5 py-2 text-xs text-gray-400">暂无收藏素材</div>
            ) : (
              currentAssets
                .filter((a) => a.favorite)
                .map((a) => <AssetRow key={a.id} asset={a} {...rowProps} />)
            )
          ) : (
            <>
              {FOLDER_DEFS.map((f) => (
                <FolderRow
                  key={f.kind}
                  label={f.label}
                  assets={currentAssets.filter(
                    (a) => a.kind === f.kind && !a.folderId
                  )}
                  loading={currentLoading}
                  rowProps={rowProps}
                />
              ))}
              {currentFolders.map((folder) => (
                <FolderRow
                  key={folder.id}
                  label={folder.name}
                  assets={currentAssets.filter((a) => a.folderId === folder.id)}
                  loading={currentLoading}
                  rowProps={rowProps}
                  onMenu={
                    <FolderMenu onDelete={() => handleDeleteFolder(folder)} />
                  }
                />
              ))}
            </>
          )}

          {currentLoading && !q && (
            <div className="px-3.5 py-1.5 text-xs text-gray-400">加载中...</div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <FolderSelectModal
        open={folderSelectOpen}
        onClose={() => setFolderSelectOpen(false)}
        onConfirm={handleUploadFolderConfirm}
      />
      <FolderSelectModal
        open={movingAsset !== null}
        title="移动到..."
        excludeKind={movingAsset?.kind}
        onClose={() => setMovingAsset(null)}
        onConfirm={(kind) => movingAsset && handleMove(movingAsset, kind)}
      />
      <NewFolderModal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onConfirm={handleCreateFolder}
      />
      <RenameModal
        open={renamingAsset !== null}
        initialName={renamingAsset?.name ?? ""}
        onClose={() => setRenamingAsset(null)}
        onConfirm={(name) => renamingAsset && handleRename(renamingAsset, name)}
      />

      <MaterialLibraryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        assets={currentAssets}
        folders={currentFolders}
        loading={currentLoading}
        tab={tab}
        onTabChange={setTab}
        showTeamTab={showTeamTab}
        uploading={uploading}
        onApply={handleApply}
        onRename={(a) => setRenamingAsset(a)}
        onMove={(a) => setMovingAsset(a)}
        onCopy={handleCopy}
        onDelete={handleDelete}
        onToggleFavorite={handleToggleFavorite}
        onDeleteFolder={handleDeleteFolder}
        onUploadClick={() => setFolderSelectOpen(true)}
        onNewFolderClick={() => setNewFolderOpen(true)}
        onRefresh={reload}
        onPreview={(url) => setPreviewUrl(url)}
      />

      <ImagePreviewModal
        isOpen={!!previewUrl}
        imageSrc={previewUrl || ""}
        onClose={() => setPreviewUrl(null)}
      />
    </>
  );
}

// helper components colocated to keep imports tidy
function FolderMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex h-[18px] w-[18px] items-center justify-center rounded text-gray-400 hover:bg-gray-200/70 hover:text-gray-700"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal size={12} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-[1200] mt-1 w-28 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={13} /> 删除文件夹
          </button>
        </div>
      )}
    </div>
  );
}

