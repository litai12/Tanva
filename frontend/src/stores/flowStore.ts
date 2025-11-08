import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';

// Flow背景样式枚举
export const FlowBackgroundVariant = {
  DOTS: 'dots',
  LINES: 'lines', 
  CROSS: 'cross'
} as const;

export type FlowBackgroundVariant = typeof FlowBackgroundVariant[keyof typeof FlowBackgroundVariant];

interface FlowState {
  // Flow背景/网格系统
  backgroundEnabled: boolean;
  backgroundVariant: FlowBackgroundVariant;
  backgroundGap: number;           // 网格间距
  backgroundSize: number;          // 点大小/线宽
  backgroundColor: string;         // 背景颜色
  backgroundOpacity: number;       // 背景透明度
  
  // Flow视口状态 (独立于Canvas)
  flowZoom: number;
  flowPanX: number;
  flowPanY: number;
  
  // Flow交互状态
  isConnecting: boolean;           // 是否正在连线
  snapToGrid: boolean;             // 是否对齐网格
  
  // 操作方法
  setBackgroundEnabled: (enabled: boolean) => void;
  setBackgroundVariant: (variant: FlowBackgroundVariant) => void;
  setBackgroundGap: (gap: number) => void;
  setBackgroundSize: (size: number) => void;
  setBackgroundColor: (color: string) => void;
  setBackgroundOpacity: (opacity: number) => void;
  setFlowZoom: (zoom: number) => void;
  setFlowPan: (x: number, y: number) => void;
  panFlowBy: (deltaX: number, deltaY: number) => void;
  resetFlowView: () => void;
  setIsConnecting: (connecting: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
}

export const useFlowStore = create<FlowState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // 初始状态 - 默认关闭Flow背景，避免与Canvas网格重叠
        backgroundEnabled: false,
        backgroundVariant: FlowBackgroundVariant.DOTS,
        backgroundGap: 20,
        backgroundSize: 1,
        backgroundColor: '#94a3b8', // slate-400
        backgroundOpacity: 0.4,
        
        // Flow视口初始状态
        flowZoom: 1.0,
        flowPanX: 0,
        flowPanY: 0,
        
        // 交互状态
        isConnecting: false,
        snapToGrid: true,
        
        // 背景设置方法
        setBackgroundEnabled: (enabled) => set({ backgroundEnabled: enabled }),
        setBackgroundVariant: (variant) => set({ backgroundVariant: variant }),
        setBackgroundGap: (gap) => set({ 
          backgroundGap: Math.max(4, Math.min(100, gap)) 
        }),
        setBackgroundSize: (size) => set({ 
          backgroundSize: Math.max(0.5, Math.min(10, size)) 
        }),
        setBackgroundColor: (color) => set({ backgroundColor: color }),
        setBackgroundOpacity: (opacity) => set({ 
          backgroundOpacity: Math.max(0, Math.min(1, opacity)) 
        }),
        
        // 视口方法
        setFlowZoom: (zoom) => set({ 
          flowZoom: Math.max(0.1, Math.min(3, zoom)) 
        }),
        setFlowPan: (x, y) => set({ flowPanX: x, flowPanY: y }),
        panFlowBy: (deltaX, deltaY) => {
          const { flowPanX, flowPanY } = get();
          set({ 
            flowPanX: flowPanX + deltaX, 
            flowPanY: flowPanY + deltaY 
          });
        },
        resetFlowView: () => set({ 
          flowZoom: 1.0, 
          flowPanX: 0, 
          flowPanY: 0 
        }),
        
        // 交互方法
        setIsConnecting: (connecting) => set({ isConnecting: connecting }),
        setSnapToGrid: (snap) => set({ snapToGrid: snap }),
      }),
      {
        name: 'flow-settings', // localStorage 键名
        storage: createJSONStorage<Partial<FlowState>>(() => createSafeStorage({ storageName: 'flow-settings' })),
        // 只持久化配置，不包括视口和交互状态
        partialize: (state) => ({
          backgroundEnabled: state.backgroundEnabled,
          backgroundVariant: state.backgroundVariant,
          backgroundGap: state.backgroundGap,
          backgroundSize: state.backgroundSize,
          backgroundColor: state.backgroundColor,
          backgroundOpacity: state.backgroundOpacity,
          snapToGrid: state.snapToGrid,
        }) as Partial<FlowState>,
      }
    )
  )
);

// 性能优化：导出常用的选择器
export const useFlowBackground = () => useFlowStore((state) => ({
  enabled: state.backgroundEnabled,
  variant: state.backgroundVariant,
  gap: state.backgroundGap,
  size: state.backgroundSize,
  color: state.backgroundColor,
  opacity: state.backgroundOpacity,
}));

export const useFlowViewport = () => useFlowStore((state) => ({
  zoom: state.flowZoom,
  panX: state.flowPanX,
  panY: state.flowPanY,
}));

export const useFlowInteraction = () => useFlowStore((state) => ({
  isConnecting: state.isConnecting,
  snapToGrid: state.snapToGrid,
}));
