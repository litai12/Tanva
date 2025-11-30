import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    Ruler,
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
    EyeOff
} from 'lucide-react';
import MemoryDebugPanel from '@/components/debug/MemoryDebugPanel';
import { useProjectStore } from '@/stores/projectStore';
import ProjectManagerModal from '@/components/projects/ProjectManagerModal';
import { useUIStore, useCanvasStore, GridStyle } from '@/stores';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import ManualSaveButton from '@/components/autosave/ManualSaveButton';
import AutosaveStatus from '@/components/autosave/AutosaveStatus';
import { paperSaveService } from '@/services/paperSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { authApi, type GoogleApiKeyInfo } from '@/services/authApi';
import { getMyCredits, type UserCreditsInfo } from '@/services/adminApi';

const SETTINGS_SECTIONS = [
    { id: 'workspace', label: '工作区', icon: Square },
    { id: 'appearance', label: '视图外观', icon: Grid3x3 },
    { id: 'ai', label: 'AI 设置', icon: Sparkles },
    { id: 'smart', label: '智能落位', icon: Ruler },
    { id: 'advanced', label: '高级', icon: Activity },
] as const;

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id'];

const VIEW_APPEARANCE_STORAGE_KEY = 'tanva-view-settings';

const FloatingHeader: React.FC = () => {
    const navigate = useNavigate();
    const {
        showLibraryPanel,
        showGrid,
        showLayerPanel,
        smartPlacementOffset,
        setSmartPlacementOffset,
        toggleLibraryPanel,
        toggleGrid,
        setShowGrid,
        focusMode,
    } = useUIStore();

    const {
        gridStyle,
        gridSize,
        gridDotSize,
        gridColor,
        gridBgColor,
        gridBgEnabled,
        setGridStyle,
        setGridSize,
        setGridDotSize,
        setGridColor,
        setGridBgColor,
        setGridBgEnabled
    } = useCanvasStore();

    // AI 配置
    const { imageOnly, setImageOnly, aiProvider, setAIProvider } = useAIChatStore();

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
    const [gridSizeInput, setGridSizeInput] = useState(String(gridSize));
    const [gridDotSizeInput, setGridDotSizeInput] = useState(String(gridDotSize));
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
                gridDotSize: number;
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
            if (typeof saved.gridDotSize === 'number' && saved.gridDotSize >= 1 && saved.gridDotSize <= 4) {
                setGridDotSize(saved.gridDotSize);
                setGridDotSizeInput(String(saved.gridDotSize));
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
    }, [setShowGrid, setGridStyle, setGridSize, setGridDotSize, setGridColor, setGridBgColor, setGridBgEnabled, setGridSizeInput, setGridDotSizeInput]);

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
            gridDotSize,
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
    }, [showGrid, gridStyle, gridSize, gridDotSize, gridColor, gridBgColor, gridBgEnabled]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('workspace');
    
    // 监听网格大小变化
    useEffect(() => {
        setGridSizeInput(String(gridSize));
    }, [gridSize]);
    
    useEffect(() => {
        setGridDotSizeInput(String(gridDotSize));
    }, [gridDotSize]);

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
    
    const commitGridDotSize = () => {
        const n = parseInt(gridDotSizeInput, 10);
        if (!isNaN(n) && n >= 1 && n <= 4) setGridDotSize(n);
        else setGridDotSizeInput(String(gridDotSize));
    };

    const clearImageHistory = useImageHistoryStore((state) => state.clearHistory);
    const historyCount = useImageHistoryStore((state) => state.history.length);
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

    // 智能落位偏移：本地草稿，失焦或回车时提交
    const [offsetInput, setOffsetInput] = useState(String(smartPlacementOffset));
    useEffect(() => {
        setOffsetInput(String(smartPlacementOffset));
    }, [smartPlacementOffset]);

    const commitOffset = () => {
        const n = parseInt(offsetInput, 10);
        if (!isNaN(n)) {
            setSmartPlacementOffset(n);
        } else {
            setOffsetInput(String(smartPlacementOffset));
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
        setCreditsLoading(true);
        getMyCredits()
            .then(setCreditsInfo)
            .catch(console.warn)
            .finally(() => setCreditsLoading(false));
    }, [user]);

    const displayName = user?.name || user?.phone?.slice(-4) || user?.email || user?.id?.slice(-4) || '用户';
    const secondaryId = user?.email || (user?.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : '') || '';
    const status = (() => {
        switch (connection) {
            case 'server': return { label: '在线', color: '#16a34a' };
            case 'refresh': return { label: '已续期', color: '#f59e0b' };
            case 'local': return { label: '本地会话', color: '#6b7280' };
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

    const renderSettingsContent = () => {
        switch (activeSettingsSection) {
            case 'workspace':
                return (
                    <div className="space-y-6 pb-6">
                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
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
                                        <div className="mt-1 text-xs text-muted-foreground truncate">
                                            {secondaryId}
                                        </div>
                                    )}
                                </div>
                                <div className="shrink-0">
                                    <ManualSaveButton />
                                </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                                <span>自动保存</span>
                                <span className="text-slate-600">
                                    <AutosaveStatus />
                                </span>
                            </div>
                        </div>

                        {/* 积分信息卡片 */}
                        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-blue-600" />
                                    <span className="text-sm font-medium text-slate-700">我的积分</span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-100"
                                    onClick={() => {
                                        setIsSettingsOpen(false);
                                        navigate('/my-credits');
                                    }}
                                >
                                    详情
                                </Button>
                            </div>
                            {creditsLoading ? (
                                <div className="text-xs text-slate-500">加载中...</div>
                            ) : creditsInfo ? (
                                <div className="space-y-3">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-3xl font-bold text-blue-600">{creditsInfo.balance}</span>
                                        <span className="text-xs text-slate-500">可用积分</span>
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
                                className="h-10 rounded-xl text-sm"
                                onClick={() => {
                                    setIsSettingsOpen(false);
                                    openModal();
                                }}
                            >
                                <Square className="mr-2 h-4 w-4" />
                                打开/管理文件
                            </Button>
                            <Button
                                variant="outline"
                                className="h-10 rounded-xl text-sm"
                                onClick={() => navigate('/')}
                            >
                                <Home className="mr-2 h-4 w-4" />
                                返回首页
                            </Button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Button
                                variant="outline"
                                className="h-10 rounded-xl text-sm border-yellow-200 text-yellow-700 hover:bg-yellow-50"
                                onClick={() => handleClearImageHistory()}
                            >
                                <History className="mr-2 h-4 w-4" />
                                清空图片历史
                                <span className="ml-auto text-[11px] text-slate-500">({historyCount})</span>
                            </Button>
                            <Button
                                variant="outline"
                                className="h-10 rounded-xl text-sm border-red-200 text-red-600 hover:bg-red-50"
                                onClick={handleClearCanvas}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                清空画布内容
                            </Button>
                        </div>
                    </div>
                );
            case 'appearance':
                return (
                    <div className="space-y-6 pb-6">
                        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
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
                                className="h-9 rounded-xl text-sm border-blue-200 text-blue-600 hover:bg-blue-50"
                                onClick={handleSaveAppearanceSettings}
                            >
                                保存设置
                            </Button>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur space-y-5">
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

                            <div>
                                <div className="text-sm font-medium text-slate-700">网格样式</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {[
                                        { value: GridStyle.LINES, label: '线条' },
                                        { value: GridStyle.DOTS, label: '点阵' },
                                        { value: GridStyle.SOLID, label: '纯色' }
                                    ].map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setGridStyle(option.value)}
                                            className={cn(
                                                "rounded-full border px-3 py-1.5 text-xs transition-all",
                                                gridStyle === option.value
                                                    ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                                                    : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
                                            )}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
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
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    />
                                </label>
                                {gridStyle === GridStyle.DOTS && (
                                    <label className="flex flex-col gap-1 text-xs text-slate-500">
                                        <span className="text-xs font-medium text-slate-600">点阵尺寸(px)</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={4}
                                            value={gridDotSizeInput}
                                            onChange={(e) => setGridDotSizeInput(e.target.value)}
                                            onBlur={commitGridDotSize}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitGridDotSize();
                                                if (e.key === 'Escape') setGridDotSizeInput(String(gridDotSize));
                                                e.stopPropagation();
                                            }}
                                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                        />
                                    </label>
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur space-y-5">
                            <div>
                                <div className="text-sm font-medium text-slate-700">颜色</div>
                                <div className="text-xs text-slate-500">调整网格线与画布底色</div>
                            </div>
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="text-xs font-medium text-slate-600">网格颜色</div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={gridColor}
                                            onChange={(e) => setGridColor(e.target.value)}
                                            className="h-9 w-9 rounded-lg border border-slate-200"
                                        />
                                        <span className="text-xs text-slate-500">{gridColor}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="text-xs font-medium text-slate-600">画布底色</div>
                                        <div className="text-xs text-slate-500">启用后可自定义背景颜色</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={gridBgColor}
                                            onChange={(e) => setGridBgColor(e.target.value)}
                                            className="h-9 w-9 rounded-lg border border-slate-200"
                                            disabled={!gridBgEnabled}
                                        />
                                        <Switch
                                            checked={gridBgEnabled}
                                            onCheckedChange={setGridBgEnabled}
                                            className="h-5 w-9"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'ai':
                return (
                    <div className="space-y-6 pb-6">
                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
                            <div className="mb-4 text-sm font-medium text-slate-700">AI 提供商</div>
                            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                                {/* 暂时隐藏基础官方版 */}
                                {/* <button
                                    onClick={() => setAIProvider('gemini')}
                                    className={cn(
                                        "relative rounded-xl border-2 p-4 text-left transition-all",
                                        aiProvider === 'gemini'
                                            ? "border-blue-500 bg-blue-50"
                                            : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30"
                                    )}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Cloud className="h-4 w-4 text-blue-600" />
                                                <span className="font-medium text-sm text-slate-700">基础官方版</span>
                                            </div>
                                            <div className="text-xs text-slate-500">Gemini2.5 + Banana 1.0</div>
                                        </div>
                                        {aiProvider === 'gemini' && (
                                            <Check className="h-5 w-5 text-blue-600 flex-shrink-0" />
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
                                                <Sparkles className="h-4 w-4 text-green-600" />
                                                <span className="font-medium text-sm text-slate-700">国际版</span>
                                            </div>
                                            <div className="text-xs text-slate-500">Gemini 3.0 + Banana 2.0</div>
                                        </div>
                                        {aiProvider === 'gemini-pro' && (
                                            <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
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
                                                <Zap className="h-4 w-4 text-amber-600" />
                                                <span className="font-medium text-sm text-slate-700">国内版</span>
                                            </div>
                                            <div className="text-xs text-slate-500">Gemini 3.0 + Banana 2.0</div>
                                        </div>
                                        {aiProvider === 'banana' && (
                                            <Check className="h-5 w-5 text-amber-600 flex-shrink-0" />
                                        )}
                                    </div>
                                </button>

                            </div>
                        </div>

                        {/* Google API Key 设置 */}
                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
                            <div className="flex items-center gap-2 mb-4">
                                <Key className="h-4 w-4 text-green-600" />
                                <div className="text-sm font-medium text-slate-700">Google Gemini API Key</div>
                            </div>
                            <div className="text-xs text-slate-500 mb-4">
                                在「国际版」下输入自己的 Google API Key 进行生图，不消耗积分。不输入则使用系统默认 Key（消耗积分）。
                            </div>

                            {/* 当前状态显示 */}
                            <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
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
                                        <div className="text-xs text-slate-500 font-mono">
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
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm font-mono focus:border-green-500 focus:outline-none"
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
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                                        title={showGoogleApiKey ? '隐藏' : '显示'}
                                    >
                                        {showGoogleApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
            case 'smart':
                return (
                    <div className="space-y-6 pb-6">
                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
                            <div className="mb-2 text-sm font-medium text-slate-700">智能落位偏移</div>
                            <div className="text-xs text-slate-500 mb-4">
                                调整自动排布节点时的默认间距，单位为像素。
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <input
                                    type="number"
                                    min={16}
                                    max={4096}
                                    inputMode="numeric"
                                    value={offsetInput}
                                    onChange={(e) => setOffsetInput(e.target.value)}
                                    onBlur={commitOffset}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitOffset();
                                        if (e.key === 'Escape') setOffsetInput(String(smartPlacementOffset));
                                        e.stopPropagation();
                                    }}
                                    className="w-full sm:w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                />
                                <span className="text-xs text-slate-500">推荐 64 ~ 256</span>
                            </div>
                        </div>
                    </div>
                );
            case 'advanced':
                return (
                    <div className="space-y-6 pb-6">
                        {import.meta.env.DEV && (
                            <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-sm font-medium text-slate-700">内存监控</div>
                                    <div className="text-xs text-slate-500">仅开发模式可用的调试工具</div>
                                </div>
                                <Button
                                    variant="outline"
                                    className="rounded-xl text-sm"
                                    onClick={() => setShowMemoryDebug(!showMemoryDebug)}
                                >
                                    <Activity className="mr-2 h-4 w-4" />
                                    {showMemoryDebug ? '关闭面板' : '打开面板'}
                                </Button>
                            </div>
                        )}
                        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                                <LogOut className="mr-2 h-4 w-4" />
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
        <div
            aria-hidden={focusMode}
            className={cn(
                "fixed top-4 left-0 right-0 z-50 px-4 flex items-center justify-between gap-4 transition-all duration-[50ms] ease-out pointer-events-none",
                showLayerPanel ? "left-[306px]" : "left-0",
                focusMode && "hidden"
            )}
        >
            {/* 左侧栏：Logo + Beta + 项目名称 */}
            <div className="flex items-center gap-2 md:gap-3 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 pointer-events-auto">
                {/* Logo */}
                <div
                    className="flex items-center justify-center w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity select-none"
                    onClick={handleLogoClick}
                    title="返回首页"
                >
                    <img
                        src="/logo.png"
                        alt="Logo"
                        className="w-6 h-6 object-contain"
                        draggable="false"
                    />
                </div>

                {/* Beta Badge */}
                <Badge variant="secondary" className="text-[8px] px-1 py-0">
                    Beta
                </Badge>

                {/* 分隔线 */}
                <div className="w-px h-5 bg-gray-300/40" />

                {/* 项目名称与快速切换 */}
                <div className="hidden sm:flex items-center gap-1">
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
                                className="flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:bg-slate-100 cursor-pointer select-none bg-transparent border-none"
                                onDoubleClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setEditingTitle(true);
                                }}
                            >
                                <ChevronDown className="h-4 w-4 text-slate-500" />
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
                                className="min-w-[220px] max-h-[400px] rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-lg"
                            >
                                <DropdownMenuLabel className="px-2 pb-1 text-[11px] font-medium text-slate-400">
                                    切换项目
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator className="mb-1" />
                                <div className="max-h-[340px] overflow-y-auto space-y-0.5">
                                    {projects.length === 0 ? (
                                        <DropdownMenuItem disabled className="cursor-default text-slate-400">
                                            暂无项目
                                        </DropdownMenuItem>
                                    ) : (
                                        projects.slice(0, 5).map((project) => (
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
                                                    <Check className="h-4 w-4 text-blue-600" />
                                                )}
                                            </DropdownMenuItem>
                                        ))
                                    )}
                                </div>
                                <DropdownMenuSeparator className="my-1" />
                                <DropdownMenuItem
                                    onClick={async (event) => {
                                        event.preventDefault();
                                        await create();
                                    }}
                                    className="px-2 py-1 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-2"
                                >
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current">+</span>
                                    新建项目
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>

            {/* 空白拉伸 */}
            <div className="flex-1" />

            {/* 右侧栏：功能按钮 */}
            <div className="flex items-center gap-1.5 md:gap-2 px-4 md:px-6 py-2 h-[46px] rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 pointer-events-auto">
                {/* 素材库按钮 */}
                {showLibraryButton && (
                    <Button
                        onClick={toggleLibraryPanel}
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "h-7 text-xs flex items-center rounded-full transition-all duration-200",
                            "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light text-gray-600",
                            "hover:bg-blue-500 hover:text-white hover:border-blue-500",
                            showLibraryPanel ? "text-blue-600" : "",
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
                    className="h-7 w-7 p-0 rounded-full transition-all duration-200 bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light hover:bg-liquid-glass-hover text-gray-600"
                    title="帮助"
                >
                    <HelpCircle className="w-4 h-4" />
                </Button>

                {/* 分享按钮 */}
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-7 text-xs flex items-center rounded-full transition-all duration-200 w-7 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1",
                        "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light text-gray-600",
                        "hover:bg-blue-500 hover:text-white hover:border-blue-500"
                    )}
                    onClick={handleShare}
                    title="分享"
                >
                    <Share className="w-3 h-3" />
                    <span className="hidden sm:inline">分享</span>
                </Button>

                {/* 设置按钮 */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 rounded-full transition-all duration-200 bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light hover:bg-liquid-glass-hover text-gray-600"
                    title="设置"
                    onClick={() => {
                        setActiveSettingsSection('workspace');
                        setIsSettingsOpen(true);
                    }}
                >
                    <Menu className="w-4 h-4" />
                </Button>
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
                        <button
                            type="button"
                            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                            onClick={() => setIsSettingsOpen(false)}
                            title="关闭设置 (Esc)"
                        >
                            <X className="h-4 w-4" />
                        </button>
                        <div className="flex h-full flex-1 overflow-hidden pt-4 sm:pt-0">
                            <aside className="hidden h-full w-56 shrink-0 border-r border-slate-200/80 bg-white/95 py-6 pr-2 sm:flex sm:flex-col">
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
                                            <Icon className="h-4 w-4" />
                                            <span className="truncate">{section.label}</span>
                                        </button>
                                    );
                                })}
                            </aside>
                            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                                <div className="mb-4 flex flex-wrap gap-2 sm:hidden">
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
                                                        ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                                                        : "border-slate-200 bg-white/90 text-slate-600"
                                                )}
                                            >
                                                <Icon className="h-3 w-3" />
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

            {/* 项目管理器（文件选择弹窗） */}
            <ProjectManagerModal />
        </div>
    );
};

export default FloatingHeader;
