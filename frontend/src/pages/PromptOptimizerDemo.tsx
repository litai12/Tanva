import React, { useCallback, useMemo, useState } from 'react';
import usePromptOptimization from '@/hooks/usePromptOptimization';
import { useAIChatStore, getTextModelForProvider } from '@/stores/aiChatStore';

const PromptOptimizerDemo: React.FC = () => {
  const { optimize, loading, result, error, reset } = usePromptOptimization();
  const [input, setInput] = useState('给我一个关于春天校园插画的提示');
  const [language, setLanguage] = useState<'中文' | 'English'>('中文');
  const [tone, setTone] = useState('灵动且富有画面感');
  const [focus, setFocus] = useState('描绘环境、光线、角色活动以及视觉风格');
  const [lengthPreference, setLengthPreference] = useState<'concise' | 'balanced' | 'detailed'>('balanced');
  const [localError, setLocalError] = useState<string | null>(null);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const textModel = useMemo(() => getTextModelForProvider(aiProvider), [aiProvider]);

  const disableSubmit = useMemo(() => loading || !input.trim(), [loading, input]);

  const handleOptimize = useCallback(async () => {
    setLocalError(null);

    if (!input.trim()) {
      setLocalError('请输入原始提示描述');
      return;
    }

    const res = await optimize({
      input,
      language,
      tone: tone.trim() || undefined,
      focus: focus.trim() || undefined,
      lengthPreference,
      aiProvider,
      model: textModel
    });

    if (!res) {
      setLocalError('优化失败，请检查控制台日志或 API 配置');
    }
  }, [focus, input, language, lengthPreference, optimize, tone]);

  const handleReset = useCallback(() => {
    setInput('');
    setTone('');
    setFocus('');
    setLocalError(null);
    reset();
  }, [reset]);

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-4xl bg-slate-800/80 backdrop-blur rounded-2xl shadow-xl border border-slate-700 p-8 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">提示词优化测试台</h1>
          <p className="text-sm text-slate-300">
            输入基础描述，调用后端 AI 服务生成扩展且不偏题的提示词。默认返回中文且为单段文本。
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-5">
          <div className="md:col-span-5 space-y-2">
            <label className="text-sm text-slate-200">原始描述</label>
            <textarea
              className="w-full min-h-[140px] rounded-lg border border-slate-600 bg-slate-900/80 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="描述你想生成的内容或任务"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">输出语言</label>
            <select
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={language}
              onChange={(event) => setLanguage(event.target.value as '中文' | 'English')}
            >
              <option value="中文">中文</option>
              <option value="English">English</option>
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-slate-200">语气/风格</label>
            <input
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="可选，比如：沉浸式、策略性"
              value={tone}
              onChange={(event) => setTone(event.target.value)}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-slate-200">重点补充方向</label>
            <input
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="可选，比如：目标受众、视觉细节"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">长度倾向</label>
            <select
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={lengthPreference}
              onChange={(event) => setLengthPreference(event.target.value as 'concise' | 'balanced' | 'detailed')}
            >
              <option value="concise">简洁</option>
              <option value="balanced">均衡</option>
              <option value="detailed">细节丰富</option>
            </select>
          </div>
        </section>

        {localError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {localError}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {`${error.message} (${error.code})`}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-600"
            onClick={handleOptimize}
            disabled={disableSubmit}
          >
            {loading ? '生成中...' : '生成优化提示'}
          </button>
          <button
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
            onClick={handleReset}
            disabled={loading}
          >
            重置
          </button>
        </div>

        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-medium">优化结果</h2>
            {result?.tokenUsage && (
              <span className="text-xs text-slate-400">Token 使用量：{result.tokenUsage}</span>
            )}
          </header>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200 min-h-[120px]">
            {loading && <span className="text-slate-400">等待响应中...</span>}
            {!loading && result && (
              <span>{result.optimizedPrompt}</span>
            )}
            {!loading && !result && !localError && !error && (
              <span className="text-slate-500">尚未生成结果</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default PromptOptimizerDemo;
