import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Canvas from '@/pages/Canvas';
import PromptOptimizerDemo from '@/pages/PromptOptimizerDemo';
import AccountBadge from '@/components/AccountBadge';
import ProjectAutosaveManager from '@/components/autosave/ProjectAutosaveManager';
import AutosaveStatus from '@/components/autosave/AutosaveStatus';
import SaveDebugPanel from '@/components/autosave/SaveDebugPanel';
import { useProjectStore } from '@/stores/projectStore';

const App: React.FC = () => {
  const [showPromptDemo, setShowPromptDemo] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const search = window.location.search;
    const hash = window.location.hash;
    return search.includes('prompt-demo') || hash.includes('prompt-demo');
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const evaluate = () => {
      const search = window.location.search;
      const hash = window.location.hash;
      setShowPromptDemo(search.includes('prompt-demo') || hash.includes('prompt-demo'));
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

  const [searchParams] = useSearchParams();
  const paramProjectId = searchParams.get('projectId');
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const openProject = useProjectStore((state) => state.open);
  const projects = useProjectStore((state) => state.projects);

  useEffect(() => {
    if (paramProjectId) {
      openProject(paramProjectId);
    }
  }, [paramProjectId, openProject]);

  useEffect(() => {
    if (paramProjectId && projects.length > 0) {
      openProject(paramProjectId);
    }
  }, [paramProjectId, projects, openProject]);

  const projectId = useMemo(() => paramProjectId || currentProjectId, [paramProjectId, currentProjectId]);

  return (
    <div className="h-screen w-screen">
      <div className="absolute right-3 top-3 z-50">
        <div className="flex items-center gap-2 bg-white/90 border rounded px-2 py-1 shadow-sm">
          <AccountBadge />
          <a href="/" className="text-xs text-sky-600">返回首页</a>
          <AutosaveStatus />
        </div>
      </div>
      <ProjectAutosaveManager projectId={projectId} />
      <Canvas />
      <SaveDebugPanel />
    </div>
  );
};

export default App;
