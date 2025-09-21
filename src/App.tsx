import React, { useEffect, useState } from 'react';
import Canvas from '@/pages/Canvas';
import PromptOptimizerDemo from '@/pages/PromptOptimizerDemo';

const App: React.FC = () => {
  const [showPromptDemo, setShowPromptDemo] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const search = window.location.search;
    const hash = window.location.hash;
    return search.includes('prompt-demo') || hash.includes('prompt-demo');
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const evaluate = () => {
      const search = window.location.search;
      const hash = window.location.hash;
      setShowPromptDemo(search.includes('prompt-demo') || hash.includes('prompt-demo'));
    };

    window.addEventListener('hashchange', evaluate);
    window.addEventListener('popstate', evaluate);

    return () => {
      window.removeEventListener('hashchange', evaluate);
      window.removeEventListener('popstate', evaluate);
    };
  }, []);

  if (showPromptDemo) {
    return <PromptOptimizerDemo />;
  }

  return (
    <div className="h-screen w-screen">
      <Canvas />
    </div>
  );
};

export default App;
