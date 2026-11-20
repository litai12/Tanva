import React, { useState, useEffect } from 'react';
import { Menu, X, Globe } from 'lucide-react';
import { Button } from './ui/button';
import { useLanguage } from '../contexts/LanguageContext';
import { Logo } from './Logo';

export const Navbar: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: t('nav.howItWorks'), href: '#features' },
    { name: t('nav.portfolio'), href: '#gallery' },
    { name: t('nav.startProject'), href: '#contact' },
  ];

  const handleLogin = () => {
    // 子站官网与应用同域名，登录走本站相对路径
    window.location.href = '/auth/login';
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-slate-950/80 backdrop-blur-md border-b border-white/10 py-3'
          : 'bg-transparent py-5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center cursor-pointer" onClick={() => window.scrollTo(0,0)}>
            <Logo className="h-8 w-auto" />
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="text-sm font-medium text-slate-300 hover:text-cyan-400 transition-colors"
              >
                {link.name}
              </a>
            ))}
            
            {/* Language Switcher */}
            <div className="relative group ml-2">
              <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white rounded-full">
                <Globe className="w-5 h-5" />
              </Button>
              <div className="absolute right-0 mt-2 w-32 bg-slate-900 border border-white/10 rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 overflow-hidden">
                <button onClick={() => setLanguage('en')} className={`block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${language === 'en' ? 'text-cyan-400' : 'text-slate-300'}`}>English</button>
                <button onClick={() => setLanguage('zh-CN')} className={`block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${language === 'zh-CN' ? 'text-cyan-400' : 'text-slate-300'}`}>简体中文</button>
                <button onClick={() => setLanguage('zh-HK')} className={`block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${language === 'zh-HK' ? 'text-cyan-400' : 'text-slate-300'}`}>繁體中文</button>
              </div>
            </div>

            <div className="flex items-center gap-3 ml-2">
              <Button 
                variant="outline"
                className="rounded-full"
                onClick={handleLogin}
              >
                {t('nav.login')}
              </Button>
              <Button 
                className="rounded-full"
                onClick={() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })}
              >
                {t('nav.getQuote')}
              </Button>
            </div>
          </div>

          {/* Mobile Menu Toggle */}
          <div className="md:hidden flex items-center gap-2">
            {/* Mobile Language Switcher */}
            <div className="relative group">
              <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white">
                <Globe className="w-5 h-5" />
              </Button>
              <div className="absolute right-0 mt-2 w-32 bg-slate-900 border border-white/10 rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 overflow-hidden">
                <button onClick={() => setLanguage('en')} className={`block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${language === 'en' ? 'text-cyan-400' : 'text-slate-300'}`}>English</button>
                <button onClick={() => setLanguage('zh-CN')} className={`block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${language === 'zh-CN' ? 'text-cyan-400' : 'text-slate-300'}`}>简体中文</button>
                <button onClick={() => setLanguage('zh-HK')} className={`block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${language === 'zh-HK' ? 'text-cyan-400' : 'text-slate-300'}`}>繁體中文</button>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-slate-300 hover:text-white"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-slate-900 border-b border-white/10 p-4 flex flex-col gap-4 shadow-xl">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-base font-medium text-slate-300 hover:text-cyan-400 p-2 rounded-md hover:bg-white/5"
            >
              {link.name}
            </a>
          ))}
          <div className="flex flex-col gap-3 pt-4 border-t border-white/10">
            <Button 
              variant="outline"
              className="w-full justify-center"
              onClick={handleLogin}
            >
              {t('nav.login')}
            </Button>
            <Button 
              className="w-full justify-center"
              onClick={() => {
                setIsMobileMenuOpen(false);
                document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {t('nav.getQuote')}
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
};
