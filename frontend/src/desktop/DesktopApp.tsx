import { useEffect } from 'react';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import LoginModal from '@/components/auth/LoginModal';
import ProjectAutosaveManager from '@/components/autosave/ProjectAutosaveManager';
import { useTeamRealtime } from '@/hooks/useTeamRealtime';
import { useProjectStore } from '@/stores/projectStore';
import { tokenRefreshManager } from '@/services/tokenRefreshManager';
import DesktopShell from './DesktopShell';

export default function DesktopApp() {
  useTeamRealtime();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  useEffect(() => {
    tokenRefreshManager.init();
    return () => tokenRefreshManager.destroy();
  }, []);

  return (
    <>
      <KeyboardShortcuts />
      <ProjectAutosaveManager projectId={currentProjectId} />
      <DesktopShell />
      <LoginModal />
    </>
  );
}
