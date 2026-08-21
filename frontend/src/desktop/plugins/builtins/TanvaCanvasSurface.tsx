import Canvas from '@/pages/Canvas';

export default function TanvaCanvasSurface() {
  return (
    <div className="h-full min-h-0 overflow-hidden bg-white" translate="no">
      <Canvas showAIChat={false} embeddedDesktop />
    </div>
  );
}
