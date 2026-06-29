export const DEFAULT_AVATAR_COLORS = [
  { bg: '#fee2e2', text: '#b91c1c' },
  { bg: '#ffedd5', text: '#c2410c' },
  { bg: '#fef3c7', text: '#b45309' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#e0e7ff', text: '#4338ca' },
  { bg: '#f3e8ff', text: '#7e22ce' },
  { bg: '#fce7f3', text: '#be185d' },
];

export function getDefaultAvatarColor(seed?: string | null) {
  const source = (seed || 'user').trim() || 'user';
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return DEFAULT_AVATAR_COLORS[hash % DEFAULT_AVATAR_COLORS.length];
}

export function getDefaultAvatarInitial(name?: string | null, fallback?: string | null): string {
  const source = (name || fallback || '').trim();
  if (!source) return 'U';
  return source.slice(0, 1).toUpperCase();
}
