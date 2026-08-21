import { create } from 'zustand';
import type { HtmlPptDeck } from '@/utils/htmlPptDeck';

export type DesktopArtifactKind = 'presentation' | 'spreadsheet' | 'document';

export interface DesktopArtifactSheet {
  name: string;
  rows: string[][];
}

export interface DesktopArtifact {
  id: string;
  kind: DesktopArtifactKind;
  title: string;
  summary?: string;
  nodeId?: string;
  formats?: string[];
  sheets?: DesktopArtifactSheet[];
  deck?: HtmlPptDeck;
  markdown?: string;
  createdAt: string;
}

interface DesktopArtifactState {
  artifacts: DesktopArtifact[];
  activeArtifactId: string | null;
  upsert: (artifact: DesktopArtifact) => void;
  activate: (artifactId: string) => void;
}

export const useDesktopArtifactStore = create<DesktopArtifactState>((set) => ({
  artifacts: [],
  activeArtifactId: null,
  upsert: (artifact) =>
    set((state) => {
      const previous = state.artifacts.find((item) => item.id === artifact.id);
      const merged: DesktopArtifact = previous
        ? {
            ...previous,
            ...artifact,
            deck: artifact.deck ?? previous.deck,
            sheets: artifact.sheets ?? previous.sheets,
            markdown: artifact.markdown ?? previous.markdown,
          }
        : artifact;
      return {
        artifacts: [
          merged,
          ...state.artifacts.filter((item) => item.id !== artifact.id),
        ],
        activeArtifactId: artifact.id,
      };
    }),
  activate: (artifactId) => set({ activeArtifactId: artifactId }),
}));

export const DESKTOP_ARTIFACT_OPEN_EVENT = 'tanva:desktop-open-artifact';

export const openDesktopArtifact = (artifact: DesktopArtifact): void => {
  window.dispatchEvent(
    new CustomEvent<DesktopArtifact>(DESKTOP_ARTIFACT_OPEN_EVENT, {
      detail: artifact,
    })
  );
};
