import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';

export type SandboxLogType = 'info' | 'success' | 'error';

export interface SandboxLogEntry {
  id: string;
  type: SandboxLogType;
  message: string;
  timestamp: number;
}

interface SandboxState {
  code: string;
  autoRun: boolean;
  autoRunDelay: number;
  logs: SandboxLogEntry[];
  isExecuting: boolean;
  setCode: (code: string) => void;
  setAutoRun: (autoRun: boolean) => void;
  setAutoRunDelay: (delay: number) => void;
  addLog: (entry: Omit<SandboxLogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => void;
  clearLogs: () => void;
  setExecuting: (executing: boolean) => void;
  reset: () => void;
}

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sandbox-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
};

const DEFAULT_CODE = `// Paper.js 沙盒示例
const center = view.center;
const radius = 120;

const circle = new Path.Circle(center, radius);
circle.fillColor = new Color(0.2, 0.6, 1, 0.15);
circle.strokeColor = '#3388ff';
circle.strokeWidth = 4;

const spokes = 18;
for (let i = 0; i < spokes; i++) {
  const angle = (i / spokes) * Math.PI * 2;
  const start = center + new Point(Math.cos(angle) * 12, Math.sin(angle) * 12);
  const end = center + new Point(Math.cos(angle) * radius, Math.sin(angle) * radius);
  const spoke = new Path.Line(start, end);
  spoke.strokeColor = '#99c8ff';
  spoke.strokeWidth = i % 3 === 0 ? 2 : 1;
}
`;

const LOG_LIMIT = 40;

export const useSandboxStore = create<SandboxState>()(
  persist(
    (set) => ({
      code: DEFAULT_CODE,
      autoRun: false,
      autoRunDelay: 800,
      logs: [],
      isExecuting: false,
      setCode: (code) => set({ code }),
      setAutoRun: (autoRun) => set({ autoRun }),
      setAutoRunDelay: (delay) => set({ autoRunDelay: Math.max(300, Math.min(5000, delay)) }),
      addLog: (entry) =>
        set((state) => {
          const next: SandboxLogEntry = {
            id: entry.id || createId(),
            type: entry.type,
            message: entry.message.trim(),
            timestamp: entry.timestamp ?? Date.now(),
          };
          return {
            logs: [...state.logs, next].slice(-LOG_LIMIT),
          };
        }),
      clearLogs: () => set({ logs: [] }),
      setExecuting: (isExecuting) => set({ isExecuting }),
      reset: () =>
        set({
          code: DEFAULT_CODE,
          logs: [],
          autoRun: false,
          autoRunDelay: 800,
          isExecuting: false,
        }),
    }),
    {
      name: 'sandbox-preferences',
      storage: createJSONStorage<Partial<SandboxState>>(() => createSafeStorage({ storageName: 'sandbox-preferences' })),
      partialize: (state) =>
        ({
          code: state.code,
          autoRun: state.autoRun,
          autoRunDelay: state.autoRunDelay,
        }) as Partial<SandboxState>,
    }
  )
);
