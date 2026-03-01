import paper from 'paper';
import { useLayerStore } from '@/stores/layerStore';

/**
 * 绘图图层管理器
 * 负责管理Paper.js绘图图层的创建、激活和维护
 */
export class DrawingLayerManager {
    private drawingLayerRef: paper.Layer | null = null;

    /**
     * 确保绘图图层存在并激活
     */
    ensureDrawingLayer(): paper.Layer {
        // 始终与全局层存储保持一致
        try {
            const state = useLayerStore.getState();

            // 如果有活动图层ID，尝试获取对应的Paper.js图层
            if (state.activeLayerId) {
                const layerName = `layer_${state.activeLayerId}`;
                const paperLayer = paper.project.layers.find(l => l.name === layerName);
                if (paperLayer && paperLayer.project) {
                    paperLayer.activate();
                    this.drawingLayerRef = paperLayer;
                    return paperLayer;
                }
            }

            // 如果没有活动图层或找不到对应的Paper.js图层，创建默认图层
            const activeLayer = state.ensureActiveLayer();
            this.drawingLayerRef = activeLayer;
            return activeLayer;
        } catch (e) {
            console.warn('获取活动图层失败，使用兜底方案:', e);
            // 优先尝试通过全局层存储创建一个“正式”的用户图层
            try {
                const state = useLayerStore.getState();
                // 不强制名称，交由 store 依据现有层自动生成“图层 2/3/...”，避免重名
                const newId = state.createLayer(undefined, true);
                const created = paper.project?.layers.find(l => l.name === `layer_${newId}`) || null;
                if (created && created.project) {
                    created.activate();
                    this.drawingLayerRef = created;
                    return created;
                }
            } catch (ee) {
                console.warn('通过全局层存储创建图层失败，继续使用兜底图层:', ee);
            }

            // 兜底：仍然保证可绘制
            let drawingLayer = this.drawingLayerRef;
            if (!drawingLayer || this.isLayerDeleted(drawingLayer)) {
                drawingLayer = new paper.Layer();
                drawingLayer.name = 'layer_fallback';
                const gridLayer = paper.project.layers.find(layer => layer.name === 'grid');
                if (gridLayer) drawingLayer.insertAbove(gridLayer);
            }
            drawingLayer.activate();
            this.drawingLayerRef = drawingLayer;
            return drawingLayer;
        }
    }

    /**
     * 检查图层是否已被删除
     */
    private isLayerDeleted(layer: paper.Layer): boolean {
        // 安全的类型检查，避免使用any
        return !layer.project || layer.project !== paper.project;
    }

    /**
     * 获取当前绘图图层
     */
    getCurrentLayer(): paper.Layer | null {
        return this.drawingLayerRef;
    }

    /**
     * 清理资源
     */
    cleanup(): void {
        this.drawingLayerRef = null;
    }
}
