import { resolvePublicAssetUrlFromKey } from '@/utils/assetProxy'

const REMOTE_PREFIX = 'director-assets/v1/open-source'
const LOCAL_PREFIX = '/director/open-source'

export function directorOpenSourceAssetUrl(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '')
  return resolvePublicAssetUrlFromKey(`${REMOTE_PREFIX}/${normalized}`)
    ?? `${LOCAL_PREFIX}/${normalized}`
}
