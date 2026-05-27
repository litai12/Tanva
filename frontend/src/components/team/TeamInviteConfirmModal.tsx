import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, X } from 'lucide-react';
import { teamApi } from '../../services/teamApi';
import { refreshTeams } from '../../stores/authStore';
import { Button } from '@/components/ui/button';

interface Props {
  code: string;
  onClose: () => void;
  onJoined: (teamId: string) => void;
}

export function TeamInviteConfirmModal({ code, onClose, onJoined }: Props) {
  const [info, setInfo] = useState<{ teamName: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    teamApi
      .getInviteInfo(code)
      .then(setInfo)
      .catch((e: any) => setLoadError(e?.message || '邀请链接无效或已过期'));
  }, [code]);

  const handleJoin = async () => {
    setJoining(true);
    setJoinError('');
    try {
      const result = await teamApi.acceptInvite(code);
      await refreshTeams();
      onJoined(result.teamId);
    } catch (e: any) {
      setJoinError(e?.message || '加入失败');
      setJoining(false);
    }
  };

  const isLoading = !info && !loadError;

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-3xl bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)] border border-slate-200/80 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors text-slate-400"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center gap-3 mb-6 pt-2">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Users className="w-6 h-6 text-slate-600" />
          </div>

          {isLoading && <p className="text-sm text-slate-400">加载中…</p>}

          {loadError && (
            <p className="text-sm text-red-500">{loadError}</p>
          )}

          {info && (
            <>
              <h2 className="text-base font-semibold text-slate-800">团队邀请</h2>
              <p className="text-sm text-slate-500">
                你被邀请加入团队{' '}
                <span className="font-semibold text-slate-800">「{info.teamName}」</span>
                ，确认加入？
              </p>
            </>
          )}
        </div>

        {joinError && (
          <p className="text-xs text-red-500 text-center mb-3">{joinError}</p>
        )}

        {info && (
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>
              取消
            </Button>
            <Button className="flex-1 rounded-xl" onClick={handleJoin} disabled={joining}>
              {joining ? '加入中…' : '确认加入'}
            </Button>
          </div>
        )}

        {(loadError || (!info && !isLoading)) && (
          <Button variant="outline" className="w-full rounded-xl" onClick={onClose}>
            关闭
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}
