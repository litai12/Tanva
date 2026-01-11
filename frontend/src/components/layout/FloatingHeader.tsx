import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
    X,
    Cloud,
    Zap,
    Key,
    Eye,
    EyeOff,
    Code,
    FolderOpen,
    Send
} from 'lucide-react';
import MemoryDebugPanel from '@/components/debug/MemoryDebugPanel';
import HistoryDebugPanel from '@/components/debug/HistoryDebugPanel';
import { useProjectStore } from '@/stores/projectStore';
import ProjectManagerModal from '@/components/projects/ProjectManagerModal';
import { useUIStore, useCanvasStore, GridStyle } from '@/stores';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import ManualSaveButton from '@/components/autosave/ManualSaveButton';
import GlobalImageHistoryPage from '@/components/global-history/GlobalImageHistoryPage';
import { useGlobalImageHistoryStore } from '@/stores/globalImageHistoryStore';
import AutosaveStatus from '@/components/autosave/AutosaveStatus';
import { paperSaveService } from '@/services/paperSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { authApi, type GoogleApiKeyInfo } from '@/services/authApi';
import {
    claimDailyReward,
    getDailyRewardStatus,
    getMyCredits,
    type DailyRewardStatus,
    type UserCreditsInfo,
} from '@/services/adminApi';

const SETTINGS_SECTIONS = [
    { id: 'workspace', label: '工作区', icon: Square },
    { id: 'appearance', label: '视图外观', icon: Grid3x3 },
    { id: 'ai', label: 'AI 设置', icon: Sparkles },
    { id: 'advanced', label: '高级', icon: Activity },
] as const;

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

const VIEW_APPEARANCE_STORAGE_KEY = 'tanva-view-settings';
const MAX_QUICK_PROJECTS = 5;

