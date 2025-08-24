import React from 'react';
import { Button } from '../ui/button';
import { Layers } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

const LayerTool: React.FC = () => {
    const { showLayerPanel, toggleLayerPanel } = useUIStore();

    return (
        <Button
            variant={showLayerPanel ? 'default' : 'outline'}
            size="sm"
            className="px-2 py-2 h-8 w-8"
            onClick={toggleLayerPanel}
            title="图层面板"
        >
            <Layers className="w-4 h-4" />
        </Button>
    );
};

export default LayerTool;
