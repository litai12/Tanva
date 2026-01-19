import React from "react";
import { useNonBase64ImageSrc } from "@/hooks/useNonBase64ImageSrc";

export type SmoothSmartImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "onLoad" | "onError" | "style"
> & {
  src?: string | null;
  placeholder?: React.ReactNode;
  style?: React.CSSProperties;
};

type SlotIndex = 0 | 1;

const SmoothSmartImage = ({
  src,
  placeholder,
  className,
  style,
  alt,
  ...imgProps
}: SmoothSmartImageProps) => {
  const resolvedSrc = useNonBase64ImageSrc(src);
  const raw = typeof src === "string" ? src.trim() : "";

  const prevRawRef = React.useRef(raw);
  const activeRef = React.useRef<SlotIndex>(0);
  const slotSrcRef = React.useRef<[string | null, string | null]>([
    resolvedSrc,
    null,
  ]);

  const pendingSwapRef = React.useRef<{
    slot: SlotIndex;
    src: string;
  } | null>(null);

  const [activeSlot, setActiveSlot] = React.useState<SlotIndex>(0);
  const [slotSrc, setSlotSrc] = React.useState<[string | null, string | null]>([
    resolvedSrc,
    null,
  ]);
  const [slotReady, setSlotReady] = React.useState<[boolean, boolean]>([
    false,
    false,
  ]);

  React.useEffect(() => {
    activeRef.current = activeSlot;
  }, [activeSlot]);

  React.useEffect(() => {
    slotSrcRef.current = slotSrc;
  }, [slotSrc]);

  React.useEffect(() => {
    const next = resolvedSrc;
    const prevRaw = prevRawRef.current;
    prevRawRef.current = raw;

    if (!next) {
      pendingSwapRef.current = null;
      setActiveSlot(0);
      setSlotSrc([null, null]);
      setSlotReady([false, false]);
      return;
    }

    const currentActive = activeRef.current;
    const currentSrc = slotSrcRef.current[currentActive];

    if (!currentSrc) {
      pendingSwapRef.current = null;
      setActiveSlot(0);
      setSlotSrc([next, null]);
      setSlotReady([false, false]);
      return;
    }

    if (currentSrc === next) return;

    const shouldSmooth =
      prevRaw.startsWith("blob:") && currentSrc.startsWith("blob:");

    if (!shouldSmooth) {
      pendingSwapRef.current = null;
      setActiveSlot(0);
      setSlotSrc([next, null]);
      setSlotReady([false, false]);
      return;
    }

    const inactive: SlotIndex = currentActive === 0 ? 1 : 0;
    pendingSwapRef.current = { slot: inactive, src: next };
    setSlotSrc((prev) => {
      const nextSlots: [string | null, string | null] = [...prev] as any;
      nextSlots[inactive] = next;
      return nextSlots;
    });
    setSlotReady((prev) => {
      const nextReady: [boolean, boolean] = [...prev] as any;
      nextReady[inactive] = false;
      return nextReady;
    });
  }, [raw, resolvedSrc]);

  const finalizeSwap = React.useCallback((slot: SlotIndex) => {
    setActiveSlot(slot);
    pendingSwapRef.current = null;
    try {
      window.setTimeout(() => {
        setSlotSrc((prev) => {
          const nextSlots: [string | null, string | null] = [...prev] as any;
          nextSlots[slot === 0 ? 1 : 0] = null;
          return nextSlots;
        });
        setSlotReady((prev) => {
          const nextReady: [boolean, boolean] = [...prev] as any;
          nextReady[slot === 0 ? 1 : 0] = false;
          return nextReady;
        });
      }, 180);
    } catch {}
  }, []);

  const handleSlotLoad = React.useCallback(
    (slot: SlotIndex) => async (event: React.SyntheticEvent<HTMLImageElement>) => {
      const srcForSlot = slotSrcRef.current[slot];
      if (!srcForSlot) return;

      const img = event.currentTarget;
      const decoder = (img as any).decode;
      if (typeof decoder === "function") {
        try {
          await decoder.call(img);
        } catch {}
      }

      setSlotReady((prev) => {
        const nextReady: [boolean, boolean] = [...prev] as any;
        nextReady[slot] = true;
        return nextReady;
      });

      const pending = pendingSwapRef.current;
      if (!pending || pending.slot !== slot || pending.src !== srcForSlot) return;
      finalizeSwap(slot);
    },
    [finalizeSwap]
  );

  const handleSlotError = React.useCallback((slot: SlotIndex) => () => {
    const srcForSlot = slotSrcRef.current[slot];
    const pending = pendingSwapRef.current;
    if (!pending || pending.slot !== slot || pending.src !== srcForSlot) {
      return;
    }
    pendingSwapRef.current = null;
    setSlotSrc((prev) => {
      const nextSlots: [string | null, string | null] = [...prev] as any;
      nextSlots[slot] = null;
      return nextSlots;
    });
    setSlotReady((prev) => {
      const nextReady: [boolean, boolean] = [...prev] as any;
      nextReady[slot] = false;
      return nextReady;
    });
  }, []);

  const hasAnySrc = Boolean(slotSrc[0] || slotSrc[1]);
  if (!hasAnySrc) {
    if (placeholder !== undefined) {
      return <>{placeholder}</>;
    }
    return (
      <div className={typeof className === "string" ? className : undefined} style={style} />
    );
  }

  const wrapperClassName =
    typeof className === "string"
      ? `relative overflow-hidden ${className}`
      : "relative overflow-hidden";

  const renderSlot = (slot: SlotIndex) => {
    const slotSource = slotSrc[slot];
    if (!slotSource) return null;

    const isActive = activeSlot === slot;
    const ready = slotReady[slot];
    const opacity = isActive ? 1 : pendingSwapRef.current?.slot === slot && ready ? 1 : 0;

    return (
      <img
        {...imgProps}
        key={`${slot}-${slotSource}`}
        src={slotSource}
        alt={alt}
        onLoad={handleSlotLoad(slot)}
        onError={handleSlotError(slot)}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-150"
        style={{ opacity }}
      />
    );
  };

  return (
    <div className={wrapperClassName} style={style}>
      {renderSlot(0)}
      {renderSlot(1)}
    </div>
  );
};

export default SmoothSmartImage;