const FloatingHeader: React.FC = () => {
    const navigate = useNavigate();
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
        setGridStyle,
        setGridSize,
        setGridColor,
        setGridBgColor,
        setGridBgEnabled,
        setZoomSensitivity
    } = useCanvasStore();

    // AI 配置
    const { imageOnly, setImageOnly, aiProvider, setAIProvider, sendShortcut, setSendShortcut, expandedPanelStyle, setExpandedPanelStyle } = useAIChatStore();


    // 项目（文件）管理
    const { currentProject, openModal, create, rename, optimisticRenameLocal, projects, open } = useProjectStore();
    // Header 下拉中的快速切换与新建，直接复用项目管理的函数
    const handleQuickSwitch = (projectId: string) => {
        if (!projectId || projectId === currentProject?.id) return;
        open(projectId);
    };
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleInput, setTitleInput] = useState('');
    useEffect(() => {
        setTitleInput(currentProject?.name || '未命名');
    }, [currentProject?.id, currentProject?.name]);
    const commitTitle = async () => {
        const name = titleInput.trim() || '未命名';
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
    const [saveFeedback, setSaveFeedback] = useState<'idle' | 'success' | 'error'>('idle');
    const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasAppliedSavedAppearanceRef = useRef(false);

    // Google API Key 管理状态
    const [googleApiKeyInfo, setGoogleApiKeyInfo] = useState<GoogleApiKeyInfo>({ hasCustomKey: false, maskedKey: null, mode: 'official' });
    const [googleApiKeyInput, setGoogleApiKeyInput] = useState('');
    const [showGoogleApiKey, setShowGoogleApiKey] = useState(false);
    const [googleApiKeySaving, setGoogleApiKeySaving] = useState(false);
    const [googleApiKeyFeedback, setGoogleApiKeyFeedback] = useState<'idle' | 'success' | 'error'>('idle');
    const googleApiKeyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 用户积分状态
    const [creditsInfo, setCreditsInfo] = useState<UserCreditsInfo | null>(null);
    const [creditsLoading, setCreditsLoading] = useState(false);
    const [dailyRewardStatus, setDailyRewardStatus] = useState<DailyRewardStatus | null>(null);
    const [dailyRewardLoading, setDailyRewardLoading] = useState(false);
    const [dailyRewardClaiming, setDailyRewardClaiming] = useState(false);

    // 清理 Google API Key 反馈计时器
    useEffect(() => () => {
        if (googleApiKeyFeedbackTimerRef.current) {
            clearTimeout(googleApiKeyFeedbackTimerRef.current);
            googleApiKeyFeedbackTimerRef.current = null;
        }
    }, []);

    const handleSaveGoogleApiKey = useCallback(async () => {
        if (googleApiKeySaving) return;
        setGoogleApiKeySaving(true);
        try {
            const trimmedKey = googleApiKeyInput.trim();
            const result = await authApi.updateGoogleApiKey({
                googleCustomApiKey: trimmedKey || null,
                googleKeyMode: trimmedKey ? 'custom' : 'official',
            });
            if (result.success) {
                setGoogleApiKeyFeedback('success');
                // 重新加载状态
                const info = await authApi.getGoogleApiKey();
                setGoogleApiKeyInfo(info);
                setGoogleApiKeyInput(''); // 清空输入框
            } else {
                setGoogleApiKeyFeedback('error');
            }
        } catch (e) {
            console.error('Failed to save Google API Key:', e);
            setGoogleApiKeyFeedback('error');
        } finally {
            setGoogleApiKeySaving(false);
            if (googleApiKeyFeedbackTimerRef.current) {
                clearTimeout(googleApiKeyFeedbackTimerRef.current);
            }
            googleApiKeyFeedbackTimerRef.current = setTimeout(() => setGoogleApiKeyFeedback('idle'), 2500);
        }
    }, [googleApiKeyInput, googleApiKeySaving]);

    const handleClearGoogleApiKey = useCallback(async () => {
        if (googleApiKeySaving) return;
        const confirmed = window.confirm('确定要清除自定义 API Key 吗？系统将恢复使用官方 Key。');
        if (!confirmed) return;

        setGoogleApiKeySaving(true);
        try {
            const result = await authApi.updateGoogleApiKey({
                googleCustomApiKey: null,
                googleKeyMode: 'official',
            });
            if (result.success) {
                setGoogleApiKeyFeedback('success');
                setGoogleApiKeyInfo({ hasCustomKey: false, maskedKey: null, mode: 'official' });
                setGoogleApiKeyInput('');
            } else {
                setGoogleApiKeyFeedback('error');
            }
        } catch (e) {
            console.error('Failed to clear Google API Key:', e);
            setGoogleApiKeyFeedback('error');
        } finally {
            setGoogleApiKeySaving(false);
            if (googleApiKeyFeedbackTimerRef.current) {
                clearTimeout(googleApiKeyFeedbackTimerRef.current);
            }
            googleApiKeyFeedbackTimerRef.current = setTimeout(() => setGoogleApiKeyFeedback('idle'), 2500);
        }
    }, [googleApiKeySaving]);

    // 一次性加载保存的视图外观设置
    useEffect(() => {
        if (hasAppliedSavedAppearanceRef.current) return;
        if (typeof window === 'undefined') return;
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
            if (!saved || typeof saved !== 'object') return;

            if (typeof saved.showGrid === 'boolean') setShowGrid(saved.showGrid);
            if (saved.gridStyle && Object.values(GridStyle).includes(saved.gridStyle)) {
                setGridStyle(saved.gridStyle);
            }
            if (typeof saved.gridSize === 'number' && saved.gridSize >= 1 && saved.gridSize <= 200) {
                setGridSize(saved.gridSize);
                setGridSizeInput(String(saved.gridSize));
            }
            if (typeof saved.gridColor === 'string' && saved.gridColor.startsWith('#')) {
                setGridColor(saved.gridColor);
            }
            if (typeof saved.gridBgColor === 'string' && saved.gridBgColor.startsWith('#')) {
                setGridBgColor(saved.gridBgColor);
            }
            if (typeof saved.gridBgEnabled === 'boolean') {
                setGridBgEnabled(saved.gridBgEnabled);
            }
        } catch (error) {
            console.warn('[FloatingHeader] Failed to load saved appearance settings:', error);
        }
    }, [setShowGrid, setGridStyle, setGridSize, setGridColor, setGridBgColor, setGridBgEnabled, setGridSizeInput]);

    // 清理保存提示计时器
    useEffect(() => () => {
        if (saveFeedbackTimerRef.current) {
            clearTimeout(saveFeedbackTimerRef.current);
            saveFeedbackTimerRef.current = null;
        }
    }, []);

    const handleSaveAppearanceSettings = useCallback(() => {
        if (typeof window === 'undefined') return;
        const payload = {
            showGrid,
            gridStyle,
            gridSize,
            gridColor,
            gridBgColor,
            gridBgEnabled,
        };

        try {
            window.localStorage.setItem(VIEW_APPEARANCE_STORAGE_KEY, JSON.stringify(payload));
            setSaveFeedback('success');
        } catch (error) {
            console.warn('[FloatingHeader] Failed to save appearance settings:', error);
            setSaveFeedback('error');
        } finally {
            if (saveFeedbackTimerRef.current) {
                clearTimeout(saveFeedbackTimerRef.current);
            }
            saveFeedbackTimerRef.current = setTimeout(() => setSaveFeedback('idle'), 2200);
        }
    }, [showGrid, gridStyle, gridSize, gridColor, gridBgColor, gridBgEnabled]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('workspace');
    const [isGlobalHistoryOpen, setIsGlobalHistoryOpen] = useState(false);
    
    // 监听网格大小变化
    useEffect(() => {
        setGridSizeInput(String(gridSize));
    }, [gridSize]);

    useEffect(() => {
        if (!isSettingsOpen) return;
        if (typeof document === 'undefined') return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsSettingsOpen(false);
            }
        };

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSettingsOpen]);

    const commitGridSize = () => {
        const n = parseInt(gridSizeInput, 10);
        if (!isNaN(n) && n > 0 && n <= 200) setGridSize(n);
        else setGridSizeInput(String(gridSize));
    };

    const clearImageHistory = useImageHistoryStore((state) => state.clearHistory);
    const historyCount = useImageHistoryStore((state) => state.history.length);
    const globalHistoryCount = useGlobalImageHistoryStore((state) => state.totalCount);
    const fetchGlobalHistoryCount = useGlobalImageHistoryStore((state) => state.fetchCount);
    const authUser = useAuthStore((s) => s.user);

    // 获取全局历史数量（仅在已登录时调用，避免未登录时触发受保护接口）
    useEffect(() => {
        if (!authUser) return;
        fetchGlobalHistoryCount();
    }, [fetchGlobalHistoryCount, authUser]);

    const handleClearImageHistory = React.useCallback(() => {
        if (historyCount === 0) {
            alert('当前没有需要清理的图片历史。');
            return;
        }
        const confirmed = window.confirm(`确定要清空 ${historyCount} 条图片历史记录吗？此操作仅清除本地缓存，云端文件不会删除。`);
        if (confirmed) {
            clearImageHistory();
        }
    }, [clearImageHistory, historyCount]);

    const handleLogoClick = () => {
        logger.debug('Logo clicked - navigating to home');
        navigate('/');
    };


    const handleShare = () => {
        if (navigator.share) {
            navigator.share({
                title: '智绘画板',
                text: '来体验这个智能画板应用！',
                url: window.location.href
            }).catch(console.error);
        } else {
            navigator.clipboard.writeText(window.location.href).then(() => {
                alert('链接已复制到剪贴板！');
            }).catch(() => {
                alert('分享链接: ' + window.location.href);
            });
        }
    };

    // 清空画布内容（保留网格/背景等系统层）
    const handleClearCanvas = () => {
        const confirmed = window.confirm('确定要清空画布上的全部内容吗？\n此操作将删除所有绘制元素与节点（保留背景/网格），且当前不支持撤销。');
        if (!confirmed) return;

        try {
            // 清理绘制内容但保留图层结构与系统层
            paperSaveService.clearCanvasContent();

            // 清空运行时实例，避免残留引用
            try { (window as any).tanvaImageInstances = []; } catch {}
            try { (window as any).tanvaModel3DInstances = []; } catch {}
            try { (window as any).tanvaTextItems = []; } catch {}

            // 触发一次自动保存，记录清空后的状态
            try { paperSaveService.triggerAutoSave(); } catch {}

            // 同时清空 Flow 节点与连线，并标记为脏以触发文件保存
            try {
                const api = useProjectContentStore.getState();
                api.updatePartial({ flow: { nodes: [], edges: [] } }, { markDirty: true });
            } catch {}
        } catch (e) {
            console.error('清空画布失败:', e);
            alert('清空画布失败，请稍后重试');
        }
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
                if (creditsResult.status === 'fulfilled') setCreditsInfo(creditsResult.value);
                else console.warn(creditsResult.reason);
                if (dailyRewardResult.status === 'fulfilled') setDailyRewardStatus(dailyRewardResult.value);
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
            if (creditsResult.status === 'fulfilled') setCreditsInfo(creditsResult.value);
            else console.warn(creditsResult.reason);
            if (dailyRewardResult.status === 'fulfilled') setDailyRewardStatus(dailyRewardResult.value);
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

    const handleClaimDailyReward = useCallback(async () => {
        if (!user || dailyRewardClaiming) return;
        setDailyRewardClaiming(true);
        try {
            const result = await claimDailyReward();
            if (result.success) {
                alert('领取成功：已发放每日登录奖励');
            } else if (result.alreadyClaimed) {
                alert('今日奖励已领取');
            } else {
                alert('领取失败，请稍后重试');
            }
        } catch (e: any) {
            console.error('Failed to claim daily reward:', e);
            alert(e?.message || '领取失败，请稍后重试');
        } finally {
            setDailyRewardClaiming(false);
            refreshCreditsAndDailyReward();
        }
    }, [dailyRewardClaiming, refreshCreditsAndDailyReward, user]);

    const displayName = user?.name || user?.phone?.slice(-4) || user?.email || user?.id?.slice(-4) || '用户';
    const secondaryId = user?.email || (user?.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : '') || '';
    const status = (() => {
        switch (connection) {
            case 'server': return { label: '在线', color: '#16a34a' };
            case 'refresh': return { label: '已续期', color: '#f59e0b' };
            case 'local': return { label: '在线', color: '#16a34a' };
            case 'mock': return { label: 'Mock', color: '#8b5cf6' };
            default: return { label: '未知', color: '#9ca3af' };
        }
    })();
    const showLibraryButton = false; // 临时关闭素材库入口，后续恢复时改为 true
    const handleLogout = async () => {
        if (loading) return;
        try {
            console.log('🔴 开始退出登录...');
            await logout();
            console.log('✅ 登出成功，准备跳转...');
            navigate('/auth/login', { replace: true });
        } catch (err) {
            console.error('❌ 退出登录失败:', err);
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
        { value: 'enter' as const, label: '回车发送', description: 'Enter 发送，Shift+Enter 换行' },
        { value: 'mod-enter' as const, label: 'Ctrl/Cmd + Enter', description: '回车换行，Ctrl/Cmd + Enter 发送' },
    ];
    const renderSettingsContent = () => {
        switch (activeSettingsSection) {
            case 'workspace':
                return (
                    <div className="pb-6 space-y-6">
                        <div className="p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                                        <span>你好，{displayName}</span>
                                        <span
                                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                                            style={{ borderColor: status.color, color: status.color }}
                                            title={`认证来源：${status.label}`}
                                        >
                                            <span
                                                style={{ width: 6, height: 6, borderRadius: 9999, background: status.color, display: 'inline-block' }}
                                            />
                                            {status.label}
                                        </span>
                                    </div>
                                    {secondaryId && (
                                        <div className="mt-1 text-xs truncate text-muted-foreground">
                                            {secondaryId}
                                        </div>
                                    )}
                                </div>
                                <div className="shrink-0">
                                    <ManualSaveButton />
                                </div>
                            </div>
                            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                                <span>自动保存</span>
                                <span className="text-slate-600">
                                    <AutosaveStatus />
                                </span>
                            </div>
                        </div>

                        {/* 积分信息卡片 */}
                        <div className="p-5 border shadow-sm rounded-2xl border-slate-200 bg-gradient-to-br from-blue-50 to-indigo-50">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-blue-600" />
                                    <span className="text-sm font-medium text-slate-700">我的积分</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant={dailyRewardStatus?.canClaim === false ? "outline" : "default"}
                                        size="sm"
                                        className={cn(
                                            "h-7 px-2 text-xs",
                                            dailyRewardStatus?.canClaim === false
                                                ? "text-slate-600 border-slate-300 bg-white/70 hover:bg-white"
                                                : "bg-blue-600 hover:bg-blue-700 text-white"
                                        )}
                                        disabled={
                                            !user ||
                                            dailyRewardLoading ||
                                            dailyRewardClaiming ||
                                            dailyRewardStatus?.canClaim === false
                                        }
                                        onClick={handleClaimDailyReward}
                                        title={dailyRewardStatus?.lastClaimAt ? `上次领取：${new Date(dailyRewardStatus.lastClaimAt).toLocaleString('zh-CN')}` : undefined}
                                    >
                                        {!user
                                            ? '登录后领取'
                                            : dailyRewardLoading
                                            ? '加载中...'
                                            : dailyRewardClaiming
                                                ? '领取中...'
                                                : dailyRewardStatus?.canClaim === false
                                                    ? '今日已领'
                                                    : '领取奖励'}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="px-2 text-xs text-gray-800 h-7 hover:text-gray-900 hover:bg-gray-800/10"
                                        onClick={() => {
                                            setIsSettingsOpen(false);
                                            window.open('/my-credits', '_blank');
                                        }}
                                    >
                                        详情
                                    </Button>
                                </div>
                            </div>
                            {creditsLoading ? (
                                <div className="text-xs text-slate-500">加载中...</div>
                            ) : creditsInfo ? (
                                <div className="space-y-3">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-bold text-blue-600">{creditsInfo.balance}</span>
                                        <span className="text-xs select-none text-slate-500">可用积分</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200/60">
                                        <div>
                                            <div className="text-xs text-slate-500">累计获得</div>
                                            <div className="text-sm font-medium text-green-600">+{creditsInfo.totalEarned}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500">累计消耗</div>
                                            <div className="text-sm font-medium text-orange-600">-{creditsInfo.totalSpent}</div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-slate-500">暂无积分信息</div>
                            )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Button
                                variant="outline"
                                className="h-10 text-sm rounded-xl"
                                onClick={() => {
                                    setIsSettingsOpen(false);
                                    openModal();
                                }}
                            >
                                <Square className="w-4 h-4 mr-2" />
                                打开/管理文件
                            </Button>
                            <Button
                                variant="outline"
                                className="h-10 text-sm rounded-xl"
                                onClick={() => navigate('/')}
                            >
                                <Home className="w-4 h-4 mr-2" />
                                返回首页
                            </Button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Button
                                variant="outline"
                                className="h-10 text-sm rounded-xl"
                                onClick={() => setIsGlobalHistoryOpen(true)}
                            >
                                <History className="w-4 h-4 mr-2" />
                                全局图片历史
                            </Button>
                            <Button
                                variant="outline"
                                className="h-10 text-sm text-red-600 border-red-200 rounded-xl hover:bg-red-50"
                                onClick={handleClearCanvas}
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                清空画布内容
                            </Button>
                        </div>
                    </div>
                );
            case 'appearance':
                return (
                    <div className="pb-6 space-y-6">
                        <div className="flex items-center justify-between p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div>
                                <div className="text-sm font-medium text-slate-700">保存视图设置</div>
                                <div className="text-xs text-slate-500">保存当前网格样式与颜色，刷新后保持一致。</div>
                                {saveFeedback === 'success' && (
                                    <div className="mt-1 text-xs text-green-600">已保存</div>
                                )}
                                {saveFeedback === 'error' && (
                                    <div className="mt-1 text-xs text-red-600">保存失败，请重试</div>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                className="text-sm text-gray-900 h-9 rounded-xl border-gray-800/20 hover:bg-gray-800/10"
                                onClick={handleSaveAppearanceSettings}
                            >
                                保存设置
                            </Button>
                        </div>

                        <div className="p-5 space-y-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-sm font-medium text-slate-700">显示背景网格</div>
                                    <div className="text-xs text-slate-500">在画布中启用网格辅助对齐</div>
                                </div>
                                <Switch
                                    checked={showGrid}
                                    onCheckedChange={toggleGrid}
                                    className="h-5 w-9"
                                />
                            </div>

                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-sm font-medium text-slate-700">自动吸附对齐</div>
                                    <div className="text-xs text-slate-500">拖动元素时自动吸附到其他元素边缘</div>
                                </div>
                                <Switch
                                    checked={snapAlignmentEnabled}
                                    onCheckedChange={toggleSnapAlignment}
                                    className="h-5 w-9"
                                />
                            </div>

                            <div>
                                <div className="text-sm font-medium text-slate-700">网格样式</div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {[
                                        { value: GridStyle.LINES, label: '网格' },
                                        { value: GridStyle.SOLID, label: '纯色' }
                                    ].map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setGridStyle(option.value)}
                                            className={cn(
                                                "rounded-full border px-3 py-1.5 text-xs transition-all",
                                                gridStyle === option.value
                                                    ? "border-gray-800 bg-gray-800 text-white shadow-sm"
                                                    : "border-slate-200 bg-white text-slate-600 hover:border-gray-800/30 hover:text-gray-900"
                                            )}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="flex flex-col gap-1 text-xs text-slate-500">
                                    <span className="text-xs font-medium text-slate-600">网格间距(px)</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={200}
                                        value={gridSizeInput}
                                        onChange={(e) => setGridSizeInput(e.target.value)}
                                        onBlur={commitGridSize}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') commitGridSize();
                                            if (e.key === 'Escape') setGridSizeInput(String(gridSize));
                                            e.stopPropagation();
                                        }}
                                        className="w-full px-3 py-2 text-sm border rounded-lg border-slate-200 focus:border-blue-500 focus:outline-none"
                                    />
                                </label>
                            </div>
                        </div>

                        {/* 缩放灵敏度设置 */}
                        <div className="p-5 space-y-4 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div>
                                <div className="text-sm font-medium text-slate-700">滚轮缩放灵敏度</div>
                                <div className="text-xs text-slate-500">调整鼠标滚轮/触控板缩放的响应速度，值越小越平滑</div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="w-8 text-xs text-slate-500">慢</span>
                                <input
                                    type="range"
                                    min={1}
                                    max={10}
                                    step={1}
                                    value={zoomSensitivity}
                                    onChange={(e) => setZoomSensitivity(Number(e.target.value))}
                                    className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-slate-200 accent-blue-500"
                                />
                                <span className="w-8 text-xs text-slate-500">快</span>
                                <span className="w-6 text-sm font-medium text-center text-slate-700">{zoomSensitivity}</span>
                            </div>
                        </div>

                        <div className="p-5 space-y-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div>
                                <div className="text-sm font-medium text-slate-700">颜色</div>
                                <div className="text-xs text-slate-500">调整网格线与画布底色</div>
                            </div>
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-3 p-3 border rounded-xl border-slate-100 bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="text-xs font-medium text-slate-600">网格颜色</div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={gridColor}
                                            onChange={(e) => setGridColor(e.target.value)}
                                            className="border rounded-lg h-9 w-9 border-slate-200"
                                        />
                                        <span className="text-xs text-slate-500">{gridColor}</span>
                                    </div>
                                </div>
                                {/* 画布底色功能暂时隐藏 */}
                                {/* <div className="flex flex-col gap-3 p-3 border rounded-xl border-slate-100 bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="text-xs font-medium text-slate-600">画布底色</div>
                                        <div className="text-xs text-slate-500">启用后可自定义背景颜色</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={gridBgColor}
                                            onChange={(e) => setGridBgColor(e.target.value)}
                                            className="border rounded-lg h-9 w-9 border-slate-200"
                                            disabled={!gridBgEnabled}
                                        />
                                        <Switch
                                            checked={gridBgEnabled}
                                            onCheckedChange={setGridBgEnabled}
                                            className="h-5 w-9"
                                        />
                                    </div>
                                </div> */}
                            </div>
                        </div>

                        <div className="p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div>
                                <div className="text-sm font-medium text-slate-700">AI 对话框样式</div>
                                <div className="text-xs text-slate-500">展开或最大化时的背景样式</div>
                            </div>
                            <div className="flex items-center gap-2 mt-4">
                                <button
                                    type="button"
                                    onClick={() => setExpandedPanelStyle('transparent')}
                                    className={cn(
                                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                                        expandedPanelStyle === 'transparent'
                                            ? "bg-slate-900 text-white"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    )}
                                >
                                    透明
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExpandedPanelStyle('solid')}
                                    className={cn(
                                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                                        expandedPanelStyle === 'solid'
                                            ? "bg-slate-900 text-white"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    )}
                                >
                                    纯色
                                </button>
                            </div>
                        </div>
                    </div>
                );
            case 'ai':
                return (
                    <div className="pb-6 space-y-6">
                        <div className="flex flex-col gap-4 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-medium text-slate-700">仅图像模式</div>
                                <div className="text-xs text-slate-500">禁用文字结果，仅输出图像</div>
                            </div>
                            <Switch
                                checked={imageOnly}
                                onCheckedChange={setImageOnly}
                                className="h-5 w-9"
                            />
                        </div>

                        <div className="p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div className="flex items-start gap-2 mb-3">
                                <Send className="w-4 h-4 text-blue-600" />
                                <div>
                                    <div className="text-sm font-medium text-slate-700">发送快捷键</div>
                                    <div className="text-xs text-slate-500">选择聊天输入框的发送习惯。</div>
                                </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {sendShortcutOptions.map((option) => {
                                    const active = sendShortcut === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setSendShortcut(option.value)}
                                            className={cn(
                                                "w-full rounded-xl border px-3 py-3 text-left transition-all",
                                                active
                                                    ? "border-blue-500 bg-blue-50 shadow-sm"
                                                    : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-sm font-medium text-slate-700">{option.label}</div>
                                                {active && <Check className="w-4 h-4 text-blue-600" />}
                                            </div>
                                            <div className="mt-1 text-xs text-slate-500">{option.description}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div className="mb-4 text-sm font-medium text-slate-700">AI 提供商</div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {/* 暂时隐藏基础官方版 */}
                                {/* <button
                                    onClick={() => setAIProvider('gemini')}
                                    className={cn(
                                        "relative rounded-xl border-2 p-4 text-left transition-all",
                                        aiProvider === 'gemini'
                                            ? "border-gray-800 bg-gray-800/5"
                                            : "border-slate-200 bg-white hover:border-gray-800/30 hover:bg-gray-800/10"
                                    )}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Cloud className="w-4 h-4 text-blue-600" />
                                                <span className="text-sm font-medium text-slate-700">基础官方版</span>
                                            </div>
                                            <div className="text-xs text-slate-500">Gemini2.5 + Banana 1.0</div>
                                        </div>
                                        {aiProvider === 'gemini' && (
                                            <Check className="flex-shrink-0 w-5 h-5 text-blue-600" />
                                        )}
                                    </div>
                                </button> */}

                                <button
                                    onClick={() => setAIProvider('gemini-pro')}
                                    className={cn(
                                        "relative rounded-xl border-2 p-4 text-left transition-all",
                                        aiProvider === 'gemini-pro'
                                            ? "border-green-500 bg-green-50"
                                            : "border-slate-200 bg-white hover:border-green-300 hover:bg-green-50/30"
                                    )}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Sparkles className="w-4 h-4 text-green-600" />
                                                <span className="text-sm font-medium text-slate-700">国际版</span>
                                            </div>
                                            <div className="text-xs text-slate-500">可使用个人KEY不消耗积分</div>
                                        </div>
                                        {aiProvider === 'gemini-pro' && (
                                            <Check className="flex-shrink-0 w-5 h-5 text-green-600" />
                                        )}
                                    </div>
                                </button>

                                <button
                                    onClick={() => setAIProvider('banana')}
                                    className={cn(
                                        "relative rounded-xl border-2 p-4 text-left transition-all",
                                        aiProvider === 'banana'
                                            ? "border-amber-500 bg-amber-50"
                                            : "border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/30"
                                    )}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Zap className="w-4 h-4 text-amber-600" />
                                                <span className="text-sm font-medium text-slate-700">国内Pro版</span>
                                            </div>
                                            <div className="text-xs text-slate-500">2代模型 品质最佳 建议避开高峰时段使用</div>
                                        </div>
                                        {aiProvider === 'banana' && (
                                            <Check className="flex-shrink-0 w-5 h-5 text-amber-600" />
                                        )}
                                    </div>
                                </button>

                                <button
                                    onClick={() => setAIProvider('banana-2.5')}
                                    className={cn(
                                        "relative rounded-xl border-2 p-4 text-left transition-all",
                                        aiProvider === 'banana-2.5'
                                            ? "border-orange-500 bg-orange-50"
                                            : "border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/30"
                                    )}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Zap className="w-4 h-4 text-orange-600" />
                                                <span className="text-sm font-medium text-slate-700">国内极速版</span>
                                            </div>
                                            <div className="text-xs text-slate-500">1代模型 高速稳定</div>
                                        </div>
                                        {aiProvider === 'banana-2.5' && (
                                            <Check className="flex-shrink-0 w-5 h-5 text-orange-600" />
                                        )}
                                    </div>
                                </button>

                            </div>
                        </div>

                        {/* Google API Key 设置 */}
                        <div className="p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur">
                            <div className="flex items-center gap-2 mb-4">
                                <Key className="w-4 h-4 text-green-600" />
                                <div className="text-sm font-medium text-slate-700">Google Gemini API Key</div>
                            </div>
                            <div className="mb-4 text-xs text-slate-500">
                                在「国际版」下输入自己的 Google API Key 进行生图，不消耗积分。不输入则使用系统默认 Key（消耗积分）。
                            </div>

                            {/* 当前状态显示 */}
                            <div className="p-3 mb-4 border rounded-xl bg-slate-50 border-slate-100">
                                <div className="flex items-center justify-between">
                                    <div className="text-xs text-slate-600">
                                        当前模式：
                                        <span className={cn(
                                            "ml-1 font-medium",
                                            googleApiKeyInfo.mode === 'custom' ? "text-green-600" : "text-blue-600"
                                        )}>
                                            {googleApiKeyInfo.mode === 'custom' ? '使用自定义 Key' : '使用系统默认 Key'}
                                        </span>
                                    </div>
                                    {googleApiKeyInfo.hasCustomKey && googleApiKeyInfo.maskedKey && (
                                        <div className="font-mono text-xs text-slate-500">
                                            {googleApiKeyInfo.maskedKey}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 输入框 */}
                            <div className="flex flex-col gap-3">
                                <div className="relative">
                                    <input
                                        type={showGoogleApiKey ? 'text' : 'password'}
                                        value={googleApiKeyInput}
                                        onChange={(e) => setGoogleApiKeyInput(e.target.value)}
                                        placeholder={googleApiKeyInfo.hasCustomKey ? '输入新的 Key 以更新...' : '输入 Google Gemini API Key...'}
                                        className="w-full px-3 py-2 pr-10 font-mono text-sm border rounded-lg border-slate-200 focus:border-green-500 focus:outline-none"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && googleApiKeyInput.trim()) {
                                                handleSaveGoogleApiKey();
                                            }
                                            e.stopPropagation();
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                                        className="absolute p-1 -translate-y-1/2 right-2 top-1/2 text-slate-400 hover:text-slate-600"
                                        title={showGoogleApiKey ? '隐藏' : '显示'}
                                    >
                                        {showGoogleApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>

                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                            "flex-1 rounded-xl text-sm border-green-200 text-green-600 hover:bg-green-50",
                                            googleApiKeySaving && "opacity-70"
                                        )}
                                        disabled={googleApiKeySaving || !googleApiKeyInput.trim()}
                                        onClick={handleSaveGoogleApiKey}
                                    >
                                        {googleApiKeySaving ? '保存中...' : '保存 Key'}
                                    </Button>
                                    {googleApiKeyInfo.hasCustomKey && (
                                        <Button
                                            variant="outline"
                                            size="sm"
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
                                {googleApiKeyFeedback === 'success' && (
                                    <div className="text-xs text-green-600">已保存</div>
                                )}
                                {googleApiKeyFeedback === 'error' && (
                                    <div className="text-xs text-red-600">保存失败，请重试</div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            case 'advanced':
                return (
                    <div className="pb-6 space-y-6">
                        {import.meta.env.DEV && (
                            <div className="flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-sm font-medium text-slate-700">内存监控</div>
                                    <div className="text-xs text-slate-500">仅开发模式可用的调试工具</div>
                                </div>
                                <Button
                                    variant="outline"
                                    className="text-sm rounded-xl"
                                    onClick={() => setShowMemoryDebug(!showMemoryDebug)}
                                >
                                    <Activity className="w-4 h-4 mr-2" />
                                    {showMemoryDebug ? '关闭面板' : '打开面板'}
                                </Button>
                            </div>
                        )}
                        {import.meta.env.DEV && (
                            <div className="flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-sm font-medium text-slate-700">历史记录调试</div>
                                    <div className="text-xs text-slate-500">查看撤销/重做栈内容与快照详情</div>
                                </div>
                                <Button
                                    variant="outline"
                                    className="text-sm rounded-xl"
                                    onClick={() => setShowHistoryDebug(!showHistoryDebug)}
                                >
                                    <History className="w-4 h-4 mr-2" />
                                    {showHistoryDebug ? '关闭面板' : '打开面板'}
                                </Button>
                            </div>
                        )}
                        <div className="flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-medium text-slate-700">Paper.js 沙盒</div>
                                <div className="text-xs text-slate-500">打开 Paper.js 代码调试工作台</div>
                            </div>
                            <Button
                                variant="outline"
                                className="text-sm text-gray-900 rounded-xl border-gray-800/20 hover:bg-gray-800/10"
                                onClick={() => {
                                    const { toggleSandboxPanel } = useUIStore.getState();
                                    toggleSandboxPanel();
                                    setIsSettingsOpen(false);
                                }}
                            >
                                <Code className="w-4 h-4 mr-2" />
                                打开沙盒
                            </Button>
                        </div>
                        <div className="flex flex-col gap-3 p-5 border shadow-sm rounded-2xl border-slate-200 bg-white/90 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-medium text-slate-700">退出登录</div>
                                <div className="text-xs text-slate-500">注销当前账号并返回登录页</div>
                            </div>
                            <Button
                                variant="outline"
                                className={cn(
                                    "rounded-xl text-sm border-red-200 text-red-600 hover:bg-red-50",
                                    loading ? "opacity-70" : ""
                                )}
                                disabled={loading}
                                onClick={handleLogout}
                            >
                                <LogOut className="w-4 h-4 mr-2" />
                                {loading ? '正在退出…' : '退出登录'}
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
            <div className="flex items-center gap-2 md:gap-3 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 pointer-events-auto">
                {/* Logo */}
                <div
                    className="flex w-[110px] h-auto items-center pb-1 justify-center cursor-pointer hover:opacity-80 transition-opacity select-none"
                    onClick={handleLogoClick}
                    title="返回首页"
                >
                    <img
                        src="/LogoText.svg"
                        alt="Logo"
                        draggable="false"
                        style={{ imageRendering: 'auto', WebkitFontSmoothing: 'antialiased' }}
                    />
                </div>
                {/* 分隔线 */}
                <div className="w-px h-5 bg-gray-300/40" />

                {/* 项目名称与快速切换 */}
                <div className="items-center hidden gap-1 sm:flex">
                    {editingTitle ? (
                        <input
                            autoFocus
                            className="h-6 text-sm px-2 rounded border border-slate-300 bg-white/90 min-w-[200px] max-w-[380px]"
                            value={titleInput}
                            onChange={(e) => setTitleInput(e.target.value)}
                            onBlur={commitTitle}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') commitTitle();
                                if (e.key === 'Escape') setEditingTitle(false);
                                e.stopPropagation();
                            }}
                        />
                    ) : (
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                className="flex items-center gap-1 px-2 py-1 transition-colors bg-transparent border-none rounded-full cursor-pointer select-none hover:bg-slate-100"
                                onDoubleClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setEditingTitle(true);
                                }}
                            >
                                <ChevronDown className="w-4 h-4 text-slate-500" />
                                <span
                                    className="truncate text-sm text-gray-800 max-w-[260px]"
                                    title="双击重命名"
                                >
                                    {currentProject?.name || '未命名'}
                                </span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                sideOffset={12}
                                className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-lg overflow-hidden"
                            >
                                <DropdownMenuLabel className="px-2 pb-1 text-[11px] font-medium text-slate-400">
                                    切换项目
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator className="mb-1" />
                                <div className="max-h-[340px] overflow-y-auto space-y-0.5">
                                {recentProjects.length === 0 ? (
                                    <DropdownMenuItem disabled className="cursor-default text-slate-400">
                                        暂无项目
                                    </DropdownMenuItem>
                                ) : (
                                        recentProjects.map((project) => (
                                            <DropdownMenuItem
                                                key={project.id}
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    handleQuickSwitch(project.id);
                                                }}
                                                className="flex items-center justify-between gap-3 px-2 py-1 text-sm"
                                            >
                                                <span className="truncate text-slate-700">
                                                    {project.name || '未命名'}
                                                </span>
                                                {project.id === currentProject?.id && (
                                                    <Check className="w-4 h-4 text-blue-600" />
                                                )}
                                            </DropdownMenuItem>
                                        ))
                                    )}
                                </div>
                                <DropdownMenuSeparator className="my-1" />
                                <DropdownMenuItem
                                    onClick={(event) => {
                                        event.preventDefault();
                                        openModal();
                                    }}
                                    className="flex items-center gap-2 px-2 py-1 text-sm text-blue-600 hover:text-blue-700"
                                >
                                    <FolderOpen className="w-4 h-4" />
                                    打开/管理文件
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={async (event) => {
                                        event.preventDefault();
                                        await create();
                                    }}
                                    className="flex items-center justify-between gap-3 px-2 py-1 text-sm text-blue-600 hover:text-blue-700"
                                >
                                    <span className="flex items-center gap-2">
                                        <span className="inline-flex items-center justify-center w-4 h-4 text-xs border border-current rounded-full">+</span>
                                        新建项目
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>

            {/* 空白拉伸 */}
            <div className="flex-1" />

            {/* 右侧栏：功能按钮 + 保存状态 */}
            <div className="flex flex-col items-center gap-1 pointer-events-auto">
                <div className="flex items-center gap-1.5 md:gap-2 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300">
                    {/* 素材库按钮 */}
                    {showLibraryButton && (
                        <Button
                            onClick={toggleLibraryPanel}
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-7 text-xs flex items-center rounded-full transition-all duration-200",
                                "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light text-gray-600",
                                "hover:bg-gray-900 hover:text-white hover:border-gray-900",
                                showLibraryPanel ? "text-gray-900" : "",
                            "w-8 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1"
                            )}
                            title={showLibraryButton ? "关闭素材库" : "打开素材库"}
                        >
                            <Library className="w-3 h-3" />
                            <span className="hidden sm:inline">素材库</span>
                        </Button>
                    )}

                    {/* 帮助按钮 */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover"
                        title="帮助"
                        onClick={() => window.open('https://gcnyatv1ofs3.feishu.cn/docx/U5Jzd18dLoCtvlxhHdDcoRgVnWd', '_blank')}
                    >
                        <HelpCircle className="w-4 h-4" />
                    </Button>

                    {/* 设置按钮 */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7 bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover"
                        title="设置"
                        onClick={() => {
                            setActiveSettingsSection('workspace');
                            setIsSettingsOpen(true);
                        }}
                    >
                        <Menu className="w-4 h-4" />
                    </Button>
                </div>
                <div className="pr-1 text-[11px] leading-none w-full text-center h-4 flex items-center justify-center select-none pointer-events-none">
                    <span className="pointer-events-none">
                        <AutosaveStatus />
                    </span>
                </div>
            </div>

            {isSettingsOpen && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-transparent px-4"
                    onClick={() => setIsSettingsOpen(false)}
                >
                    <div
                        className="relative flex h-[90vh] max-h-[700px] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_32px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex flex-1 h-full pt-4 overflow-hidden sm:pt-0">
                            <aside className="hidden w-56 h-full py-6 pr-2 border-r shrink-0 border-slate-200/80 bg-white/95 sm:flex sm:flex-col">
                                {SETTINGS_SECTIONS.map((section) => {
                                    const Icon = section.icon;
                                    const isActive = activeSettingsSection === section.id;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => setActiveSettingsSection(section.id)}
                                            className={cn(
                                                "mx-3 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                                                isActive
                                                    ? "bg-white text-blue-600 shadow-sm"
                                                    : "text-slate-600 hover:bg-white/70"
                                            )}
                                        >
                                            <Icon className="w-4 h-4" />
                                            <span className="truncate">{section.label}</span>
                                        </button>
                                    );
                                })}
                            </aside>
                            <div className="flex-1 px-4 py-6 overflow-y-auto sm:px-6">
                                <div className="flex flex-wrap gap-2 mb-4 sm:hidden">
                                    {SETTINGS_SECTIONS.map((section) => {
                                        const Icon = section.icon;
                                        const isActive = activeSettingsSection === section.id;
                                        return (
                                            <button
                                                key={section.id}
                                                type="button"
                                                onClick={() => setActiveSettingsSection(section.id)}
                                                className={cn(
                                                    "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors",
                                                    isActive
                                                        ? "border-gray-800 bg-gray-800 text-white shadow-sm"
                                                        : "border-slate-200 bg-white/90 text-slate-600"
                                                )}
                                            >
                                                <Icon className="w-3 h-3" />
                                                <span>{section.label}</span>
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
