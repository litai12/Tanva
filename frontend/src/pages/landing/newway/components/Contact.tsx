import React, { useState } from 'react';
import { Send, Film } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Card, CardContent } from './ui/card';
import { useLanguage } from '../contexts/LanguageContext';

export const Contact: React.FC = () => {
  const { t } = useLanguage();
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    length: '',
    message: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate form submission
    console.log('Form submitted:', formState);
    alert(t('contact.alert'));
    setFormState({ name: '', email: '', length: '', message: '' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormState({
      ...formState,
      [e.target.name]: e.target.value
    });
  };

  return (
    <section id="contact" className="py-24 relative z-10 bg-slate-950 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          
          {/* Left side: Text */}
          <div>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              {t('contact.title1')} <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">{t('contact.title2')}</span>
            </h2>
            <p className="text-slate-400 text-lg mb-8">
              {t('contact.subtitle')}
            </p>

            <div className="space-y-6 mb-10">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-1">
                  <span className="text-cyan-400 font-bold">1</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold text-lg">{t('contact.step1.title')}</h4>
                  <p className="text-slate-400 text-sm mt-1">{t('contact.step1.desc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 mt-1">
                  <span className="text-purple-400 font-bold">2</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold text-lg">{t('contact.step2.title')}</h4>
                  <p className="text-slate-400 text-sm mt-1">{t('contact.step2.desc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-1">
                  <span className="text-blue-400 font-bold">3</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold text-lg">{t('contact.step3.title')}</h4>
                  <p className="text-slate-400 text-sm mt-1">{t('contact.step3.desc')}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right side: Form */}
          <Card className="relative overflow-hidden border-white/10 p-2">
            {/* Glow effect behind form */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/20 rounded-full blur-[80px] pointer-events-none"></div>
            
            <CardContent className="pt-6 relative z-10">
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="name" className="text-sm font-medium text-slate-400">
                      {t('contact.form.name')}
                    </label>
                    <Input
                      type="text"
                      id="name"
                      name="name"
                      value={formState.name}
                      onChange={handleChange}
                      required
                      placeholder={t('contact.form.name.placeholder')}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-slate-400">
                      {t('contact.form.email')}
                    </label>
                    <Input
                      type="email"
                      id="email"
                      name="email"
                      value={formState.email}
                      onChange={handleChange}
                      required
                      placeholder={t('contact.form.email.placeholder')}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="length" className="text-sm font-medium text-slate-400">
                    {t('contact.form.length')}
                  </label>
                  <select
                    id="length"
                    name="length"
                    value={formState.length}
                    onChange={handleChange}
                    required
                    className="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 ring-offset-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 transition-all"
                  >
                    <option value="" disabled className="text-slate-500">{t('contact.form.length.placeholder')}</option>
                    <option value="< 1 min">{t('contact.form.length.opt1')}</option>
                    <option value="1-3 mins">{t('contact.form.length.opt2')}</option>
                    <option value="3-5 mins">{t('contact.form.length.opt3')}</option>
                    <option value="5+ mins">{t('contact.form.length.opt4')}</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="message" className="text-sm font-medium text-slate-400">
                    {t('contact.form.details')}
                  </label>
                  <Textarea
                    id="message"
                    name="message"
                    value={formState.message}
                    onChange={handleChange}
                    required
                    rows={5}
                    placeholder={t('contact.form.details.placeholder')}
                  />
                </div>

                <Button type="submit" size="lg" className="w-full group mt-2">
                  {t('contact.form.submit')}
                  <Film className="w-4 h-4 ml-2 group-hover:scale-110 transition-transform" />
                </Button>
              </form>
            </CardContent>
          </Card>

        </div>
      </div>
    </section>
  );
};
