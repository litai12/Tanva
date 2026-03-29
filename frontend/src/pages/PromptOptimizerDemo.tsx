import React, { useCallback, useMemo, useState } from 'react';
import usePromptOptimization from '@/hooks/usePromptOptimization';
import { useAIChatStore, getTextModelForProvider } from '@/stores/aiChatStore';
import { useTranslation } from 'react-i18next';

const PromptOptimizerDemo: React.FC = () => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);
  const { optimize, loading, result, error, reset } = usePromptOptimization();
  const [input, setInput] = useState(isZh ? '给我一个关于春天校园插画的提示' : 'Give me a prompt about a spring campus illustration');
  const [language, setLanguage] = useState<'中文' | 'English'>(isZh ? '中文' : 'English');
  const [tone, setTone] = useState(isZh ? '灵动且富有画面感' : 'Vivid and cinematic');
  const [focus, setFocus] = useState(isZh ? '描绘环境、光线、角色活动以及视觉风格' : 'Describe environment, lighting, character actions and visual style');
  const [lengthPreference, setLengthPreference] = useState<'concise' | 'balanced' | 'detailed'>('balanced');
  const [localError, setLocalError] = useState<string | null>(null);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const textModel = useMemo(() => getTextModelForProvider(aiProvider), [aiProvider]);

  const disableSubmit = useMemo(() => loading || !input.trim(), [loading, input]);

  const handleOptimize = useCallback(async () => {
    setLocalError(null);

    if (!input.trim()) {
      setLocalError(lt('请输入原始提示描述', 'Please enter the original prompt description'));
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
      setLocalError(lt('优化失败，请检查控制台日志或 API 配置', 'Optimization failed. Check console logs or API configuration.'));
    }
  }, [aiProvider, focus, input, language, lengthPreference, lt, optimize, textModel, tone]);

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
          <h1 className="text-2xl font-semibold">{lt('提示词优化测试台', 'Prompt Optimizer Demo')}</h1>
          <p className="text-sm text-slate-300">
            {lt(
              '输入基础描述，调用后端 AI 服务生成扩展且不偏题的提示词。默认返回中文且为单段文本。',
              'Enter a base description to call backend AI and generate an expanded, on-topic prompt.'
            )}
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-5">
          <div className="md:col-span-5 space-y-2">
            <label className="text-sm text-slate-200">{lt('原始描述', 'Original description')}</label>
            <textarea
              className="w-full min-h-[140px] rounded-lg border border-slate-600 bg-slate-900/80 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder={lt('描述你想生成的内容或任务', 'Describe what you want to generate')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">{lt('输出语言', 'Output language')}</label>
            <select
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={language}
              onChange={(event) => setLanguage(event.target.value as '中文' | 'English')}
            >
              <option value="中文">{lt('中文', 'Chinese')}</option>
              <option value="English">English</option>
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-slate-200">{lt('语气/风格', 'Tone/style')}</label>
            <input
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder={lt('可选，比如：沉浸式、策略性', 'Optional, e.g. immersive, strategic')}
              value={tone}
              onChange={(event) => setTone(event.target.value)}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-slate-200">{lt('重点补充方向', 'Focus areas')}</label>
            <input
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder={lt('可选，比如：目标受众、视觉细节', 'Optional, e.g. target audience, visual details')}
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-200">{lt('长度倾向', 'Length preference')}</label>
            <select
              className="w-full rounded-lg border border-slate-600 bg-slate-900/80 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={lengthPreference}
              onChange={(event) => setLengthPreference(event.target.value as 'concise' | 'balanced' | 'detailed')}
            >
              <option value="concise">{lt('简洁', 'Concise')}</option>
              <option value="balanced">{lt('均衡', 'Balanced')}</option>
              <option value="detailed">{lt('细节丰富', 'Detailed')}</option>
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
            {loading ? lt('生成中...', 'Generating...') : lt('生成优化提示', 'Generate optimized prompt')}
          </button>
          <button
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
            onClick={handleReset}
            disabled={loading}
          >
            {lt('重置', 'Reset')}
          </button>
        </div>

        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{lt('优化结果', 'Optimization result')}</h2>
            {result?.tokenUsage && (
              <span className="text-xs text-slate-400">{lt('Token 使用量：', 'Token usage: ')}{result.tokenUsage}</span>
            )}
          </header>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200 min-h-[120px]">
            {loading && <span className="text-slate-400">{lt('等待响应中...', 'Waiting for response...')}</span>}
            {!loading && result && (
              <span>{result.optimizedPrompt}</span>
            )}
            {!loading && !result && !localError && !error && (
              <span className="text-slate-500">{lt('尚未生成结果', 'No result yet')}</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default PromptOptimizerDemo;
