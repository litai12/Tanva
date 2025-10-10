import React, { useState, useEffect } from 'react';
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
    Palette,
    Check,
    ChevronDown,
    ChevronRight,
    Home,
    Sparkles
} from 'lucide-react';
import MemoryDebugPanel from '@/components/debug/MemoryDebugPanel';
import { useProjectStore } from '@/stores/projectStore';
import ProjectManagerModal from '@/components/projects/ProjectManagerModal';
import { useUIStore, useCanvasStore, GridStyle } from '@/stores';
import { useAIChatStore } from '@/stores/aiChatStore';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import ManualSaveButton from '@/components/autosave/ManualSaveButton';
import AutosaveStatus from '@/components/autosave/AutosaveStatus';

const FloatingHeader: React.FC = () => {
    const navigate = useNavigate();
    const {
        showLibraryPanel,
        showGrid,
        smartPlacementOffset,
        setSmartPlacementOffset,
        toggleLibraryPanel,
        toggleGrid,
        setShowGrid,
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
    const { imageOnly, setImageOnly } = useAIChatStore();

    // 项目（文件）管理
    const { currentProject, openModal, create, rename, optimisticRenameLocal, projects, open } = useProjectStore();
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
    const [showGridOptions, setShowGridOptions] = useState(false);
    const [gridSizeInput, setGridSizeInput] = useState(String(gridSize));
    const [gridDotSizeInput, setGridDotSizeInput] = useState(String(gridDotSize));
    
    // 监听网格大小变化
    useEffect(() => {
        setGridSizeInput(String(gridSize));
    }, [gridSize]);
    
    useEffect(() => {
        setGridDotSizeInput(String(gridDotSize));
    }, [gridDotSize]);
    
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

    return (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
            <div className="grid grid-cols-3 items-center gap-2 md:gap-3 px-4 md:px-6 py-2 rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300 min-w-[640px]">
                
                {/* 左侧区域：Logo + Beta */}
                <div className="flex items-center gap-2 justify-self-start">
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
                    <Badge variant="secondary" className="text-[8px] px-1 py-0">
                        Beta
                    </Badge>
                </div>

                {/* 中间区域：文件名与快速切换 */}
                <div className="hidden sm:flex items-center gap-2 justify-self-center">
                    {editingTitle ? (
                        <input
                            autoFocus
                            className="h-7 text-sm px-2 rounded border border-slate-300 bg-white/90 min-w-[240px] max-w-[440px]"
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
                            <DropdownMenuTrigger asChild>
                                <div
                                    className="flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:bg-slate-100 cursor-pointer select-none"
                                    role="button"
                                    tabIndex={0}
                                >
                                    <ChevronDown className="h-4 w-4 text-slate-500" />
                                    <span
                                        className="truncate text-sm text-gray-800 max-w-[300px]"
                                        title="双击重命名"
                                        onDoubleClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setEditingTitle(true);
                                        }}
                                    >
                                        {currentProject?.name || '未命名'}
                                    </span>
                                </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="center"
                                sideOffset={6}
                                className="min-w-[220px] max-h-[200px] rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-lg"
                            >
                                <DropdownMenuLabel className="px-2 pb-1 text-[11px] font-medium text-slate-400">
                                    切换项目
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator className="mb-1" />
                                <div className="max-h-[152px] overflow-y-auto space-y-0.5">
                                    {projects.length === 0 ? (
                                        <DropdownMenuItem disabled className="cursor-default text-slate-400">
                                            暂无项目
                                        </DropdownMenuItem>
                                    ) : (
                                        projects.slice(0, 5).map((project) => (
                                            <DropdownMenuItem
                                                key={project.id}
                                                onSelect={(event) => {
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
                                    onSelect={async (event) => {
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

                {/* 右侧区域：次要功能 */}
                <div className="flex items-center gap-1.5 justify-self-end">
                    {/* 素材库按钮 */}
                    <Button
                        onClick={toggleLibraryPanel}
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "h-8 text-xs flex items-center rounded-full transition-all duration-200",
                            "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light text-gray-600",
                            "hover:bg-blue-500 hover:text-white hover:border-blue-500",
                            showLibraryPanel ? "text-blue-600" : "",
                            "w-8 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1" // 响应式宽度和padding，与分享按钮一致
                        )}
                        title={showLibraryPanel ? "关闭素材库" : "打开素材库"}
                    >
                        <Library className="w-3 h-3" />
                        <span className="hidden sm:inline">素材库</span>
                    </Button>

                    {/* 帮助按钮 */}
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="hidden md:flex h-8 w-8 p-0 rounded-full transition-all duration-200 bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light hover:bg-liquid-glass-hover text-gray-600"
                        title="帮助"
                    >
                        <HelpCircle className="w-4 h-4" />
                    </Button>

                    {/* 分享按钮 */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "h-8 text-xs flex items-center rounded-full transition-all duration-200 w-8 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1",
                            "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light text-gray-600",
                            "hover:bg-blue-500 hover:text-white hover:border-blue-500"
                        )}
                        onClick={handleShare}
                        title="分享"
                    >
                        <Share className="w-3 h-3" />
                        <span className="hidden sm:inline">分享</span>
                    </Button>

                    {/* 设置下拉菜单 */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 w-8 p-0 rounded-full transition-all duration-200 bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light hover:bg-liquid-glass-hover text-gray-600"
                                title="设置菜单"
                            >
                                <Menu className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent 
                            className="w-64 min-h-[400px] bg-white/80 backdrop-blur-md" 
                            align="end" 
                            side="right"
                            sideOffset={8}
                            forceMount
                        >
                            <div className="px-3 pt-3 pb-2 space-y-3">
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
                                            <div className="mt-1 text-xs text-muted-foreground truncate">{secondaryId}</div>
                                        )}
                                    </div>
                                    <div className="shrink-0">
                                        <ManualSaveButton />
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>自动保存</span>
                                    <span className="text-slate-600"><AutosaveStatus /></span>
                                </div>
                            </div>
                            <DropdownMenuSeparator />

                            {/* 文件管理 */}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                文件
                            </DropdownMenuLabel>
                            <DropdownMenuItem className="text-xs cursor-pointer" onClick={openModal}>
                                <Square className="mr-2 h-3 w-3" />
                                <span>打开/管理文件</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={() => navigate('/')}
                            >
                                <Home className="mr-2 h-3 w-3" />
                                <span>返回首页</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />

                            {/* 视图控制 */}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                视图控制
                            </DropdownMenuLabel>

                            {/* 背景开关 */}
                            <div className="px-3 py-1.5 flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Square className="h-3 w-3 text-gray-500" />
                                    <span className="text-xs">背景</span>
                                </div>
                                <Switch
                                    checked={showGrid}
                                    onCheckedChange={toggleGrid}
                                    className="h-4 w-7"
                                />
                            </div>

                            {/* 网格样式选择 */}
                            <DropdownMenuItem
                                className="text-xs cursor-pointer px-3"
                                onClick={() => setShowGridOptions(!showGridOptions)}
                                onSelect={(e) => e.preventDefault()}
                            >
                                <Grid3x3 className="mr-2 h-3 w-3" />
                                <span className="flex-1">网格线</span>
                                <span className="text-[10px] text-gray-500 mr-1">
                                    {gridStyle === GridStyle.LINES ? '线条' : 
                                     gridStyle === GridStyle.DOTS ? '点阵' : '纯色'}
                                </span>
                                <ChevronRight className="h-3 w-3" />
                            </DropdownMenuItem>

                            {/* 网格样式选项 */}
                            {showGridOptions && (
                                <>
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer ml-6"
                                        onClick={() => {
                                            setGridStyle(GridStyle.LINES);
                                            setShowGridOptions(false);
                                        }}
                                    >
                                        {gridStyle === GridStyle.LINES && <Check className="mr-2 h-3 w-3" />}
                                        <span className="ml-5">线条</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer ml-6"
                                        onClick={() => {
                                            setGridStyle(GridStyle.DOTS);
                                            setShowGridOptions(false);
                                        }}
                                    >
                                        {gridStyle === GridStyle.DOTS && <Check className="mr-2 h-3 w-3" />}
                                        <span className="ml-5">点阵</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer ml-6"
                                        onClick={() => {
                                            setGridStyle(GridStyle.SOLID);
                                            setShowGridOptions(false);
                                        }}
                                    >
                                        {gridStyle === GridStyle.SOLID && <Check className="mr-2 h-3 w-3" />}
                                        <span className="ml-5">纯色</span>
                                    </DropdownMenuItem>
                                </>
                            )}

                            {/* 网格颜色 */}
                            <div className="px-3 py-1.5 flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Palette className="h-3 w-3 text-gray-500" />
                                    <span className="text-xs">颜色</span>
                                </div>
                                <input
                                    type="color"
                                    value={gridColor}
                                    onChange={(e) => setGridColor(e.target.value)}
                                    className="w-8 h-5 rounded border border-gray-300 cursor-pointer"
                                />
                            </div>

                            {/* 网格间距 */}
                            <div className="px-3 py-1.5 flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Ruler className="h-3 w-3 text-gray-500" />
                                    <span className="text-xs">间距</span>
                                </div>
                                <input
                                    type="number"
                                    min={10}
                                    max={200}
                                    value={gridSizeInput}
                                    onChange={(e) => setGridSizeInput(e.target.value)}
                                    onBlur={commitGridSize}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitGridSize();
                                        if (e.key === 'Escape') setGridSizeInput(String(gridSize));
                                        e.stopPropagation();
                                    }}
                                    className="w-16 text-xs px-2 py-0.5 rounded border border-gray-300 bg-white"
                                />
                            </div>

                            {/* 点阵大小（仅在点阵模式下显示） */}
                            {gridStyle === GridStyle.DOTS && (
                                <div className="px-3 py-1.5 flex items-center justify-between">
                                    <span className="text-xs">尺寸</span>
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
                                        className="w-16 text-xs px-2 py-0.5 rounded border border-gray-300 bg-white"
                                    />
                                </div>
                            )}

                            {/* 底色开关 */}
                            <div className="px-3 py-1.5 flex items-center justify-between">
                                <span className="text-xs">底色</span>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="color"
                                        value={gridBgColor}
                                        onChange={(e) => setGridBgColor(e.target.value)}
                                        className="w-8 h-5 rounded border border-gray-300 cursor-pointer"
                                        disabled={!gridBgEnabled}
                                    />
                                    <Switch
                                        checked={gridBgEnabled}
                                        onCheckedChange={setGridBgEnabled}
                                        className="h-4 w-7"
                                    />
                                </div>
                            </div>

                            <DropdownMenuSeparator />

                            {/* AI 图像生成设置 */}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                AI 图像生成
                            </DropdownMenuLabel>

                            {/* 仅图像模式开关 */}
                            <div className="px-3 py-1.5 flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Sparkles className="h-3 w-3 text-gray-500" />
                                    <span className="text-xs">仅图像（无文字）</span>
                                </div>
                                <Switch
                                    checked={imageOnly}
                                    onCheckedChange={setImageOnly}
                                    className="h-4 w-7"
                                />
                            </div>

                            <DropdownMenuSeparator />

                            {/* 已移除：视图设置（坐标轴/回到原点/比例尺）、单位和比例尺信息 */}
                            {/* 智能落位偏移 */}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                智能落位
                            </DropdownMenuLabel>
                            <div className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-600">偏移(px)</span>
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
                                        className="w-20 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                    />
                                </div>
                            </div>

                            {/* 开发模式下显示内存调试选项 */}
                            {import.meta.env.DEV && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer"
                                        onClick={() => setShowMemoryDebug(!showMemoryDebug)}
                                    >
                                        <Activity className="mr-2 h-3 w-3" />
                                        <span>{showMemoryDebug ? '关闭内存监控' : '内存监控'}</span>
                                    </DropdownMenuItem>
                                </>
                            )}
                            
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="text-xs cursor-pointer text-red-500 focus:text-red-500"
                                disabled={loading}
                                onClick={async () => {
                                    if (loading) return;
                                    try {
                                        console.log('🔴 开始退出登录...');
                                        await logout();
                                        console.log('✅ 登出成功，准备跳转...');
                                        navigate('/auth/login', { replace: true });
                                    } catch (err) {
                                        console.error('❌ 退出登录失败:', err);
                                    }
                                }}
                            >
                                <LogOut className="mr-2 h-3 w-3" />
                                <span>{loading ? '正在退出…' : '退出登录'}</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            
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
    const handleQuickSwitch = (projectId: string) => {
        if (!projectId || projectId === currentProject?.id) return;
        open(projectId);
    };
