import { mobileChatApi } from './mobileChatApi';

export type MobileCollection = 'works' | 'materials';
export type MobileMediaLabel = '图片' | '详情页长图' | '详情图分页' | '视频素材图片' | '视频分镜' | '视频成片';
export type MobileImageWork = {
  id: string;
  type: 'image';
  label: MobileMediaLabel;
  title: string;
  createdAt: string;
  taskId: string | null;
  url?: string;
  tall?: boolean;
  error?: string;
};
export type MobileWork = MobileImageWork | {
  id: string;
  type: 'video';
  label: MobileMediaLabel;
  title: string;
  createdAt: string;
  url: string;
};

/** 从历史会话与视频任务读取成品或过程素材。 */
export async function loadMobileWorks(collection: MobileCollection = 'works'): Promise<{ works: MobileWork[]; warning: string }> {
  const [videos, conversations] = await Promise.allSettled([mobileChatApi.jobs(), mobileChatApi.list()]);
  const name = collection === 'works' ? '作品' : '素材';
  if (videos.status === 'rejected' && conversations.status === 'rejected') throw new Error(`加载${name}失败，请稍后重试`);
  const works: MobileWork[] = [];
  const jobIds = new Set<string>();
  let incomplete = videos.status === 'rejected' || conversations.status === 'rejected';
  if (videos.status === 'fulfilled') {
    for (const job of videos.value) {
      jobIds.add(job.jobId);
      if (collection === 'works' && job.stage === 'succeeded' && job.finalVideoUrl && job.kind !== 'single') {
        works.push({ id: `video:${job.jobId}`, type: 'video', label: '视频成片', title: job.prompt || (job.kind === 'remake' ? '复刻视频' : '一键成片'), createdAt: job.createdAt, url: job.finalVideoUrl });
      }
    }
  }
  if (conversations.status === 'fulfilled') {
    // 限制历史记录读取并发，避免一次发出大量请求。
    for (let offset = 0; offset < conversations.value.length; offset += 4) {
      const results = await Promise.allSettled(conversations.value.slice(offset, offset + 4).map((c) => mobileChatApi.get(c.id)));
      for (const result of results) {
        if (result.status === 'rejected') { incomplete = true; continue; }
        for (const message of result.value.messages) {
          if (message.role !== 'assistant') continue;
          if (message.kind === 'job' && message.jobId) jobIds.add(message.jobId);
          if (collection === 'materials' && message.kind === 'image' && message.jobId) {
            works.push({ id: `image:${message.id}`, type: 'image', label: '图片', title: message.content || '生成图片', createdAt: message.createdAt, taskId: message.jobId });
          }
          if (message.kind !== 'image_set' || !message.imageSet) continue;
          const meta = message.imageSet;
          if (collection === 'works' && meta.longImageUrl) {
            works.push({ id: `detail:${message.id}`, type: 'image', label: '详情页长图', title: meta.title || '详情图', createdAt: message.createdAt, taskId: null, url: meta.longImageUrl, tall: true });
          }
          if (collection === 'materials') {
            meta.sections.forEach((section, index) => works.push({
              id: `detail:${message.id}:${index}`, type: 'image', label: '详情图分页', title: `${meta.title || '详情图'} · ${section.title || `第 ${index + 1} 屏`}`,
              createdAt: message.createdAt, taskId: section.taskId, error: section.error,
            }));
          }
        }
      }
    }
  }
  // 素材详情包含角色 / 道具 / 场景图和分镜，包含尚未完成或失败任务已产出的素材。
  // 作品页仅补读列表未返回、但历史对话仍有引用的任务。
  const details = collection === 'materials' || videos.status === 'rejected'
    ? [...jobIds]
    : [...jobIds].filter((id) => !videos.value.some((job) => job.jobId === id));
  for (let offset = 0; offset < details.length; offset += 4) {
    const results = await Promise.allSettled(details.slice(offset, offset + 4).map((id) => mobileChatApi.job(id)));
    for (const result of results) {
      if (result.status === 'rejected') { incomplete = true; continue; }
      const job = result.value;
      if (collection === 'works') {
        if (job.stage === 'succeeded' && job.finalVideoUrl && job.mode !== 'single') {
          works.push({ id: `video:${job.jobId}`, type: 'video', label: '视频成片', title: job.mode === 'remake' ? '复刻视频' : '一键成片', createdAt: job.createdAt, url: job.finalVideoUrl });
        }
        continue;
      }
      for (const image of job.images ?? []) {
        if (!image.imageUrl) continue;
        works.push({ id: `video-image:${job.jobId}:${image.key}`, type: 'image', label: '视频素材图片', title: image.title || image.key, createdAt: job.createdAt, taskId: null, url: image.imageUrl });
      }
      for (const clip of job.storyboard ?? []) {
        if (!clip.videoUrl) continue;
        works.push({ id: `video-clip:${job.jobId}:${clip.key}`, type: 'video', label: '视频分镜', title: clip.title || `分镜 ${clip.index}`, createdAt: job.createdAt, url: clip.videoUrl });
      }
    }
  }
  works.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.id.localeCompare(b.id));
  return { works, warning: incomplete ? `部分${name}加载失败，请重试加载` : '' };
}
