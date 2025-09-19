import React, { useState, useEffect } from 'react';
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
    Settings, 
    User, 
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
    ChevronRight,
    ToggleRight
} from 'lucide-react';
import MemoryDebugPanel from '@/components/debug/MemoryDebugPanel';
import { useUIStore, useCanvasStore, GridStyle } from '@/stores';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

const FloatingHeader: React.FC = () => {
    const {
        showLibraryPanel,
        showGrid,
        smartPlacementOffset,
        setSmartPlacementOffset,
        toggleLibraryPanel,
        toggleGrid,
        setShowGrid,
        mode,
        toggleMode,
        setMode
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
        logger.debug('Logo clicked');
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

    return (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
            <div className="flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3.5 py-2 rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300">
                
                {/* 左侧区域：Logo + Beta */}
                <div className="flex items-center gap-2">
                    <div
                        className="flex items-center justify-center w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={handleLogoClick}
                        title="返回首页"
                    >
                        <img
                            src="/logo.png"
                            alt="Logo"
                            className="w-6 h-6 object-contain"
                        />
                    </div>
                    <Badge variant="secondary" className="text-[8px] px-1 py-0">
                        Beta
                    </Badge>
                </div>

                <div className="hidden sm:block w-px h-6 bg-white/20"></div>

                {/* 中间区域：保留空间（功能已移至设置菜单） */}
                <div className="hidden sm:flex items-center gap-2">
                    {/* 空间占位，保持布局宽度 */}
                    <div className="w-32 h-8"></div>
                </div>

                <div className="hidden sm:block w-px h-6 bg-white/20"></div>

                {/* 右侧区域：次要功能 + 模式切换 */}
                <div className="flex items-center gap-1.5">
                    {/* 模式切换：收窄样式，中间显示文字，两端为圆形滑钮停靠区 */}
                    <div className="relative w-[100px] h-8 rounded-full border border-liquid-glass-light bg-white/95 shadow-sm select-none overflow-hidden">
                      {/* 点击半区 */}
                      <button onClick={() => setMode('chat')} className="absolute left-0 top-0 h-full w-1/2" aria-label="切换到聊天模式" />
                      <button onClick={() => setMode('node')} className="absolute right-0 top-0 h-full w-1/2" aria-label="切换到节点模式" />

                      {/* 中间文字（根据模式切换），始终居中显示 */}
                      <div className="absolute inset-0 flex items-center justify-center text-[11px] pointer-events-none">
                        <span className={cn('transition-colors', mode === 'chat' ? 'text-gray-900' : 'text-gray-900')}>{mode === 'chat' ? '聊天模式' : '节点模式'}</span>
                      </div>

                      {/* 滑钮：蓝色主题 */}
                      <div
                        aria-hidden
                        className={cn('absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white transition-all duration-200 border-2 border-blue-600',
                          mode === 'chat' ? 'left-1' : 'left-[calc(100%-1.25rem-4px)]')}
                        style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}
                      />
                    </div>
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
                        <DropdownMenuContent className="w-56" align="end" forceMount>
                            <DropdownMenuLabel className="font-normal">
                                <div className="flex flex-col space-y-1">
                                    <p className="text-xs font-medium leading-none">
                                        智绘用户
                                    </p>
                                    <p className="text-[10px] leading-none text-muted-foreground">
                                        @user
                                    </p>
                                </div>
                            </DropdownMenuLabel>
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

                            <DropdownMenuSeparator />

                            {/* 用户设置 */}
                            <DropdownMenuItem className="text-xs">
                                <User className="mr-2 h-3 w-3" />
                                <span>个人资料</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-xs">
                                <Settings className="mr-2 h-3 w-3" />
                                <span>设置</span>
                            </DropdownMenuItem>
                            
                            {/* 开发模式下显示内存调试选项 */}
                            {process.env.NODE_ENV === 'development' && (
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
                                className="text-xs cursor-pointer"
                                onClick={() => logger.debug('退出登录')}
                            >
                                <LogOut className="mr-2 h-3 w-3" />
                                <span>退出登录</span>
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
        </div>
    );
};

export default FloatingHeader;
