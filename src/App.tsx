import React, { useEffect, useState } from 'react';
import Canvas from '@/pages/Canvas';
import PromptOptimizerDemo from '@/pages/PromptOptimizerDemo';
import AccountBadge from '@/components/AccountBadge';

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
      <div className="absolute right-3 top-3 z-50">
        <div className="flex items-center gap-2 bg-white/90 border rounded px-2 py-1 shadow-sm">
          <AccountBadge />
          <a href="/" className="text-xs text-sky-600">返回首页</a>
        </div>
      </div>
      <Canvas />
    </div>
  );
};

export default App;
