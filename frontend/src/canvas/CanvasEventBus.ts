/**
 * Centralized event bus for canvas-level DOM events.
 *
 * All window-level event listeners (wheel, gesture, mousedown-capture, etc.)
 * are registered once in GlobalEventCapture.tsx. Components subscribe here
 * instead of calling addEventListener themselves. This gives us:
 *   - One listener per event type (no accidental doubles)
 *   - Deterministic dispatch order via priority tiers
 *   - Easy cleanup without ref-passing
 */

export type CanvasEventMap = {
  wheel: WheelEvent;
  mousedownCapture: MouseEvent;
  mousemoveCapture: MouseEvent;
  mouseupCapture: MouseEvent;
  gesturestart: Event;
  gesturechange: Event;
  gestureend: Event;
  keydownCapture: KeyboardEvent;
  keyupCapture: KeyboardEvent;
};

export type CanvasEventType = keyof CanvasEventMap;

type Handler<T extends CanvasEventType> = (event: CanvasEventMap[T]) => void;

interface Registration<T extends CanvasEventType> {
  handler: Handler<T>;
  priority: number;
}

class CanvasEventBus {
  private readonly _listeners = new Map<
    CanvasEventType,
    Array<Registration<CanvasEventType>>
  >();

  on<T extends CanvasEventType>(
    type: T,
    handler: Handler<T>,
    priority = 0
  ): () => void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, []);
    }
    const list = this._listeners.get(type)!;
    const entry = { handler, priority } as Registration<CanvasEventType>;
    list.push(entry);
    // Higher priority runs first
    list.sort((a, b) => b.priority - a.priority);

    return () => {
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  emit<T extends CanvasEventType>(type: T, event: CanvasEventMap[T]): void {
    const list = this._listeners.get(type);
    if (!list) return;
    for (const { handler } of list) {
      // Respect stopImmediatePropagation: cancelBubble is set by both
      // stopPropagation and stopImmediatePropagation. Only break on
      // stopImmediatePropagation (which also sets cancelBubble).
      if ((event as Event).cancelBubble) break;
      handler(event as never);
    }
  }
}

// Singleton — one bus per app instance
export const canvasEventBus = new CanvasEventBus();
