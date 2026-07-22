import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Logo } from './Logo';

export const Footer: React.FC = () => {
  const { t } = useLanguage();

  return (
    <footer className="bg-slate-950 border-t border-white/10 pt-16 pb-8 relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          
          {/* Brand */}
          <div className="col-span-1 md:col-span-1">
            <div className="flex items-center mb-6">
              <Logo className="h-10 w-auto" />
            </div>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              {t('footer.desc')}
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-white font-semibold mb-4">{t('footer.services')}</h4>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><a href="#" className="hover:text-cyan-400 transition-colors">{t('footer.services.1')}</a></li>
              <li><a href="#" className="hover:text-cyan-400 transition-colors">{t('footer.services.2')}</a></li>
              <li><a href="#" className="hover:text-cyan-400 transition-colors">{t('footer.services.3')}</a></li>
              <li><a href="#" className="hover:text-cyan-400 transition-colors">{t('footer.services.4')}</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">{t('footer.studio')}</h4>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><a href="#gallery" className="hover:text-cyan-400 transition-colors">{t('nav.portfolio')}</a></li>
              <li><a href="#features" className="hover:text-cyan-400 transition-colors">{t('nav.howItWorks')}</a></li>
              <li><a href="#contact" className="hover:text-cyan-400 transition-colors">{t('nav.getQuote')}</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">{t('footer.legal')}</h4>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><a href="#" className="hover:text-cyan-400 transition-colors">{t('footer.legal.1')}</a></li>
              <li><a href="#" className="hover:text-cyan-400 transition-colors">{t('footer.legal.2')}</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">
            © {new Date().getFullYear()} {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  );
};
