import type { CSSProperties } from 'react';
import { useCanvasBackgroundStore } from '@/stores/canvasBackgroundStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { canvasGridInk } from '@/utils/canvasBackground';

type CanvasStyle = CSSProperties & {
  '--tanva-canvas-background'?: string;
  '--tanva-canvas-grid-ink'?: string;
};

export function useCanvasBackgroundStyle(): CanvasStyle | undefined {
  const theme = useAIChatStore((state) => state.chatTheme);
  const background = useCanvasBackgroundStore((state) => state.byScheme[theme === 'black' ? 'dark' : 'light']);
  return background ? {
    '--tanva-canvas-background': background,
    '--tanva-canvas-grid-ink': canvasGridInk(background),
  } : undefined;
}
