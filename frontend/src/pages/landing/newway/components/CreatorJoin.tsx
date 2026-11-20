import React, { useState } from 'react';
import { Briefcase, Star, DollarSign, Upload } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Card, CardContent } from './ui/card';
import { useLanguage } from '../contexts/LanguageContext';

export const CreatorJoin: React.FC = () => {
  const { t } = useLanguage();
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    portfolio: '',
    specialty: '',
    bio: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Creator application submitted:', formState);
    alert(t('creator.alert'));
    setFormState({ name: '', email: '', portfolio: '', specialty: '', bio: '' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormState({
      ...formState,
      [e.target.name]: e.target.value
    });
  };

  return (
    <section id="creator-join" className="py-24 relative z-10 bg-slate-900 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          
          {/* Left side: Text */}
          <div className="order-2 lg:order-1">
            <Card className="relative overflow-hidden border-white/10 p-2 bg-slate-950/50">
              {/* Glow effect behind form */}
              <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-[80px] pointer-events-none"></div>
              
              <CardContent className="pt-6 relative z-10">
                <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label htmlFor="creator-name" className="text-sm font-medium text-slate-400">
                        {t('creator.form.name')}
                      </label>
                      <Input
                        type="text"
                        id="creator-name"
                        name="name"
                        value={formState.name}
                        onChange={handleChange}
                        required
                        placeholder={t('creator.form.name.placeholder')}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label htmlFor="creator-email" className="text-sm font-medium text-slate-400">
                        {t('creator.form.email')}
                      </label>
                      <Input
                        type="email"
                        id="creator-email"
                        name="email"
                        value={formState.email}
                        onChange={handleChange}
                        required
                        placeholder={t('creator.form.email.placeholder')}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="portfolio" className="text-sm font-medium text-slate-400">
                      {t('creator.form.portfolio')}
                    </label>
                    <Input
                      type="url"
                      id="portfolio"
                      name="portfolio"
                      value={formState.portfolio}
                      onChange={handleChange}
                      required
                      placeholder={t('creator.form.portfolio.placeholder')}
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="specialty" className="text-sm font-medium text-slate-400">
                      {t('creator.form.specialty')}
                    </label>
                    <select
                      id="specialty"
                      name="specialty"
                      value={formState.specialty}
                      onChange={handleChange}
                      required
                      className="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 ring-offset-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 transition-all"
                    >
                      <option value="" disabled className="text-slate-500">{t('creator.form.specialty.placeholder')}</option>
                      <option value="photorealistic">{t('creator.form.specialty.opt1')}</option>
                      <option value="anime">{t('creator.form.specialty.opt2')}</option>
                      <option value="3d">{t('creator.form.specialty.opt3')}</option>
                      <option value="abstract">{t('creator.form.specialty.opt4')}</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="bio" className="text-sm font-medium text-slate-400">
                      {t('creator.form.bio')}
                    </label>
                    <Textarea
                      id="bio"
                      name="bio"
                      value={formState.bio}
                      onChange={handleChange}
                      required
                      rows={4}
                      placeholder={t('creator.form.bio.placeholder')}
                    />
                  </div>

                  <Button type="submit" size="lg" className="w-full group mt-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)]">
                    {t('creator.form.submit')}
                    <Upload className="w-4 h-4 ml-2 group-hover:-translate-y-1 transition-transform" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Right side: Form */}
          <div className="order-1 lg:order-2">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              {t('creator.title1')} <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500">{t('creator.title2')}</span>
            </h2>
            <p className="text-slate-400 text-lg mb-8">
              {t('creator.subtitle')}
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Briefcase className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-white font-semibold text-lg">{t('creator.benefit1.title')}</h4>
                  <p className="text-slate-400 text-sm mt-1">{t('creator.benefit1.desc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center shrink-0">
                  <DollarSign className="w-6 h-6 text-teal-400" />
                </div>
                <div>
                  <h4 className="text-white font-semibold text-lg">{t('creator.benefit2.title')}</h4>
                  <p className="text-slate-400 text-sm mt-1">{t('creator.benefit2.desc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                  <Star className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                  <h4 className="text-white font-semibold text-lg">{t('creator.benefit3.title')}</h4>
                  <p className="text-slate-400 text-sm mt-1">{t('creator.benefit3.desc')}</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
