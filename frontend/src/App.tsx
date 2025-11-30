import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Canvas from '@/pages/Canvas';
import PromptOptimizerDemo from '@/pages/PromptOptimizerDemo';
import Sora2Test from '@/pages/Sora2Test';
import AccountBadge from '@/components/AccountBadge';
import ProjectAutosaveManager from '@/components/autosave/ProjectAutosaveManager';
import AutosaveStatus from '@/components/autosave/AutosaveStatus';
import ManualSaveButton from '@/components/autosave/ManualSaveButton';
import SaveDebugPanel from '@/components/autosave/SaveDebugPanel';
import { useProjectStore } from '@/stores/projectStore';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';

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

  if (showPromptDemo) {
    return <PromptOptimizerDemo />;
  }

  if (showSora2Test) {
    return <Sora2Test />;
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const paramProjectId = searchParams.get('projectId');
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  // 记录上一次打开的项目ID，避免重复打开
  const lastOpenedProjectIdRef = useRef<string | null>(null);

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
