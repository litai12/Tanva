import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { getPendingImageCount, subscribePendingImageCount } from '@/utils/globalImageLoadTracker';

const FADE_OUT_MS = 200;
const MIN_SHOW_MS = 350;
const QUIET_WINDOW_MS = 200;
const MAX_WAIT_MS = 15000;

export default function InitialLoadingOverlay() {
  const authLoading = useAuthStore((s) => s.loading);
  const projectLoading = useProjectStore((s) => s.loading);
  const [pendingImages, setPendingImages] = useState(() => getPendingImageCount());
  const [shouldRender, setShouldRender] = useState(true);
  const [visible, setVisible] = useState(true);
  const didHideRef = useRef(false);
  const startedAtRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const quietTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return subscribePendingImageCount(setPendingImages);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!shouldRender || didHideRef.current) return undefined;

    const readyToHide = !authLoading && !projectLoading && pendingImages === 0;

    if (!readyToHide) {
      if (quietTimerRef.current) window.clearTimeout(quietTimerRef.current);
      quietTimerRef.current = null;
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      if (!visible) setVisible(true);
      return undefined;
    }

    if (quietTimerRef.current) window.clearTimeout(quietTimerRef.current);
    quietTimerRef.current = window.setTimeout(() => {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAtRef.current;
      const wait = Math.max(0, MIN_SHOW_MS - elapsed);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        if (didHideRef.current) return;
        didHideRef.current = true;
        setVisible(false);
        window.setTimeout(() => setShouldRender(false), FADE_OUT_MS);
      }, wait);
    }, QUIET_WINDOW_MS);

    return () => {
      if (quietTimerRef.current) window.clearTimeout(quietTimerRef.current);
      quietTimerRef.current = null;
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };
  }, [authLoading, pendingImages, projectLoading, shouldRender, visible]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const timeoutId = window.setTimeout(() => {
      if (didHideRef.current) return;
      didHideRef.current = true;
      setVisible(false);
      window.setTimeout(() => setShouldRender(false), FADE_OUT_MS);
    }, MAX_WAIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!shouldRender) return null;

  return (
    <div
      className={[
        'fixed inset-0 z-[2147483647] flex items-center justify-center bg-white/45 backdrop-blur-lg backdrop-saturate-150 transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      ].join(' ')}
    >
      <div className="h-10 w-10 rounded-full border-4 border-black/15 border-t-black/70 animate-spin" />
    </div>
  );
}
