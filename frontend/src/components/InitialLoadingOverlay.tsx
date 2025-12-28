import { useEffect, useRef, useState } from 'react';

const FADE_OUT_MS = 200;
const MAX_WAIT_MS = 15000;

export default function InitialLoadingOverlay() {
  const [shouldRender, setShouldRender] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.readyState !== 'complete';
  });
  const [visible, setVisible] = useState(shouldRender);
  const didHideRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.readyState === 'complete') {
      setVisible(false);
      setShouldRender(false);
      return;
    }

    const hide = () => {
      if (didHideRef.current) return;
      didHideRef.current = true;
      setVisible(false);
      window.setTimeout(() => setShouldRender(false), FADE_OUT_MS);
    };

    window.addEventListener('load', hide, { once: true });
    const timeoutId = window.setTimeout(hide, MAX_WAIT_MS);
    return () => {
      window.removeEventListener('load', hide);
      window.clearTimeout(timeoutId);
    };
  }, []);

  if (!shouldRender) return null;

  return (
    <div
      className={[
        'fixed inset-0 z-[9999] flex items-center justify-center bg-neutral-950 transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      ].join(' ')}
    >
      <div className="h-10 w-10 rounded-full border-4 border-white/20 border-t-white animate-spin" />
    </div>
  );
}
