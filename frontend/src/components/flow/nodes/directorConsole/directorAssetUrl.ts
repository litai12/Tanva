import { resolvePublicAssetUrlFromKey } from '@/utils/assetProxy'

const REMOTE_PREFIX = 'director-assets/v1'
const DEFAULT_REMOTE_BASE_URL = 'https://tanvas-ai.tos-cn-guangzhou.volces.com/director-assets/v1'

export function directorAssetUrl(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '')
  return resolvePublicAssetUrlFromKey(`${REMOTE_PREFIX}/${normalized}`)
    ?? `${DEFAULT_REMOTE_BASE_URL}/${normalized}`
}

export function directorOpenSourceAssetUrl(relativePath: string): string {
  return directorAssetUrl(`open-source/${relativePath}`)
}
