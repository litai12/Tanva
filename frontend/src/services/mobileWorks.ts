import { mobileChatApi, type VideoJobSummary } from './mobileChatApi';

export type MobileImageWork = {
  id: string;
  type: 'image';
  title: string;
  createdAt: string;
  taskId: string | null;
  url?: string;
  tall?: boolean;
  error?: string;
};
export type MobileWork = MobileImageWork | { id: string; type: 'video'; createdAt: string; job: VideoJobSummary };

/** 从现有会话读取生图与详情页，兼容已有消息，无需重新生成作品。 */
export async function loadMobileWorks(): Promise<{ works: MobileWork[]; warning: string }> {
  const [videos, conversations] = await Promise.allSettled([mobileChatApi.jobs(), mobileChatApi.list()]);
  if (videos.status === 'rejected' && conversations.status === 'rejected') throw new Error('加载作品失败，请稍后重试');
  const works: MobileWork[] = videos.status === 'fulfilled'
    ? videos.value.map((job) => ({ id: `video:${job.jobId}`, type: 'video', createdAt: job.createdAt, job }))
    : [];
  let incomplete = videos.status === 'rejected' || conversations.status === 'rejected';
  if (conversations.status === 'fulfilled') {
    // 限制会话读取并发，避免作品较多时瞬间发出大量请求。
    for (let offset = 0; offset < conversations.value.length; offset += 4) {
      const results = await Promise.allSettled(conversations.value.slice(offset, offset + 4).map((c) => mobileChatApi.get(c.id)));
      for (const result of results) {
        if (result.status === 'rejected') { incomplete = true; continue; }
        for (const message of result.value.messages) {
          if (message.role !== 'assistant') continue;
          if (message.kind === 'image' && message.jobId) {
            works.push({ id: `image:${message.id}`, type: 'image', title: message.content || '生成图片', createdAt: message.createdAt, taskId: message.jobId });
          }
          if (message.kind !== 'image_set' || !message.imageSet) continue;
          const meta = message.imageSet;
          if (meta.longImageUrl) {
            works.push({ id: `detail:${message.id}`, type: 'image', title: meta.title || '详情图', createdAt: message.createdAt, taskId: null, url: meta.longImageUrl, tall: true });
          } else {
            meta.sections.forEach((section, index) => works.push({
              id: `detail:${message.id}:${index}`, type: 'image', title: `${meta.title || '详情图'} · ${section.title || `第 ${index + 1} 屏`}`,
              createdAt: message.createdAt, taskId: section.taskId, error: section.error,
            }));
          }
        }
      }
    }
  }
  works.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.id.localeCompare(b.id));
  return { works, warning: incomplete ? '部分作品加载失败，请重试加载' : '' };
}
