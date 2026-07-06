import React from 'react';
import { Sparkles, ArrowRight, Film, Clapperboard, Clock } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useLanguage } from '../contexts/LanguageContext';

export const Hero: React.FC = () => {
  const { t } = useLanguage();

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background Effects */}
      <div className="absolute inset-0 w-full h-full bg-slate-950 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full mix-blend-screen filter blur-[100px] animate-blob"></div>
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full mix-blend-screen filter blur-[100px] animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-1/4 left-1/2 w-96 h-96 bg-blue-500/20 rounded-full mix-blend-screen filter blur-[100px] animate-blob animation-delay-4000"></div>
        
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center">
        
        {/* Badge */}
        <div className="animate-fade-in-up mb-8" style={{ animationDelay: '0.1s' }}>
          <Badge variant="secondary" className="px-3 py-1 gap-2 text-sm font-medium">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            {t('hero.badge')}
          </Badge>
        </div>

        {/* Main Headline */}
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          {t('hero.title1')} <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600">
            {t('hero.title2')}
          </span>
        </h1>

        {/* Subheadline */}
        <p className="max-w-2xl text-lg md:text-xl text-slate-400 mb-10 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          {t('hero.subtitle')}
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
          <Button 
            size="lg" 
            className="group relative overflow-hidden bg-white text-slate-950 hover:bg-white/90 hover:text-slate-950 shadow-none"
            onClick={() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-cyan-300 to-purple-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <span className="relative flex items-center justify-center gap-2 font-bold">
              {t('hero.startBtn')}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
          </Button>
          <Button 
            variant="outline" 
            size="lg"
            onClick={() => document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' })}
          >
            {t('hero.portfolioBtn')}
          </Button>
        </div>

        {/* Feature Pills */}
        <div className="mt-16 flex flex-wrap justify-center gap-4 animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
          {[
            { icon: <Clapperboard className="w-4 h-4" />, text: t('hero.feat1') },
            { icon: <Film className="w-4 h-4" />, text: t('hero.feat2') },
            { icon: <Clock className="w-4 h-4" />, text: t('hero.feat3') },
          ].map((feature, idx) => (
            <Badge key={idx} variant="outline" className="gap-2 px-4 py-2 rounded-full bg-slate-900/50 text-slate-400 font-normal">
              {feature.icon}
              {feature.text}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
};
