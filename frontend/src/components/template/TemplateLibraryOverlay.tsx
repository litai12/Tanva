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
    // TemplateModal notifies FlowOverlay through events; this overlay only closes itself.
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
