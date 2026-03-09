import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  LogOut,
  HelpCircle,
  Share,
  Library,
  Grid3x3,
  Square,
  Menu,
  Activity,
  History,
  Check,
  ChevronDown,
  Home,
  Sparkles,
  Trash2,
  Cloud,
  Zap,
  Key,
  Eye,
  EyeOff,
  Code,
  FolderOpen,
  Send,
  Globe,
  Gift,
  MessageCircle,
  Play,
} from "lucide-react";
import MemoryDebugPanel from "@/components/debug/MemoryDebugPanel";
import HistoryDebugPanel from "@/components/debug/HistoryDebugPanel";
import PaymentPanel from "@/components/payment/PaymentPanel";
import { useProjectStore } from "@/stores/projectStore";
import ProjectManagerModal from "@/components/projects/ProjectManagerModal";
import { useUIStore, useCanvasStore, GridStyle } from "@/stores";
import { useImageHistoryStore } from "@/stores/imageHistoryStore";
import { useAIChatStore } from "@/stores/aiChatStore";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import ManualSaveButton from "@/components/autosave/ManualSaveButton";
import GlobalImageHistoryPage from "@/components/global-history/GlobalImageHistoryPage";
import { useGlobalImageHistoryStore } from "@/stores/globalImageHistoryStore";
import AutosaveStatus from "@/components/autosave/AutosaveStatus";
import { paperSaveService } from "@/services/paperSaveService";
import { historyService } from "@/services/historyService";
import { clipboardService } from "@/services/clipboardService";
import { contextManager } from "@/services/contextManager";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { authApi, type GoogleApiKeyInfo } from "@/services/authApi";
import ReferralRewards from "@/components/ReferralRewards";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import {
  claimDailyReward,
  getDailyRewardStatus,
  getMyCredits,
  type DailyRewardStatus,
  type UserCreditsInfo,
} from "@/services/adminApi";

