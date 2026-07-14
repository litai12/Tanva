import React from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button";
import SmartImage from "../ui/SmartImage";
import ImagePreviewModal from "../ui/ImagePreviewModal";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Send,
  Image as ImageIcon,
  Film,
  Play,
  Box,
  Folder as FolderIcon,
  Plus,
  Search,
  Loader2,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { useTeamStore } from "@/stores/teamStore";
import { uploadToOSS } from "@/services/ossUploadService";
import { imageUploadService } from "@/services/imageUploadService";
import {
  model3DUploadService,
  type Model3DData,
} from "@/services/model3DUploadService";
import { model3DPreviewService } from "@/services/model3DPreviewService";
import { personalLibraryApi } from "@/services/personalLibraryApi";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { fetchWithAuth } from "@/services/authFetch";
import { blobToDataUrl, responseToBlob } from "@/utils/imageConcurrency";
import {
  createPersonalAssetId,
  usePersonalLibraryStore,
  type PersonalAssetType,
  type PersonalLibraryAsset,
  type PersonalImageAsset,
  type PersonalModelAsset,
  type PersonalSvgAsset,
} from "@/stores/personalLibraryStore";
import {
  globalImageHistoryApi,
  type GlobalImageHistoryItem,
} from "@/services/globalImageHistoryApi";
import {
  GLOBAL_HISTORY_SOURCE_TYPE_LABELS,
  getGlobalHistoryDownloadFileName,
  getGlobalHistoryMediaUrl,
  getGlobalHistoryVideoThumbnail,
  isGlobalHistoryVideoItem,
} from "@/components/global-history/historyMedia";
import {
  createTeamMaterialAsset,
  createMaterialFolder,
  deleteMaterialFolder,
  deleteTeamMaterialAsset,
  getAssetImageUrl,
  listMaterialFolders,
  listTeamMaterialAssets,
  updateMaterialFolder,
  updateTeamMaterialAsset,
  type MaterialAssetDto,
  type MaterialFolderDto,
  type MaterialKindDto,
} from "@/services/materialLibraryApi";
import type { StoredImageAsset } from "@/types/canvas";
import { useLocaleText } from "@/utils/localeText";

const formatSize = (bytes?: number): string => {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

const formatHistoryDate = (value: string, locale: string): string => {
  return new Date(value).toLocaleDateString(locale, {
    month: "2-digit",
    day: "2-digit",
  });
};

type LibraryTab = "global-history" | "project-history" | "manual";
const HISTORY_PAGE_SIZE = 20;
const LIBRARY_DETAIL_PANEL_TOP = 185;
const LIBRARY_DETAIL_PANEL_BOTTOM_GAP = 24;
const LIBRARY_DETAIL_PANEL_STYLE: React.CSSProperties = {
  top: LIBRARY_DETAIL_PANEL_TOP,
  maxHeight: `calc(100vh - ${
    LIBRARY_DETAIL_PANEL_TOP + LIBRARY_DETAIL_PANEL_BOTTOM_GAP
  }px)`,
};

type HistoryPageSlot = number | "ellipsis-left" | "ellipsis-right";

const buildHistoryPageSlots = (
  currentPage: number,
  totalPages: number
): HistoryPageSlot[] => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-right", totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis-left",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }
  return [
    1,
    "ellipsis-left",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis-right",
    totalPages,
  ];
};

const getTypeLabel = (
  type: PersonalAssetType
): { label: string; icon: React.ReactNode; bgColor: string } => {
  switch (type) {
    case "2d":
      return {
        label: "2D",
        icon: <ImageIcon className='w-3 h-3' />,
        bgColor: "bg-blue-100 text-blue-700",
      };
    case "3d":
      return {
        label: "3D",
        icon: <Box className='w-3 h-3' />,
        bgColor: "bg-purple-100 text-purple-700",
      };
    default:
      return {
        label: "SVG",
        icon: <ImageIcon className='w-3 h-3' />,
        bgColor: "bg-green-100 text-green-700",
      };
  }
};

export interface LibraryPanelProps {
  /** "panel"（默认）= 现有右侧固定素材栏；"modal" = 居中弹窗选择器。 */
  variant?: "panel" | "modal";
  /** modal 变体的显隐（取代 showLibraryPanel）。 */
  open?: boolean;
  /** modal 变体关闭回调。 */
  onClose?: () => void;
  /** 选择模式：点击资产回调 onSelectAsset 而非应用到画布/展示详情。 */
  selectMode?: boolean;
  /** 选择模式下点选一张图片资产时触发（url 为原始图片地址）。 */
  onSelectAsset?: (url: string, name?: string) => void;
}

