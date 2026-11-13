import { useEffect, useState } from 'react';

const WELCOME_PROMPTS = [
  '讲个故事',
  '复刻爆款视频',
  '做一版详情页',
  '把灵感拍成片',
  '制作产品海报',
  '设计一组配图',
  '记录生活片刻',
  '为新品写文案',
  '打造品牌视觉',
  '制作一条广告',
  '给照片换个场景',
  '探索新的创意',
];

export default function WelcomePrompt() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => (current + 1) % WELCOME_PROMPTS.length), 3000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="h-7 text-center text-[16px] font-medium leading-7 text-white/70" aria-label={`今天想：${WELCOME_PROMPTS.join('、')}`}>
      <span className="text-white/45" aria-hidden="true">今天想 </span>
      <span key={index} className="tanva-fade-in inline-block whitespace-nowrap" aria-hidden="true">{WELCOME_PROMPTS[index]}<span className="text-white/45">？</span></span>
    </div>
  );
}