const SETTINGS_SECTIONS = [
  { id: "workspace", labelKey: "workspace.settings.sections.workspace", icon: Square },
  { id: "referral", labelKey: "workspace.settings.sections.referral", icon: Gift },
  { id: "appearance", labelKey: "workspace.settings.sections.appearance", icon: Eye },
  { id: "ai", labelKey: "workspace.settings.sections.ai", icon: Sparkles },
  { id: "advanced", labelKey: "workspace.settings.sections.advanced", icon: Zap },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

const VIEW_APPEARANCE_STORAGE_KEY = "tanva-view-settings";
const REFERRAL_NOTIFICATION_LAST_SEEN_DATE_STORAGE_KEY =
  "tanva-referral-notification-last-seen-date";
const MAX_QUICK_PROJECTS = 5;

const getTodayDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const FloatingHeader: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const untitledLabel = t("common.untitled");
  const {
    showLibraryPanel,
    showGrid,
    showLayerPanel,
    toggleLibraryPanel,
    toggleGrid,
    setShowGrid,
    focusMode,
    snapAlignmentEnabled,
    toggleSnapAlignment,
  } = useUIStore();

  const {
    gridStyle,
    gridSize,
    gridColor,
    gridBgColor,
    gridBgEnabled,
    zoomSensitivity,
    wheelZoomMode,
    setGridStyle,
    setGridSize,
    setGridColor,
    setGridBgColor,
    setGridBgEnabled,
    setZoomSensitivity,
    setWheelZoomMode,
  } = useCanvasStore();

  // AI 配置
  const {
    imageOnly,
    setImageOnly,
    aiProvider,
    setAIProvider,
    sendShortcut,
    setSendShortcut,
    expandedPanelStyle,
    setExpandedPanelStyle,
  } = useAIChatStore();

  // 项目（文件）管理
  const {
    currentProject,
    openModal,
    create,
    rename,
    optimisticRenameLocal,
    projects,
    open,
  } = useProjectStore();
  // Header 下拉中的快速切换与新建，直接复用项目管理的函数
  const handleQuickSwitch = (projectId: string) => {
    if (!projectId || projectId === currentProject?.id) return;
    open(projectId);
  };
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  useEffect(() => {
    setTitleInput(currentProject?.name || untitledLabel);
  }, [currentProject?.id, currentProject?.name, untitledLabel]);
  const commitTitle = async () => {
    const name = titleInput.trim() || untitledLabel;
    try {
      if (currentProject) {
        if (name !== currentProject.name) {
          // 先本地乐观更新，提升体验
          optimisticRenameLocal(currentProject.id, name);
          await rename(currentProject.id, name);
        }
      } else {
        await create(name);
      }
    } finally {
      setEditingTitle(false);
    }
  };

  // 单位/比例功能已移除
  const [showMemoryDebug, setShowMemoryDebug] = useState(false);
  const [showHistoryDebug, setShowHistoryDebug] = useState(false);
  const [gridSizeInput, setGridSizeInput] = useState(String(gridSize));
  const [saveFeedback, setSaveFeedback] = useState<
    "idle" | "success" | "error"
  >("idle");
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const hasAppliedSavedAppearanceRef = useRef(false);

  // Google API Key 管理状态
  const [googleApiKeyInfo, setGoogleApiKeyInfo] = useState<GoogleApiKeyInfo>({
    hasCustomKey: false,
    maskedKey: null,
    mode: "official",
  });
  const [googleApiKeyInput, setGoogleApiKeyInput] = useState("");
  const [showGoogleApiKey, setShowGoogleApiKey] = useState(false);
  const [googleApiKeySaving, setGoogleApiKeySaving] = useState(false);
  const [googleApiKeyFeedback, setGoogleApiKeyFeedback] = useState<
    "idle" | "success" | "error"
  >("idle");
  const googleApiKeyFeedbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // 用户积分状态
  const [creditsInfo, setCreditsInfo] = useState<UserCreditsInfo | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [dailyRewardStatus, setDailyRewardStatus] =
    useState<DailyRewardStatus | null>(null);
  const [dailyRewardLoading, setDailyRewardLoading] = useState(false);
  const [dailyRewardClaiming, setDailyRewardClaiming] = useState(false);
  const [isWechatQrOpen, setIsWechatQrOpen] = useState(false);
  const [isGlobalFlowRunning, setIsGlobalFlowRunning] = useState(false);
  const [fpsOverlayAdminButtonLayout, setFpsOverlayAdminButtonLayout] = useState<{
    top: number;
    left: number;
    size: number;
  } | null>(null);
  const [wechatQrCodes, setWechatQrCodes] = useState<{
    officialAccount: string;
    wechatGroup: string;
  }>({
    officialAccount: "/qrcode-official.png",
    wechatGroup: "/qrcode-group.png",
  });

  useEffect(() => {
    const fetchQrCodes = async () => {
      try {
        const apiBase =
          (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:4000";
        const response = await fetch(`${apiBase}/api/settings/wechat-qrcodes`);
        if (response.ok) {
          const data = await response.json();
          if (data.officialAccount) {
            setWechatQrCodes((prev) => ({ ...prev, officialAccount: data.officialAccount }));
          }
          if (data.wechatGroup) {
            setWechatQrCodes((prev) => ({ ...prev, wechatGroup: data.wechatGroup }));
          }
        }
      } catch (_error) {
        // keep fallback qrcode images
      }
    };
    fetchQrCodes();
  }, []);

  // 清理 Google API Key 反馈计时器
  useEffect(
    () => () => {
      if (googleApiKeyFeedbackTimerRef.current) {
        clearTimeout(googleApiKeyFeedbackTimerRef.current);
        googleApiKeyFeedbackTimerRef.current = null;
      }
    },
    []
  );

  const handleSaveGoogleApiKey = useCallback(async () => {
    if (googleApiKeySaving) return;
    setGoogleApiKeySaving(true);
    try {
      const trimmedKey = googleApiKeyInput.trim();
      const result = await authApi.updateGoogleApiKey({
        googleCustomApiKey: trimmedKey || null,
        googleKeyMode: trimmedKey ? "custom" : "official",
      });
      if (result.success) {
        setGoogleApiKeyFeedback("success");
        // 重新加载状态
        const info = await authApi.getGoogleApiKey();
        setGoogleApiKeyInfo(info);
        setGoogleApiKeyInput(""); // 清空输入框
      } else {
        setGoogleApiKeyFeedback("error");
      }
    } catch (e) {
      console.error("Failed to save Google API Key:", e);
      setGoogleApiKeyFeedback("error");
    } finally {
      setGoogleApiKeySaving(false);
      if (googleApiKeyFeedbackTimerRef.current) {
        clearTimeout(googleApiKeyFeedbackTimerRef.current);
      }
      googleApiKeyFeedbackTimerRef.current = setTimeout(
        () => setGoogleApiKeyFeedback("idle"),
        2500
      );
    }
  }, [googleApiKeyInput, googleApiKeySaving]);

  const handleClearGoogleApiKey = useCallback(async () => {
    if (googleApiKeySaving) return;
    const confirmed = window.confirm(
      t("workspace.settings.aiTab.googleKey.clearConfirm")
    );
    if (!confirmed) return;

    setGoogleApiKeySaving(true);
    try {
      const result = await authApi.updateGoogleApiKey({
        googleCustomApiKey: null,
        googleKeyMode: "official",
      });
      if (result.success) {
        setGoogleApiKeyFeedback("success");
        setGoogleApiKeyInfo({
          hasCustomKey: false,
          maskedKey: null,
          mode: "official",
        });
        setGoogleApiKeyInput("");
      } else {
        setGoogleApiKeyFeedback("error");
      }
    } catch (e) {
      console.error("Failed to clear Google API Key:", e);
      setGoogleApiKeyFeedback("error");
    } finally {
      setGoogleApiKeySaving(false);
      if (googleApiKeyFeedbackTimerRef.current) {
        clearTimeout(googleApiKeyFeedbackTimerRef.current);
      }
      googleApiKeyFeedbackTimerRef.current = setTimeout(
        () => setGoogleApiKeyFeedback("idle"),
        2500
      );
    }
  }, [googleApiKeySaving, t]);

  // 一次性加载保存的视图外观设置
  useEffect(() => {
    if (hasAppliedSavedAppearanceRef.current) return;
    if (typeof window === "undefined") return;
    hasAppliedSavedAppearanceRef.current = true;

    try {
      const raw = window.localStorage.getItem(VIEW_APPEARANCE_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<{
        showGrid: boolean;
        gridStyle: GridStyle;
        gridSize: number;
        gridColor: string;
        gridBgColor: string;
        gridBgEnabled: boolean;
      }> | null;
      if (!saved || typeof saved !== "object") return;

      if (typeof saved.showGrid === "boolean") setShowGrid(saved.showGrid);
      if (
        saved.gridStyle &&
        Object.values(GridStyle).includes(saved.gridStyle)
      ) {
        setGridStyle(saved.gridStyle);
      }
      if (
        typeof saved.gridSize === "number" &&
        saved.gridSize >= 1 &&
        saved.gridSize <= 200
      ) {
        setGridSize(saved.gridSize);
        setGridSizeInput(String(saved.gridSize));
      }
      if (
        typeof saved.gridColor === "string" &&
        saved.gridColor.startsWith("#")
      ) {
        setGridColor(saved.gridColor);
      }
      if (
        typeof saved.gridBgColor === "string" &&
        saved.gridBgColor.startsWith("#")
      ) {
        setGridBgColor(saved.gridBgColor);
      }
      if (typeof saved.gridBgEnabled === "boolean") {
        setGridBgEnabled(saved.gridBgEnabled);
      }
    } catch (error) {
      console.warn(
        "[FloatingHeader] Failed to load saved appearance settings:",
        error
      );
    }
  }, [
    setShowGrid,
    setGridStyle,
    setGridSize,
    setGridColor,
    setGridBgColor,
    setGridBgEnabled,
    setGridSizeInput,
  ]);

  // 清理保存提示计时器
  useEffect(
    () => () => {
      if (saveFeedbackTimerRef.current) {
        clearTimeout(saveFeedbackTimerRef.current);
        saveFeedbackTimerRef.current = null;
      }
    },
    []
  );

  const handleSaveAppearanceSettings = useCallback(() => {
    if (typeof window === "undefined") return;
    const payload = {
      showGrid,
      gridStyle,
      gridSize,
      gridColor,
      gridBgColor,
      gridBgEnabled,
    };

    try {
      window.localStorage.setItem(
        VIEW_APPEARANCE_STORAGE_KEY,
        JSON.stringify(payload)
      );
      setSaveFeedback("success");
    } catch (error) {
      console.warn(
        "[FloatingHeader] Failed to save appearance settings:",
        error
      );
      setSaveFeedback("error");
    } finally {
      if (saveFeedbackTimerRef.current) {
        clearTimeout(saveFeedbackTimerRef.current);
      }
      saveFeedbackTimerRef.current = setTimeout(
        () => setSaveFeedback("idle"),
        2200
      );
    }
  }, [showGrid, gridStyle, gridSize, gridColor, gridBgColor, gridBgEnabled]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("workspace");
  const [showReferralNotification, setShowReferralNotification] =
    useState(false);
  const [isGlobalHistoryOpen, setIsGlobalHistoryOpen] = useState(false);
  const [showPaymentPanel, setShowPaymentPanel] = useState(false);

  // 监听网格大小变化
  useEffect(() => {
    setGridSizeInput(String(gridSize));
  }, [gridSize]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    if (typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isSettingsOpen) return;
    const today = getTodayDateKey();
    const lastSeen = window.localStorage.getItem(
      REFERRAL_NOTIFICATION_LAST_SEEN_DATE_STORAGE_KEY
    );
    setShowReferralNotification(lastSeen !== today);
  }, [isSettingsOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!showReferralNotification) return;
    if (activeSettingsSection !== "referral") return;
    const today = getTodayDateKey();
    window.localStorage.setItem(
      REFERRAL_NOTIFICATION_LAST_SEEN_DATE_STORAGE_KEY,
      today
    );
    setShowReferralNotification(false);
  }, [activeSettingsSection, showReferralNotification]);

  const commitGridSize = () => {
    const n = parseInt(gridSizeInput, 10);
    if (!isNaN(n) && n > 0 && n <= 200) setGridSize(n);
    else setGridSizeInput(String(gridSize));
  };

  const clearImageHistory = useImageHistoryStore((state) => state.clearHistory);
  const historyCount = useImageHistoryStore((state) => state.history.length);
  const globalHistoryCount = useGlobalImageHistoryStore(
    (state) => state.totalCount
  );
  const fetchGlobalHistoryCount = useGlobalImageHistoryStore(
    (state) => state.fetchCount
  );
  const authUser = useAuthStore((s) => s.user);

  // 获取全局历史数量（仅在已登录时调用，避免未登录时触发受保护接口）
  useEffect(() => {
    if (!authUser) return;
    fetchGlobalHistoryCount();
  }, [fetchGlobalHistoryCount, authUser]);

  const handleClearImageHistory = React.useCallback(() => {
    if (historyCount === 0) {
      alert(t("workspace.settings.workspaceTab.history.empty"));
      return;
    }
    const confirmed = window.confirm(
      t("workspace.settings.workspaceTab.history.clearConfirm", {
        count: historyCount,
      })
    );
    if (confirmed) {
      clearImageHistory();
    }
  }, [clearImageHistory, historyCount, t]);

  const handleLogoClick = () => {
    logger.debug("Logo clicked - navigating to home");
    navigate("/");
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator
        .share({
          title: t("home.share.title"),
          text: t("home.share.text"),
          url: window.location.href,
        })
        .catch(console.error);
    } else {
      navigator.clipboard
        .writeText(window.location.href)
        .then(() => {
          alert(t("home.linkCopied"));
        })
        .catch(() => {
          alert(t("home.shareLink", { url: window.location.href }));
        });
    }
  };

  // 清空画布内容（保留网格/背景等系统层）
  const handleClearCanvas = () => {
    const confirmed = window.confirm(
      t("workspace.settings.workspaceTab.clearCanvasConfirm")
    );
    if (!confirmed) return;

    void (async () => {
      try {
        // 清理绘制内容但保留图层结构与系统层
        paperSaveService.clearCanvasContent();

        // 清空运行时实例，避免残留引用
        try {
          (window as any).tanvaImageInstances = [];
        } catch {}
        try {
          (window as any).tanvaModel3DInstances = [];
        } catch {}
        try {
          (window as any).tanvaTextItems = [];
        } catch {}

        // 清理剪贴板/AI 图像缓存，避免仍引用大体积 dataURL/base64
        try {
          clipboardService.clear();
        } catch {}
        try {
          contextManager.clearImageCache();
        } catch {}

        // 同时清空 Flow 节点与连线，并标记为脏以触发文件保存
        try {
          const api = useProjectContentStore.getState();
          api.updatePartial(
            { flow: { nodes: [], edges: [] } },
            { markDirty: true }
          );
        } catch {}

        // 立即保存一次，确保 store.paperJson/assets 被快速覆盖为“空场景”
        try {
          await paperSaveService.saveImmediately();
        } catch {}

        // ⚠️ 该操作声明“不可撤销”：同步重置 undo/redo 历史，释放旧快照引用
        try {
          await historyService.resetToCurrent("clear-canvas");
        } catch {}
      } catch (e) {
        console.error("清空画布失败:", e);
        alert(t("workspace.settings.workspaceTab.clearCanvasFailed"));
      }
    })();
  };

  const { user, logout, loading, connection } = useAuthStore();

  // 加载用户的 Google API Key 设置
  useEffect(() => {
    if (!user) return;
    authApi.getGoogleApiKey().then(setGoogleApiKeyInfo).catch(console.warn);
  }, [user]);

  // 加载用户积分信息
  useEffect(() => {
    if (!user) return;
    let canceled = false;
    setCreditsLoading(true);
    setDailyRewardLoading(true);
    Promise.allSettled([getMyCredits(), getDailyRewardStatus()])
      .then(([creditsResult, dailyRewardResult]) => {
        if (canceled) return;
        if (creditsResult.status === "fulfilled")
          setCreditsInfo(creditsResult.value);
        else console.warn(creditsResult.reason);
        if (dailyRewardResult.status === "fulfilled")
          setDailyRewardStatus(dailyRewardResult.value);
        else console.warn(dailyRewardResult.reason);
      })
      .finally(() => {
        if (canceled) return;
        setCreditsLoading(false);
        setDailyRewardLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [user]);

  const refreshCreditsAndDailyReward = useCallback(async () => {
    if (!user) return;
    setCreditsLoading(true);
    setDailyRewardLoading(true);
    try {
      const [creditsResult, dailyRewardResult] = await Promise.allSettled([
        getMyCredits(),
        getDailyRewardStatus(),
      ]);
      if (creditsResult.status === "fulfilled")
        setCreditsInfo(creditsResult.value);
      else console.warn(creditsResult.reason);
      if (dailyRewardResult.status === "fulfilled")
        setDailyRewardStatus(dailyRewardResult.value);
      else console.warn(dailyRewardResult.reason);
    } finally {
      setCreditsLoading(false);
      setDailyRewardLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isSettingsOpen || !user) return;
    refreshCreditsAndDailyReward();
  }, [isSettingsOpen, refreshCreditsAndDailyReward, user]);

  // 监听全局积分刷新事件
  useEffect(() => {
    const handleRefreshCredits = () => {
      refreshCreditsAndDailyReward();
    };
    window.addEventListener("refresh-credits", handleRefreshCredits);
    return () => {
      window.removeEventListener("refresh-credits", handleRefreshCredits);
    };
  }, [refreshCreditsAndDailyReward]);

  useEffect(() => {
    const handleGlobalRunState = (
      event: Event
    ) => {
      const detail = (event as CustomEvent<{ running?: boolean }>).detail;
      setIsGlobalFlowRunning(detail?.running === true);
    };
    window.addEventListener(
      "flow:global-run-state",
      handleGlobalRunState as EventListener
    );
    return () => {
      window.removeEventListener(
        "flow:global-run-state",
        handleGlobalRunState as EventListener
      );
    };
  }, []);

  const handleClaimDailyReward = useCallback(async () => {
    if (!user || dailyRewardClaiming) return;
    setDailyRewardClaiming(true);
    try {
      const result = await claimDailyReward();
      if (result.success) {
        alert(t("workspace.settings.workspaceTab.dailyReward.success"));
      } else if (result.alreadyClaimed) {
        alert(t("workspace.settings.workspaceTab.dailyReward.alreadyClaimed"));
      } else {
        alert(t("workspace.settings.workspaceTab.dailyReward.failed"));
      }
    } catch (e: any) {
      console.error("Failed to claim daily reward:", e);
      alert(e?.message || t("workspace.settings.workspaceTab.dailyReward.failed"));
    } finally {
      setDailyRewardClaiming(false);
      refreshCreditsAndDailyReward();
    }
  }, [dailyRewardClaiming, refreshCreditsAndDailyReward, t, user]);

  const displayName =
    user?.name ||
    user?.phone?.slice(-4) ||
    user?.email ||
    user?.id?.slice(-4) ||
    t("common.user");
  const secondaryId =
    user?.email ||
    (user?.phone
      ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}`
      : "") ||
    "";
  const status = (() => {
    switch (connection) {
      case "server":
        return { label: t("common.status.online"), color: "#16a34a" };
      case "refresh":
        return { label: t("common.status.refreshed"), color: "#f59e0b" };
      case "local":
        return { label: t("common.status.online"), color: "#16a34a" };
      case "mock":
        return { label: t("common.status.mock"), color: "#8b5cf6" };
      default:
        return { label: t("common.status.unknown"), color: "#9ca3af" };
    }
  })();
  const isAdmin = user?.role === "admin";
  useEffect(() => {
    if (!isAdmin || typeof window === "undefined") {
      setFpsOverlayAdminButtonLayout(null);
      return;
    }

    const applyOverlayLayout = (detail?: {
      visible?: boolean;
      top?: number;
      left?: number;
      height?: number;
    }) => {
      if (!detail?.visible) {
        setFpsOverlayAdminButtonLayout(null);
        return;
      }

      const top = Number(detail.top);
      const left = Number(detail.left);
      const height = Number(detail.height);
      if (!Number.isFinite(top) || !Number.isFinite(left) || !Number.isFinite(height)) {
        setFpsOverlayAdminButtonLayout(null);
        return;
      }

      const size = Math.max(24, Math.round(height));
      const gap = 8;
      setFpsOverlayAdminButtonLayout({
        top,
        left: Math.max(12, left - gap - size),
        size,
      });
    };

    const handleOverlayLayout = (event: Event) => {
      const detail = (event as CustomEvent<{
        visible?: boolean;
        top?: number;
        left?: number;
        height?: number;
      }>).detail;
      applyOverlayLayout(detail);
    };

    window.addEventListener(
      "tanva:fps-overlay-layout",
      handleOverlayLayout as EventListener
    );

    const overlayEl = document.getElementById("tanva-fps-overlay");
    if (overlayEl) {
      const rect = overlayEl.getBoundingClientRect();
      applyOverlayLayout({
        visible: true,
        top: rect.top,
        left: rect.left,
        height: rect.height,
      });
    } else {
      applyOverlayLayout({ visible: false });
    }

    return () => {
      window.removeEventListener(
        "tanva:fps-overlay-layout",
        handleOverlayLayout as EventListener
      );
    };
  }, [isAdmin]);

  const showLibraryButton = false; // 临时关闭素材库入口，后续恢复时改为 true
  const handleLogout = async () => {
    if (loading) return;
    try {
      console.log("🔴 开始退出登录...");
      await logout();
      console.log("✅ 登出成功，准备跳转...");
      navigate("/auth/login", { replace: true });
    } catch (err) {
      console.error("❌ 退出登录失败:", err);
    }
  };
  const recentProjects = useMemo(() => {
    const sliced = projects.slice(0, MAX_QUICK_PROJECTS);
    if (currentProject && !sliced.some((p) => p.id === currentProject.id)) {
      const trimmed = sliced.slice(0, Math.max(MAX_QUICK_PROJECTS - 1, 0));
      return [...trimmed, currentProject];
    }
    return sliced;
  }, [projects, currentProject?.id]);
  const sendShortcutOptions = [
    {
      value: "enter" as const,
      label: t("workspace.settings.aiTab.shortcuts.enterLabel"),
      description: t("workspace.settings.aiTab.shortcuts.enterDesc"),
    },
    {
      value: "mod-enter" as const,
      label: "Ctrl/Cmd + Enter",
      description: t("workspace.settings.aiTab.shortcuts.modEnterDesc"),
    },
  ];
  const wheelZoomModeOptions = [
    {
      value: "modifier" as const,
      label: t("workspace.settings.aiTab.wheel.modifierLabel"),
      description: t("workspace.settings.aiTab.wheel.modifierDesc"),
    },
    {
      value: "direct" as const,
      label: t("workspace.settings.aiTab.wheel.directLabel"),
      description: t("workspace.settings.aiTab.wheel.directDesc"),
    },
  ];
  const renderSettingsContent = () => {
    switch (activeSettingsSection) {
      case "workspace":
        // 显示支付面板
        if (showPaymentPanel) {
          return <PaymentPanel onBack={() => setShowPaymentPanel(false)} />;
        }
        // 显示工作区内容
        return (
          <div className='pb-6 space-y-5 '>
            {/* User Greeting Section */}
            <div className='flex items-center gap-4 mb-10 mt-8'>
              <div className='w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-base font-medium text-slate-600 shrink-0'>
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2 mb-0.5'>
                  <span className='text-base font-medium text-slate-900'>
                    {t("workspace.settings.workspaceTab.greeting", {
                      name: displayName,
                    })}
                  </span>
                </div>
                <div className='text-sm text-slate-400'>{secondaryId}</div>
              </div>
            </div>

            {/* 积分信息卡片 */}
            <div className='p-6 rounded-2xl bg-slate-50'>
              <div className='flex items-center justify-between mb-6'>
                <div className='flex items-center gap-3'>
                  <Zap className='w-4 h-4 text-blue-500' />
                  <span className='text-lg font-medium text-slate-700'>
                    {t("workspace.settings.workspaceTab.credits.title")}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setIsSettingsOpen(false);
                    window.open("/my-credits", "_blank");
                  }}
                  className='text-sm text-slate-500 hover:text-slate-700'
                >
                  {t("workspace.settings.workspaceTab.credits.detail")}
                </button>
              </div>

              <div className='flex items-end justify-between py-2'>
                {creditsLoading ? (
                  <div className='text-sm text-slate-500'>
                    {t("workspace.settings.workspaceTab.loading")}
                  </div>
                ) : creditsInfo ? (
                  <>
                    <div className='flex items-baseline gap-2'>
                      <span className='text-5xl font-bold text-slate-800'>
                        {creditsInfo.balance}
                      </span>
                      <span className='text-base text-slate-400'>
                        {t("workspace.settings.workspaceTab.credits.unit")}
                      </span>
                    </div>
                    <button
                      onClick={() => setShowPaymentPanel(true)}
                      className='px-5 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-white transition-colors text-sm'
                    >
                      {t("workspace.settings.workspaceTab.credits.recharge")}
                    </button>
                  </>
                ) : (
                  <div className='text-sm text-slate-500'>
                    {t("workspace.settings.workspaceTab.credits.empty")}
                  </div>
                )}
              </div>
            </div>

            <div className='grid gap-4 sm:grid-cols-2 pt-5'>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors'
                onClick={() => {
                  setIsSettingsOpen(false);
                  openModal();
                }}
              >
                <Square className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.openManageFile")}
              </button>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors'
                onClick={() => navigate("/")}
              >
                <Home className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.backHome")}
              </button>
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors'
                onClick={() => setIsGlobalHistoryOpen(true)}
              >
                <History className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.globalHistory")}
              </button>
              <button
                className='flex items-center justify-center gap-2 h-12 bg-white border border-red-200 rounded-xl text-sm text-red-500 hover:bg-red-50 transition-colors'
                onClick={handleClearCanvas}
              >
                <Trash2 className='w-4 h-4' />
                {t("workspace.settings.workspaceTab.clearCanvas")}
              </button>
            </div>
          </div>
        );
      case "referral":
        return <ReferralRewards />;
      case "appearance":
        return (
          <div className='pb-6 space-y-6'>
            {/* 保存视图标题 */}
            <div className='border-b border-slate-100 pt-5 pb-6'>
              <div className='flex items-center justify-between'>
                <div>
                  <h3 className='text-base font-medium text-slate-800'>
                    {t("workspace.settings.appearanceTab.saveView.title")}
                  </h3>
                  <p className='text-xs text-slate-400 mt-1'>
                    {t("workspace.settings.appearanceTab.saveView.desc")}
                  </p>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  className='p-5 rounded-3xl text-sm'
                  onClick={handleSaveAppearanceSettings}
                >
                  {t("workspace.settings.appearanceTab.saveView.button")}
                </Button>
              </div>
              {saveFeedback === "success" && (
                <div className='mt-2 text-xs text-green-600'>
                  {t("workspace.settings.appearanceTab.saveView.saved")}
                </div>
              )}
              {saveFeedback === "error" && (
                <div className='mt-2 text-xs text-red-600'>
                  {t("workspace.settings.appearanceTab.saveView.saveFailed")}
                </div>
              )}
            </div>

            {/* 界面语言 */}
            <div className='flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3'>
              <div>
                <div className='text-sm font-medium text-slate-700'>
                  {t("workspace.appearance.languageTitle")}
                </div>
                <div className='text-xs text-slate-400 mt-0.5'>
                  {t("workspace.appearance.languageDesc")}
                </div>
              </div>
              <LanguageSwitcher compact />
            </div>

            {/* 网格渲染 + 物理吸附 */}
            <div className='flex items-start justify-between gap-10'>
              <div className='flex items-center gap-4 flex-1'>
                <div className='flex-1'>
                  <div className='text-sm font-medium text-slate-700'>
                    {t("workspace.settings.appearanceTab.gridRender.title")}
                  </div>
                  <div className='text-xs text-slate-400 mt-0.5'>
                    {t("workspace.settings.appearanceTab.gridRender.desc")}
                  </div>
                </div>
                <Switch
                  checked={showGrid}
                  onCheckedChange={toggleGrid}
                  className='h-5 w-9'
                />
              </div>
              <div className='flex items-center gap-4 flex-1'>
                <div className='flex-1'>
                  <div className='text-sm font-medium text-slate-700'>
                    {t("workspace.settings.appearanceTab.snap.title")}
                  </div>
                  <div className='text-xs text-slate-400 mt-0.5'>
                    {t("workspace.settings.appearanceTab.snap.desc")}
                  </div>
                </div>
                <Switch
                  checked={snapAlignmentEnabled}
                  onCheckedChange={toggleSnapAlignment}
                  className='h-5 w-9'
                />
              </div>
            </div>

            {/* 风格样式 + 网格单位 */}
            <div className='flex items-start justify-between gap-8'>
              <div className='flex-1'>
                <div className='text-sm font-medium text-slate-700 pb-3'>
                  {t("workspace.settings.appearanceTab.style.title")}
                </div>
                <div className='inline-flex rounded-full bg-slate-100 p-1'>
                  {[
                    {
                      value: GridStyle.LINES,
                      label: t("workspace.settings.appearanceTab.style.grid"),
                    },
                    {
                      value: GridStyle.SOLID,
                      label: t("workspace.settings.appearanceTab.style.solid"),
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => setGridStyle(option.value)}
                      className={cn(
                        "px-4 py-2 rounded-full text-sm transition-all",
                        gridStyle === option.value
                          ? "bg-white text-slate-700 shadow-sm"
                          : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className='flex-1'>
                <div className='text-sm font-medium text-slate-700 pb-3'>
                  {t("workspace.settings.appearanceTab.gridUnit.title")}
                </div>
                <div className='flex items-center gap-2 border border-slate-200 w-28 rounded-3xl'>
                  <input
                    type='number'
                    min={1}
                    max={200}
                    value={gridSizeInput}
                    onChange={(e) => setGridSizeInput(e.target.value)}
                    onBlur={commitGridSize}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitGridSize();
                      if (e.key === "Escape")
                        setGridSizeInput(String(gridSize));
                      e.stopPropagation();
                    }}
                    className='w-18 px-3 py-2 text-sm text-center  focus:border-blue-500 focus:outline-none bg-transparent'
                  />
                  <span className='text-xs text-slate-400'>px</span>
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <div className='border-b border-slate-100'></div>

            {/* 缩放反馈速度 */}
            <div>
              <div className='text-sm font-medium text-slate-700'>
                {t("workspace.settings.appearanceTab.zoom.title")}
              </div>
              <div className='text-xs text-slate-400 mt-0.5 mb-4'>
                {t("workspace.settings.appearanceTab.zoom.desc")}
              </div>
              <div className='flex items-center gap-4'>
                <input
                  type='range'
                  min={1}
                  max={10}
                  step={1}
                  value={zoomSensitivity}
                  onChange={(e) => setZoomSensitivity(Number(e.target.value))}
                  className='flex-1 h-1 rounded-full appearance-none cursor-pointer bg-slate-200 accent-slate-400'
                />
                <span className='text-sm text-slate-500 w-6 text-right'>
                  {zoomSensitivity}
                </span>
              </div>
            </div>

            {/* 分隔线 */}
            <div className='border-b border-slate-100'></div>

            {/* 色彩模式 */}
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700'>
                  {t("workspace.settings.appearanceTab.gridColor.title")}
                </div>
              </div>
              <div className='flex items-center'>
                <input
                  type='color'
                  value={gridColor}
                  onChange={(e) => setGridColor(e.target.value)}
                  className='w-8 h-8 rounded-full border-0 cursor-pointer overflow-hidden'
                  style={{ WebkitAppearance: "none" }}
                />
              </div>
            </div>

            {/* 分隔线 */}
            <div className='border-b border-slate-100'></div>

            {/* AI 对话框样式 */}
            <div>
              <div className='text-sm font-medium text-slate-700 mb-3'>
                {t("workspace.settings.appearanceTab.chatStyle.title")}
              </div>
              <div className='inline-flex rounded-full bg-slate-100 p-1'>
                <button
                  type='button'
                  onClick={() => setExpandedPanelStyle("transparent")}
                  className={cn(
                    "px-4 py-1 rounded-full text-sm transition-all",
                    expandedPanelStyle === "transparent"
                      ? "bg-white text-slate-700 shadow-sm"
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {t("workspace.settings.appearanceTab.chatStyle.transparent")}
                </button>
                <button
                  type='button'
                  onClick={() => setExpandedPanelStyle("solid")}
                  className={cn(
                    "px-5 py-2 rounded-full text-sm transition-all",
                    expandedPanelStyle === "solid"
                      ? "bg-white text-slate-700 shadow-sm"
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {t("workspace.settings.appearanceTab.chatStyle.solid")}
                </button>
              </div>
            </div>
          </div>
        );
      case "ai":
        return (
          <div className='pb-6 space-y-6'>
            <div className='flex flex-col gap-4 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700'>
                  {t("workspace.settings.aiTab.imageOnly.title")}
                </div>
                <div className='text-xs text-slate-500'>
                  {t("workspace.settings.aiTab.imageOnly.desc")}
                </div>
              </div>
              <Switch
                checked={imageOnly}
                onCheckedChange={setImageOnly}
                className='h-5 w-9'
              />
            </div>

            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur'>
              <div className='flex items-start gap-2 mb-3'>
                <Send className='w-4 h-4 text-blue-600' />
                <div>
                  <div className='text-sm font-medium text-slate-700'>
                    {t("workspace.settings.aiTab.shortcuts.title")}
                  </div>
                  <div className='text-xs text-slate-500'>
                    {t("workspace.settings.aiTab.shortcuts.desc")}
                  </div>
                </div>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                {sendShortcutOptions.map((option) => {
                  const active = sendShortcut === option.value;
                  return (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => setSendShortcut(option.value)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-3 text-left transition-all",
                        active
                          ? "border-blue-500 bg-blue-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                      )}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <div className='text-sm font-medium text-slate-700'>
                          {option.label}
                        </div>
                        {active && <Check className='w-4 h-4 text-blue-600' />}
                      </div>
                      <div className='mt-1 text-xs text-slate-500'>
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur'>
              <div className='flex items-start gap-2 mb-3'>
                <Globe className='w-4 h-4 text-indigo-600' />
                <div>
                  <div className='text-sm font-medium text-slate-700'>
                    {t("workspace.settings.aiTab.wheel.title")}
                  </div>
                  <div className='text-xs text-slate-500'>
                    {t("workspace.settings.aiTab.wheel.desc")}
                  </div>
                </div>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                {wheelZoomModeOptions.map((option) => {
                  const active = wheelZoomMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => setWheelZoomMode(option.value)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-3 text-left transition-all",
                        active
                          ? "border-indigo-500 bg-indigo-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
                      )}
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <div className='text-sm font-medium text-slate-700'>
                          {option.label}
                        </div>
                        {active && <Check className='w-4 h-4 text-indigo-600' />}
                      </div>
                      <div className='mt-1 text-xs text-slate-500'>
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur'>
              <div className='mb-4 text-sm font-medium text-slate-700'>
                {t("workspace.settings.aiTab.provider.title")}
              </div>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {/* 国际版按钮已注释
                <button
                  onClick={() => setAIProvider("gemini-pro")}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "gemini-pro"
                      ? "border-green-500 bg-green-50"
                      : "border-slate-200 bg-white hover:border-green-300 hover:bg-green-50/30"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Sparkles className='w-4 h-4 text-green-600' />
                        <span className='text-sm font-medium text-slate-700'>
                          国际版
                        </span>
                      </div>
                      <div className='text-xs text-slate-500'>
                        可使用个人KEY不消耗积分
                      </div>
                    </div>
                    {aiProvider === "gemini-pro" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-green-600' />
                    )}
                  </div>
                </button>
                */}

                <button
                  onClick={() => setAIProvider("banana")}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "banana"
                      ? "border-amber-500 bg-amber-50"
                      : "border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/30"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Zap className='w-4 h-4 text-amber-600' />
                        <span className='text-sm font-medium text-slate-700'>
                          {t("workspace.settings.aiTab.provider.banana")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500'>
                        {t("workspace.settings.aiTab.provider.bananaDesc")}
                      </div>
                    </div>
                    {aiProvider === "banana" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-amber-600' />
                    )}
                  </div>
                </button>

                <button
                  onClick={() => setAIProvider("banana-3.1")}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "banana-3.1"
                      ? "border-rose-500 bg-rose-50"
                      : "border-slate-200 bg-white hover:border-rose-300 hover:bg-rose-50/30"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Sparkles className='w-4 h-4 text-rose-600' />
                        <span className='text-sm font-medium text-slate-700'>
                          {t("workspace.settings.aiTab.provider.banana31")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500'>
                        {t("workspace.settings.aiTab.provider.banana31Desc")}
                      </div>
                    </div>
                    {aiProvider === "banana-3.1" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-rose-600' />
                    )}
                  </div>
                </button>

                <button
                  onClick={() => setAIProvider("banana-2.5")}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all",
                    aiProvider === "banana-2.5"
                      ? "border-orange-500 bg-orange-50"
                      : "border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/30"
                  )}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <Zap className='w-4 h-4 text-orange-600' />
                        <span className='text-sm font-medium text-slate-700'>
                          {t("workspace.settings.aiTab.provider.banana25")}
                        </span>
                      </div>
                      <div className='text-xs text-slate-500'>
                        {t("workspace.settings.aiTab.provider.banana25Desc")}
                      </div>
                    </div>
                    {aiProvider === "banana-2.5" && (
                      <Check className='flex-shrink-0 w-5 h-5 text-orange-600' />
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* Google API Key 设置 - 已隐藏 */}
            {false && (
            <div className='p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur'>
              <div className='flex items-center gap-2 mb-4'>
                <Key className='w-4 h-4 text-green-600' />
                <div className='text-sm font-medium text-slate-700'>
                  Google Gemini API Key
                </div>
              </div>
              <div className='mb-4 text-xs text-slate-500'>
                在「国际版」下输入自己的 Google API Key
                进行生图，不消耗积分。不输入则使用系统默认 Key（消耗积分）。
              </div>

              <div className='p-3 mb-4 border rounded-xl bg-slate-50 border-slate-100'>
                <div className='flex items-center justify-between'>
                  <div className='text-xs text-slate-600'>
                    当前模式：
                    <span
                      className={cn(
                        "ml-1 font-medium",
                        googleApiKeyInfo.mode === "custom"
                          ? "text-green-600"
                          : "text-blue-600"
                      )}
                    >
                      {googleApiKeyInfo.mode === "custom"
                        ? "使用自定义 Key"
                        : "使用系统默认 Key"}
                    </span>
                  </div>
                  {googleApiKeyInfo.hasCustomKey &&
                    googleApiKeyInfo.maskedKey && (
                      <div className='font-mono text-xs text-slate-500'>
                        {googleApiKeyInfo.maskedKey}
                      </div>
                    )}
                </div>
              </div>

              {/* 输入框 */}
              <div className='flex flex-col gap-3'>
                <div className='relative'>
                  <input
                    type={showGoogleApiKey ? "text" : "password"}
                    value={googleApiKeyInput}
                    onChange={(e) => setGoogleApiKeyInput(e.target.value)}
                    placeholder={
                      googleApiKeyInfo.hasCustomKey
                        ? "输入新的 Key 以更新..."
                        : "输入 Google Gemini API Key..."
                    }
                    className='w-full px-3 py-2 pr-10 font-mono text-sm border rounded-lg border-slate-200 focus:border-green-500 focus:outline-none'
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && googleApiKeyInput.trim()) {
                        handleSaveGoogleApiKey();
                      }
                      e.stopPropagation();
                    }}
                  />
                  <button
                    type='button'
                    onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                    className='absolute p-1 -translate-y-1/2 right-2 top-1/2 text-slate-400 hover:text-slate-600'
                    title={showGoogleApiKey ? "隐藏" : "显示"}
                  >
                    {showGoogleApiKey ? (
                      <EyeOff className='w-4 h-4' />
                    ) : (
                      <Eye className='w-4 h-4' />
                    )}
                  </button>
                </div>

                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    className={cn(
                      "flex-1 rounded-xl text-sm border-green-200 text-green-600 hover:bg-green-50",
                      googleApiKeySaving && "opacity-70"
                    )}
                    disabled={googleApiKeySaving || !googleApiKeyInput.trim()}
                    onClick={handleSaveGoogleApiKey}
                  >
                    {googleApiKeySaving ? "保存中..." : "保存 Key"}
                  </Button>
                  {googleApiKeyInfo.hasCustomKey && (
                    <Button
                      variant='outline'
                      size='sm'
                      className={cn(
                        "rounded-xl text-sm border-red-200 text-red-600 hover:bg-red-50",
                        googleApiKeySaving && "opacity-70"
                      )}
                      disabled={googleApiKeySaving}
                      onClick={handleClearGoogleApiKey}
                    >
                      清除
                    </Button>
                  )}
                </div>

                {/* 反馈信息 */}
                {googleApiKeyFeedback === "success" && (
                  <div className='text-xs text-green-600'>已保存</div>
                )}
                {googleApiKeyFeedback === "error" && (
                  <div className='text-xs text-red-600'>保存失败，请重试</div>
                )}
              </div>
            </div>
            )}
          </div>
        );
      case "advanced":
        return (
          <div className='pb-6 space-y-6'>
            {import.meta.env.DEV && (
              <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <div className='text-sm font-medium text-slate-700'>
                    {t("workspace.settings.advancedTab.memory.title")}
                  </div>
                  <div className='text-xs text-slate-500'>
                    {t("workspace.settings.advancedTab.memory.desc")}
                  </div>
                </div>
                <Button
                  variant='outline'
                  className='text-sm rounded-xl'
                  onClick={() => setShowMemoryDebug(!showMemoryDebug)}
                >
                  <Activity className='w-4 h-4 mr-2' />
                  {showMemoryDebug
                    ? t("workspace.settings.advancedTab.closePanel")
                    : t("workspace.settings.advancedTab.openPanel")}
                </Button>
              </div>
            )}
            {import.meta.env.DEV && (
              <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <div className='text-sm font-medium text-slate-700'>
                    {t("workspace.settings.advancedTab.history.title")}
                  </div>
                  <div className='text-xs text-slate-500'>
                    {t("workspace.settings.advancedTab.history.desc")}
                  </div>
                </div>
                <Button
                  variant='outline'
                  className='text-sm rounded-xl'
                  onClick={() => setShowHistoryDebug(!showHistoryDebug)}
                >
                  <History className='w-4 h-4 mr-2' />
                  {showHistoryDebug
                    ? t("workspace.settings.advancedTab.closePanel")
                    : t("workspace.settings.advancedTab.openPanel")}
                </Button>
              </div>
            )}
            <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700'>
                  {t("workspace.settings.advancedTab.sandbox.title")}
                </div>
                <div className='text-xs text-slate-500'>
                  {t("workspace.settings.advancedTab.sandbox.desc")}
                </div>
              </div>
              <Button
                variant='outline'
                className='text-sm text-gray-900 rounded-xl border-gray-800/20 hover:bg-gray-800/10'
                onClick={() => {
                  const { toggleSandboxPanel } = useUIStore.getState();
                  toggleSandboxPanel();
                  setIsSettingsOpen(false);
                }}
              >
                <Code className='w-4 h-4 mr-2' />
                {t("workspace.settings.advancedTab.sandbox.open")}
              </Button>
            </div>
            <div className='flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <div className='text-sm font-medium text-slate-700'>
                  {t("workspace.settings.advancedTab.logout.title")}
                </div>
                <div className='text-xs text-slate-500'>
                  {t("workspace.settings.advancedTab.logout.desc")}
                </div>
              </div>
              <Button
                variant='outline'
                className={cn(
                  "rounded-xl text-sm border-red-200 text-red-600 hover:bg-red-50",
                  loading ? "opacity-70" : ""
                )}
                disabled={loading}
                onClick={handleLogout}
              >
                <LogOut className='w-4 h-4 mr-2' />
                {loading
                  ? t("workspace.settings.advancedTab.logout.loading")
                  : t("workspace.settings.advancedTab.logout.button")}
              </Button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div
        aria-hidden={focusMode}
        className={cn(
          "fixed top-4 left-0 right-0 z-50 px-4 flex items-start justify-between gap-4 transition-all duration-[50ms] ease-out pointer-events-none",
          showLayerPanel ? "left-[306px]" : "left-0",
          focusMode && "hidden"
        )}
      >
        {/* 左侧栏：Logo + Beta + 项目名称 */}
        <div className='flex items-center gap-2 md:gap-3 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 pointer-events-auto'>
          {/* Logo */}
          <div
            className='flex w-[110px] h-auto items-center pb-1 justify-center cursor-pointer hover:opacity-80 transition-opacity select-none'
            onClick={handleLogoClick}
            title={t("workspace.header.backHome")}
          >
            <img
              src='/LogoText.svg'
              alt='Logo'
              draggable='false'
              style={{
                imageRendering: "auto",
                WebkitFontSmoothing: "antialiased",
              }}
            />
          </div>
          {/* 分隔线 */}
          <div className='w-px h-5 bg-gray-300/40' />

          {/* 项目名称与快速切换 */}
          <div className='items-center hidden gap-1 sm:flex'>
            {editingTitle ? (
              <input
                autoFocus
                className='h-6 text-sm px-2 rounded border border-slate-300 bg-white/90 min-w-[200px] max-w-[380px]'
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                  e.stopPropagation();
                }}
              />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className='flex items-center gap-1 px-2 py-1 transition-colors bg-transparent border-none rounded-full cursor-pointer select-none hover:bg-slate-100'
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingTitle(true);
                  }}
                >
                  <ChevronDown className='w-4 h-4 text-slate-500' />
                  <span
                    className='truncate text-sm text-gray-800 max-w-[260px]'
                    title={t("workspace.header.renameHint")}
                  >
                    {currentProject?.name || untitledLabel}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='start'
                  sideOffset={12}
                  className='min-w-[220px] rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-lg overflow-hidden'
                >
                  <DropdownMenuLabel className='px-2 pb-1 text-[11px] font-medium text-slate-400'>
                    {t("workspace.header.switchProject")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className='mb-1' />
                  <div className='max-h-[340px] overflow-y-auto space-y-0.5'>
                    {recentProjects.length === 0 ? (
                      <DropdownMenuItem
                        disabled
                        className='cursor-default text-slate-400'
                      >
                        {t("workspace.header.noProjects")}
                      </DropdownMenuItem>
                    ) : (
                      recentProjects.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          onClick={(event) => {
                            event.preventDefault();
                            handleQuickSwitch(project.id);
                          }}
                          className='flex items-center justify-between gap-3 px-2 py-1 text-sm'
                        >
                          <span className='truncate text-slate-700'>
                            {project.name || untitledLabel}
                          </span>
                          {project.id === currentProject?.id && (
                            <Check className='w-4 h-4 text-blue-600' />
                          )}
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                  <DropdownMenuSeparator className='my-1' />
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.preventDefault();
                      openModal();
                    }}
                    className='flex items-center gap-2 px-2 py-1 text-sm text-blue-600 hover:text-blue-700'
                  >
                    <FolderOpen className='w-4 h-4' />
                    {t("workspace.header.openManageFile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async (event) => {
                      event.preventDefault();
                      await create();
                    }}
                    className='flex items-center justify-between gap-3 px-2 py-1 text-sm text-blue-600 hover:text-blue-700'
                  >
                    <span className='flex items-center gap-2'>
                      <span className='inline-flex items-center justify-center w-4 h-4 text-xs border border-current rounded-full'>
                        +
                      </span>
                      {t("workspace.header.newProject")}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {isAdmin && !fpsOverlayAdminButtonLayout && (
          <div className='flex items-center h-[46px] pointer-events-auto'>
            <Button
              variant='ghost'
              size='sm'
              className='h-8 w-8 p-0 text-slate-600 transition-all duration-200 border rounded-full bg-white/80 border-slate-300 hover:bg-slate-100 hover:text-slate-700'
              onClick={() => navigate("/admin")}
              title='Admin 后台'
              aria-label='打开 Admin 后台'
            >
              <Activity className='w-3.5 h-3.5' />
            </Button>
          </div>
        )}
        {isAdmin && fpsOverlayAdminButtonLayout && (
          <div
            className='pointer-events-auto'
            style={{
              position: "fixed",
              top: fpsOverlayAdminButtonLayout.top,
              left: fpsOverlayAdminButtonLayout.left,
              zIndex: 1001,
            }}
          >
            <Button
              variant='ghost'
              size='sm'
              className='p-0 text-slate-600 transition-all duration-200 border rounded-full bg-white/80 border-slate-300 hover:bg-slate-100 hover:text-slate-700'
              style={{
                width: fpsOverlayAdminButtonLayout.size,
                height: fpsOverlayAdminButtonLayout.size,
              }}
              onClick={() => navigate("/admin")}
              title='Admin 后台'
              aria-label='打开 Admin 后台'
            >
              <Activity className='w-3.5 h-3.5' />
            </Button>
          </div>
        )}

        {/* 空白拉伸 */}
        <div className='flex-1' />

        {/* 右侧栏：功能按钮 + 保存状态 */}
        <div className='flex flex-col items-center gap-1 pointer-events-auto'>
          <div className='flex items-center gap-1.5 md:gap-2 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300'>
            {/* 素材库按钮 */}
            {showLibraryButton && (
              <Button
                onClick={toggleLibraryPanel}
                variant='ghost'
                size='sm'
                className={cn(
                  "h-7 text-xs flex items-center rounded-full transition-all duration-200",
                  "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light text-gray-600",
                  "hover:bg-gray-900 hover:text-white hover:border-gray-900",
                  showLibraryPanel ? "text-gray-900" : "",
                  "w-8 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1"
                )}
                title={
                  showLibraryButton
                    ? t("workspace.header.closeLibrary")
                    : t("workspace.header.openLibrary")
                }
              >
                <Library className='w-3 h-3' />
                <span className='hidden sm:inline'>{t("workspace.header.library")}</span>
              </Button>
            )}

            {/* 全局运行按钮 */}
            <Button
              variant='ghost'
              size='sm'
              className={cn(
                "h-7 px-2 gap-1.5 rounded-full transition-all duration-200 border",
                "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass shadow-liquid-glass",
                "text-slate-700 hover:bg-liquid-glass-hover"
              )}
              title={
                isGlobalFlowRunning
                  ? t("workspace.header.globalAutoStop")
                  : t("workspace.header.globalAutoRun")
              }
              onClick={() => {
                if (isGlobalFlowRunning) {
                  window.dispatchEvent(new CustomEvent("flow:stop-global"));
                } else {
                  window.dispatchEvent(new CustomEvent("flow:run-global"));
                }
              }}
            >
              {isGlobalFlowRunning ? (
                <span
                  className='inline-block w-2.5 h-2.5 bg-black rounded-[2px]'
                  aria-hidden='true'
                />
              ) : (
                <Play className='w-4 h-4' />
              )}
              <span className='text-[11px] leading-none whitespace-nowrap'>
                {isGlobalFlowRunning
                  ? t("workspace.header.globalAutoStop")
                  : t("workspace.header.globalAutoRun")}
              </span>
            </Button>

            {/* 帮助按钮 */}
            <Button
              variant='ghost'
              size='sm'
              className='p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover'
              title={t("workspace.header.help")}
              onClick={() =>
                window.open(
                  "https://gcnyatv1ofs3.feishu.cn/docx/U5Jzd18dLoCtvlxhHdDcoRgVnWd",
                  "_blank"
                )
              }
            >
              <HelpCircle className='w-4 h-4' />
            </Button>

            <div
              className='relative'
              onMouseEnter={() => setIsWechatQrOpen(true)}
              onMouseLeave={() => setIsWechatQrOpen(false)}
            >
              {isWechatQrOpen && (
                <div className='absolute top-full right-0 mt-2 p-4 rounded-2xl bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl z-[100] animate-in fade-in slide-in-from-top-2 duration-200'>
                  <div className='flex gap-4'>
                    <div className='flex flex-col items-center'>
                      <div className='w-28 h-28 bg-white rounded-lg p-2 mb-2'>
                        <img
                          src={wechatQrCodes.officialAccount}
                          alt={t("home.wechat.followOfficial")}
                          className='w-full h-full object-contain'
                          onError={(event) => {
                            (event.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                          }}
                        />
                      </div>
                      <span className='text-xs text-white/80 whitespace-nowrap'>
                        {t("home.wechat.followOfficial")}
                      </span>
                    </div>
                    <div className='flex flex-col items-center'>
                      <div className='w-28 h-28 bg-white rounded-lg p-2 mb-2'>
                        <img
                          src={wechatQrCodes.wechatGroup}
                          alt={t("home.wechat.joinGroup")}
                          className='w-full h-full object-contain'
                          onError={(event) => {
                            (event.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">${encodeURIComponent(t("home.wechat.noImage"))}</text></svg>`;
                          }}
                        />
                      </div>
                      <span className='text-xs text-white/80 whitespace-nowrap'>
                        {t("home.wechat.joinGroup")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <Button
                variant='ghost'
                size='sm'
                className='p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover'
                title='WeChat'
              >
                <MessageCircle className='w-4 h-4' />
              </Button>
            </div>

            {/* 设置按钮 */}
            <Button
              variant='ghost'
              size='sm'
              className='p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover'
              title={t("workspace.header.settings")}
              onClick={() => {
                setActiveSettingsSection("workspace");
                setIsSettingsOpen(true);
              }}
            >
              <Menu className='w-4 h-4' />
            </Button>
          </div>
          <div className='pr-1 text-[11px] leading-none w-full text-center h-4 flex items-center justify-center select-none pointer-events-none'>
            <span className='pointer-events-none'>
              <AutosaveStatus />
            </span>
          </div>
        </div>

        {isSettingsOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className='fixed inset-0 z-[1000] flex items-center justify-center bg-transparent px-4'
              onClick={() => setIsSettingsOpen(false)}
            >
              <div
                className='relative flex h-[90vh] max-h-[700px] w-full max-w-[1000px] flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_32px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl'
                onClick={(event) => event.stopPropagation()}
              >
                <div className='flex flex-1 h-full pt-4 overflow-hidden sm:pt-0'>
                  <aside className='hidden w-[230px] h-full py-5 border-r shrink-0 border-slate-100 bg-white sm:flex sm:flex-col'>
                    {/* 顶部标题 */}
                    <div className='flex items-center gap-2 px-6 mb-6 my-1'>
                      <svg
                        className='w-4 h-4 text-slate-400'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                      >
                        <circle cx='12' cy='12' r='3' />
                        <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' />
                      </svg>
                      <span className='text-sm text-slate-500'>
                        {t("workspace.settings.title")}
                      </span>
                    </div>

                    {/* 导航菜单 */}
                    <div className='flex-1 px-4 space-y-2'>
                      {SETTINGS_SECTIONS.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSettingsSection === section.id;
                        const hasNotification =
                          section.id === "referral" && showReferralNotification;
                        return (
                          <button
                            key={section.id}
                            type='button'
                            onClick={() => setActiveSettingsSection(section.id)}
                            className={cn(
                              "w-full flex items-center gap-3 rounded-3xl px-4 py-3 text-sm transition-colors",
                              isActive
                                ? "bg-slate-100 text-slate-600"
                                : "text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            <Icon className='w-4 h-4' />
                            <span>{t(section.labelKey)}</span>
                            {hasNotification && (
                              <span className='w-2 h-2 bg-red-500 rounded-full ml-auto' />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* 底部用户信息 */}
                    <div className='px-6 pt-4 mt-auto'>
                      <div className='flex items-center gap-2'>
                        <div className='w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-white'>
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className='text-sm text-slate-600'>
                          {displayName}
                        </span>
                      </div>
                    </div>
                  </aside>
                  <div className='flex-1 px-4 py-6 overflow-y-auto sm:px-6'>
                    <div className='flex flex-wrap gap-2 mb-4 sm:hidden'>
                      {SETTINGS_SECTIONS.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSettingsSection === section.id;
                        return (
                          <button
                            key={section.id}
                            type='button'
                            onClick={() => setActiveSettingsSection(section.id)}
                            className={cn(
                              "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors",
                              isActive
                                ? "border-gray-800 bg-gray-800 text-white shadow-sm"
                                : "border-slate-200 bg-white/90 text-slate-600"
                            )}
                          >
                            <Icon className='w-3 h-3' />
                            <span>{t(section.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {renderSettingsContent()}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* 内存调试面板 */}
        <MemoryDebugPanel
          isVisible={showMemoryDebug}
          onClose={() => setShowMemoryDebug(false)}
        />

        {/* 历史记录调试面板 */}
        <HistoryDebugPanel
          isVisible={showHistoryDebug}
          onClose={() => setShowHistoryDebug(false)}
        />

        {/* 项目管理器（文件选择弹窗） */}
        <ProjectManagerModal />

        {/* 全局图片历史页面 */}
        <GlobalImageHistoryPage
          isOpen={isGlobalHistoryOpen}
          onClose={() => setIsGlobalHistoryOpen(false)}
        />
      </div>
    </>
  );
};

export default FloatingHeader;
