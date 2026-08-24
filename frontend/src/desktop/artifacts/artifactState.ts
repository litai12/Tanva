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
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  createdAt: string;
}

interface DesktopArtifactState {
  artifacts: DesktopArtifact[];
  activeArtifactId: string | null;
  pendingEditArtifactId: string | null;
  upsert: (artifact: DesktopArtifact) => void;
  activate: (artifactId: string) => void;
  requestEdit: (artifactId: string) => void;
  clearEditRequest: (artifactId?: string) => void;
}

export const useDesktopArtifactStore = create<DesktopArtifactState>((set) => ({
  artifacts: [],
  activeArtifactId: null,
  pendingEditArtifactId: null,
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
            fileUrl: artifact.fileUrl ?? previous.fileUrl,
            fileName: artifact.fileName ?? previous.fileName,
            mimeType: artifact.mimeType ?? previous.mimeType,
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
  requestEdit: (artifactId) => set({
    activeArtifactId: artifactId,
    pendingEditArtifactId: artifactId,
  }),
  clearEditRequest: (artifactId) => set((state) => ({
    pendingEditArtifactId:
      artifactId && state.pendingEditArtifactId !== artifactId
        ? state.pendingEditArtifactId
        : null,
  })),
}));

export const DESKTOP_ARTIFACT_OPEN_EVENT = 'tanva:desktop-open-artifact';
export const DESKTOP_ARTIFACT_EDIT_EVENT = 'tanva:desktop-edit-artifact';

export const buildDesktopArtifactEditPrompt = (
  userInput: string,
  artifact: DesktopArtifact
): string => {
  const fileType = artifact.kind === 'presentation' ? 'PPTX' : 'XLSX';
  const skill = artifact.kind === 'presentation' ? 'pptx-generator' : 'minimax-xlsx';
  const context = {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    fileUrl: artifact.fileUrl,
  };
  return `${userInput.trim()}\n\n[宿主当前文件上下文]\n${JSON.stringify(context)}\n请使用 ${skill} 下载并编辑这份现有 ${fileType}，保留未要求修改的内容和原生可编辑结构；完成真实文件校验后必须通过 present_file 交付修订版。不要改成 HTML、固定模板、Markdown 或仅给修改建议。`;
};

export const openDesktopArtifact = (artifact: DesktopArtifact): void => {
  window.dispatchEvent(
    new CustomEvent<DesktopArtifact>(DESKTOP_ARTIFACT_OPEN_EVENT, {
      detail: artifact,
    })
  );
};

export const editDesktopArtifact = (artifact: DesktopArtifact): void => {
  useDesktopArtifactStore.getState().requestEdit(artifact.id);
  window.dispatchEvent(
    new CustomEvent<DesktopArtifact>(DESKTOP_ARTIFACT_EDIT_EVENT, {
      detail: artifact,
    })
  );
};
