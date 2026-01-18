import React, { useState, useCallback } from 'react';
import { generateImageViaAPI } from '@/services/aiBackendAPI';
import { ossUploadService, dataURLToBlob } from '@/services/ossUploadService';
import type { RunningHubGenerateOptions, AIProviderOptions } from '@/types/ai';

type LogEntry = {
  timestamp: Date;
  level: 'info' | 'error';
  message: string;
};

const defaultPrimaryNodeId = import.meta.env?.VITE_RUNNINGHUB_PRIMARY_NODE_ID ?? '112';
const defaultReferenceNodeId = import.meta.env?.VITE_RUNNINGHUB_REFERENCE_NODE_ID ?? '158';
// 注：Webapp ID 应在 .env.local 中配置为 VITE_RUNNINGHUB_WEBAPP_ID，与后端保持一致
const defaultWebappId = import.meta.env?.VITE_RUNNINGHUB_WEBAPP_ID ?? '1983545874322268161';
const defaultWebhookUrl = import.meta.env?.VITE_RUNNINGHUB_WEBHOOK_URL ?? '';

const ensureDataUrl = (data: string): string =>
  data.startsWith('data:image') ? data : `data:image/png;base64,${data}`;

const RunningHubTest: React.FC = () => {
  const [prompt, setPrompt] = useState('酒吧客厅氛围渲染');
  const [webappId, setWebappId] = useState(defaultWebappId);
  const [webhookUrl, setWebhookUrl] = useState(defaultWebhookUrl);
  const [primaryNodeId, setPrimaryNodeId] = useState(defaultPrimaryNodeId);
  const [referenceNodeId, setReferenceNodeId] = useState(defaultReferenceNodeId);
  const [suImageData, setSuImageData] = useState<string | null>(null);
  const [referenceImageData, setReferenceImageData] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appendLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => [...prev, entry]);
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, setter: (value: string | null) => void) => {
    const file = event.target.files?.[0];
    if (!file) {
      setter(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setter(reader.result);
      }
    };
    reader.onerror = () => {
      appendLog({
        timestamp: new Date(),
        level: 'error',
        message: `读取文件失败: ${reader.error?.message ?? '未知错误'}`,
      });
    };
    reader.readAsDataURL(file);
  };

  const uploadImage = useCallback(
    async (dataUrl: string, label: string) => {
      appendLog({
        timestamp: new Date(),
        level: 'info',
        message: `开始上传 ${label} 至 OSS...`,
      });

      const blob = dataURLToBlob(ensureDataUrl(dataUrl));
      const uploadResult = await ossUploadService.uploadToOSS(blob, {
        dir: 'runninghub-test/',
        fileName: `${label}-${Date.now()}.png`,
        contentType: 'image/png',
        maxSize: 10 * 1024 * 1024,
      });

      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || `${label} 上传失败`);
      }

      appendLog({
        timestamp: new Date(),
        level: 'info',
        message: `${label} 上传成功: ${uploadResult.url}`,
      });

      return uploadResult.url;
    },
    [appendLog],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!suImageData) {
      setError('请先上传 SU 截图');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResultImage(null);
    setRawResponse('');
    setLogs([]);

    try {
      const primaryUrl = await uploadImage(suImageData, 'su-screenshot');

      let referenceUrl: string | undefined;
      if (referenceImageData) {
        referenceUrl = await uploadImage(referenceImageData, 'reference-image');
      }

      const nodeInfoList: RunningHubGenerateOptions['nodeInfoList'] = [
        {
          nodeId: primaryNodeId.trim(),
          fieldName: 'image',
          fieldValue: primaryUrl,
          description: 'SU截图',
        },
      ];

      if (referenceUrl && referenceNodeId.trim()) {
        nodeInfoList.push({
          nodeId: referenceNodeId.trim(),
          fieldName: 'image',
          fieldValue: referenceUrl,
          description: '参考图',
        });
        appendLog({
          timestamp: new Date(),
          level: 'info',
          message: `参考图已添加到节点 ${referenceNodeId.trim()}`,
        });
      } else if (referenceImageData && !referenceNodeId.trim()) {
        appendLog({
          timestamp: new Date(),
          level: 'info',
          message: '已选择参考图，但未指定节点 ID，将作为单图像处理',
        });
      }

      const options: AIProviderOptions = {
        runningHub: {
          webappId: webappId.trim() || undefined,
          webhookUrl: webhookUrl.trim() || undefined,
          nodeInfoList,
        },
      };

      appendLog({
        timestamp: new Date(),
        level: 'info',
        message: `调用 RunningHub 接口...`,
      });

      const response = await generateImageViaAPI({
        prompt,
        aiProvider: 'runninghub',
        model: 'runninghub-su-effect',
        providerOptions: options,
        imageOnly: true,
        outputFormat: 'png',
      });

      setRawResponse(JSON.stringify(response, null, 2));

      if (!response.success || !response.data) {
        const errorMsg = response.error?.message || '调用失败';
        const errorCode = response.error?.code;
        const errorDetails = response.error?.details;

        appendLog({
          timestamp: new Date(),
          level: 'error',
          message: `错误代码: ${errorCode || '未知'}`,
        });

        if (errorDetails) {
          appendLog({
            timestamp: new Date(),
            level: 'error',
            message: `错误详情: ${JSON.stringify(errorDetails)}`,
          });
        }

        throw new Error(errorMsg);
      }

      const imageSrc =
        response.data.imageUrl ||
        response.data.metadata?.imageUrl ||
        response.data.imageData;

      if (imageSrc) {
        setResultImage(imageSrc);
        appendLog({
          timestamp: new Date(),
          level: 'info',
          message: '✅ 生成成功，已获取图像链接。',
        });
      } else {
        appendLog({
          timestamp: new Date(),
          level: 'info',
          message: '⚠️ 生成成功，但响应中没有图像数据/链接。',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      appendLog({
        timestamp: new Date(),
        level: 'error',
        message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* 顶部标题栏 */}
      <header className="border-b border-slate-200 bg-white px-8 py-4 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-800">RunningHub API 调试面板</h1>
        <p className="text-sm text-slate-500">
          SU 截图转效果图接口测试 - 上传截图后自动调用后端 API
        </p>
      </header>

      {/* 主容器：两栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：配置表单（可滚动） */}
        <div className="w-full overflow-y-auto border-r border-slate-200 lg:w-1/2">
          <form className="space-y-6 p-6" onSubmit={handleSubmit}>
            {/* 基础配置 */}
            <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-base font-medium text-slate-700">基础配置</h2>
              <div className="space-y-4">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs font-medium text-slate-500">Webapp ID</span>
                  <input
                    value={webappId}
                    onChange={(e) => setWebappId(e.target.value)}
                    placeholder="配置 VITE_RUNNINGHUB_WEBAPP_ID 环境变量或直接输入"
                    className="rounded-lg border border-slate-200 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                  <span className="text-xs text-slate-400">当前值: {webappId ? webappId.substring(0, 15) + '...' : '(未设置)'}</span>
                </label>
                <label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs font-medium text-slate-500">Webhook URL（可选）</span>
                  <input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="留空则不设置回调"
                    className="rounded-lg border border-slate-200 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-xs font-medium text-slate-500">SU 截图节点 ID</span>
                    <input
                      value={primaryNodeId}
                      onChange={(e) => setPrimaryNodeId(e.target.value)}
                      className="rounded-lg border border-slate-200 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="text-xs font-medium text-slate-500">参考图节点 ID（可选）</span>
                    <input
                      value={referenceNodeId}
                      onChange={(e) => setReferenceNodeId(e.target.value)}
                      className="rounded-lg border border-slate-200 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            </section>

            {/* 输入内容 */}
            <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-base font-medium text-slate-700">输入内容</h2>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-xs font-medium text-slate-500">提示词</span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm">
                  <span className="text-xs font-medium text-slate-500">SU 截图（必选）</span>
                  <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, setSuImageData)} />
                  {suImageData && (
                    <img src={suImageData} alt="SU 截图预览" className="max-h-40 rounded-lg border border-slate-200 object-contain" />
                  )}
                </label>

                <label className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm">
                  <span className="text-xs font-medium text-slate-500">参考图（可选）</span>
                  <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, setReferenceImageData)} />
                  {referenceImageData && (
                    <img src={referenceImageData} alt="参考图预览" className="max-h-40 rounded-lg border border-slate-200 object-contain" />
                  )}
                </label>
              </div>
            </section>

            {/* 提交按钮 */}
            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-lg bg-gray-800 px-6 py-3 text-base font-medium text-white shadow hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? '调用中…' : '🚀 调用 RunningHub'}
              </button>
              {error && <span className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200">{error}</span>}
            </div>

            {/* 调试日志 */}
            <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-base font-medium text-slate-700">调试日志</h2>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-xs text-slate-100">
                {logs.length === 0 ? (
                  <div className="text-slate-400">暂无日志</div>
                ) : (
                  <ul className="space-y-1 font-mono">
                    {logs.map((entry, index) => (
                      <li key={`${entry.timestamp.toISOString()}-${index}`}>
                        <span className="text-slate-500">
                          [{entry.timestamp.toLocaleTimeString('zh-CN', { hour12: false })}]
                        </span>{' '}
                        <span className={entry.level === 'error' ? 'text-red-400' : 'text-emerald-300'}>
                          {entry.level.toUpperCase()}
                        </span>{' '}
                        <span>{entry.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </form>
        </div>

        {/* 右侧：实时结果展示（可滚动） */}
        <div className="hidden w-1/2 overflow-y-auto bg-slate-100 p-6 lg:block">
          <div className="space-y-6">
            {/* 生成结果 */}
            <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-base font-medium text-slate-700">✨ 生成结果</h2>
              {resultImage ? (
                <div className="space-y-4">
                  <img src={resultImage} alt="生成结果" className="w-full rounded-lg border border-slate-200" />
                  <button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = resultImage;
                      a.download = `runninghub-result-${Date.now()}.png`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-green-500"
                  >
                    📥 下载图像
                  </button>
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50">
                  <p className="text-center text-sm text-slate-500">
                    调用 API 后，生成的图像会显示在这里
                  </p>
                </div>
              )}
            </section>

            {/* API 响应 */}
            {rawResponse && (
              <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
                <h2 className="text-base font-medium text-slate-700">📋 API 响应</h2>
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 font-mono">
                  {rawResponse}
                </pre>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunningHubTest;
