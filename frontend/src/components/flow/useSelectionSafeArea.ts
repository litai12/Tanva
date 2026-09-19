import { useEffect, useState, type RefObject } from 'react';
import { computeSelectionSafeArea, type SelectionRect } from '@/utils/flowSelectionViewport';

export function readSelectionSafeArea(container: HTMLElement): SelectionRect | null {
  const rect = container.getBoundingClientRect();
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-xiaot-chat-panel]'))
    .filter(panel => panel.getAttribute('aria-hidden') !== 'true')
    .map(panel => panel.getBoundingClientRect())
    .filter(panel => panel.width > 0 && panel.height > 0)
    .map(panel => ({ x: panel.left - rect.left, y: panel.top - rect.top, width: panel.width, height: panel.height }));
  const left = Math.min(80, rect.width * 0.1);
  const top = Math.min(100, rect.height * 0.15);
  return computeSelectionSafeArea({ x: left, y: top, width: Math.max(0, rect.width - left - 24), height: Math.max(0, rect.height - top - 24) }, panels);
}

export function useSelectionSafeArea(container: RefObject<HTMLElement | null>, active: boolean) {
  const [area, setArea] = useState<SelectionRect | null>(null);
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const next = container.current ? readSelectionSafeArea(container.current) : null;
      setArea(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    measure();
    // Position can change without resizing (chat drag, collapse transition, desktop panels).
    const timer = window.setInterval(measure, 100);
    window.addEventListener('resize', measure);
    return () => { window.clearInterval(timer); window.removeEventListener('resize', measure); };
  }, [active, container]);
  return area;
}
