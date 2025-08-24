import { create } from 'zustand';
import paper from 'paper';

export interface LayerMeta {
    id: string;
    name: string;
    visible: boolean;
    locked?: boolean;
}

interface LayerState {
    layers: LayerMeta[];
    activeLayerId: string | null;

    // getters (non-react usage friendly)
    getPaperLayerById: (id: string) => paper.Layer | null;

    // actions
    createLayer: (name?: string, activate?: boolean) => string;
    deleteLayer: (id: string) => void;
    toggleVisibility: (id: string) => void;
    activateLayer: (id: string) => void;
    renameLayer: (id: string, name: string) => void;
    toggleLocked: (id: string) => void;
    moveLayerUp: (id: string) => void;
    moveLayerDown: (id: string) => void;
    reorderLayer: (sourceId: string, targetId: string, placeAbove?: boolean) => void;
    ensureActiveLayer: () => paper.Layer;
}

const SYSTEM_LAYER_NAMES = new Set(['grid', 'background', 'scalebar']);

function findLayerByStoreId(id: string): paper.Layer | null {
    if (!paper.project) return null;
    return paper.project.layers.find(layer => layer.name === `layer_${id}`) || null;
}

function insertAboveGrid(newLayer: paper.Layer) {
    const gridLayer = paper.project?.layers?.find(layer => layer.name === 'grid');
    if (gridLayer) {
        newLayer.insertAbove(gridLayer);
    }
}

