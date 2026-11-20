import React from 'react';
import { PlayCircle } from 'lucide-react';
import { Button } from './ui/button';
import { useLanguage } from '../contexts/LanguageContext';

export const Gallery: React.FC = () => {
  const { t } = useLanguage();

  const galleryItems = [
    {
      id: 1,
      url: 'https://picsum.photos/800/600?random=10',
      title: 'Neon Genesis',
      type: t('gallery.type1'),
      span: 'col-span-1 md:col-span-2 row-span-2'
    },
    {
      id: 2,
      url: 'https://picsum.photos/400/400?random=20',
      title: 'Aura',
      type: t('gallery.type2'),
      span: 'col-span-1 row-span-1'
    },
    {
      id: 3,
      url: 'https://picsum.photos/400/400?random=30',
      title: 'Deep Space',
      type: t('gallery.type3'),
      span: 'col-span-1 row-span-1'
    },
    {
      id: 4,
      url: 'https://picsum.photos/800/400?random=40',
      title: 'Wanderlust',
      type: t('gallery.type4'),
      span: 'col-span-1 md:col-span-2 row-span-1'
    },
    {
      id: 5,
      url: 'https://picsum.photos/400/600?random=50',
      title: 'Cybernetic',
      type: t('gallery.type5'),
      span: 'col-span-1 row-span-2'
    },
    {
      id: 6,
      url: 'https://picsum.photos/400/400?random=60',
      title: 'Brutalism',
      type: t('gallery.type6'),
      span: 'col-span-1 row-span-1'
    },
    {
      id: 7,
      url: 'https://picsum.photos/400/400?random=70',
      title: 'The Artifact',
      type: t('gallery.type7'),
      span: 'col-span-1 row-span-1'
    }
  ];

  return (
    <section id="gallery" className="py-24 relative z-10 bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {t('gallery.title1')} <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">{t('gallery.title2')}</span>
            </h2>
            <p className="text-slate-400 text-lg">
              {t('gallery.subtitle')}
            </p>
          </div>
          <Button 
            variant="outline" 
            className="shrink-0"
            onClick={() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })}
          >
            {t('gallery.startBtn')}
          </Button>
        </div>

        {/* Masonry-style Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-[200px]">
          {galleryItems.map((item) => (
            <div 
              key={item.id} 
              className={`group relative rounded-xl overflow-hidden bg-slate-900 border border-white/5 cursor-pointer ${item.span}`}
            >
              <img 
                src={item.url} 
                alt={item.title}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-80 group-hover:opacity-100"
                loading="lazy"
              />
              
              {/* Play Button Overlay */}
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="w-12 h-12 rounded-full bg-slate-950/50 backdrop-blur-sm flex items-center justify-center border border-white/20 group-hover:scale-110 group-hover:bg-cyan-500/80 group-hover:border-cyan-400 transition-all duration-300">
                  <PlayCircle className="w-6 h-6 text-white ml-1" />
                </div>
              </div>

              {/* Text Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6 z-20">
                <div className="translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                  <p className="text-xs font-mono text-cyan-400 mb-1 uppercase tracking-wider">{item.type}</p>
                  <p className="text-lg font-bold text-white">
                    {item.title}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
