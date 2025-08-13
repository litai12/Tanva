import React from 'react';
import Header from '@/components/layout/Header';
import Canvas from '@/pages/Canvas';

const App: React.FC = () => {
  return (
    <div className="flex flex-col h-screen w-screen">
      <Header />
      <Canvas />
    </div>
  );
};

export default App;
