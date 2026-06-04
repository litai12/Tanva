import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Canvas from '@/pages/Canvas';
import PromptOptimizerDemo from '@/pages/PromptOptimizerDemo';
import Sora2Test from '@/pages/Sora2Test';
import ProjectAutosaveManager from '@/components/autosave/ProjectAutosaveManager';
import SaveDebugPanel from '@/components/autosave/SaveDebugPanel';
import { useProjectStore } from '@/stores/projectStore';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import LoginModal from '@/components/auth/LoginModal';
import { tokenRefreshManager } from '@/services/tokenRefreshManager';
import { useAuthStore } from '@/stores/authStore';
import { AppLoadingIndicator } from '@/components/AppLoadingIndicator';
import { useTranslation } from 'react-i18next';
import { TeamInviteConfirmModal } from '@/components/team/TeamInviteConfirmModal';
import { useTeamRealtime } from '@/hooks/useTeamRealtime';
import { useProjectContentStore } from '@/stores/projectContentStore';
import CampaignNoticeBar from '@/components/layout/CampaignNoticeBar';
import { isCampaignNoticeAvailable } from '@/components/layout/campaignNoticeConfig';

const PENDING_INVITE_KEY = 'tanva_pending_team_invite';

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
const MobileWarning: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center w-screen h-screen p-6 bg-gradient-to-br from-gray-900 to-gray-800">
      <div className="max-w-md text-center">
        <div className="mb-6 text-6xl">💻</div>
        <h1 className="mb-4 text-2xl font-bold text-white">
          {t('app.mobile.title')}
        </h1>
        <p className="mb-6 leading-relaxed text-gray-300">
          {t('app.mobile.desc1')}
          <br /><br />
          {t('app.mobile.desc2')}
        </p>
        <div className="text-sm text-gray-500">
          {t('app.mobile.recommendation')}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  useTeamRealtime();
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
  const [showCampaignNotice, setShowCampaignNotice] = useState<boolean>(() =>
    isCampaignNoticeAvailable()
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const paramProjectId = searchParams.get('projectId');
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  // 获取认证状态用于显示加载指示器
  const { user, loading: authLoading } = useAuthStore();
  const projectViewReady = useProjectContentStore((state) => state.projectViewReady);
  const projectLoadError = useProjectContentStore((state) => state.lastError);

  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  const prevUserRef = useRef<typeof user>(undefined);

  // 记录上一次打开的项目ID，避免重复打开
  const lastOpenedProjectIdRef = useRef<string | null>(null);

  // 初始化 TokenRefreshManager
  useEffect(() => {
    tokenRefreshManager.init();
    return () => {
      tokenRefreshManager.destroy();
    };
  }, []);

  // 检测 URL 中的邀请码
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('inviteCode');
    if (!code) return;
    url.searchParams.delete('inviteCode');
    window.history.replaceState({}, '', url.toString());
    if (useAuthStore.getState().user) {
      setPendingInviteCode(code);
    } else {
      localStorage.setItem(PENDING_INVITE_KEY, code);
    }
  }, []);

  // 登录后处理待加入的邀请
  useEffect(() => {
    const prev = prevUserRef.current;
    prevUserRef.current = user;
    if (prev !== undefined && !prev && user) {
      const code = localStorage.getItem(PENDING_INVITE_KEY);
      if (code) {
        localStorage.removeItem(PENDING_INVITE_KEY);
        setPendingInviteCode(code);
      }
    }
  }, [user]);

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
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const projectLoadingMessage = t('app.projectLoading', {
    defaultValue: isZh ? '加载中...' : 'Loading...',
  });
  const showProjectLoading = Boolean(
    projectId &&
    user &&
    !authLoading &&
    !projectViewReady &&
    !projectLoadError
  );

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
    <div
      className={`w-screen h-screen flex flex-col ${
        showCampaignNotice ? 'tanva-campaign-shell' : ''
      }`}
    >
      <KeyboardShortcuts />
      <ProjectAutosaveManager projectId={projectId} />
      {showCampaignNotice && (
        <CampaignNoticeBar
          onClose={() => setShowCampaignNotice(false)}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <Canvas />
      </div>
      {showProjectLoading && (
        <AppLoadingIndicator
          message={projectLoadingMessage}
          variant="minimal"
          style={{ zIndex: 1500 }}
        />
      )}
      <LoginModal />

      {pendingInviteCode && (
        <TeamInviteConfirmModal
          code={pendingInviteCode}
          onClose={() => setPendingInviteCode(null)}
          onJoined={() => setPendingInviteCode(null)}
        />
      )}

      {/* 认证初始化加载指示器 */}
      {authLoading && !user && (
        <AppLoadingIndicator message={t('app.authChecking')} />
      )}

      <SaveDebugPanel />
    </div>
  );
};

export default App;
