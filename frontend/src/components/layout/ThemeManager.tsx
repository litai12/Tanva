import React, { useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 主题管理器，负责将主题应用到 HTML 元素
 */
const ThemeManager: React.FC = () => {
  const theme = useUIStore((state) => state.theme);
  const { gridBgColor, gridColor, setGridBgColor, setGridColor } = useCanvasStore();

  useEffect(() => {
    const root = window.document.documentElement;
    const body = window.document.body;
    
    // 移除之前的类（同时在 html 和 body 上）
    root.classList.remove('light', 'dark');
    body.classList.remove('light', 'dark');

    const activeTheme = theme === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
      
    // 同时在 html 和 body 上添加类，确保 createPortal 渲染的内容也能正确应用深色模式
    root.classList.add(activeTheme);
    body.classList.add(activeTheme);
    
    // 同步更新画布基础颜色（如果还是默认值的话）
    if (activeTheme === 'dark') {
      if (gridBgColor === '#ffffff') {
        setGridBgColor('#1a1a1a');
      }
      if (gridColor === '#000000') {
        setGridColor('#444444');
      }
    } else {
      if (gridBgColor === '#1a1a1a') {
        setGridBgColor('#ffffff');
      }
      if (gridColor === '#444444') {
        setGridColor('#000000');
      }
    }
  }, [theme, gridBgColor, gridColor, setGridBgColor, setGridColor]);

  // 监听系统主题变化
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const root = window.document.documentElement;
      const body = window.document.body;
      const isDark = mediaQuery.matches;
      root.classList.remove('light', 'dark');
      body.classList.remove('light', 'dark');
      root.classList.add(isDark ? 'dark' : 'light');
      body.classList.add(isDark ? 'dark' : 'light');
      
      // 同步更新画布基础颜色
      if (isDark) {
        if (useCanvasStore.getState().gridBgColor === '#ffffff') {
          useCanvasStore.getState().setGridBgColor('#1a1a1a');
        }
        if (useCanvasStore.getState().gridColor === '#000000') {
          useCanvasStore.getState().setGridColor('#444444');
        }
      } else {
        if (useCanvasStore.getState().gridBgColor === '#1a1a1a') {
          useCanvasStore.getState().setGridBgColor('#ffffff');
        }
        if (useCanvasStore.getState().gridColor === '#444444') {
          useCanvasStore.getState().setGridColor('#000000');
        }
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return null;
};

export default ThemeManager;

