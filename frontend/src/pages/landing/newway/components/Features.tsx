import React from 'react';
import { Clapperboard, Clock, Coins, Wand2, Mic, Rocket } from 'lucide-react';
import { Card, CardDescription, CardContent } from './ui/card';
import { useLanguage } from '../contexts/LanguageContext';

export const Features: React.FC = () => {
  const { t } = useLanguage();

  const features = [
    {
      icon: <Wand2 className="w-6 h-6 text-cyan-400" />,
      title: t('features.item1.title'),
      description: t('features.item1.desc')
    },
    {
      icon: <Clapperboard className="w-6 h-6 text-purple-400" />,
      title: t('features.item2.title'),
      description: t('features.item2.desc')
    },
    {
      icon: <Coins className="w-6 h-6 text-blue-400" />,
      title: t('features.item3.title'),
      description: t('features.item3.desc')
    },
    {
      icon: <Mic className="w-6 h-6 text-yellow-400" />,
      title: t('features.item4.title'),
      description: t('features.item4.desc')
    },
    {
      icon: <Rocket className="w-6 h-6 text-emerald-400" />,
      title: t('features.item5.title'),
      description: t('features.item5.desc')
    },
    {
      icon: <Clock className="w-6 h-6 text-pink-400" />,
      title: t('features.item6.title'),
      description: t('features.item6.desc')
    }
  ];

  return (
    <section id="features" className="py-24 relative z-10 bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {t('features.title1')} <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">{t('features.title2')}</span>
          </h2>
          <p className="text-slate-400 text-lg">
            {t('features.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, idx) => (
            <Card 
              key={idx}
              className="group relative overflow-hidden hover:border-cyan-500/30 transition-all duration-300 hover:bg-slate-800/50"
            >
              {/* Hover Gradient Background */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              
              <div className="relative z-10 p-6 pb-2 flex flex-row items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-slate-950 border border-white/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300 shadow-lg">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold leading-tight tracking-tight text-slate-100 group-hover:text-white transition-colors m-0">
                  {feature.title}
                </h3>
              </div>
              <CardContent className="relative z-10 pt-2">
                <CardDescription className="text-base leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
