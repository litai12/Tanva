import React, { useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Partners } from './components/Partners';
import { Features } from './components/Features';
import { Gallery } from './components/Gallery';
import { TrainingProgram } from './components/TrainingProgram';
import { CreatorJoin } from './components/CreatorJoin';
import { Contact } from './components/Contact';
import { Footer } from './components/Footer';
import { LanguageProvider } from './contexts/LanguageContext';
import './newway.css';

/**
 * NewWay 官网宣发页（子站首页模板 homepage='newway'）。
 * 原为独立 Vite+CDN Tailwind 项目，整体移植；样式自包含（具体色值，不依赖全局 token）。
 */
const NewwayLanding: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'NewWay | Next-Gen AIGC';
    // 原项目在 <html> 上开启平滑滚动（锚点导航依赖）
    document.documentElement.classList.add('scroll-smooth');
    return () => {
      document.title = prevTitle;
      document.documentElement.classList.remove('scroll-smooth');
    };
  }, []);

  return (
    <LanguageProvider>
      <div className="newway-landing min-h-screen bg-slate-950 text-slate-50 font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        <Navbar />
        <main>
          <Hero />
          <Partners />
          <Features />
          <Gallery />
          <TrainingProgram />
          <CreatorJoin />
          <Contact />
        </main>
        <Footer />
      </div>
    </LanguageProvider>
  );
};

export default NewwayLanding;
