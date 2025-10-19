import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { veoVideoService } from '@/services/veoVideoService';
import type {
  VideoGenerateRequest,
  VideoGenerationResult,
  VideoGenerationStatus,
  VideoListItem,
  VideoProgressEvent
} from '@/types/video';

interface VideoState {
  // 视频列表
  videos: VideoGenerationResult[];

  // 当前生成中的视频
  currentGeneratingVideoId: string | null;

  // 视频状态映射
  videoStatuses: Map<string, VideoGenerationStatus>;

  // 生成进度事件
  progressEvents: VideoProgressEvent[];

  // 错误信息
  error: string | null;

  // 加载状态
  isLoading: boolean;

  // 操作方法
  generateVideo: (request: VideoGenerateRequest) => Promise<boolean>;
  extendVideo: (sourceVideoId: string, extensionSeconds: number, extensionPrompt?: string) => Promise<boolean>;
  getVideoStatus: (videoId: string) => VideoGenerationStatus | null;
  pollVideoStatus: (videoId: string) => Promise<void>;
  addVideo: (video: VideoGenerationResult) => void;
  removeVideo: (videoId: string) => void;
  clearVideos: () => void;
  addProgressEvent: (event: VideoProgressEvent) => void;
  clearError: () => void;
  setLoading: (loading: boolean) => void;
}

export const useVideoStore = create<VideoState>()(
  devtools(
    persist(
      (set, get) => ({
        videos: [],
        currentGeneratingVideoId: null,
        videoStatuses: new Map(),
        progressEvents: [],
        error: null,
        isLoading: false,

        generateVideo: async (request: VideoGenerateRequest) => {
          set({ isLoading: true, error: null });

          try {
            console.log('🎬 发起视频生成请求:', request.prompt.substring(0, 50) + '...');

            const result = await veoVideoService.generateVideo(request);

            if (result.success && result.data) {
              console.log('✅ 视频生成成功:', result.data.id);

              // 添加视频到列表
              set((state) => ({
                videos: [result.data, ...state.videos],
                currentGeneratingVideoId: result.data.id,
                videoStatuses: new Map(state.videoStatuses).set(result.data.id, {
                  videoId: result.data.id,
                  status: 'completed',
                  progress: 100,
                  resultUrl: result.data.videoUrl,
                  createdAt: result.data.createdAt
                })
              }));

              // 添加进度事件
              get().addProgressEvent({
                videoId: result.data.id,
                phase: 'completed',
                progress: 100,
                message: '视频生成完成!',
                timestamp: Date.now()
              });

              return true;
            } else {
              const errorMsg = result.error?.message || '未知错误';
              console.error('❌ 视频生成失败:', errorMsg);
              set({ error: errorMsg });
              return false;
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : '视频生成异常';
            console.error('❌ 异常:', errorMsg);
            set({ error: errorMsg });
            return false;
          } finally {
            set({ isLoading: false });
          }
        },

        extendVideo: async (sourceVideoId: string, extensionSeconds: number, extensionPrompt?: string) => {
          set({ isLoading: true, error: null });

          try {
            console.log('🎬 扩展视频:', sourceVideoId, '+', extensionSeconds, '秒');

            const result = await veoVideoService.extendVideo({
              sourceVideoId,
              extensionSeconds,
              extensionPrompt
            });

            if (result.success && result.data) {
              console.log('✅ 视频扩展成功:', result.data.id);

              set((state) => ({
                videos: [result.data, ...state.videos],
                videoStatuses: new Map(state.videoStatuses).set(result.data.id, {
                  videoId: result.data.id,
                  status: 'completed',
                  progress: 100,
                  resultUrl: result.data.videoUrl,
                  createdAt: result.data.createdAt
                })
              }));

              get().addProgressEvent({
                videoId: result.data.id,
                phase: 'completed',
                progress: 100,
                message: '视频扩展完成!',
                timestamp: Date.now()
              });

              return true;
            } else {
              const errorMsg = result.error?.message || '扩展失败';
              set({ error: errorMsg });
              return false;
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : '扩展异常';
            set({ error: errorMsg });
            return false;
          } finally {
            set({ isLoading: false });
          }
        },

        getVideoStatus: (videoId: string) => {
          const status = veoVideoService.getVideoStatus(videoId);

          set((state) => ({
            videoStatuses: new Map(state.videoStatuses).set(videoId, status)
          }));

          return status;
        },

        pollVideoStatus: async (videoId: string) => {
          console.log('⏳ 开始轮询视频状态:', videoId);

          const success = await veoVideoService.pollVideoStatus(videoId);

          if (success) {
            const status = veoVideoService.getVideoStatus(videoId);
            set((state) => ({
              videoStatuses: new Map(state.videoStatuses).set(videoId, status)
            }));

            get().addProgressEvent({
              videoId,
              phase: 'completed',
              progress: 100,
              message: '视频生成完成!',
              timestamp: Date.now()
            });
          } else {
            set({ error: '视频生成超时或失败' });
          }
        },

        addVideo: (video: VideoGenerationResult) => {
          set((state) => ({
            videos: [video, ...state.videos],
            videoStatuses: new Map(state.videoStatuses).set(video.id, {
              videoId: video.id,
              status: video.status,
              progress: video.status === 'completed' ? 100 : 50,
              resultUrl: video.videoUrl,
              createdAt: video.createdAt
            })
          }));
        },

        removeVideo: (videoId: string) => {
          set((state) => {
            const newStatuses = new Map(state.videoStatuses);
            newStatuses.delete(videoId);

            return {
              videos: state.videos.filter(v => v.id !== videoId),
              videoStatuses: newStatuses
            };
          });
        },

        clearVideos: () => {
          set({
            videos: [],
            videoStatuses: new Map(),
            currentGeneratingVideoId: null
          });
        },

        addProgressEvent: (event: VideoProgressEvent) => {
          set((state) => ({
            progressEvents: [event, ...state.progressEvents].slice(0, 100) // 最多保留100条事件
          }));
        },

        clearError: () => {
          set({ error: null });
        },

        setLoading: (loading: boolean) => {
          set({ isLoading: loading });
        }
      }),
      {
        name: 'video-store' // 存储名称
      }
    )
  )
);
