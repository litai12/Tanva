/**
 * Google Veo 3.1 视频生成 - 快速使用示例
 *
 * 这个文件展示了如何在你的 Artboard 项目中集成和使用 Veo 3.1 视频生成功能
 */

// ============================================================
// 示例 1：基础使用 - 使用 React 组件
// ============================================================

import React from 'react';
import { VeoVideoGenerator } from '@/components/VeoVideoGenerator';

export function VideoGenerationPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* 简单地添加组件即可 */}
      <VeoVideoGenerator />
    </div>
  );
}

// ============================================================
// 示例 2：集成到 Flow 节点系统
// ============================================================

import { useVideoStore } from '@/stores/videoStore';

// Flow 节点组件
export function VideoGeneratorNode({ nodeId }: { nodeId: string }) {
  const { generateVideo, isLoading, error } = useVideoStore();
  const [prompt, setPrompt] = React.useState('');

  const handleGenerate = async () => {
    const success = await generateVideo({
      prompt,
      duration: 8,
      resolution: '720p'
    });

    if (success) {
      console.log('✅ Flow 节点视频生成成功');
      // 可以在这里触发后续节点
    } else {
      console.error('❌ Flow 节点视频生成失败');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 w-64">
      <h3 className="font-semibold mb-3">🎬 Veo 视频生成</h3>

      <textarea
        placeholder="输入视频描述..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="w-full h-20 px-2 py-1 border rounded mb-3 text-sm"
        disabled={isLoading}
      />

      <button
        onClick={handleGenerate}
        disabled={isLoading || !prompt.trim()}
        className="w-full bg-blue-500 text-white rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? '生成中...' : '🎬 生成'}
      </button>

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}

// ============================================================
// 示例 3：自定义集成 - 控制面板
// ============================================================

import { useVideoStore } from '@/stores/videoStore';
import type { VideoGenerateRequest } from '@/types/video';

export function VideoControlPanel() {
  const {
    generateVideo,
    extendVideo,
    videos,
    isLoading,
    getVideoStatus,
    pollVideoStatus
  } = useVideoStore();

  const [config, setConfig] = React.useState({
    prompt: '',
    duration: 8 as const,
    resolution: '720p' as const
  });

  // 生成视频
  const handleGenerate = async () => {
    const success = await generateVideo(config);
    if (success) {
      alert('✅ 视频生成成功！');
      setConfig({ ...config, prompt: '' });
    }
  };

  // 扩展最新视频
  const handleExtendLatest = async () => {
    if (videos.length === 0) {
      alert('没有视频可扩展');
      return;
    }

    const extended = await extendVideo(videos[0].id, 10, '继续场景...');
    if (extended) {
      alert('✅ 视频扩展成功！');
    }
  };

  // 轮询检查视频状态
  const handlePollStatus = async () => {
    if (videos.length === 0) {
      alert('没有视频');
      return;
    }

    await pollVideoStatus(videos[0].id);
    const status = getVideoStatus(videos[0].id);
    alert(`视频状态: ${status?.status} (进度: ${status?.progress}%)`);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-md">
      <h2 className="text-2xl font-bold mb-4">🎬 视频生成控制</h2>

      {/* 参数配置 */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">视频描述</label>
          <textarea
            value={config.prompt}
            onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
            placeholder="例如：日落时的海滩，海浪拍打沙滩..."
            rows={3}
            className="w-full border rounded px-3 py-2 text-sm"
            disabled={isLoading}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">时长（秒）</label>
          <select
            value={config.duration}
            onChange={(e) => setConfig({ ...config, duration: parseInt(e.target.value) as 4 | 6 | 8 })}
            className="w-full border rounded px-3 py-2"
            disabled={isLoading}
          >
            <option value={4}>4 秒</option>
            <option value={6}>6 秒</option>
            <option value={8}>8 秒（推荐）</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">分辨率</label>
          <select
            value={config.resolution}
            onChange={(e) => setConfig({ ...config, resolution: e.target.value as '720p' | '1080p' })}
            className="w-full border rounded px-3 py-2"
            disabled={isLoading}
          >
            <option value="720p">720p（推荐）</option>
            <option value="1080p">1080p</option>
          </select>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="space-y-2">
        <button
          onClick={handleGenerate}
          disabled={isLoading || !config.prompt.trim()}
          className="w-full bg-blue-500 text-white rounded py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600"
        >
          {isLoading ? '生成中...' : '🎬 生成视频'}
        </button>

        <button
          onClick={handleExtendLatest}
          disabled={isLoading || videos.length === 0}
          className="w-full bg-green-500 text-white rounded py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-600"
        >
          ➕ 扩展最新视频
        </button>

        <button
          onClick={handlePollStatus}
          disabled={isLoading || videos.length === 0}
          className="w-full bg-purple-500 text-white rounded py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-600"
        >
          📊 检查状态
        </button>
      </div>

      {/* 视频列表 */}
      {videos.length > 0 && (
        <div className="mt-6 pt-6 border-t">
          <h3 className="font-semibold mb-3">生成的视频 ({videos.length})</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {videos.map((video) => (
              <div
                key={video.id}
                className="bg-gray-50 rounded p-3 text-sm"
              >
                <p className="font-medium truncate">{video.prompt}</p>
                <p className="text-gray-600 text-xs">
                  ⏱️ {video.duration}s | 📐 {video.resolution} | {video.status}
                </p>
                {video.videoUrl && (
                  <video
                    src={video.videoUrl}
                    controls
                    className="w-full mt-2 rounded bg-black"
                    style={{ maxHeight: '200px' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 示例 4：高级使用 - 直接调用服务
// ============================================================

import { veoVideoService } from '@/services/veoVideoService';

async function advancedExample() {
  try {
    // 1. 生成视频
    console.log('📝 开始生成视频...');
    const generateResult = await veoVideoService.generateVideo({
      prompt: '一只可爱的狗在公园里和主人玩耍，阳光明媚',
      duration: 8,
      resolution: '720p',
      seed: 12345 // 可选：用于可重复生成
    });

    if (!generateResult.success) {
      console.error('❌ 生成失败:', generateResult.error?.message);
      return;
    }

    const videoId = generateResult.data?.id;
    console.log('✅ 视频生成成功，ID:', videoId);

    // 2. 轮询检查状态
    console.log('⏳ 等待视频生成完成...');
    const completed = await veoVideoService.pollVideoStatus(videoId);

    if (!completed) {
      console.error('❌ 视频生成超时');
      return;
    }

    console.log('✅ 视频生成完成');

    // 3. 获取最终状态
    const finalStatus = veoVideoService.getVideoStatus(videoId);
    console.log('📊 最终状态:', finalStatus);

    // 4. 下载或处理视频
    if (finalStatus.resultUrl) {
      console.log('🎬 视频 URL:', finalStatus.resultUrl);

      // 示例：将视频 URL 保存到数据库或其他地方
      // await saveVideoToDB({
      //   id: videoId,
      //   url: finalStatus.resultUrl,
      //   prompt: generateResult.data?.prompt
      // });
    }

    // 5. 可选：扩展视频
    console.log('➕ 扩展视频...');
    const extendResult = await veoVideoService.extendVideo({
      sourceVideoId: videoId,
      extensionSeconds: 10,
      extensionPrompt: '继续狗和主人在公园里的场景，更多互动'
    });

    if (extendResult.success) {
      console.log('✅ 视频扩展成功');
    }

  } catch (error) {
    console.error('❌ 发生错误:', error);
  }
}

// ============================================================
// 示例 5：错误处理和重试
// ============================================================

async function robustGeneration(prompt: string, retries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 尝试 ${attempt}/${retries}...`);

      const result = await veoVideoService.generateVideo({
        prompt,
        duration: 8,
        resolution: '720p'
      });

      if (result.success) {
        console.log('✅ 成功');
        return result.data;
      } else {
        lastError = result.error?.message;
        console.warn(`⚠️ 失败: ${lastError}`);

        // 特殊错误处理
        if (lastError?.includes('BILLING_REQUIRED')) {
          console.error('❌ 需要付费账户，无法重试');
          break;
        }

        if (lastError?.includes('INVALID_API_KEY')) {
          console.error('❌ API Key 无效，无法重试');
          break;
        }
      }

      // 等待后重试
      if (attempt < retries) {
        const delay = 2000 * attempt; // 指数退避
        console.log(`⏳ ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`❌ 异常: ${lastError}`);

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  throw new Error(`所有 ${retries} 次尝试都失败: ${lastError}`);
}

// 使用示例
robustGeneration('一个美丽的日落场景')
  .then(video => console.log('✅ 最终成功:', video))
  .catch(error => console.error('❌ 最终失败:', error));

// ============================================================
// 导出所有示例
// ============================================================

export { VideoGenerationPage, VideoGeneratorNode, VideoControlPanel };
