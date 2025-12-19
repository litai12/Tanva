import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Canvas from '@/pages/Canvas';
import PromptOptimizerDemo from '@/pages/PromptOptimizerDemo';
import Sora2Test from '@/pages/Sora2Test';
import ProjectAutosaveManager from '@/components/autosave/ProjectAutosaveManager';
import SaveDebugPanel from '@/components/autosave/SaveDebugPanel';
import { useProjectStore } from '@/stores/projectStore';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import { useProjectContentStore } from '@/stores/projectContentStore';
import AppLoadingOverlay from '@/components/layout/AppLoadingOverlay';

const App: React.FC = () => {
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
  const projectLoading = useProjectStore((state) => state.loading);
  const projectError = useProjectStore((state) => state.error);
  const contentHydrated = useProjectContentStore((state) => state.hydrated);
  const hydratedProjectId = useProjectContentStore((state) => state.projectId);
  const contentError = useProjectContentStore((state) => state.lastError);

  // 记录上一次打开的项目ID，避免重复打开
  const lastOpenedProjectIdRef = useRef<string | null>(null);

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

  const loadingState = useMemo(() => {
    if (projectLoading) {
      return {
        title: '正在加载项目',
        description: '刷新后需要几秒钟恢复工作区，请稍候...',
      };
    }
    if (projectId && (hydratedProjectId !== projectId || !contentHydrated)) {
      return {
        title: '正在恢复画布内容',
        description: '图片节点、图层与对话会话正在就位',
      };
    }
    return null;
  }, [projectLoading, projectId, hydratedProjectId, contentHydrated]);

  const loadError = projectError || contentError;

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  // 条件渲染放在所有 Hooks 之后
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
      <AppLoadingOverlay
        visible={Boolean(loadingState) || Boolean(loadError)}
        title={loadError ? '加载失败' : loadingState?.title || '正在加载'}
        description={loadError || loadingState?.description}
        status={loadError ? 'error' : 'loading'}
        onRetry={loadError ? handleReload : undefined}
      />
    </div>
  );
};

export default App;