export const useLayerStore = create<LayerState>((set, get) => ({
    layers: [],
    activeLayerId: null,

    getPaperLayerById: (id) => {
        return findLayerByStoreId(id);
    },

    createLayer: (name, activate = true) => {
        // generate id
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // 默认命名：图层 1, 2, 3 ...
        const nextDefaultName = (() => {
            const current = get().layers;
            let maxNum = 0;
            for (const l of current) {
                const m = /^(?:图层\s*)?(\d+)$|^图层\s+(\d+)$/.exec(l.name);
                if (m) {
                    const n = parseInt(m[1] || m[2] || '0', 10);
                    if (!Number.isNaN(n)) maxNum = Math.max(maxNum, n);
                }
            }
            const next = maxNum + 1 || (current.length + 1);
            return `图层 ${next}`;
        })();
        const layerName = name && name.trim() ? name.trim() : nextDefaultName;

        // create paper layer if possible
        let paperLayer: paper.Layer | null = null;
        if (paper.project) {
            paperLayer = new paper.Layer();
            paperLayer.name = `layer_${id}`;
            paperLayer.visible = true;
            insertAboveGrid(paperLayer);
            if (activate) paperLayer.activate();
        }

        set((state) => {
            const meta: LayerMeta = { id, name: layerName, visible: true, locked: false };
            const nextLayers = [...state.layers, meta];
            return {
                layers: nextLayers,
                activeLayerId: activate ? id : state.activeLayerId
            };
        });

        return id;
    },

    deleteLayer: (id) => {
        const state = get();
        const meta = state.layers.find(l => l.id === id);
        if (!meta) return;

        // 至少保留一个图层
        if (state.layers.length <= 1) {
            console.warn('无法删除最后一个图层');
            return;
        }

        // 删除 paper layer
        const paperLayer = findLayerByStoreId(id);
        if (paperLayer) {
            paperLayer.remove();
        }

        set((state) => {
            const nextLayers = state.layers.filter(l => l.id !== id);
            let nextActiveId = state.activeLayerId;

            // 如果删除的是活动图层，激活另一个
            if (state.activeLayerId === id) {
                const currentIndex = state.layers.findIndex(l => l.id === id);
                if (currentIndex > 0) {
                    nextActiveId = state.layers[currentIndex - 1].id;
                } else if (nextLayers.length > 0) {
                    nextActiveId = nextLayers[0].id;
                } else {
                    nextActiveId = null;
                }
            }

            return {
                layers: nextLayers,
                activeLayerId: nextActiveId
            };
        });

        // 激活新的活动图层
        const newActiveId = get().activeLayerId;
        if (newActiveId) {
            const newActiveLayer = findLayerByStoreId(newActiveId);
            if (newActiveLayer) {
                newActiveLayer.activate();
            }
        }
    },

    toggleVisibility: (id) => {
        const paperLayer = findLayerByStoreId(id);
        if (paperLayer) {
            paperLayer.visible = !paperLayer.visible;
        }

        set((state) => ({
            layers: state.layers.map(l =>
                l.id === id ? { ...l, visible: !l.visible } : l
            )
        }));
    },

    activateLayer: (id) => {
        const paperLayer = findLayerByStoreId(id);
        if (paperLayer) {
            paperLayer.activate();
        }

        set({ activeLayerId: id });
    },

    renameLayer: (id, name) => {
        set((state) => ({
            layers: state.layers.map(l =>
                l.id === id ? { ...l, name } : l
            )
        }));
    },

    toggleLocked: (id) => {
        set((state) => ({
            layers: state.layers.map(l =>
                l.id === id ? { ...l, locked: !l.locked } : l
            )
        }));
    },

    moveLayerUp: (id) => {
        const state = get();
        const index = state.layers.findIndex(l => l.id === id);
        if (index > 0) {
            const newLayers = [...state.layers];
            [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
            set({ layers: newLayers });

            // 更新 paper layer 顺序
            const paperLayer = findLayerByStoreId(id);
            const targetLayer = findLayerByStoreId(newLayers[index - 1].id);
            if (paperLayer && targetLayer) {
                paperLayer.insertAbove(targetLayer);
            }
        }
    },

    moveLayerDown: (id) => {
        const state = get();
        const index = state.layers.findIndex(l => l.id === id);
        if (index < state.layers.length - 1) {
            const newLayers = [...state.layers];
            [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
            set({ layers: newLayers });

            // 更新 paper layer 顺序
            const paperLayer = findLayerByStoreId(id);
            const targetLayer = findLayerByStoreId(newLayers[index + 1].id);
            if (paperLayer && targetLayer) {
                paperLayer.insertBelow(targetLayer);
            }
        }
    },

    reorderLayer: (sourceId, targetId, placeAbove = true) => {
        if (sourceId === targetId) return;

        const state = get();
        const sourceIndex = state.layers.findIndex(l => l.id === sourceId);
        const targetIndex = state.layers.findIndex(l => l.id === targetId);

        if (sourceIndex === -1 || targetIndex === -1) return;

        const newLayers = [...state.layers];
        const [removed] = newLayers.splice(sourceIndex, 1);

        let insertIndex = targetIndex;
        if (sourceIndex < targetIndex) {
            insertIndex = placeAbove ? targetIndex - 1 : targetIndex;
        } else {
            insertIndex = placeAbove ? targetIndex : targetIndex + 1;
        }

        newLayers.splice(insertIndex, 0, removed);
        set({ layers: newLayers });

        // 更新 paper layer 顺序
        const sourceLayer = findLayerByStoreId(sourceId);
        const targetLayer = findLayerByStoreId(targetId);
        if (sourceLayer && targetLayer) {
            if (placeAbove) {
                sourceLayer.insertAbove(targetLayer);
            } else {
                sourceLayer.insertBelow(targetLayer);
            }
        }
    },

    ensureActiveLayer: () => {
        const state = get();

        // 如果有活动图层，返回它
        if (state.activeLayerId) {
            const paperLayer = findLayerByStoreId(state.activeLayerId);
            if (paperLayer && paperLayer.project) {
                paperLayer.activate();
                return paperLayer;
            }
        }

        // 如果没有任何图层，创建一个
        if (state.layers.length === 0) {
            const newId = state.createLayer('图层 1', true);
            const newLayer = findLayerByStoreId(newId);
            if (newLayer) return newLayer;
        }

        // 激活第一个图层
        if (state.layers.length > 0) {
            const firstId = state.layers[0].id;
            state.activateLayer(firstId);
            const firstLayer = findLayerByStoreId(firstId);
            if (firstLayer) return firstLayer;
        }

        // 最后的兜底方案
        throw new Error('无法创建或获取活动图层');
    }
}));