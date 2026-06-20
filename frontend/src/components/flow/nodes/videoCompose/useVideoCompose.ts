import React from "react";
import { composeVideosToBlob, type ComposeAudioTrack } from "./composeVideosCore";

export type ComposeVideoSource = {
  url: string;
  title?: string;
  thumbnailUrl?: string;
  trimStart?: number; // microseconds to skip at beginning
  trimEnd?: number; // microseconds to skip at end
};

export function useVideoCompose() {
  const [composing, setComposing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const compose = React.useCallback(
    async (
      videos: ComposeVideoSource[],
      options?: { audioTracks?: ComposeAudioTrack[] }
    ): Promise<Blob | null> => {
      if (videos.length < 2) return null;

      abortRef.current?.abort();
      const abortCtrl = new AbortController();
      abortRef.current = abortCtrl;

      setComposing(true);
      setProgress(0);
      setError(null);

      try {
        return await composeVideosToBlob(videos, {
          signal: abortCtrl.signal,
          onProgress: (p) => setProgress(p),
          audioTracks: options?.audioTracks,
        });
      } catch (err: unknown) {
        if (!abortCtrl.signal.aborted) {
          setError(err instanceof Error ? err.message : "合成失败");
        }
        return null;
      } finally {
        setComposing(false);
      }
    },
    []
  );

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { compose, cancel, composing, progress, error };
}
