import { logger } from '@/utils/logger';
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
import { Settings, User, LogOut, HelpCircle, Share, Library, Menu, Grid3x3, Plus, Home, Ruler, Eye, EyeOff, Dot, Square } from 'lucide-react';
import { useUIStore, useCanvasStore, GridStyle } from '@/stores';
import { getAllUnits, getUnitDisplayName, getScaleRatioText } from '@/lib/unitUtils';

const Header: React.FC = () => {
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
        // 暂时空实现
        logger.debug('Logo clicked');
    };

    // 网格样式切换函数 - 循环切换：线条 -> 点阵 -> 纯色 -> 线条...
    const getNextGridStyle = (currentStyle: GridStyle) => {
        switch (currentStyle) {
            case GridStyle.LINES:
                return GridStyle.DOTS;
            case GridStyle.DOTS:
                return GridStyle.SOLID;
            case GridStyle.SOLID:
                return GridStyle.LINES;
            default:
                return GridStyle.LINES;
        }
    };

    // 获取网格样式显示信息
    const getGridStyleInfo = (style: GridStyle) => {
        switch (style) {
            case GridStyle.LINES:
                return { icon: Grid3x3, text: '切换到点阵' };
            case GridStyle.DOTS:
                return { icon: Dot, text: '切换到纯色' };
            case GridStyle.SOLID:
                return { icon: Square, text: '切换到线条' };
            default:
                return { icon: Grid3x3, text: '切换到点阵' };
        }
    };

    return (
        <header
            className="sticky top-0 z-50 w-full border-b border-glass bg-glass backdrop-blur-md shadow-glass"
        >
            <div className="flex h-10 w-full items-center justify-between px-3">
                {/* Logo - 左对齐 */}
                <div className="flex items-center space-x-2">
                    <div
                        className="flex items-center justify-center w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={handleLogoClick}
                        title="返回首页"
                    >
                        {/* Logo图片 */}
                        <img
                            src="/logo.png"
                            alt="Logo"
                            className="w-6 h-6 object-contain"
                        />
                    </div>
                    <Badge variant="secondary" className="ml-1 text-[8px] px-0.5 py-0">
                        Beta
                    </Badge>
                </div>

                {/* 中间区域 - 暂时为空 */}
                <div className="flex-1 flex justify-center">
                    <div></div>
                </div>

                {/* 用户菜单 - 右对齐 */}
                <div className="flex items-center space-x-2">
                    {/* 问号帮助按钮 */}
                    <Button variant="ghost" size="sm" className="w-6 h-6 p-0">
                        <HelpCircle className="w-3 h-3" />
                    </Button>

                    {/* 素材库按钮 */}
                    <Button
                        onClick={toggleLibraryPanel}
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs flex items-center gap-1"
                        title={showLibraryPanel ? "关闭素材库" : "打开素材库"}
                    >
                        <Library className="w-3 h-3" />
                        <span>素材库</span>
                    </Button>

                    {/* 分享按钮 */}
                    <Button
                        variant="default"
                        size="sm"
                        className="h-6 px-2 bg-blue-500 hover:bg-blue-600 text-white text-xs flex items-center gap-1"
                        onClick={() => {
                            // 分享功能
                            if (navigator.share) {
                                // 使用原生分享API
                                navigator.share({
                                    title: '智绘画板',
                                    text: '来体验这个智能画板应用！',
                                    url: window.location.href
                                }).catch(console.error);
                            } else {
                                // 备用方案：复制链接到剪贴板
                                navigator.clipboard.writeText(window.location.href).then(() => {
                                    alert('链接已复制到剪贴板！');
                                }).catch(() => {
                                    alert('分享链接: ' + window.location.href);
                                });
                            }
                        }}
                        title="分享"
                    >
                        <Share className="w-3 h-3" />
                        <span>分享</span>
                    </Button>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="w-6 h-6 p-0">
                                <Menu className="w-3 h-3" />
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

                            {/* 视图设置 */}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                                视图设置
                            </DropdownMenuLabel>

                            {/* 网格开关 */}
                            <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={toggleGrid}
                            >
                                <Grid3x3 className="mr-2 h-3 w-3" />
                                <span>{showGrid ? '关闭网格' : '开启网格'}</span>
                            </DropdownMenuItem>

                            {/* 网格样式切换 */}
                            {showGrid && (() => {
                                const { icon: IconComponent, text } = getGridStyleInfo(gridStyle);
                                return (
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer ml-4"
                                        onClick={() => setGridStyle(getNextGridStyle(gridStyle))}
                                    >
                                        <IconComponent className="mr-2 h-3 w-3" />
                                        <span>{text}</span>
                                    </DropdownMenuItem>
                                );
                            })()}

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

                            {/* 比例尺显示开关 */}
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
        </header>
    );
};

export default Header;