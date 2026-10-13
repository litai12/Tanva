import { authApi } from '@/services/authApi';
import { ossUploadService } from '@/services/ossUploadService';
import { ensureAvatarImageRenderable } from '@/utils/avatarImage';

export async function uploadUserAvatar(file: File) {
  const result = await ossUploadService.uploadToOSS(file, {
    dir: 'uploads/avatars/',
    contentType: file.type,
    fileName: file.name,
  });
  const avatarUrl = result.url?.trim();
  if (!result.success || !avatarUrl) throw new Error(result.error || '头像上传失败');
  await ensureAvatarImageRenderable(avatarUrl);
  return authApi.updateProfile({ avatarUrl });
}
