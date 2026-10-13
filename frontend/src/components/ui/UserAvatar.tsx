import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useNonBase64ImageSrc } from '@/hooks/useNonBase64ImageSrc';
import { getDefaultAvatarColor, getDefaultAvatarInitial } from '@/utils/defaultAvatar';
import { resolveAvatarFallback } from '@/utils/avatarImage';

type UserAvatarProps = {
  name: string;
  userId?: string;
  src?: string | null;
  className?: string;
};

// Keying the image state by source clears failures when a new avatar is saved.
function AvatarImage({ src, name }: { src: string; name: string }) {
  const directSrc = useNonBase64ImageSrc(src);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const handleError = async () => {
    if (fallbackSrc) {
      setFailed(true);
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setFailed(true);
    const resolved = await resolveAvatarFallback(src).catch(() => null);
    if (!mounted.current) {
      if (resolved) URL.revokeObjectURL(resolved);
      return;
    }
    objectUrl.current = resolved;
    setFallbackSrc(resolved);
    setFailed(!resolved);
  };

  if (failed || !(fallbackSrc || directSrc)) return <>{getDefaultAvatarInitial(name)}</>;
  return (
    <img
      src={fallbackSrc || directSrc || undefined}
      alt={name}
      className="h-full w-full object-cover"
      onError={() => { void handleError(); }}
    />
  );
}

export default function UserAvatar({ src, name, userId, className }: UserAvatarProps) {
  const color = getDefaultAvatarColor(userId || name);
  const normalized = src?.trim();
  return (
    <div
      className={cn('overflow-hidden rounded-full flex items-center justify-center font-medium shrink-0', className)}
      style={{ backgroundColor: color.bg, color: color.text }}
      role="img"
      aria-label={name}
    >
      {normalized ? <AvatarImage key={normalized} src={normalized} name={name} /> : getDefaultAvatarInitial(name)}
    </div>
  );
}
