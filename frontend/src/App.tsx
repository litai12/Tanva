import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Canvas from '@/pages/Canvas';
import PromptOptimizerDemo from '@/pages/PromptOptimizerDemo';
import Sora2Test from '@/pages/Sora2Test';
import ProjectAutosaveManager from '@/components/autosave/ProjectAutosaveManager';
import SaveDebugPanel from '@/components/autosave/SaveDebugPanel';
import { useProjectStore } from '@/stores/projectStore';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';

// 检测是否为移动设备
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;

  // 检测 userAgent
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['android', 'iphone', 'ipad', 'ipod', 'webos', 'blackberry', 'windows phone'];
  const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));

  // 检测屏幕宽度（小于 768px 视为移动设备）
  const isSmallScreen = window.innerWidth < 768;

  // 检测触摸设备
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // userAgent 匹配或者（小屏幕且是触摸设备）
  return isMobileUA || (isSmallScreen && isTouchDevice);
};

// 移动设备提示组件
const MobileWarning: React.FC = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 p-6">
    <div className="max-w-md text-center">
      <div className="text-6xl mb-6">💻</div>
      <h1 className="text-2xl font-bold text-white mb-4">
        请使用电脑访问
      </h1>
      <p className="text-gray-300 mb-6 leading-relaxed">
        Tanva 是一款专业的设计工具，需要在电脑端使用以获得最佳体验。
        <br /><br />
        请在 PC 或 Mac 上打开浏览器访问本网站。
      </p>
      <div className="text-sm text-gray-500">
        推荐使用 Chrome、Edge 或 Safari 浏览器
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileDevice());
  const [showPromptDemo, setShowPromptDemo] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const search = window.location.search;
    const hash = window.location.hash;
    return search.includes('prompt-demo') || hash.includes('prompt-demo');
  });

  const [showSora2Test, setShowSora2Test] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const search = window.location.search;
    const hash = window.location.hash;
    return search.includes('sora2-test') || hash.includes('sora2-test');
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const paramProjectId = searchParams.get('projectId');
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  // 记录上一次打开的项目ID，避免重复打开
  const lastOpenedProjectIdRef = useRef<string | null>(null);

  // 监听窗口大小变化，更新移动设备状态
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setIsMobile(isMobileDevice());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const evaluate = () => {
      const search = window.location.search;
      const hash = window.location.hash;
      setShowPromptDemo(search.includes('prompt-demo') || hash.includes('prompt-demo'));
      setShowSora2Test(search.includes('sora2-test') || hash.includes('sora2-test'));
    };

    window.addEventListener('hashchange', evaluate);
    window.addEventListener('popstate', evaluate);

    return () => {
      window.removeEventListener('hashchange', evaluate);
      window.removeEventListener('popstate', evaluate);
    };
  }, []);

  useEffect(() => {
    if (!paramProjectId) {
      return;
    }
    // 避免重复打开同一个项目
    if (lastOpenedProjectIdRef.current === paramProjectId) {
      return;
    }
    lastOpenedProjectIdRef.current = paramProjectId;

    // Get the openProject method directly in the effect to avoid dependency issues
    const openProjectFn = useProjectStore.getState().open;
    openProjectFn(paramProjectId);
  }, [paramProjectId]);

  // 使用稳定的 projectId，优先使用 currentProjectId
  const projectId = useMemo(() => {
    // 如果 currentProjectId 存在，优先使用它（因为它是"权威"来源）
    if (currentProjectId) {
      return currentProjectId;
    }
    // 否则使用 URL 参数
    return paramProjectId;
  }, [paramProjectId, currentProjectId]);

  useEffect(() => {
    if (!currentProjectId) {
      return;
    }
    if (paramProjectId === currentProjectId) {
      return;
    }
    const next = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    next.set('projectId', currentProjectId);
    setSearchParams(next, { replace: true });
  }, [currentProjectId, paramProjectId, setSearchParams]);

  // 条件渲染放在所有 Hooks 之后
  // 移动设备优先显示提示
  if (isMobile) {
    return <MobileWarning />;
  }

  if (showPromptDemo) {
    return <PromptOptimizerDemo />;
  }

  if (showSora2Test) {
    return <Sora2Test />;
  }

  return (
    <div className="h-screen w-screen">
      <KeyboardShortcuts />
      <ProjectAutosaveManager projectId={projectId} />
      <Canvas />
      <SaveDebugPanel />
    </div>
  );
};

export default App;
