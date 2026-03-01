// @ts-nocheck
import React, { useCallback } from 'react';
import TemplateModal from '@/components/template/TemplateModal';
import { useUIStore } from '@/stores/uiStore';
import type { FlowTemplate } from '@/types/template';

const TemplateLibraryOverlay: React.FC = () => {
  const show = useUIStore(state => state.showTemplateLibraryModal);
  const setShow = useUIStore(state => state.setShowTemplateLibraryModal);

  const handleClose = useCallback(() => {
    setShow(false);
  }, [setShow]);

  const handleInstantiate = useCallback((_: FlowTemplate) => {
    // TemplateModal 会自行通过事件通知 FlowOverlay，这里仅负责关闭弹窗
    setShow(false);
  }, [setShow]);

  if (!show) {
    return null;
  }

  return (
    <TemplateModal
      isOpen={show}
      onClose={handleClose}
      onInstantiateTemplate={handleInstantiate}
    />
  );
};

export default TemplateLibraryOverlay;
