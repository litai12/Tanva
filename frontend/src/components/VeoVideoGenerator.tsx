import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Download, Play, Trash2, Loader } from 'lucide-react';
import { useVideoStore } from '@/stores/videoStore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { VideoGenerateRequest } from '@/types/video';

/**
 * Veo 3.1 视频生成组件
 */
export const VeoVideoGenerator: React.FC = () => {
  const {
    videos,
    isLoading,
    error,
    generateVideo,
    removeVideo,
    clearError,
    getVideoStatus,
    pollVideoStatus
  } = useVideoStore();

  // 表单状态
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<4 | 6 | 8>(8);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [autoPolling, setAutoPolling] = useState(false);

  // 处理视频生成
  const handleGenerateVideo = async () => {
    if (!prompt.trim()) {
      alert('请输入视频描述');
      return;
    }

    const request: VideoGenerateRequest = {
      prompt: prompt.trim(),
      duration,
      resolution
    };

    const success = await generateVideo(request);

    if (success) {
      setPrompt('');
      // 自动轮询状态
      setAutoPolling(true);
    }
  };

  // 处理视频扩展
  const handleExtendVideo = async (videoId: string) => {
    const result = window.prompt('输入要扩展的秒数（1-140）:');
    if (!result) return;

    const extendSeconds = parseInt(result);
    if (isNaN(extendSeconds) || extendSeconds < 1 || extendSeconds > 140) {
      alert('请输入有效的秒数（1-140）');
      return;
    }

    // 这里调用扩展视频的方法
    console.log('扩展视频:', videoId, '+', extendSeconds, '秒');
  };

  // 处理视频下载
  const handleDownloadVideo = (videoUrl: string, videoId: string) => {
    if (videoUrl.startsWith('data:')) {
      // Base64 数据
      const link = document.createElement('a');
      link.href = videoUrl;
      link.download = `video-${videoId}.mp4`;
      link.click();
    } else {
      // URL 地址
      window.open(videoUrl, '_blank');
    }
  };

  // 定期轮询视频状态
  useEffect(() => {
    if (!autoPolling || videos.length === 0) return;

    const interval = setInterval(() => {
      const lastVideo = videos[0];
      if (lastVideo && lastVideo.status === 'processing') {
        pollVideoStatus(lastVideo.id);
      } else {
        setAutoPolling(false);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [autoPolling, videos, pollVideoStatus]);

  return (
    <div className="w-full space-y-6 p-6">
      {/* 标题 */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">🎬 Veo 3.1 视频生成</h2>
        <p className="text-muted-foreground mt-2">使用 Google Gemini 生成高质量视频</p>
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearError}
            >
              关闭
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 生成表单 */}
      <Card>
        <CardHeader>
          <CardTitle>生成视频</CardTitle>
          <CardDescription>输入视频描述和参数来生成新视频</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 提示词输入 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">视频描述</label>
            <textarea
              placeholder="例如：一个猫在公园里散步，阳光明媚，树木摇曳..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isLoading}
              rows={4}
              className="w-full px-3 py-2 border border-input rounded-md text-sm"
            />
            <p className="text-xs text-muted-foreground">
              提示：详细的描述会获得更好的结果。包括场景、动作、风格等信息。
            </p>
          </div>

          {/* 参数配置 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 时长选择 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">视频时长</label>
              <select
                value={duration}
                onChange={(event) => setDuration(parseInt(event.target.value, 10) as 4 | 6 | 8)}
                disabled={isLoading}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value={4}>4 秒</option>
                <option value={6}>6 秒</option>
                <option value={8}>8 秒（推荐）</option>
              </select>
              <p className="text-xs text-muted-foreground">
                可通过"扩展"功能扩展至 148 秒
              </p>
            </div>

            {/* 分辨率选择 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">分辨率</label>
              <select
                value={resolution}
                onChange={(event) => setResolution(event.target.value as '720p' | '1080p')}
                disabled={isLoading}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="720p">720p（推荐）</option>
                <option value="1080p">1080p</option>
              </select>
              <p className="text-xs text-muted-foreground">
                1080p 会增加生成时间
              </p>
            </div>
          </div>

          {/* 生成按钮 */}
          <Button
            onClick={handleGenerateVideo}
            disabled={isLoading || !prompt.trim()}
            className="w-full"
            size="lg"
          >
            {isLoading && <Loader className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? '生成中...' : '🎬 生成视频'}
          </Button>
        </CardContent>
      </Card>

      {/* 视频列表 */}
      {videos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>生成的视频</CardTitle>
            <CardDescription>{videos.length} 个视频</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {videos.map((video) => (
              <div
                key={video.id}
                className="flex items-center gap-4 p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
              >
                {/* 视频预览 */}
                {video.videoUrl && (
                  <div className="flex-shrink-0">
                    {video.videoUrl.startsWith('data:') ? (
                      <video
                        src={video.videoUrl}
                        className="w-24 h-24 rounded object-cover bg-muted"
                        controls
                      />
                    ) : (
                      <video
                        src={video.videoUrl}
                        className="w-24 h-24 rounded object-cover bg-muted"
                        controls
                      />
                    )}
                  </div>
                )}

                {/* 视频信息 */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{video.prompt}</p>
                  <div className="text-sm text-muted-foreground space-y-1 mt-2">
                    <p>
                      ⏱️ 时长: {video.duration}秒 | 📐 分辨率: {video.resolution}
                    </p>
                    <p>
                      {video.status === 'completed' && '✅ 已完成'}
                      {video.status === 'processing' && '⏳ 处理中...'}
                      {video.status === 'failed' && '❌ 失败'}
                      {video.status === 'pending' && '⏳ 待处理'}
                    </p>
                    <p className="text-xs">
                      📅 {new Date(video.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex-shrink-0 flex gap-2">
                  {video.status === 'completed' && video.videoUrl && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExtendVideo(video.id)}
                        title="扩展视频时长"
                      >
                        ➕ 扩展
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownloadVideo(video.videoUrl, video.id)}
                        title="下载视频"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeVideo(video.id)}
                    title="删除视频"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 空状态 */}
      {videos.length === 0 && !isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <Play className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <p className="text-muted-foreground">还没有生成任何视频</p>
              <p className="text-sm text-muted-foreground mt-1">填写表单并点击"生成视频"开始</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 使用提示 */}
      <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="text-blue-900 dark:text-blue-100">💡 使用提示</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
          <p>• <strong>提示词质量</strong>：详细的描述会产生更好的结果</p>
          <p>• <strong>时长选择</strong>：8 秒是默认选择，可通过扩展功能增加</p>
          <p>• <strong>分辨率</strong>：720p 推荐用于快速生成，1080p 适合最终输出</p>
          <p>• <strong>API 配额</strong>：Veo 3.1 是付费 API，请检查 Google Cloud 账户余额</p>
          <p>• <strong>生成时间</strong>：视频生成通常需要 1-3 分钟</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default VeoVideoGenerator;
