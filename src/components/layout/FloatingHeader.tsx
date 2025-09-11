import React, { useState } from 'react';
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
import { 
    Settings, 
    User, 
    LogOut, 
    HelpCircle, 
    Share, 
    Library, 
    Grid3x3, 
    Plus, 
    Home, 
    Ruler, 
    Eye, 
    EyeOff, 
    Square,
    Menu
} from 'lucide-react';
import { useUIStore, useCanvasStore, GridStyle } from '@/stores';
import { getAllUnits, getUnitDisplayName, getScaleRatioText } from '@/lib/unitUtils';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

const FloatingHeader: React.FC = () => {
    const {
        showLibraryPanel,
        showGrid,
        showAxis,
        toggleLibraryPanel,
        toggleGrid,
        toggleAxis
    } = useUIStore();
    
    const { 
        resetView,
        units,
        scaleRatio, 
        zoom,
        showScaleBar,
        gridStyle,
        setUnits,
        setGridStyle,
        toggleScaleBar
    } = useCanvasStore();

    const [showUnitOptions, setShowUnitOptions] = useState(false);

    const handleLogoClick = () => {
        logger.debug('Logo clicked');
    };

    // 网格样式切换函数 - 暂时禁用点阵，只在线条和纯色之间切换
    const getNextGridStyle = (currentStyle: GridStyle) => {
        switch (currentStyle) {
            case GridStyle.LINES:
                return GridStyle.SOLID;
            case GridStyle.DOTS:
                // 点阵已禁用，回退到纯色
                return GridStyle.SOLID;
            case GridStyle.SOLID:
                return GridStyle.LINES;
            default:
                return GridStyle.LINES;
        }
    };

    // 获取网格样式显示信息 - 点阵已禁用
    const getGridStyleInfo = (style: GridStyle) => {
        switch (style) {
            case GridStyle.LINES:
                return { icon: Grid3x3, text: '线条网格' };
            case GridStyle.DOTS:
                // 点阵已禁用，显示为线条
                return { icon: Grid3x3, text: '线条网格 (点阵已禁用)' };
            case GridStyle.SOLID:
                return { icon: Square, text: '纯色背景' };
            default:
                return { icon: Grid3x3, text: '线条网格' };
        }
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

    return (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
            <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 rounded-2xl bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass transition-all duration-300">
                
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

                {/* 右侧区域：次要功能 */}
                <div className="flex items-center gap-2">
                    {/* 素材库按钮 */}
                    <Button
                        onClick={toggleLibraryPanel}
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "h-8 text-xs flex items-center rounded-full transition-all duration-200",
                            "bg-liquid-glass-light backdrop-blur-minimal border border-liquid-glass-light hover:bg-liquid-glass-hover",
                            showLibraryPanel ? "text-blue-600" : "text-gray-600",
                            "w-8 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1" // 响应式宽度和padding
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
                        variant="default"
                        size="sm"
                        className="h-8 bg-blue-500 hover:bg-blue-600 text-white text-xs flex items-center rounded-full transition-all duration-200 w-8 sm:w-auto px-0 sm:px-3 gap-0 sm:gap-1"
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
                        <DropdownMenuContent className="w-48" align="end" forceMount>
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

                            {/* 网格样式设置 */}
                            {/* 视图控制 */}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                视图控制
                            </DropdownMenuLabel>

                            {/* 网格开关 */}
                            <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={toggleGrid}
                            >
                                <Grid3x3 className="mr-2 h-3 w-3" />
                                <span>{showGrid ? '关闭网格' : '开启网格'}</span>
                            </DropdownMenuItem>

                            {/* 坐标轴开关 */}
                            <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={toggleAxis}
                            >
                                <Plus className="mr-2 h-3 w-3" />
                                <span>{showAxis ? '关闭坐标轴' : '开启坐标轴'}</span>
                            </DropdownMenuItem>

                            {/* 回到原点 */}
                            <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={resetView}
                            >
                                <Home className="mr-2 h-3 w-3" />
                                <span>回到原点</span>
                            </DropdownMenuItem>

                            {/* 比例尺显示切换 */}
                            <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={toggleScaleBar}
                            >
                                {showScaleBar ? (
                                    <EyeOff className="mr-2 h-3 w-3" />
                                ) : (
                                    <Eye className="mr-2 h-3 w-3" />
                                )}
                                <span>{showScaleBar ? '隐藏比例尺' : '显示比例尺'}</span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                网格样式
                            </DropdownMenuLabel>
                            
                            {showGrid && (
                                <DropdownMenuItem
                                    className="text-xs cursor-pointer"
                                    onClick={() => setGridStyle(getNextGridStyle(gridStyle))}
                                >
                                    {(() => {
                                        const { icon: IconComponent, text } = getGridStyleInfo(gridStyle);
                                        return (
                                            <>
                                                <IconComponent className="mr-2 h-3 w-3" />
                                                <span>当前: {text}</span>
                                            </>
                                        );
                                    })()}
                                </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            {/* 单位和比例尺设置 */}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                单位和比例尺
                            </DropdownMenuLabel>

                            {/* 单位选择 */}
                            <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={() => setShowUnitOptions(!showUnitOptions)}
                            >
                                <Ruler className="mr-2 h-3 w-3" />
                                <span>单位: {getUnitDisplayName(units)}</span>
                            </DropdownMenuItem>

                            {/* 单位选项 */}
                            {showUnitOptions && (
                                <>
                                    {getAllUnits().map((unit) => (
                                        <DropdownMenuItem
                                            key={unit}
                                            className="text-xs cursor-pointer ml-4"
                                            onClick={() => {
                                                setUnits(unit);
                                                setShowUnitOptions(false);
                                            }}
                                        >
                                            <span className={units === unit ? 'font-medium' : ''}>
                                                {getUnitDisplayName(unit)} ({unit})
                                            </span>
                                        </DropdownMenuItem>
                                    ))}
                                </>
                            )}

                            {/* 当前比例尺信息 */}
                            <DropdownMenuItem disabled className="text-[10px] text-muted-foreground">
                                <span>当前比例: {getScaleRatioText(scaleRatio, zoom)}</span>
                            </DropdownMenuItem>

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
        </div>
    );
};

export default FloatingHeader;