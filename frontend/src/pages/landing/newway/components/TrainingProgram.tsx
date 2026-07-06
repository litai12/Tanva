import React from 'react';
import { GraduationCap, Workflow, Rocket, ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { useLanguage } from '../contexts/LanguageContext';

export const TrainingProgram: React.FC = () => {
  const { t } = useLanguage();

  return (
    <section id="training-program" className="py-24 relative z-10 bg-slate-950 border-t border-white/5 overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left side: Text & CTA */}
          <div className="lg:col-span-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm font-medium mb-6">
              <GraduationCap className="w-4 h-4" />
              Offline Bootcamp
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              {t('training.title1')} <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">
                {t('training.title2')}
              </span>
            </h2>
            <p className="text-slate-400 text-lg mb-8 leading-relaxed">
              {t('training.subtitle')}
            </p>
            <Button 
              size="lg" 
              className="group bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_25px_rgba(99,102,241,0.5)]"
              onClick={() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t('training.cta')}
              <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>

          {/* Right side: Feature Cards */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="bg-slate-900/60 border-white/5 hover:border-indigo-500/30 transition-colors sm:col-span-2 lg:col-span-1">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                    <GraduationCap className="w-6 h-6 text-indigo-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white leading-tight m-0">{t('training.feat1.title')}</h3>
                </div>
                <p className="text-sm text-slate-400">{t('training.feat1.desc')}</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/60 border-white/5 hover:border-purple-500/30 transition-colors">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                    <Workflow className="w-6 h-6 text-purple-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white leading-tight m-0">{t('training.feat2.title')}</h3>
                </div>
                <p className="text-sm text-slate-400">{t('training.feat2.desc')}</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/60 border-white/5 hover:border-pink-500/30 transition-colors sm:col-span-2">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center shrink-0">
                    <Rocket className="w-6 h-6 text-pink-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white leading-tight m-0">{t('training.feat3.title')}</h3>
                </div>
                <p className="text-sm text-slate-400">{t('training.feat3.desc')}</p>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </section>
  );
};
