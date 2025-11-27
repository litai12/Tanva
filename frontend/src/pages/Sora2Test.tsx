import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import sora2Service from '@/services/sora2Service';
import { SORA2_VIDEO_MODELS, DEFAULT_SORA2_VIDEO_QUALITY, type Sora2VideoQuality } from '@/stores/aiChatStore';

interface VideoGenerationState {
  isLoading: boolean;
  isStreaming: boolean;
  streamContent: string;
  videoUrl?: string;
  error?: string;
  successMessage?: string;
}

const Sora2TestPage: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [state, setState] = useState<VideoGenerationState>({
    isLoading: false,
    isStreaming: false,
    streamContent: '',
  });
  const [useStream, setUseStream] = useState<boolean>(true);
  const [videoQuality, setVideoQuality] = useState<Sora2VideoQuality>(DEFAULT_SORA2_VIDEO_QUALITY);
  const modelName = SORA2_VIDEO_MODELS[videoQuality];
  const streamContentRef = useRef<HTMLDivElement>(null);

  // 初始化 API Key
  useEffect(() => {
    if (apiKey.trim()) {
      sora2Service.setApiKey(apiKey);
    }
  }, [apiKey]);

  // 自动滚动到最新内容
  useEffect(() => {
    if (streamContentRef.current) {
      streamContentRef.current.scrollTop = streamContentRef.current.scrollHeight;
    }
  }, [state.streamContent]);

  const handleGenerateVideo = async () => {
    if (!apiKey.trim()) {
      setState((prev) => ({
        ...prev,
        error: 'Please enter your API key',
      }));
      return;
    }

    if (!prompt.trim()) {
      setState((prev) => ({
        ...prev,
        error: 'Please enter a prompt',
      }));
      return;
    }

    setState({
      isLoading: true,
      isStreaming: useStream,
      streamContent: '',
      error: undefined,
      successMessage: undefined,
    });

    try {
      if (useStream) {
        // 流式生成
        const result = await sora2Service.generateVideoStream(
          prompt,
          imageUrl || undefined,
          (chunk) => {
            setState((prev) => ({
              ...prev,
              streamContent: prev.streamContent + chunk,
            }));
          },
          modelName
        );

        if (!result.success) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isStreaming: false,
            error: result.error?.message,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isStreaming: false,
            successMessage: 'Video generation completed!',
            streamContent: result.data?.fullContent || '',
          }));
        }
      } else {
        // 非流式生成
        const result = await sora2Service.generateVideo(
          prompt,
          imageUrl || undefined,
          modelName
        );

        if (!result.success) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: result.error?.message,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            streamContent: result.data || '',
            successMessage: 'Video generation completed!',
          }));
        }
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
    }
  };

  const handleClearContent = () => {
    setState((prev) => ({
      ...prev,
      streamContent: '',
      error: undefined,
      successMessage: undefined,
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Sora2 Video Generator Test</h1>
          <p className="text-gray-600">
            Test Sora2 video generation API with streaming support via Banana147
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Left Column - Configuration */}
          <div className="col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>Set up your API credentials</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* API Key Input */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">API Key</label>
                  <Input
                    type="password"
                    placeholder="sk-ERFNrFQL..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-sm"
                  />
                  {apiKey && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <span>✓</span> API Key loaded
                    </p>
                  )}
                </div>

                {/* Stream Mode Toggle */}
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useStream}
                      onChange={(e) => setUseStream(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-700">Use Streaming</span>
                  </label>
                  <p className="text-xs text-gray-500">
                    {useStream
                      ? 'Streaming: Real-time response chunks'
                      : 'Non-streaming: Wait for complete response'}
                  </p>
                </div>

                {/* Video Quality Toggle */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">Video Quality</label>
                  <div className="flex gap-2">
                    {(['hd', 'sd'] as Sora2VideoQuality[]).map((quality) => {
                      const isActive = videoQuality === quality;
                      return (
                        <button
                          key={quality}
                          type="button"
                          onClick={() => setVideoQuality(quality)}
                          className={`flex-1 py-2 rounded-md border text-sm font-medium transition ${
                            isActive
                              ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                          }`}
                        >
                          {quality === 'hd' ? 'HD' : 'SD'}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500">Model: {modelName}</p>
                </div>
              </CardContent>
            </Card>

            {/* Stats Card */}
            <Card>
              <CardHeader>
                <CardTitle>Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-600">Response Length:</span>
                  <span className="ml-2 font-mono font-bold">{state.streamContent.length}</span>
                </div>
                <div>
                  <span className="text-gray-600">Status:</span>
                  <span className="ml-2">
                    {state.isLoading ? (
                      <span className="text-yellow-600 font-semibold">Processing...</span>
                    ) : state.streamContent ? (
                      <span className="text-green-600 font-semibold">Ready</span>
                    ) : (
                      <span className="text-gray-500">Idle</span>
                    )}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Input and Output */}
          <div className="col-span-2 space-y-4">
            {/* Prompt Input Card */}
            <Card>
              <CardHeader>
                <CardTitle>Prompt Input</CardTitle>
                <CardDescription>Describe the video you want to generate</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">Video Prompt</label>
                  <textarea
                    placeholder="e.g., 一只狗在图片出场景中跑步 / A dog running in a scenic outdoor area"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full h-24 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500">
                    You can add aspect ratio hints: 横屏, 竖屏, 16:9, 9:16, etc.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">Reference Image URL (Optional)</label>
                  <Input
                    placeholder="https://example.com/image.jpg"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                <Button
                  onClick={handleGenerateVideo}
                  disabled={state.isLoading || !apiKey.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2"
                >
                  {state.isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">⏳</span>
                      {useStream ? 'Generating...' : 'Generating...'}
                    </span>
                  ) : (
                    '🎬 Generate Video'
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Response Output Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Response</CardTitle>
                  <CardDescription>API response content</CardDescription>
                </div>
                {state.streamContent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearContent}
                  >
                    Clear
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {/* Error Message */}
                {state.error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800">
                      <span className="font-semibold">Error:</span> {state.error}
                    </p>
                  </div>
                )}

                {/* Success Message */}
                {state.successMessage && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">
                      <span className="font-semibold">✓</span> {state.successMessage}
                    </p>
                  </div>
                )}

                {/* Response Content */}
                {state.streamContent && (
                  <div
                    ref={streamContentRef}
                    className="w-full h-96 p-4 bg-gray-900 text-gray-100 rounded-lg font-mono text-sm overflow-y-auto border border-gray-700"
                  >
                    <pre className="whitespace-pre-wrap break-words">{state.streamContent}</pre>
                  </div>
                )}

                {!state.streamContent && !state.error && (
                  <div className="h-96 flex items-center justify-center bg-gray-100 rounded-lg border border-gray-300">
                    <p className="text-gray-500 text-center">
                      {state.isLoading ? '⏳ Waiting for response...' : '📝 No response yet'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Info Section */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>API Information</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-700 space-y-2">
            <p>
              <strong>Endpoint:</strong> <code className="bg-gray-100 px-2 py-1 rounded">https://api.openai.banana147.com/v1/chat/completions</code>
            </p>
            <p>
              <strong>Model:</strong> <code className="bg-gray-100 px-2 py-1 rounded">sora-2</code>
            </p>
            <p>
              <strong>Authentication:</strong> Bearer Token in Authorization header
            </p>
            <p className="text-gray-600">
              Supports streaming responses and optional reference images for video generation.
              Add aspect ratio hints to your prompt for better control.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Sora2TestPage;