const LibraryPanel: React.FC<LibraryPanelProps> = ({
  variant = "panel",
  open = false,
  onClose,
  selectMode = false,
  onSelectAsset,
}) => {
  const { lt, isZh } = useLocaleText();
  const locale = isZh ? "zh-CN" : "en-US";
  const { showLibraryPanel, setShowLibraryPanel } = useUIStore();
  const isModal = variant === "modal";
  // 面板"生效"标志：panel 变体沿用 showLibraryPanel（行为逐字节不变），modal 变体用 open。
  const panelActive = isModal ? open : showLibraryPanel;
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const teams = useTeamStore((state) => state.teams);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeTeam = useTeamStore((state) => state.getActiveTeam());
  const [activeTab, setActiveTab] = React.useState<LibraryTab>("manual");
  const [isUploading, setUploading] = React.useState(false);
  const [isLibraryDragHovering, setLibraryDragHovering] = React.useState(false);
  const [selectedAsset, setSelectedAsset] =
    React.useState<PersonalLibraryAsset | null>(null);
  const [selectedHistoryItem, setSelectedHistoryItem] =
    React.useState<GlobalImageHistoryItem | null>(null);
  const [previewState, setPreviewState] = React.useState<{
    src: string;
    title: string;
  } | null>(null);
  const addAsset = usePersonalLibraryStore((state) => state.addAsset);
  const removeAsset = usePersonalLibraryStore((state) => state.removeAsset);
  const updateAsset = usePersonalLibraryStore((state) => state.updateAsset);
  const mergeAssets = usePersonalLibraryStore((state) => state.mergeAssets);
  const allAssets = usePersonalLibraryStore((state) => state.assets);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const detailPanelRef = React.useRef<HTMLDivElement>(null);
  const [historyItems, setHistoryItems] = React.useState<GlobalImageHistoryItem[]>(
    []
  );
  const [historyIsLoading, setHistoryIsLoading] = React.useState(false);
  const [historyFilterType, setHistoryFilterType] = React.useState("");
  const [historySearchQuery, setHistorySearchQuery] = React.useState("");
  const [historyPage, setHistoryPage] = React.useState(1);
  const [historyTotalPages, setHistoryTotalPages] = React.useState(1);
  const [historyTotalCount, setHistoryTotalCount] = React.useState(0);
  const [projectHistoryItems, setProjectHistoryItems] = React.useState<
    GlobalImageHistoryItem[]
  >([]);
  const [projectHistoryIsLoading, setProjectHistoryIsLoading] =
    React.useState(false);
  const [projectHistoryFilterType, setProjectHistoryFilterType] =
    React.useState("");
  const [projectHistorySearchQuery, setProjectHistorySearchQuery] =
    React.useState("");
  const [projectHistoryPage, setProjectHistoryPage] = React.useState(1);
  const [projectHistoryTotalPages, setProjectHistoryTotalPages] =
    React.useState(1);
  const [projectHistoryTotalCount, setProjectHistoryTotalCount] =
    React.useState(0);
  const [selectedTeamLibraryTeamId, setSelectedTeamLibraryTeamId] =
    React.useState<string>("");
  const [teamAssets, setTeamAssets] = React.useState<MaterialAssetDto[]>([]);
  const [teamFolders, setTeamFolders] = React.useState<MaterialFolderDto[]>([]);
  const [teamLibraryIsLoading, setTeamLibraryIsLoading] = React.useState(false);
  const [teamLibrarySearchQuery, setTeamLibrarySearchQuery] = React.useState("");
  const [isTeamAssetUploading, setTeamAssetUploading] = React.useState(false);
  const [openTeamFolderIds, setOpenTeamFolderIds] = React.useState<string[]>([]);
  const [teamUploadFolderId, setTeamUploadFolderId] = React.useState<string | null>(null);
  const [teamFolderMenuId, setTeamFolderMenuId] = React.useState<string | null>(null);

  const historyQueryOptions = React.useMemo(
    () => ({
      sourceType: historyFilterType.trim() || undefined,
      search: historySearchQuery.trim() || undefined,
    }),
    [historyFilterType, historySearchQuery]
  );

  const historyPageSlots = React.useMemo(
    () => buildHistoryPageSlots(historyPage, historyTotalPages),
    [historyPage, historyTotalPages]
  );
  const joinedTeams = React.useMemo(
    () => teams.filter((team) => !team.isPersonal),
    [teams]
  );
  const isInTeamWorkspace = Boolean(activeTeam && !activeTeam.isPersonal);
  const effectiveTeamLibraryTeamId = isInTeamWorkspace
    ? activeTeamId || ""
    : selectedTeamLibraryTeamId;
  const getVisibleTeamAssets = React.useCallback(
    (folderId: string | null) => {
      const query = teamLibrarySearchQuery.trim().toLowerCase();
      return teamAssets.filter((asset) => {
        if ((asset.folderId ?? null) !== folderId) return false;
        if (!query) return true;
        return asset.name.toLowerCase().includes(query);
      });
    },
    [teamAssets, teamLibrarySearchQuery]
  );
  const uncategorizedTeamAssets = React.useMemo(
    () => getVisibleTeamAssets(null),
    [getVisibleTeamAssets]
  );
  const projectHistoryQueryOptions = React.useMemo(
    () => ({
      sourceType: projectHistoryFilterType.trim() || undefined,
      search: projectHistorySearchQuery.trim() || undefined,
    }),
    [projectHistoryFilterType, projectHistorySearchQuery]
  );
  const projectHistoryPageSlots = React.useMemo(
    () => buildHistoryPageSlots(projectHistoryPage, projectHistoryTotalPages),
    [projectHistoryPage, projectHistoryTotalPages]
  );

  const getSourceTypeLabel = React.useCallback(
    (type: string) => {
      const item = GLOBAL_HISTORY_SOURCE_TYPE_LABELS[type];
      if (!item) return type;
      return lt(item.zh, item.en);
    },
    [lt]
  );

  const getHistoryItemTitle = React.useCallback(
    (item: GlobalImageHistoryItem) => {
      if (item.prompt) return item.prompt;
      const isVideo = isGlobalHistoryVideoItem(item);
      if (activeTab === "project-history") {
        return isVideo
          ? lt("项目视频", "Project Video")
          : lt("项目图片", "Project Image");
      }
      return isVideo
        ? lt("历史视频", "History Video")
        : lt("历史图片", "History Image");
    },
    [activeTab, lt]
  );

  const handleModelThumbnailUpdate = React.useCallback(
    (assetId: string, thumbnail: string) => {
      updateAsset(assetId, { thumbnail });
      const current = usePersonalLibraryStore
        .getState()
        .assets.find((item) => item.id === assetId);
      if (current) {
        const nextAsset: PersonalLibraryAsset = {
          ...current,
          thumbnail,
          updatedAt: Date.now(),
        };
        void personalLibraryApi
          .upsert(nextAsset)
          .catch((error) => {
            console.warn("[LibraryPanel] 同步 3D 缩略图到个人库失败:", error);
          });
      }
    },
    [updateAsset]
  );

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 监听画布侧的库悬停事件，用于展示占位反馈
  React.useEffect(() => {
    const handleLibraryHover = (event: Event) => {
      const hovering = Boolean(
        (event as CustomEvent<{ hovering: boolean }>).detail?.hovering
      );
      setLibraryDragHovering(hovering);
    };
    window.addEventListener(
      "canvas:library-drag-hover",
      handleLibraryHover as EventListener
    );
    return () => {
      window.removeEventListener(
        "canvas:library-drag-hover",
        handleLibraryHover as EventListener
      );
    };
  }, []);

  // 面板关闭时自动清理悬停态
  React.useEffect(() => {
    if (!panelActive && isLibraryDragHovering) {
      setLibraryDragHovering(false);
    }
  }, [panelActive, isLibraryDragHovering]);

  React.useEffect(() => {
    if (activeTab === "manual") {
      setSelectedHistoryItem(null);
      return;
    }
    setSelectedAsset(null);
    setSelectedHistoryItem(null);
  }, [activeTab]);

  const triggerUpload = () => fileInputRef.current?.click();

  const upsertImageAsset = React.useCallback(
    (
      file: File,
      asset: NonNullable<
        Awaited<ReturnType<typeof imageUploadService.uploadImageFile>>["asset"]
      >
    ) => {
      const id = createPersonalAssetId("pl2d");
      const imageAsset: PersonalImageAsset = {
        id,
        type: "2d",
        name:
          file.name.replace(/\.[^/.]+$/, "") || asset.fileName || lt("未命名图片", "Untitled Image"),
        url: asset.url,
        thumbnail: asset.url,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName ?? file.name,
        fileSize: file.size,
        contentType: asset.contentType ?? file.type,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAsset(imageAsset);
      void personalLibraryApi.upsert(imageAsset).catch((error) => {
        console.warn("[LibraryPanel] 同步图片资源到个人库失败:", error);
      });
    },
    [addAsset, lt]
  );

  const upsertModelAsset = React.useCallback(
    (
      file: File,
      asset: NonNullable<
        Awaited<
          ReturnType<typeof model3DUploadService.uploadModelFile>
        >["asset"]
      >
    ) => {
      const id = createPersonalAssetId("pl3d");
      const now = Date.now();
      const modelAsset: PersonalModelAsset = {
        id,
        type: "3d",
        name:
          file.name.replace(/\.[^/.]+$/, "") || asset.fileName || lt("未命名模型", "Untitled Model"),
        url: asset.url,
        fileName: asset.fileName ?? file.name,
        fileSize: asset.fileSize ?? file.size,
        contentType: asset.contentType ?? file.type,
        format: asset.format,
        createdAt: now,
        updatedAt: now,
      };
      addAsset(modelAsset);
      void personalLibraryApi.upsert(modelAsset).catch((error) => {
        console.warn("[LibraryPanel] 同步 3D 资源到个人库失败:", error);
      });
      if (asset.url) {
        void model3DPreviewService
          .generatePreviewAndUpload(asset.url)
          .then((thumbnailUrl) => {
            if (thumbnailUrl) {
              handleModelThumbnailUpdate(id, thumbnailUrl);
            }
          })
          .catch((error) => {
            console.warn("[LibraryPanel] 3D 预览生成失败:", error);
          });
      }
    },
    [addAsset, handleModelThumbnailUpdate, lt]
  );

  const handleUploadFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const is3D =
        file.name.toLowerCase().endsWith(".glb") ||
        file.name.toLowerCase().endsWith(".gltf");

      if (is3D) {
        const result = await model3DUploadService.uploadModelFile(file, {
          dir: "uploads/personal-library/models/",
        });
        if (!result.success || !result.asset) {
          alert(result.error || lt("3D 模型上传失败，请重试", "3D model upload failed. Please try again."));
          return;
        }
        upsertModelAsset(file, result.asset);
      } else {
        const result = await imageUploadService.uploadImageFile(file, {
          dir: "uploads/personal-library/images/",
        });
        if (!result.success || !result.asset) {
          alert(result.error || lt("图片上传失败，请重试", "Image upload failed. Please try again."));
          return;
        }
        upsertImageAsset(file, result.asset);
      }
    } finally {
      setUploading(false);
      resetFileInput();
    }
  };

  const handleDownload = (asset: PersonalLibraryAsset) => {
    try {
      const link = document.createElement("a");
      link.href = asset.url;
      link.download = asset.fileName || asset.name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(asset.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleRemoveAsset = (asset: PersonalLibraryAsset) => {
    if (!confirm(lt(`确定要删除「${asset.name}」吗？`, `Delete "${asset.name}"?`))) {
      return;
    }
    removeAsset(asset.id);
    setSelectedAsset(null);
    void personalLibraryApi.remove(asset.id).catch((error) => {
      console.warn("[LibraryPanel] 删除个人库资源失败:", error);
    });
  };

  const resolveImageFetchCredentials = (input: string): RequestCredentials => {
    const value = typeof input === "string" ? input.trim() : "";
    if (!value) return "omit";
    if (value.startsWith("data:") || value.startsWith("blob:")) return "omit";
    if (
      value.startsWith("/") ||
      value.startsWith("./") ||
      value.startsWith("../")
    )
      return "include";
    if (!/^https?:\/\//i.test(value)) return "include";
    if (typeof window === "undefined") return "omit";

    try {
      const parsed = new URL(value);
      if (parsed.origin === window.location.origin) return "include";

      const apiBase =
        typeof import.meta.env.VITE_API_BASE_URL === "string"
          ? import.meta.env.VITE_API_BASE_URL.trim()
          : "";
      if (apiBase) {
        try {
          const apiOrigin = new URL(apiBase.replace(/\/+$/, "")).origin;
          if (apiOrigin && parsed.origin === apiOrigin) return "include";
        } catch {}
      }
    } catch {}

    return "omit";
  };

  const readDataUrl = async (url: string): Promise<string | null> => {
    try {
      const trimmed = typeof url === "string" ? url.trim() : "";
      if (trimmed.startsWith("data:image/")) return trimmed;
      // 如果是 OSS 公网资源，优先直接返回远程 URL，避免转换为 data URL 占用内存。
      try {
        const parsed = new URL(trimmed);
        if (parsed.hostname.endsWith(".aliyuncs.com")) {
          return trimmed;
        }
      } catch {}

      const fetchUrl = proxifyRemoteAssetUrl(url);
      const response = await fetchWithAuth(fetchUrl, {
        mode: "cors",
        credentials: resolveImageFetchCredentials(fetchUrl),
        auth: "omit",
        allowRefresh: false,
      });
      if (!response.ok) return null;
      const blob = await responseToBlob(response);
      return await blobToDataUrl(blob);
    } catch (error) {
      console.warn("[LibraryPanel] 将远程图片转换为 DataURL 失败:", error);
      return null;
    }
  };

  const handleSendToCanvas = async (asset: PersonalLibraryAsset) => {
    if (!asset.url) {
      alert(lt("资源缺少可用的链接，无法发送到画板", "This asset has no usable URL and cannot be sent to canvas."));
      return;
    }
    if (asset.type === "2d") {
      const displayFileName = asset.fileName || `${asset.name}.png`;

      // Prefer an inline data URL (thumbnail already in memory) for zero-latency display.
      const inlineData =
        typeof asset.thumbnail === "string" &&
        asset.thumbnail.startsWith("data:image/")
          ? asset.thumbnail
          : null;

      // Fetch a data URL via backend proxy so CanvasImageLayer can render immediately.
      // We always pass a StoredImageAsset (never a raw string) so useQuickImageUpload
      // recognises asset.url as an already-managed OSS ref and skips re-upload.
      let localDataUrl: string | undefined = inlineData ?? undefined;
      if (!localDataUrl) {
        try {
          const proxyUrl = proxifyRemoteAssetUrl(asset.url, { forceProxy: true });
          const resp = await fetchWithAuth(proxyUrl, {
            mode: "cors",
            credentials: resolveImageFetchCredentials(proxyUrl),
            auth: "auto",
            allowRefresh: false,
          });
          if (resp.ok) {
            const blob = await responseToBlob(resp);
            const du = await blobToDataUrl(blob);
            if (du.startsWith("data:image/")) localDataUrl = du;
          }
        } catch {
          // Proxy fetch failed — CanvasImageLayer will fall back to loading d.url directly.
        }
      }

      const payload: StoredImageAsset = {
        id: asset.id,
        url: asset.url,
        src: asset.url,
        remoteUrl: asset.url,
        fileName: displayFileName,
        width: asset.width,
        height: asset.height,
        contentType: asset.contentType,
        localDataUrl,
      };

      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: {
            imageData: payload,
            fileName: displayFileName,
            operationType: "manual",
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("图片已发送到画板", "Image sent to canvas"), type: "success" },
        })
      );
      return;
    }

    if (asset.type === "3d") {
      const modelAsset = asset as PersonalModelAsset;
      const modelData: Model3DData = {
        url: modelAsset.url,
        key: modelAsset.key,
        path: modelAsset.path || modelAsset.url,
        format: modelAsset.format,
        fileName: modelAsset.fileName || modelAsset.name,
        fileSize: modelAsset.fileSize ?? 0,
        defaultScale: modelAsset.defaultScale || { x: 1, y: 1, z: 1 },
        defaultRotation: modelAsset.defaultRotation || { x: 0, y: 0, z: 0 },
        timestamp: modelAsset.updatedAt || Date.now(),
        camera: modelAsset.camera,
      };
      window.dispatchEvent(
        new CustomEvent("canvas:insert-model3d", {
          detail: {
            modelData,
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("3D 模型已发送到画板", "3D model sent to canvas"), type: "success" },
        })
      );
    }

    if (asset.type === "svg") {
      const svgAsset = asset as PersonalSvgAsset;
      const displayFileName = svgAsset.fileName || `${svgAsset.name}.svg`;

      window.dispatchEvent(
        new CustomEvent("canvas:insert-svg", {
          detail: {
            fileName: displayFileName,
            asset: {
              id: svgAsset.id,
              url: svgAsset.url,
              svgContent: svgAsset.svgContent,
              width: svgAsset.width,
              height: svgAsset.height,
              name: svgAsset.name,
              fileName: displayFileName,
            },
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("SVG 已发送到画板", "SVG sent to canvas"), type: "success" },
        })
      );
    }
  };

  const handleHistoryDownload = (item: GlobalImageHistoryItem) => {
    const mediaUrl = getGlobalHistoryMediaUrl(item);
    if (!mediaUrl) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: lt("历史记录缺少可用链接", "History item has no usable URL"),
            type: "warning",
          },
        })
      );
      return;
    }

    try {
      const link = document.createElement("a");
      link.href = mediaUrl;
      link.download = getGlobalHistoryDownloadFileName(item);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(mediaUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleTeamAssetSendToCanvas = React.useCallback(
    (asset: MaterialAssetDto) => {
      const imageUrl = getAssetImageUrl(asset);
      if (!imageUrl) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: lt("该团队素材缺少可用图片链接", "This team asset has no usable image URL"),
              type: "warning",
            },
          })
        );
        return;
      }
      const data = (asset.latestVersion?.data ?? {}) as Record<string, unknown>;
      const fileName = asset.name || "team-asset.png";
      const placementId = `team-material-${asset.id}-${Date.now()}-${Math.floor(
        Math.random() * 1e6
      )}`;
      const payload: StoredImageAsset = {
        id: placementId,
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
          detail: {
            imageData: payload,
            fileName,
            operationType: "manual",
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("团队素材已发送到画布", "Team asset sent to canvas"), type: "success" },
        })
      );
    },
    [lt]
  );

  const handleTeamAssetDownload = React.useCallback((asset: MaterialAssetDto) => {
    const imageUrl = getAssetImageUrl(asset);
    if (!imageUrl) return;
    try {
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = asset.name || "team-asset";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  }, []);

  const handleTeamAssetDelete = React.useCallback(
    async (asset: MaterialAssetDto) => {
      if (!confirm(lt(`确定要删除「${asset.name}」吗？`, `Delete "${asset.name}"?`))) {
        return;
      }
      try {
        await deleteTeamMaterialAsset(asset.id);
        setTeamAssets((prev) => prev.filter((item) => item.id !== asset.id));
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: lt("团队素材已删除", "Team asset deleted"), type: "success" },
          })
        );
      } catch (error) {
        console.warn("[LibraryPanel] 删除团队素材失败:", error);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: lt("删除失败，请稍后重试", "Delete failed. Please try again."), type: "error" },
          })
        );
      }
    },
    [lt]
  );

  const handleTeamAssetUpload = React.useCallback(
    async (file: File, kind: MaterialKindDto = "text") => {
      if (!effectiveTeamLibraryTeamId) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: lt("请先选择团队", "Select a team first"), type: "warning" },
          })
        );
        return;
      }
      setTeamAssetUploading(true);
      try {
        const uploaded = await uploadToOSS(file, {
          dir: "material-library/",
          projectId: currentProjectId,
          fileName: file.name,
          contentType: file.type,
        });
        if (!uploaded.success || !uploaded.url) {
          throw new Error(uploaded.error || "upload failed");
        }
        const initialData: Record<string, unknown> = {
          imageUrl: uploaded.url,
          url: uploaded.url,
          contentType: file.type,
          fileSize: file.size,
        };
        if (uploaded.key) initialData.ossKey = uploaded.key;
        const created = await createTeamMaterialAsset({
          teamId: effectiveTeamLibraryTeamId,
          kind,
          name: file.name.replace(/\.[^.]+$/, "") || file.name,
          initialData,
          folderId: teamUploadFolderId ?? undefined,
        });
        const [assets, folders] = await Promise.all([
          listTeamMaterialAssets({ teamId: effectiveTeamLibraryTeamId }),
          listMaterialFolders({ teamId: effectiveTeamLibraryTeamId }),
        ]);
        setTeamAssets(Array.isArray(assets) ? assets : [created]);
        setTeamFolders(Array.isArray(folders) ? folders : teamFolders);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: lt("团队素材上传成功", "Team asset uploaded"), type: "success" },
          })
        );
      } catch (error) {
        console.warn("[LibraryPanel] 上传团队素材失败:", error);
        const message = error instanceof Error ? error.message : "";
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: message
                ? lt(`上传失败：${message}`, `Upload failed: ${message}`)
                : lt("上传失败，请稍后重试", "Upload failed. Please try again."),
              type: "error",
            },
          })
        );
      } finally {
        setTeamAssetUploading(false);
        resetFileInput();
      }
    },
    [currentProjectId, effectiveTeamLibraryTeamId, lt, teamFolders, teamUploadFolderId]
  );

  const handleCreateTeamFolder = React.useCallback(async () => {
    if (!effectiveTeamLibraryTeamId) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("请先选择团队", "Select a team first"), type: "warning" },
        })
      );
      return;
    }
    const name = window.prompt(lt("新建文件夹名称", "New folder name"));
    const trimmed = name?.trim();
    if (!trimmed) return;
    try {
      const folder = await createMaterialFolder({
        teamId: effectiveTeamLibraryTeamId,
        name: trimmed,
      });
      const folders = await listMaterialFolders({ teamId: effectiveTeamLibraryTeamId });
      setTeamFolders(Array.isArray(folders) ? folders : [folder]);
      setOpenTeamFolderIds((prev) => [...prev, folder.id]);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("文件夹已创建", "Folder created"), type: "success" },
        })
      );
    } catch (error) {
      console.warn("[LibraryPanel] 创建团队文件夹失败:", error);
      const message = error instanceof Error ? error.message : "";
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: message
              ? lt(`创建失败：${message}`, `Create failed: ${message}`)
              : lt("创建失败，请稍后重试", "Create failed. Please try again."),
            type: "error",
          },
        })
      );
    }
  }, [effectiveTeamLibraryTeamId, lt]);

  const handleRenameTeamFolder = React.useCallback(
    async (folder: MaterialFolderDto) => {
      const name = window.prompt(lt("重命名文件夹", "Rename folder"), folder.name);
      const trimmed = name?.trim();
      if (!trimmed || trimmed === folder.name) return;
      try {
        const updated = await updateMaterialFolder(folder.id, { name: trimmed });
        setTeamFolders((prev) =>
          prev.map((item) => (item.id === folder.id ? updated : item))
        );
      } catch (error) {
        console.warn("[LibraryPanel] 重命名团队文件夹失败:", error);
      }
    },
    [lt]
  );

  const handleDeleteTeamFolder = React.useCallback(
    async (folder: MaterialFolderDto) => {
      if (!confirm(lt(`确定要删除「${folder.name}」吗？`, `Delete "${folder.name}"?`))) {
        return;
      }
      try {
        await deleteMaterialFolder(folder.id);
        setTeamFolders((prev) => prev.filter((item) => item.id !== folder.id));
        setTeamAssets((prev) =>
          prev.map((asset) =>
            asset.folderId === folder.id ? { ...asset, folderId: null } : asset
          )
        );
      } catch (error) {
        console.warn("[LibraryPanel] 删除团队文件夹失败:", error);
      }
    },
    [lt]
  );

  const handleMoveTeamAsset = React.useCallback(
    async (asset: MaterialAssetDto, folderId: string | null) => {
      try {
        const updated = await updateTeamMaterialAsset(asset.id, { folderId });
        setTeamAssets((prev) =>
          prev.map((item) => (item.id === asset.id ? updated : item))
        );
      } catch (error) {
        console.warn("[LibraryPanel] 移动团队素材失败:", error);
      }
    },
    []
  );

  const handleRemoveHistoryItem = async (item: GlobalImageHistoryItem) => {
    if (
      !confirm(
        lt(
          `确定要删除这条历史记录吗？`,
          `Delete this history item?`
        )
      )
    ) {
      return;
    }

    try {
      await globalImageHistoryApi.delete(item.id);
      if (activeTab === "project-history") {
        const result = await globalImageHistoryApi.list({
          limit: HISTORY_PAGE_SIZE,
          page: projectHistoryPage,
          sourceType: projectHistoryQueryOptions.sourceType,
          search: projectHistoryQueryOptions.search,
          sourceProjectId: currentProjectId || undefined,
        });
        setProjectHistoryItems(Array.isArray(result.items) ? result.items : []);
        setProjectHistoryTotalCount(result.totalCount ?? result.items.length);
        setProjectHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
        if (
          typeof result.page === "number" &&
          Number.isFinite(result.page) &&
          result.page !== projectHistoryPage
        ) {
          setProjectHistoryPage(Math.max(1, Math.trunc(result.page)));
        }
      } else {
        const result = await globalImageHistoryApi.list({
          limit: HISTORY_PAGE_SIZE,
          page: historyPage,
          sourceType: historyQueryOptions.sourceType,
          search: historyQueryOptions.search,
        });
        setHistoryItems(Array.isArray(result.items) ? result.items : []);
        setHistoryTotalCount(result.totalCount ?? result.items.length);
        setHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
        if (
          typeof result.page === "number" &&
          Number.isFinite(result.page) &&
          result.page !== historyPage
        ) {
          setHistoryPage(Math.max(1, Math.trunc(result.page)));
        }
      }
      setSelectedHistoryItem(null);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: lt("历史记录已删除", "History item deleted"),
            type: "success",
          },
        })
      );
    } catch (error) {
      console.warn("[LibraryPanel] 删除历史记录失败:", error);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: lt("删除失败，请稍后重试", "Delete failed. Please try again."),
            type: "error",
          },
        })
      );
    }
  };

  const handleHistorySendToCanvas = async (item: GlobalImageHistoryItem) => {
    const mediaUrl = getGlobalHistoryMediaUrl(item);
    if (!mediaUrl) {
      alert(lt("历史记录缺少可用链接，无法发送到画板", "History item has no usable URL and cannot be sent to canvas."));
      return;
    }

    const displayFileName = getGlobalHistoryDownloadFileName(item);
    if (isGlobalHistoryVideoItem(item)) {
      window.dispatchEvent(
        new CustomEvent("canvas:insert-video", {
          detail: {
            asset: {
              id: item.id,
              url: mediaUrl,
              thumbnail: getGlobalHistoryVideoThumbnail(item),
              fileName: displayFileName,
              contentType: "video/mp4",
              sourceUrl: mediaUrl,
              metadata: item.metadata,
            },
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("历史视频已发送到画板", "History video sent to canvas"), type: "success" },
        })
      );
      return;
    }

    const dataUrl = await readDataUrl(mediaUrl);
    const payload: string | StoredImageAsset = dataUrl
      ? dataUrl
      : {
          id: item.id,
          url: mediaUrl,
          src: mediaUrl,
          fileName: displayFileName,
        };

    window.dispatchEvent(
      new CustomEvent("triggerQuickImageUpload", {
        detail: {
          imageData: payload,
          fileName: displayFileName,
          operationType: "manual",
        },
      })
    );
    window.dispatchEvent(
      new CustomEvent("toast", {
        detail: { message: lt("历史图片已发送到画板", "History image sent to canvas"), type: "success" },
      })
    );
  };

  const handleClose = () => {
    if (isModal) {
      onClose?.();
    } else {
      setShowLibraryPanel(false);
    }
    setSelectedAsset(null);
    setSelectedHistoryItem(null);
    setPreviewState(null);
  };

  // 选择模式：拿到一张图片 URL + 名称 → 回填风格锚定参考图 → 关闭弹窗。
  // 无图片 URL（3D/视频/空素材）时不触发选择。
  const handleSelectAsset = (
    url: string | undefined | null,
    name?: string
  ) => {
    const normalized = typeof url === "string" ? url.trim() : "";
    if (!normalized) return;
    onSelectAsset?.(normalized, name);
    onClose?.();
  };

  const openImagePreview = React.useCallback(
    (src: string | undefined | null, title: string) => {
      const normalized = typeof src === "string" ? src.trim() : "";
      if (!normalized) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: lt("当前素材暂无可预览内容", "No preview available for this asset"),
              type: "warning",
            },
          })
        );
        return;
      }
      setPreviewState({ src: normalized, title });
    },
    [lt]
  );

  const getAssetPreviewSrc = React.useCallback((asset: PersonalLibraryAsset) => {
    if (asset.type === "2d" || asset.type === "svg") {
      return asset.thumbnail || asset.url;
    }
    return (asset as PersonalModelAsset).thumbnail || "";
  }, []);

  const handleAssetDoubleClick = React.useCallback(
    (asset: PersonalLibraryAsset) => {
      openImagePreview(
        getAssetPreviewSrc(asset),
        asset.name || lt("素材预览", "Asset Preview")
      );
    },
    [getAssetPreviewSrc, lt, openImagePreview]
  );

  const handleHistoryItemDoubleClick = React.useCallback(
    (item: GlobalImageHistoryItem) => {
      if (isGlobalHistoryVideoItem(item)) {
        setSelectedHistoryItem(item);
        setSelectedAsset(null);
        return;
      }
      openImagePreview(getGlobalHistoryMediaUrl(item), getHistoryItemTitle(item));
    },
    [getHistoryItemTitle, openImagePreview]
  );

  const handleHistoryItemClick = (item: GlobalImageHistoryItem) => {
    setSelectedHistoryItem(item);
    setSelectedAsset(null);
  };

  const handleAssetClick = (asset: PersonalLibraryAsset) => {
    setSelectedAsset(asset);
    setSelectedHistoryItem(null);
  };

  // 拖拽开始处理
  const handleDragStart = (
    asset: PersonalLibraryAsset,
    event: React.DragEvent
  ) => {
    // 设置拖拽数据
    if (asset.type === "2d") {
      // 2D 图片：设置 URL，DrawingController 会自动处理
      event.dataTransfer.setData("text/uri-list", asset.url);
      event.dataTransfer.setData("text/plain", asset.url);
      event.dataTransfer.setData(
        "application/x-tanva-asset",
        JSON.stringify({
          type: "2d",
          id: asset.id,
          url: asset.url,
          name: asset.name,
          fileName: asset.fileName,
        })
      );
    } else if (asset.type === "3d") {
      // 3D 模型：设置自定义数据
      const modelAsset = asset as PersonalModelAsset;
      event.dataTransfer.setData(
        "application/x-tanva-asset",
        JSON.stringify({
          type: "3d",
          id: modelAsset.id,
          url: modelAsset.url,
          name: modelAsset.name,
          fileName: modelAsset.fileName,
          format: modelAsset.format,
          key: modelAsset.key,
          path: modelAsset.path,
          defaultScale: modelAsset.defaultScale,
          defaultRotation: modelAsset.defaultRotation,
          camera: modelAsset.camera,
          fileSize: modelAsset.fileSize,
          updatedAt: modelAsset.updatedAt,
        })
      );
    } else if (asset.type === "svg") {
      const svgAsset = asset as PersonalSvgAsset;
      event.dataTransfer.setData("text/uri-list", svgAsset.url);
      event.dataTransfer.setData("text/plain", svgAsset.url);
      event.dataTransfer.setData(
        "application/x-tanva-asset",
        JSON.stringify({
          type: "svg",
          id: svgAsset.id,
          url: svgAsset.url,
          name: svgAsset.name,
          fileName: svgAsset.fileName,
          width: svgAsset.width,
          height: svgAsset.height,
          svgContent: svgAsset.svgContent,
        })
      );
    }
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleHistoryDragStart = (
    item: GlobalImageHistoryItem,
    event: React.DragEvent
  ) => {
    const mediaUrl = getGlobalHistoryMediaUrl(item);
    if (!mediaUrl) {
      event.preventDefault();
      return;
    }

    const isVideo = isGlobalHistoryVideoItem(item);
    event.dataTransfer.setData("text/uri-list", mediaUrl);
    event.dataTransfer.setData("text/plain", mediaUrl);
    event.dataTransfer.setData(
      "application/x-tanva-asset",
      JSON.stringify(
        isVideo
          ? {
              type: "video",
              id: item.id,
              url: mediaUrl,
              thumbnail: getGlobalHistoryVideoThumbnail(item),
              name: item.prompt || lt("历史视频", "History Video"),
              fileName: getGlobalHistoryDownloadFileName(item),
              contentType: "video/mp4",
              metadata: item.metadata,
            }
          : {
              type: "2d",
              id: item.id,
              url: mediaUrl,
              name: item.prompt || lt("历史图片", "History Image"),
              fileName: getGlobalHistoryDownloadFileName(item),
            }
      )
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  // 拖拽结束处理（用于 3D 模型）
  React.useEffect(() => {
    const handleDrop = (event: DragEvent) => {
      const assetData = event.dataTransfer?.getData(
        "application/x-tanva-asset"
      );
      if (!assetData) return;

      try {
        const asset = JSON.parse(assetData);
        if (asset.type === "3d") {
          // 3D 模型需要通过自定义事件处理
          const modelData: Model3DData = {
            url: asset.url,
            key: asset.key,
            path: asset.path || asset.url,
            format: asset.format,
            fileName: asset.fileName || asset.name,
            fileSize: asset.fileSize ?? 0,
            defaultScale: asset.defaultScale || { x: 1, y: 1, z: 1 },
            defaultRotation: asset.defaultRotation || { x: 0, y: 0, z: 0 },
            timestamp: asset.updatedAt || Date.now(),
            camera: asset.camera,
          };
          window.dispatchEvent(
            new CustomEvent("canvas:insert-model3d", {
              detail: { modelData },
            })
          );
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: lt("3D 模型已添加到画板", "3D model added to canvas"), type: "success" },
            })
          );
        }
      } catch (error) {
        console.warn("[LibraryPanel] 解析拖拽数据失败:", error);
      }
    };

    // 监听从画布拖拽到库的事件
    const handleAddToLibrary = (
      event: CustomEvent<{
        type: "2d" | "3d" | "svg";
        url: string;
        name?: string;
        fileName?: string;
        width?: number;
        height?: number;
        contentType?: string;
      }>
    ) => {
      const { type, url, name, fileName, width, height, contentType } =
        event.detail;
      if (!url) return;

      if (type === "2d") {
        const id = createPersonalAssetId("pl2d");
        const imageAsset: PersonalImageAsset = {
          id,
          type: "2d",
          name: name || fileName?.replace(/\.[^/.]+$/, "") || lt("画布图片", "Canvas Image"),
          url,
          thumbnail: url,
          width,
          height,
          fileName: fileName || lt("画布图片.png", "canvas-image.png"),
          contentType: contentType || "image/png",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        addAsset(imageAsset);
        void personalLibraryApi.upsert(imageAsset).catch((error) => {
          console.warn("[LibraryPanel] 同步图片资源到个人库失败:", error);
        });
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: lt("图片已添加到个人库", "Image added to personal library"), type: "success" },
          })
        );
        setLibraryDragHovering(false);
      }
    };

    window.addEventListener("drop", handleDrop);
    window.addEventListener(
      "canvas:add-to-library",
      handleAddToLibrary as EventListener
    );
    return () => {
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener(
        "canvas:add-to-library",
        handleAddToLibrary as EventListener
      );
    };
  }, [addAsset, lt]);

  // 点击外部关闭详情面板
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        detailPanelRef.current &&
        !detailPanelRef.current.contains(event.target as Node)
      ) {
        // 检查是否点击的是缩略图
        const target = event.target as HTMLElement;
        if (!target.closest("[data-library-thumbnail]")) {
          setSelectedAsset(null);
          setSelectedHistoryItem(null);
        }
      }
    };

    if (selectedAsset || selectedHistoryItem) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [selectedAsset, selectedHistoryItem]);

  // 打开面板时从后端拉取个人库，避免仅依赖 localStorage
  React.useEffect(() => {
    if (!panelActive) return;
    let cancelled = false;
    void personalLibraryApi
      .list()
      .then((assets) => {
        if (cancelled) return;
        if (Array.isArray(assets) && assets.length) {
          mergeAssets(assets);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[LibraryPanel] 拉取个人库失败:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panelActive, mergeAssets]);

  React.useEffect(() => {
    setHistoryPage(1);
  }, [historyQueryOptions.search, historyQueryOptions.sourceType]);
  React.useEffect(() => {
    setProjectHistoryPage(1);
  }, [projectHistoryQueryOptions.search, projectHistoryQueryOptions.sourceType]);

  React.useEffect(() => {
    if (isInTeamWorkspace) return;
    const firstTeamId = joinedTeams[0]?.id ?? "";
    if (
      !selectedTeamLibraryTeamId ||
      !joinedTeams.some((team) => team.id === selectedTeamLibraryTeamId)
    ) {
      setSelectedTeamLibraryTeamId(firstTeamId);
    }
  }, [isInTeamWorkspace, joinedTeams, selectedTeamLibraryTeamId]);

  React.useEffect(() => {
    if (!panelActive || activeTab !== "global-history") return;
    if (!effectiveTeamLibraryTeamId) {
      setTeamAssets([]);
      setTeamFolders([]);
      setTeamLibraryIsLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setTeamLibraryIsLoading(true);
      void Promise.all([
        listTeamMaterialAssets({ teamId: effectiveTeamLibraryTeamId }),
        listMaterialFolders({ teamId: effectiveTeamLibraryTeamId }),
      ])
        .then(([assets, folders]) => {
          if (cancelled) return;
          setTeamAssets(Array.isArray(assets) ? assets : []);
          setTeamFolders(Array.isArray(folders) ? folders : []);
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn("[LibraryPanel] 拉取团队库失败:", error);
            setTeamAssets([]);
            setTeamFolders([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setTeamLibraryIsLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [panelActive, activeTab, effectiveTeamLibraryTeamId]);

  React.useEffect(() => {
    if (!panelActive || activeTab !== "global-history") return;
    const shouldFetchLegacyGlobalHistory = false;
    if (!shouldFetchLegacyGlobalHistory) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setHistoryIsLoading(true);
      void globalImageHistoryApi
        .list({
          limit: HISTORY_PAGE_SIZE,
          page: historyPage,
          sourceType: historyQueryOptions.sourceType,
          search: historyQueryOptions.search,
        })
        .then((result) => {
          if (cancelled) return;
          setHistoryItems(Array.isArray(result.items) ? result.items : []);
          setHistoryTotalCount(result.totalCount ?? result.items.length);
          setHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
          if (
            typeof result.page === "number" &&
            Number.isFinite(result.page) &&
            result.page !== historyPage
          ) {
            setHistoryPage(Math.max(1, Math.trunc(result.page)));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn("[LibraryPanel] 拉取全局历史失败:", error);
            setHistoryItems([]);
            setHistoryTotalPages(1);
            setHistoryTotalCount(0);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setHistoryIsLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    panelActive,
    activeTab,
    historyPage,
    historyQueryOptions.search,
    historyQueryOptions.sourceType,
  ]);

  React.useEffect(() => {
    if (!panelActive || activeTab !== "project-history") return;
    if (!currentProjectId) {
      setProjectHistoryItems([]);
      setProjectHistoryTotalCount(0);
      setProjectHistoryTotalPages(1);
      setProjectHistoryIsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setProjectHistoryIsLoading(true);
      void globalImageHistoryApi
        .list({
          limit: HISTORY_PAGE_SIZE,
          page: projectHistoryPage,
          sourceType: projectHistoryQueryOptions.sourceType,
          search: projectHistoryQueryOptions.search,
          sourceProjectId: currentProjectId,
        })
        .then((result) => {
          if (cancelled) return;
          setProjectHistoryItems(Array.isArray(result.items) ? result.items : []);
          setProjectHistoryTotalCount(result.totalCount ?? result.items.length);
          setProjectHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
          if (
            typeof result.page === "number" &&
            Number.isFinite(result.page) &&
            result.page !== projectHistoryPage
          ) {
            setProjectHistoryPage(Math.max(1, Math.trunc(result.page)));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn("[LibraryPanel] 拉取项目库失败:", error);
            setProjectHistoryItems([]);
            setProjectHistoryTotalPages(1);
            setProjectHistoryTotalCount(0);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setProjectHistoryIsLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    panelActive,
    activeTab,
    currentProjectId,
    projectHistoryPage,
    projectHistoryQueryOptions.search,
    projectHistoryQueryOptions.sourceType,
  ]);

  React.useEffect(() => {
    if (!selectedHistoryItem) return;
    const sourceItems =
      activeTab === "project-history" ? projectHistoryItems : historyItems;
    if (!sourceItems.some((item) => item.id === selectedHistoryItem.id)) {
      setSelectedHistoryItem(null);
    }
  }, [activeTab, historyItems, projectHistoryItems, selectedHistoryItem]);

  const isProjectHistoryTab = activeTab === "project-history";
  const activeHistoryItems = isProjectHistoryTab
    ? projectHistoryItems
    : historyItems;
  const activeHistoryIsLoading = isProjectHistoryTab
    ? projectHistoryIsLoading
    : historyIsLoading;
  const activeHistoryFilterType = isProjectHistoryTab
    ? projectHistoryFilterType
    : historyFilterType;
  const activeHistorySearchQuery = isProjectHistoryTab
    ? projectHistorySearchQuery
    : historySearchQuery;
  const activeHistoryPage = isProjectHistoryTab ? projectHistoryPage : historyPage;
  const activeHistoryTotalPages = isProjectHistoryTab
    ? projectHistoryTotalPages
    : historyTotalPages;
  const activeHistoryTotalCount = isProjectHistoryTab
    ? projectHistoryTotalCount
    : historyTotalCount;
  const activeHistoryPageSlots = isProjectHistoryTab
    ? projectHistoryPageSlots
    : historyPageSlots;
  const selectedHistoryIsVideo = selectedHistoryItem
    ? isGlobalHistoryVideoItem(selectedHistoryItem)
    : false;
  const selectedHistoryMediaUrl = selectedHistoryItem
    ? getGlobalHistoryMediaUrl(selectedHistoryItem)
    : "";
  const selectedHistoryVideoThumbnail = selectedHistoryItem
    ? getGlobalHistoryVideoThumbnail(selectedHistoryItem)
    : undefined;
  const selectedHistoryTitle = selectedHistoryItem
    ? getHistoryItemTitle(selectedHistoryItem)
    : "";

  // 面板关闭时隐藏
  if (!panelActive) return null;

  // 详情面板（仅 panel 变体使用；modal 选择器不展示详情）。
  const detailPanels = (
    <>
      {/* 详情面板 - 在库面板左侧弹出 */}
      {activeTab === "manual" && selectedAsset && (
        <div
          ref={detailPanelRef}
          className='fixed right-[336px] w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-[1101] overflow-x-hidden overflow-y-auto'
          style={LIBRARY_DETAIL_PANEL_STYLE}
        >
          {/* 预览图 */}
          <div className='w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden'>
            {selectedAsset.type === "2d" || selectedAsset.type === "svg" ? (
              <SmartImage
                src={selectedAsset.thumbnail || selectedAsset.url}
                alt={selectedAsset.name}
                className='w-full h-full object-contain'
              />
            ) : (
              <ModelPreview
                asset={selectedAsset as PersonalModelAsset}
                onThumbnailReady={handleModelThumbnailUpdate}
                large
              />
            )}
          </div>

          {/* 资源信息 */}
          <div className='p-3 space-y-2'>
            {/* 类型标签 */}
            <div className='flex items-center gap-2'>
              {(() => {
                const typeInfo = getTypeLabel(selectedAsset.type);
                return (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeInfo.bgColor}`}
                  >
                    {typeInfo.icon}
                    {typeInfo.label}
                  </span>
                );
              })()}
            </div>

            {/* 名称 */}
            <div>
              <div
                className='text-sm font-medium text-gray-900 truncate'
                title={selectedAsset.name}
              >
                {selectedAsset.name}
              </div>
            </div>

            {/* 尺寸/格式 */}
            {selectedAsset.type === "2d" || selectedAsset.type === "svg" ? (
              <div>
                <div className='text-xs text-gray-500'>{lt("尺寸", "Dimensions")}</div>
                <div className='text-sm text-gray-700'>
                  {(selectedAsset as PersonalImageAsset | PersonalSvgAsset)
                    .width ?? "-"}{" "}
                  ×{" "}
                  {(selectedAsset as PersonalImageAsset | PersonalSvgAsset)
                    .height ?? "-"}
                </div>
              </div>
            ) : (
              <div>
                <div className='text-xs text-gray-500'>{lt("格式", "Format")}</div>
                <div className='text-sm text-gray-700'>
                  {(
                    selectedAsset as PersonalModelAsset
                  ).format?.toUpperCase() ?? "-"}
                </div>
              </div>
            )}

            {/* 文件大小 */}
            <div>
              <div className='text-xs text-gray-500'>{lt("大小", "Size")}</div>
              <div className='text-sm text-gray-700'>
                {formatSize(selectedAsset.fileSize)}
              </div>
            </div>

            {/* 更新时间 */}
            <div>
              <div className='text-xs text-gray-500'>{lt("更新时间", "Updated")}</div>
              <div className='text-sm text-gray-700'>
                {formatDate(selectedAsset.updatedAt)}
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className='p-3 pt-0 flex justify-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => void handleSendToCanvas(selectedAsset)}
              title={lt("发送到画板", "Send to canvas")}
            >
              <Send className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => handleDownload(selectedAsset)}
              title={lt("下载", "Download")}
            >
              <Download className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => handleRemoveAsset(selectedAsset)}
              title={lt("删除", "Delete")}
            >
              <Trash2 className='h-3 w-3' />
            </Button>
          </div>
        </div>
      )}
      {(activeTab === "global-history" || activeTab === "project-history") &&
        selectedHistoryItem && (
        <div
          ref={detailPanelRef}
          className='fixed right-[336px] w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-[1101] overflow-x-hidden overflow-y-auto'
          style={LIBRARY_DETAIL_PANEL_STYLE}
        >
          <div className='w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden'>
            {selectedHistoryIsVideo ? (
              selectedHistoryMediaUrl ? (
                <video
                  src={selectedHistoryMediaUrl}
                  poster={selectedHistoryVideoThumbnail}
                  className='w-full h-full object-contain bg-black'
                  controls
                  playsInline
                  preload='metadata'
                />
              ) : (
                <div className='flex h-full w-full items-center justify-center text-gray-400'>
                  <Film className='h-8 w-8' />
                </div>
              )
            ) : (
              <SmartImage
                src={selectedHistoryMediaUrl}
                alt={selectedHistoryTitle}
                className='w-full h-full object-contain'
              />
            )}
          </div>

          <div className='p-3 space-y-2'>
            <div className='flex items-center gap-2'>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                  selectedHistoryIsVideo
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {selectedHistoryIsVideo ? (
                  <Film className='w-3 h-3' />
                ) : (
                  <ImageIcon className='w-3 h-3' />
                )}
                {selectedHistoryIsVideo ? "VID" : "IMG"}
              </span>
            </div>

            <div>
              <div
                className='text-sm font-medium text-gray-900 truncate'
                title={selectedHistoryTitle}
              >
                {selectedHistoryTitle}
              </div>
            </div>

            <div>
              <div className='text-xs text-gray-500'>{lt("类型", "Type")}</div>
              <div className='text-sm text-gray-700'>
                {getSourceTypeLabel(selectedHistoryItem.sourceType)}
              </div>
            </div>

            <div>
              <div className='text-xs text-gray-500'>
                {lt("来源项目", "Source Project")}
              </div>
              <div
                className='text-sm text-gray-700 truncate'
                title={selectedHistoryItem.sourceProjectName || "-"}
              >
                {selectedHistoryItem.sourceProjectName || "-"}
              </div>
            </div>

            <div>
              <div className='text-xs text-gray-500'>{lt("创建时间", "Created")}</div>
              <div className='text-sm text-gray-700'>
                {formatDate(new Date(selectedHistoryItem.createdAt).getTime())}
              </div>
            </div>
          </div>

          <div className='p-3 pt-0 flex justify-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => void handleHistorySendToCanvas(selectedHistoryItem)}
              title={lt("发送到画板", "Send to canvas")}
            >
              <Send className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => handleHistoryDownload(selectedHistoryItem)}
              title={lt("下载", "Download")}
            >
              <Download className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => void handleRemoveHistoryItem(selectedHistoryItem)}
              title={lt("删除", "Delete")}
            >
              <Trash2 className='h-3 w-3' />
            </Button>
          </div>
        </div>
      )}
    </>
  );

  // 主面板内容（tabs + 资源网格 + 底部），panel / modal 两种外壳共用。
  const panelBody = (
    <>
      {isLibraryDragHovering && (
          <div className='pointer-events-none absolute inset-0 z-[1110] flex items-start justify-center px-3 pt-3'>
            <div className='w-full h-24 rounded-xl border-2 border-dashed border-blue-400/80 bg-blue-50/85 text-blue-700 flex items-center justify-center font-medium shadow-[0_10px_30px_rgba(59,130,246,0.15)] backdrop-blur-sm'>
              {lt("松开添加到库", "Release to add to library")}
            </div>
          </div>
        )}
        {/* 面板头部 */}
        <div className='flex items-center justify-between px-4 pt-6 pb-4'>
          <Button
            variant='ghost'
            size='sm'
            className='h-8 w-8 p-0 text-gray-600 hover:text-gray-800 bg-transparent'
            onClick={handleClose}
            title={lt("收起库面板", "Collapse library panel")}
            aria-label={lt("收起库面板", "Collapse library panel")}
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
          <h2 className='text-lg font-semibold text-gray-800'>{lt("库", "Library")}</h2>
        </div>

        {/* 分隔线 */}
        <div className='mx-4 h-px bg-gray-200' />

        {/* 标签切换 */}
        <div className='px-3 pt-3 pb-2'>
          <div className='tanva-library-tabs grid grid-cols-3 gap-2 rounded-xl bg-gray-100 p-1'>
            <button
              type='button'
              className={`tanva-library-tab h-8 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "manual"
                  ? "tanva-library-tab-active bg-white text-gray-800 shadow-sm"
                  : "tanva-library-tab-inactive text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("manual")}
            >
              {lt("个人库", "Personal")}
            </button>
            <button
              type='button'
              className={`tanva-library-tab h-8 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "global-history"
                  ? "tanva-library-tab-active bg-white text-gray-800 shadow-sm"
                  : "tanva-library-tab-inactive text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("global-history")}
            >
              {lt("团队库", "Team")}
            </button>
            <button
              type='button'
              className={`tanva-library-tab h-8 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "project-history"
                  ? "tanva-library-tab-active bg-white text-gray-800 shadow-sm"
                  : "tanva-library-tab-inactive text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("project-history")}
            >
              {lt("项目库", "Project")}
            </button>
          </div>
        </div>

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type='file'
          accept={
            activeTab === "global-history"
              ? "image/png,image/jpeg,image/jpg,image/gif,image/webp"
              : "image/png,image/jpeg,image/jpg,image/gif,image/webp,.glb,.gltf"
          }
          onChange={(event) => {
            if (activeTab === "global-history") {
              const file = event.target.files?.[0];
              if (!file) return;
              void handleTeamAssetUpload(file);
              return;
            }
            void handleUploadFiles(event);
          }}
          style={{ display: "none" }}
        />

        {/* 资源网格 */}
        <div className='flex-1 min-h-0 overflow-y-auto'>
          {activeTab === "manual" ? (
            <div className='p-3'>
              <div className='grid grid-cols-3 gap-2'>
                {/* 资源列表 */}
                {allAssets.map((asset) => {
                  const is2dOrSvg = asset.type === "2d" || asset.type === "svg";
                  const isSelected = selectedAsset?.id === asset.id;
                  const typeLabel =
                    asset.type === "2d"
                      ? "IMG"
                      : asset.type === "3d"
                      ? "3D"
                      : "SVG";

                  return (
                    <div
                      key={asset.id}
                      data-library-thumbnail
                      draggable
                      className={`aspect-square rounded-lg overflow-hidden bg-gray-100 transition-all hover:ring-2 hover:ring-blue-400 relative ${
                        selectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
                      } ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                      onClick={() => {
                        if (selectMode) {
                          if (is2dOrSvg) {
                            handleSelectAsset(asset.url || asset.thumbnail, asset.name);
                          }
                          return;
                        }
                        handleAssetClick(asset);
                      }}
                      onDoubleClick={() => handleAssetDoubleClick(asset)}
                      onDragStart={(e) => handleDragStart(asset, e)}
                    >
                      {is2dOrSvg ? (
                        <SmartImage
                          src={asset.thumbnail || asset.url}
                          alt={asset.name}
                          className='w-full h-full object-cover'
                          draggable={false}
                        />
                      ) : (
                        <ModelPreview
                          asset={asset as PersonalModelAsset}
                          onThumbnailReady={handleModelThumbnailUpdate}
                        />
                      )}
                      {/* 类型标签 */}
                      <div className='absolute bottom-1 right-1 px-1 py-0.5 bg-black/60 text-white text-[8px] font-medium rounded'>
                        {typeLabel}
                      </div>
                    </div>
                  );
                })}

                {/* 上传按钮方格 - 放在最后（选择模式下隐藏） */}
                {!selectMode && (
                  <div
                    className='tanva-library-upload-tile aspect-square rounded-lg overflow-hidden bg-gray-50 border border-gray-200 cursor-pointer transition-all hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center'
                    onClick={triggerUpload}
                  >
                    {isUploading ? (
                      <div className='text-gray-400 text-xs'>{lt("上传中...", "Uploading...")}</div>
                    ) : (
                      <Plus className='w-8 h-8 text-gray-400' />
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "global-history" ? (
            <div className='p-3 space-y-3'>
              {!isInTeamWorkspace && joinedTeams.length > 0 ? (
                <select
                  value={effectiveTeamLibraryTeamId}
                  onChange={(event) => setSelectedTeamLibraryTeamId(event.target.value)}
                  className='tanva-library-filter-select h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400'
                >
                  {joinedTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : null}

              <div className='flex gap-2'>
                <div className='relative flex-1'>
                  <Search className='pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400' />
                  <input
                    type='text'
                    value={teamLibrarySearchQuery}
                    onChange={(event) => setTeamLibrarySearchQuery(event.target.value)}
                    placeholder={lt("搜索团队素材", "Search team assets")}
                    className='tanva-library-search-input w-full h-8 rounded-lg border border-gray-200 bg-white pl-7 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400'
                    disabled={!effectiveTeamLibraryTeamId}
                  />
                </div>
                {!selectMode && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-8 w-8 p-0'
                    onClick={() => void handleCreateTeamFolder()}
                    disabled={!effectiveTeamLibraryTeamId || isTeamAssetUploading}
                    title={lt("新建文件夹", "New folder")}
                    aria-label={lt("新建文件夹", "New folder")}
                  >
                    {isTeamAssetUploading ? (
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                    ) : (
                      <Plus className='h-3.5 w-3.5' />
                    )}
                  </Button>
                )}
              </div>
              {!selectMode && effectiveTeamLibraryTeamId ? (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8 w-full text-xs'
                  onClick={() => {
                    setTeamUploadFolderId(null);
                    triggerUpload();
                  }}
                  disabled={isTeamAssetUploading}
                >
                  {lt("上传到未归类", "Upload to uncategorized")}
                </Button>
              ) : null}

              {!effectiveTeamLibraryTeamId ? (
                <div className='rounded-lg border border-dashed border-gray-200 bg-white/70 py-10 text-center text-xs text-gray-500'>
                  {lt("暂无团队", "No teams available")}
                </div>
              ) : teamLibraryIsLoading ? (
                <div className='flex items-center justify-center gap-1 text-xs text-gray-500 py-8'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  {lt("加载中...", "Loading...")}
                </div>
              ) : teamFolders.length === 0 && uncategorizedTeamAssets.length === 0 ? (
                <div className='rounded-lg border border-dashed border-gray-200 bg-white/70 py-10 text-center text-xs text-gray-500'>
                  {lt("暂无团队素材", "No team assets")}
                </div>
              ) : (
                <div className='space-y-1'>
                  {teamFolders.map((folder) => {
                    const isOpen = openTeamFolderIds.includes(folder.id);
                    const folderAssets = getVisibleTeamAssets(folder.id);
                    return (
                      <div key={folder.id}>
                        <div className='group relative flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-700 hover:bg-gray-100'>
                          <button
                            type='button'
                            className='flex h-5 w-5 items-center justify-center text-gray-400'
                            onClick={() =>
                              setOpenTeamFolderIds((prev) =>
                                prev.includes(folder.id)
                                  ? prev.filter((id) => id !== folder.id)
                                  : [...prev, folder.id]
                              )
                            }
                          >
                            <ChevronRight
                              className='h-4 w-4 transition-transform'
                              style={{ transform: isOpen ? "rotate(90deg)" : undefined }}
                            />
                          </button>
                          <FolderIcon className='h-5 w-5 shrink-0 text-gray-400' />
                          <span className='min-w-0 flex-1 truncate font-medium'>
                            {folder.name}
                          </span>
                          <span className='text-xs text-gray-400'>{folderAssets.length}</span>
                          {!selectMode && (
                          <button
                            type='button'
                            className='h-6 w-6 rounded text-gray-400 opacity-0 hover:bg-gray-200 group-hover:opacity-100'
                            onClick={(event) => {
                              event.stopPropagation();
                              setTeamFolderMenuId((prev) =>
                                prev === folder.id ? null : folder.id
                              );
                            }}
                          >
                            ...
                          </button>
                          )}
                          {!selectMode && teamFolderMenuId === folder.id ? (
                            <div className='absolute right-2 top-8 z-[1200] w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg'>
                              <button className='block w-full px-3 py-2 text-left hover:bg-gray-100' onClick={() => { setTeamFolderMenuId(null); void handleCreateTeamFolder(); }}>
                                {lt("新建文件夹", "New folder")}
                              </button>
                              <button className='block w-full px-3 py-2 text-left hover:bg-gray-100' onClick={() => { setTeamFolderMenuId(null); void handleRenameTeamFolder(folder); }}>
                                {lt("重命名", "Rename")}
                              </button>
                              <button className='block w-full px-3 py-2 text-left hover:bg-gray-100' onClick={() => { setTeamFolderMenuId(null); setTeamUploadFolderId(folder.id); triggerUpload(); }}>
                                {lt("上传到此处", "Upload here")}
                              </button>
                              <button className='block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50' onClick={() => { setTeamFolderMenuId(null); void handleDeleteTeamFolder(folder); }}>
                                {lt("删除", "Delete")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {isOpen ? (
                          <div className='ml-8 space-y-1 border-l border-gray-100 pl-2'>
                            {folderAssets.length === 0 ? (
                              <div className='py-2 text-xs text-gray-400'>{lt("文件夹为空", "Folder is empty")}</div>
                            ) : (
                              folderAssets.map((asset) => (
                                <TeamAssetRow
                                  key={asset.id}
                                  asset={asset}
                                  folders={teamFolders}
                                  selectMode={selectMode}
                                  onSelect={(a) => handleSelectAsset(getAssetImageUrl(a), a.name)}
                                  onSend={handleTeamAssetSendToCanvas}
                                  onPreview={(url) => openImagePreview(url, asset.name)}
                                  onDownload={handleTeamAssetDownload}
                                  onDelete={handleTeamAssetDelete}
                                  onMove={handleMoveTeamAsset}
                                />
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {uncategorizedTeamAssets.length > 0 ? (
                    <div className='pt-2'>
                      <div className='px-2 pb-1 text-xs text-gray-400'>{lt("未归类", "Uncategorized")}</div>
                      <div className='space-y-1'>
                        {uncategorizedTeamAssets.map((asset) => (
                          <TeamAssetRow
                            key={asset.id}
                            asset={asset}
                            folders={teamFolders}
                            selectMode={selectMode}
                            onSelect={(a) => handleSelectAsset(getAssetImageUrl(a), a.name)}
                            onSend={handleTeamAssetSendToCanvas}
                            onPreview={(url) => openImagePreview(url, asset.name)}
                            onDownload={handleTeamAssetDownload}
                            onDelete={handleTeamAssetDelete}
                            onMove={handleMoveTeamAsset}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className='p-3 space-y-3'>
              <div className='flex gap-2'>
                <div className='relative flex-1'>
                  <Search className='pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400' />
                  <input
                    type='text'
                    value={activeHistorySearchQuery}
                    onChange={(event) => {
                      if (isProjectHistoryTab) {
                        setProjectHistorySearchQuery(event.target.value);
                        return;
                      }
                      setHistorySearchQuery(event.target.value);
                    }}
                    placeholder={lt("搜索 prompt...", "Search prompt...")}
                    className='tanva-library-search-input w-full h-8 rounded-lg border border-gray-200 bg-white pl-7 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400'
                  />
                </div>
                <select
                  value={activeHistoryFilterType}
                  onChange={(event) => {
                    if (isProjectHistoryTab) {
                      setProjectHistoryFilterType(event.target.value);
                      return;
                    }
                    setHistoryFilterType(event.target.value);
                  }}
                  className='tanva-library-filter-select h-8 max-w-[108px] rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400'
                >
                  <option value=''>{lt("全部类型", "All types")}</option>
                  {Object.keys(GLOBAL_HISTORY_SOURCE_TYPE_LABELS).map((key) => (
                    <option key={key} value={key}>
                      {getSourceTypeLabel(key)}
                    </option>
                  ))}
                </select>
              </div>

              {!currentProjectId && isProjectHistoryTab ? (
                <div className='rounded-lg border border-dashed border-gray-200 bg-white/70 py-10 text-center text-xs text-gray-500'>
                  {lt("当前项目未就绪", "Current project is not ready")}
                </div>
              ) : activeHistoryItems.length === 0 && !activeHistoryIsLoading ? (
                <div className='rounded-lg border border-dashed border-gray-200 bg-white/70 py-10 text-center text-xs text-gray-500'>
                  {isProjectHistoryTab
                    ? lt("暂无项目库记录", "No project library records")
                    : lt("暂无全局历史", "No global history")}
                </div>
              ) : (
                <div className='grid grid-cols-2 gap-2'>
                  {activeHistoryItems.map((item) => {
                    const itemIsVideo = isGlobalHistoryVideoItem(item);
                    const mediaUrl = getGlobalHistoryMediaUrl(item);
                    const videoThumbnail = getGlobalHistoryVideoThumbnail(item);
                    const itemTitle = getHistoryItemTitle(item);

                    return (
                      <div
                        key={item.id}
                        data-library-thumbnail
                        draggable={!itemIsVideo}
                        className={`aspect-square rounded-lg overflow-hidden bg-gray-100 transition-all hover:ring-2 hover:ring-blue-400 relative ${
                          itemIsVideo
                            ? "cursor-pointer"
                            : "cursor-grab active:cursor-grabbing"
                        }`}
                        onClick={() => {
                          if (selectMode) {
                            if (!itemIsVideo) {
                              handleSelectAsset(mediaUrl, itemTitle);
                            }
                            return;
                          }
                          handleHistoryItemClick(item);
                        }}
                        onDoubleClick={() => handleHistoryItemDoubleClick(item)}
                        onDragStart={(event) => handleHistoryDragStart(item, event)}
                        title={itemTitle}
                      >
                        {itemIsVideo ? (
                          videoThumbnail ? (
                            <SmartImage
                              src={videoThumbnail}
                              alt={itemTitle}
                              className='w-full h-full object-cover'
                              draggable={false}
                              loading='lazy'
                            />
                          ) : mediaUrl ? (
                            <video
                              src={mediaUrl}
                              className='w-full h-full object-cover bg-black'
                              muted
                              playsInline
                              preload='metadata'
                            />
                          ) : (
                            <div className='flex h-full w-full items-center justify-center text-gray-400'>
                              <Film className='h-8 w-8' />
                            </div>
                          )
                        ) : (
                          <SmartImage
                            src={mediaUrl}
                            alt={itemTitle}
                            className='w-full h-full object-cover'
                            draggable={false}
                            loading='lazy'
                          />
                        )}
                        {itemIsVideo ? (
                          <div className='absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none'>
                            <div className='flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white shadow-lg'>
                              <Play className='h-4 w-4 fill-current' />
                            </div>
                          </div>
                        ) : null}
                        <div className='absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between text-[10px] text-white'>
                          <span>{formatHistoryDate(item.createdAt, locale)}</span>
                          <span className='px-1 py-0.5 rounded bg-white/25 truncate max-w-[70px] text-right'>
                            {itemIsVideo ? "VID" : getSourceTypeLabel(item.sourceType)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeHistoryIsLoading ? (
                <div className='flex items-center justify-center gap-1 text-xs text-gray-500 py-1'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  {lt("加载中...", "Loading...")}
                </div>
              ) : null}

              {activeHistoryTotalPages > 1 ? (
                <div className='flex items-center justify-center gap-1'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    disabled={activeHistoryIsLoading || activeHistoryPage <= 1}
                    onClick={() => {
                      if (isProjectHistoryTab) {
                        setProjectHistoryPage((prev) => Math.max(1, prev - 1));
                        return;
                      }
                      setHistoryPage((prev) => Math.max(1, prev - 1));
                    }}
                    aria-label={lt("上一页", "Previous page")}
                    title={lt("上一页", "Previous page")}
                  >
                    <ChevronLeft className='h-3.5 w-3.5' />
                  </Button>
                  {activeHistoryPageSlots.map((slot, index) =>
                    typeof slot === "number" ? (
                      <button
                        key={`page-${slot}`}
                        type='button'
                        className={`h-7 min-w-7 px-1 rounded text-xs border transition-colors ${
                          activeHistoryPage === slot
                            ? "bg-gray-900 border-gray-900 text-white"
                            : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                        }`}
                        onClick={() => {
                          if (isProjectHistoryTab) {
                            setProjectHistoryPage(slot);
                            return;
                          }
                          setHistoryPage(slot);
                        }}
                      >
                        {slot}
                      </button>
                    ) : (
                      <span
                        key={`${slot}-${index}`}
                        className='h-7 min-w-7 inline-flex items-center justify-center text-xs text-gray-400'
                      >
                        ...
                      </span>
                    )
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    disabled={
                      activeHistoryIsLoading ||
                      activeHistoryPage >= activeHistoryTotalPages
                    }
                    onClick={() => {
                      if (isProjectHistoryTab) {
                        setProjectHistoryPage((prev) =>
                          Math.min(activeHistoryTotalPages, prev + 1)
                        );
                        return;
                      }
                      setHistoryPage((prev) =>
                        Math.min(activeHistoryTotalPages, prev + 1)
                      );
                    }}
                    aria-label={lt("下一页", "Next page")}
                    title={lt("下一页", "Next page")}
                  >
                    <ChevronRight className='h-3.5 w-3.5' />
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 面板底部 */}
        <div className='tanva-library-footer p-3 bg-white/80 backdrop-blur-sm border-t border-white/40'>
          <div className='text-xs text-gray-500 text-center'>
            {activeTab === "manual"
              ? lt(`共 ${allAssets.length} 个资源`, `${allAssets.length} assets`)
              : activeTab === "global-history"
              ? lt(
                  `共 ${teamAssets.length} 个团队素材 · ${teamFolders.length} 个文件夹`,
                  `${teamAssets.length} team assets · ${teamFolders.length} folders`
                )
              : lt(
                  `第 ${activeHistoryPage}/${activeHistoryTotalPages} 页 · 共 ${activeHistoryTotalCount} 条`,
                  `Page ${activeHistoryPage}/${activeHistoryTotalPages} · ${activeHistoryTotalCount} items`
                )}
          </div>
        </div>
    </>
  );

  const previewModal = (
    <ImagePreviewModal
      isOpen={Boolean(previewState)}
      imageSrc={previewState?.src || ""}
      imageTitle={previewState?.title}
      onClose={() => setPreviewState(null)}
    />
  );

  // modal 变体：居中 portal 弹窗壳（对齐项目管理弹窗），背景遮罩点击关闭。
  if (isModal) {
    return createPortal(
      <div className='fixed inset-0 z-[1000] flex items-center justify-center'>
        <div className='absolute inset-0 bg-black/30' onClick={handleClose} />
        <div className='tanva-library-panel relative flex h-[640px] max-h-[calc(100vh-64px)] w-[900px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl'>
          {panelBody}
        </div>
        {previewModal}
      </div>,
      document.body
    );
  }

  // panel 变体：现有右侧固定素材栏（行为逐字节不变）。
  return (
    <>
      {detailPanels}
      <div
        data-library-drop-zone='true'
        className={`tanva-library-panel fixed top-0 right-0 h-full w-80 bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border-l border-liquid-glass z-[1100] transform transition-transform duration-[50ms] ease-out flex flex-col overflow-hidden ${
          showLibraryPanel ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {panelBody}
      </div>
      {previewModal}
    </>
  );
};

// 3D 模型预览组件
interface ModelPreviewProps {
  asset: PersonalModelAsset;
  onThumbnailReady: (id: string, thumbnail: string) => void;
  large?: boolean;
}

const ModelPreview: React.FC<ModelPreviewProps> = ({
  asset,
  onThumbnailReady,
  large,
}) => {
  const { lt } = useLocaleText();
  const [previewSrc, setPreviewSrc] = React.useState<string | null>(
    asset.thumbnail ?? null
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const requestStartedRef = React.useRef(false);

  React.useEffect(() => {
    setPreviewSrc(asset.thumbnail ?? null);
  }, [asset.thumbnail]);

  React.useEffect(() => {
    if (asset.thumbnail || !asset.url || requestStartedRef.current) {
      return;
    }
    let cancelled = false;
    requestStartedRef.current = true;
    setIsLoading(true);
    model3DPreviewService
      .generatePreviewAndUpload(asset.url)
      .then((thumbnailUrl) => {
        if (cancelled) return;
        if (thumbnailUrl) {
          setPreviewSrc(thumbnailUrl);
          onThumbnailReady(asset.id, thumbnailUrl);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[LibraryPanel] 3D 预览生成失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.thumbnail, asset.url, onThumbnailReady]);

  if (previewSrc) {
    return (
      <SmartImage
        src={previewSrc}
        alt={`${asset.name} ${lt("预览", "Preview")}`}
        className={`w-full h-full ${large ? "object-contain" : "object-cover"}`}
        draggable={false}
      />
    );
  }

  return (
    <div className='w-full h-full bg-gradient-to-br from-purple-500 to-indigo-600 flex flex-col items-center justify-center text-white'>
      <Box className={large ? "w-8 h-8" : "w-4 h-4"} />
      {isLoading && (
        <div className={`mt-1 ${large ? "text-xs" : "text-[8px]"}`}>{lt("加载中", "Loading")}</div>
      )}
    </div>
  );
};

interface TeamAssetRowProps {
  asset: MaterialAssetDto;
  folders: MaterialFolderDto[];
  onSend: (asset: MaterialAssetDto) => void;
  onPreview: (url: string) => void;
  onDownload: (asset: MaterialAssetDto) => void;
  onDelete: (asset: MaterialAssetDto) => void;
  onMove: (asset: MaterialAssetDto, folderId: string | null) => void;
  /** 选择模式：点击整行触发 onSelect，隐藏操作菜单。 */
  selectMode?: boolean;
  onSelect?: (asset: MaterialAssetDto) => void;
}

const TeamAssetRow: React.FC<TeamAssetRowProps> = ({
  asset,
  folders,
  onSend,
  onPreview,
  onDownload,
  onDelete,
  onMove,
  selectMode = false,
  onSelect,
}) => {
  const { lt } = useLocaleText();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const imageUrl = getAssetImageUrl(asset);
  return (
    <div
      data-library-thumbnail
      draggable={!selectMode && Boolean(imageUrl)}
      className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 ${
        selectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      }`}
      onClick={() => {
        if (selectMode) {
          onSelect?.(asset);
          return;
        }
        onSend(asset);
      }}
      onDoubleClick={() => imageUrl && onPreview(imageUrl)}
      onDragStart={(event) => {
        if (!imageUrl) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("text/uri-list", imageUrl);
        event.dataTransfer.setData("text/plain", imageUrl);
        event.dataTransfer.setData(
          "application/x-tanva-asset",
          JSON.stringify({
            type: "2d",
            id: asset.id,
            url: imageUrl,
            name: asset.name,
            fileName: asset.name,
          })
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
      title={asset.name}
    >
      {imageUrl ? (
        <SmartImage
          src={imageUrl}
          alt={asset.name}
          className='h-8 w-8 shrink-0 rounded object-cover'
          draggable={false}
          loading='lazy'
        />
      ) : (
        <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400'>
          <ImageIcon className='h-4 w-4' />
        </div>
      )}
      <span className='min-w-0 flex-1 truncate text-xs font-medium'>
        {asset.name}
      </span>
      {!selectMode && (
      <button
        type='button'
        className='h-6 w-6 rounded text-gray-400 opacity-0 hover:bg-gray-200 group-hover:opacity-100'
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((prev) => !prev);
        }}
      >
        ...
      </button>
      )}
      {!selectMode && menuOpen ? (
        <div
          className='absolute right-2 top-8 z-[1200] w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg'
          onClick={(event) => event.stopPropagation()}
        >
          <button className='block w-full px-3 py-2 text-left hover:bg-gray-100' onClick={() => { setMenuOpen(false); onSend(asset); }}>
            {lt("发送到画布", "Send to canvas")}
          </button>
          <button className='block w-full px-3 py-2 text-left hover:bg-gray-100' onClick={() => { setMenuOpen(false); onDownload(asset); }}>
            {lt("下载", "Download")}
          </button>
          <div className='my-1 border-t border-gray-100' />
          <button className='block w-full px-3 py-2 text-left hover:bg-gray-100' onClick={() => { setMenuOpen(false); onMove(asset, null); }}>
            {lt("移动到未归类", "Move to uncategorized")}
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className='block w-full px-3 py-2 text-left hover:bg-gray-100'
              onClick={() => {
                setMenuOpen(false);
                onMove(asset, folder.id);
              }}
            >
              {lt("移动到", "Move to")} {folder.name}
            </button>
          ))}
          <div className='my-1 border-t border-gray-100' />
          <button className='block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50' onClick={() => { setMenuOpen(false); void onDelete(asset); }}>
            {lt("删除", "Delete")}
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default LibraryPanel;
