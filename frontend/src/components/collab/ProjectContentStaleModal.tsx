import React from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle } from 'lucide-react';
import { useProjectContentStore, type StaleReason } from '@/stores/projectContentStore';

/**
 * 「项目内容已过期」强制刷新弹窗。
 * 触发：本地版本号落后于服务器最新版本，store.staleContent=true。
 * 文案按 staleReason 区分——三种触发原因排查手段不同，不能共用一句话。
 * 交互：全屏毛玻璃蒙层阻断，唯一出口是「刷新页面」——刷新即重建 store、加载最新内容。
 * 不做关闭 / 遮罩点击关闭 / ESC，避免用户继续在过期画布上编辑造成覆盖。
 */

const COPY: Record<StaleReason, { title: string; lines: string[] }> = {
  'other-tab': {
    title: '项目内容已过期',
    lines: ['此项目已在其他标签页打开并保存', '请刷新页面以继续编辑'],
  },
  'remote-newer': {
    title: '项目内容已过期',
    lines: ['此项目在别处已有更新，你当前打开的是旧版本', '请刷新页面加载最新内容后再编辑'],
  },
  'save-rejected': {
    title: '保存被拒绝：本地版本已过期',
    lines: ['此项目在别处已有更新，本次保存未写入', '请刷新页面加载最新内容后重做本次改动'],
  },
};

const FALLBACK = {
  title: '项目内容已过期',
  lines: ['此项目在别处已有更新', '请刷新页面以继续编辑'],
};

const ProjectContentStaleModal: React.FC = () => {
  const staleContent = useProjectContentStore((state) => state.staleContent);
  const staleReason = useProjectContentStore((state) => state.staleReason);
  if (!staleContent) return null;

  const copy = (staleReason && COPY[staleReason]) || FALLBACK;

  return createPortal(
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="w-[380px] rounded-2xl bg-[#1f2329] shadow-[0_20px_60px_rgba(0,0,0,0.5)] px-8 py-9 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full border-[3px] border-amber-500 flex items-center justify-center mb-5">
          <AlertCircle className="w-9 h-9 text-amber-500" strokeWidth={2.2} />
        </div>
        <h3 className="text-xl font-semibold text-white mb-4">{copy.title}</h3>
        {copy.lines.map((line, i) => (
          <p
            key={line}
            className={`text-sm text-slate-400 leading-7${i === copy.lines.length - 1 ? ' mb-7' : ''}`}
          >
            {line}
          </p>
        ))}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full h-11 rounded-lg bg-blue-600 text-white text-base font-medium hover:bg-blue-700 transition-colors"
        >
          刷新页面
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default ProjectContentStaleModal;
