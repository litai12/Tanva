import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export const Partners: React.FC = () => {
  const { t } = useLanguage();
  
  // Placeholder names for tech companies
  const partners = [
    "Quantum Dynamics",
    "Stellar AI",
    "Nebula Systems",
    "CyberDyne",
    "Aperture Tech",
    "OmniCorp"
  ];

  return (
    <section className="py-12 border-y border-white/5 bg-slate-950/50 relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-sm font-medium text-slate-500 mb-8 uppercase tracking-widest">
          {t('partners.title')}
        </p>
        <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-60">
          {partners.map((partner, idx) => (
            <div 
              key={idx} 
              className="text-xl md:text-2xl font-bold text-slate-400 hover:text-white transition-colors duration-300 cursor-default flex items-center gap-2"
            >
              {/* Abstract logo shape */}
              <div className="w-6 h-6 rounded-sm bg-current opacity-50 rotate-45"></div>
              {partner}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
