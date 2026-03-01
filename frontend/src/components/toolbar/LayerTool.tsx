import React from 'react';
import { Button } from '../ui/button';
import { Layers } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

const LayerTool: React.FC = () => {
    const { showLayerPanel, toggleLayerPanel } = useUIStore();

    return (
        <Button
            variant={showLayerPanel ? 'default' : 'outline'}
            size="sm"
            className={cn(
                "px-2 py-2 h-8 w-8",
                showLayerPanel 
                    ? "bg-gray-800 text-white" 
                    : "bg-white/50 border-gray-300"
            )}
            onClick={toggleLayerPanel}
            title="图层面板"
        >
            <Layers className="w-4 h-4" />
        </Button>
    );
};

export default LayerTool;
