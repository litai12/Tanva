type PendingListener = (pendingCount: number) => void;

type TrackerState = {
  installed: boolean;
  pendingCount: number;
  listeners: Set<PendingListener>;
};

declare global {
  interface Window {
    __tanvaImageLoadTracker?: TrackerState;
  }
}

const getState = (): TrackerState | null => {
  if (typeof window === 'undefined') return null;
  return (window.__tanvaImageLoadTracker ??= {
    installed: false,
    pendingCount: 0,
    listeners: new Set(),
  });
};

const notify = (state: TrackerState) => {
  for (const listener of state.listeners) listener(state.pendingCount);
};

const inc = (state: TrackerState) => {
  state.pendingCount += 1;
  notify(state);
};

const dec = (state: TrackerState) => {
  state.pendingCount = Math.max(0, state.pendingCount - 1);
  notify(state);
};

const isLoadPending = (img: HTMLImageElement) =>
  !!img.currentSrc || !!img.src ? !img.complete : false;

const safeString = (value: unknown) => (value == null ? '' : String(value));

const instrumentImageInstance = (img: HTMLImageElement, state: TrackerState) => {
  const anyImg = img as any;
  if (anyImg.__tanvaImageInstrumented) return;
  anyImg.__tanvaImageInstrumented = true;

  const proto = Object.getPrototypeOf(img) as any;
  const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(proto, 'src');
  if (!desc || typeof desc.get !== 'function' || typeof desc.set !== 'function') {
    // 兜底：只做一次性 pending 检测
    if (isLoadPending(img)) {
      inc(state);
      const done = () => dec(state);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
    return;
  }

  let token = 0;
  let pending = false;

  const finishIfCurrent = (expectedToken: number) => {
    if (token !== expectedToken) return;
    if (!pending) return;
    pending = false;
    dec(state);
  };

  const attachDoneHandlers = (expectedToken: number) => {
    const done = () => finishIfCurrent(expectedToken);
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    queueMicrotask(() => finishIfCurrent(expectedToken));
    window.setTimeout(() => finishIfCurrent(expectedToken), 0);
  };

  Object.defineProperty(img, 'src', {
    configurable: true,
    enumerable: desc.enumerable ?? true,
    get: () => desc.get!.call(img),
    set: (value: unknown) => {
      const next = safeString(value);
      token += 1;
      const currentToken = token;

      if (pending) {
        pending = false;
        dec(state);
      }

      desc.set!.call(img, next);

      if (!next) return;
      if (img.complete) return;

      pending = true;
      inc(state);
      attachDoneHandlers(currentToken);
    },
  });

  // 处理“已开始加载但 src 在我们接管之前已设置”的情况
  if (isLoadPending(img)) {
    token += 1;
    const currentToken = token;
    pending = true;
    inc(state);
    attachDoneHandlers(currentToken);
  }
};

export const installGlobalImageLoadTracker = () => {
  const state = getState();
  if (!state || state.installed) return;
  state.installed = true;

  const OriginalImage = window.Image;
  const TrackingImage: any = function TrackingImage(width?: number, height?: number) {
    const img = height === undefined ? new OriginalImage(width as any) : new OriginalImage(width as any, height as any);
    instrumentImageInstance(img, state);
    return img;
  };
  TrackingImage.prototype = OriginalImage.prototype;

  try {
    window.Image = TrackingImage;
  } catch {
    // ignore
  }

  const scan = (root: ParentNode) => {
    const images = Array.from(root.querySelectorAll?.('img') ?? []);
    for (const img of images) instrumentImageInstance(img as HTMLImageElement, state);
  };

  scan(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.tagName.toLowerCase() === 'img') {
          instrumentImageInstance(node as HTMLImageElement, state);
          continue;
        }
        scan(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
};

export const getPendingImageCount = (): number => {
  const state = getState();
  return state ? state.pendingCount : 0;
};

export const subscribePendingImageCount = (listener: PendingListener): (() => void) => {
  const state = getState();
  if (!state) return () => {};
  state.listeners.add(listener);
  listener(state.pendingCount);
  return () => {
    state.listeners.delete(listener);
  };
};

