import React, { createContext, useState, useContext, type ReactNode } from 'react';

export type Language = 'en' | 'zh-CN' | 'zh-HK';

const translations = {
  en: {
    // Navbar
    'nav.howItWorks': 'How it Works',
    'nav.portfolio': 'Portfolio',
    'nav.startProject': 'Start a Project',
    'nav.getQuote': 'Get a Quote',
    'nav.login': 'Login',
    
    // Hero
    'hero.badge': 'Now accepting new video projects',
    'hero.title1': 'Transform Scripts into',
    'hero.title2': 'Cinematic AI Videos',
    'hero.subtitle': 'You provide the vision, we provide the magic. We craft high-quality, AI-generated videos tailored to your ideas, charged simply by the minute.',
    'hero.startBtn': 'Start Your Project',
    'hero.portfolioBtn': 'View Portfolio',
    'hero.feat1': 'Script to Screen',
    'hero.feat2': '4K Resolution',
    'hero.feat3': 'Per-Minute Pricing',

    // Partners
    'partners.title': 'Trusted by innovative teams worldwide',

    // Features
    'features.title1': 'Your Personal',
    'features.title2': 'AI Production Studio',
    'features.subtitle': 'We bridge the gap between your imagination and the final render. Delegate the technical complexities of AIGC to us.',
    'features.item1.title': 'Concept to Creation',
    'features.item1.desc': 'Bring us your script, storyboard, or even just a rough idea. We handle the prompt engineering, generation, and editing.',
    'features.item2.title': 'Cinematic Visuals',
    'features.item2.desc': 'We utilize the absolute bleeding-edge of AI video models to ensure your project looks like a high-budget production.',
    'features.item3.title': 'Transparent Pricing',
    'features.item3.desc': 'No hidden fees or complex subscriptions. You are charged a flat rate per minute of the final, approved video.',
    'features.item4.title': 'Professional Audio',
    'features.item4.desc': 'Complete your video with hyper-realistic AI voiceovers, custom sound design, and atmospheric background music.',
    'features.item5.title': 'Rapid Turnaround',
    'features.item5.desc': 'Skip the weeks of traditional production. We deliver initial drafts in days, keeping your content schedule moving fast.',
    'features.item6.title': 'Collaborative Revisions',
    'features.item6.desc': 'We work closely with you to refine the generations. Your feedback directly shapes the final cut of the video.',

    // Gallery
    'gallery.title1': 'Featured',
    'gallery.title2': 'Projects',
    'gallery.subtitle': "Take a look at some of the recent videos we've produced for our clients. From commercials to short films, we bring any script to life.",
    'gallery.startBtn': 'Start Your Project',
    'gallery.type1': 'Sci-Fi Short Film Trailer',
    'gallery.type2': 'Perfume Commercial',
    'gallery.type3': 'Documentary Intro',
    'gallery.type4': 'Travel Agency Promo',
    'gallery.type5': 'Music Video Visualizer',
    'gallery.type6': 'Architecture Showcase',
    'gallery.type7': 'Game Concept Teaser',

    // Training Program
    'training.title1': 'Master AI Video',
    'training.title2': 'Production Bootcamp',
    'training.subtitle': 'Join our intensive 6-day offline training program. Learn the proprietary NewWay node-based workflow and go from zero experience to fulfilling commercial orders.',
    'training.feat1.title': 'Zero Experience Required',
    'training.feat1.desc': 'Step-by-step guidance from basic AI concepts to advanced prompt engineering.',
    'training.feat2.title': 'NewWay Workflow',
    'training.feat2.desc': 'Master our standardized, highly efficient node-based system for consistent results.',
    'training.feat3.title': 'Commercial Ready',
    'training.feat3.desc': 'Directly connect with real commercial projects upon graduation.',
    'training.cta': 'Enroll in Bootcamp',

    // Creator Join
    'creator.title1': 'Join Our',
    'creator.title2': 'Creator Network',
    'creator.subtitle': 'Are you a talented AI video creator? Submit your portfolio to join our roster and start receiving paid video generation orders from our clients.',
    'creator.benefit1.title': 'Consistent Orders',
    'creator.benefit1.desc': 'Get matched with clients looking for your specific visual style.',
    'creator.benefit2.title': 'Fair Compensation',
    'creator.benefit2.desc': 'Earn competitive per-minute rates for your generated content.',
    'creator.benefit3.title': 'Focus on Creating',
    'creator.benefit3.desc': 'We handle the client communication and billing, you focus on the art.',
    'creator.form.name': 'Creator Name / Studio',
    'creator.form.name.placeholder': 'Jane Doe',
    'creator.form.email': 'Email Address',
    'creator.form.email.placeholder': 'jane@example.com',
    'creator.form.portfolio': 'Portfolio Link',
    'creator.form.portfolio.placeholder': 'YouTube, Vimeo, or Website URL',
    'creator.form.specialty': 'Primary Style / Specialty',
    'creator.form.specialty.placeholder': 'Select your main style...',
    'creator.form.specialty.opt1': 'Photorealistic / Cinematic',
    'creator.form.specialty.opt2': 'Anime / 2D Animation',
    'creator.form.specialty.opt3': '3D / CGI',
    'creator.form.specialty.opt4': 'Abstract / Experimental',
    'creator.form.bio': 'Workflow & Tools',
    'creator.form.bio.placeholder': 'Tell us about the AI tools you use (Midjourney, Runway, Pika, etc.) and your general workflow...',
    'creator.form.submit': 'Apply to Join',
    'creator.alert': 'Application received! We will review your portfolio and contact you soon.',

    // Contact
    'contact.title1': "Let's Make Your",
    'contact.title2': 'Video',
    'contact.subtitle': "Have a script, a storyboard, or just a wild idea? Send us the details. We'll review your concept and provide a timeline for your AI-generated masterpiece.",
    'contact.step1.title': 'Submit Your Idea',
    'contact.step1.desc': 'Fill out the form with your script or concept and estimated video length.',
    'contact.step2.title': 'Review & Quote',
    'contact.step2.desc': "We'll get back to you within 24 hours to confirm details and lock in the per-minute rate.",
    'contact.step3.title': 'Production Begins',
    'contact.step3.desc': 'Sit back while our AI artists generate, edit, and polish your video to perfection.',
    'contact.form.name': 'Your Name',
    'contact.form.name.placeholder': 'John Doe',
    'contact.form.email': 'Email Address',
    'contact.form.email.placeholder': 'john@example.com',
    'contact.form.length': 'Estimated Video Length',
    'contact.form.length.placeholder': 'Select estimated length...',
    'contact.form.length.opt1': 'Under 1 minute (Short/Ad)',
    'contact.form.length.opt2': '1 - 3 minutes',
    'contact.form.length.opt3': '3 - 5 minutes',
    'contact.form.length.opt4': '5+ minutes',
    'contact.form.details': 'Project Details & Script',
    'contact.form.details.placeholder': 'Tell us about the visual style, tone, and paste your script or outline here...',
    'contact.form.submit': 'Submit Project Request',
    'contact.alert': 'Thanks for reaching out! We will review your project details and get back to you shortly.',

    // Footer
    'footer.desc': 'Your dedicated partner for high-end, AI-generated video production. You write the script, we create the world.',
    'footer.services': 'Services',
    'footer.services.1': 'Commercials & Ads',
    'footer.services.2': 'Music Videos',
    'footer.services.3': 'Short Films',
    'footer.services.4': 'Explainer Videos',
    'footer.studio': 'Studio',
    'footer.legal': 'Legal',
    'footer.legal.1': 'Privacy Policy',
    'footer.legal.2': 'Terms of Service',
    'footer.rights': 'NewWay. All rights reserved.',
  },
  'zh-CN': {
    // Navbar
    'nav.howItWorks': '工作原理',
    'nav.portfolio': '作品集',
    'nav.startProject': '发起项目',
    'nav.getQuote': '获取报价',
    'nav.login': '登录',
    
    // Hero
    'hero.badge': '现已接受新视频项目',
    'hero.title1': '将剧本转化为',
    'hero.title2': '电影级 AI 视频',
    'hero.subtitle': '您提供创意，我们创造奇迹。我们根据您的想法量身定制高质量的 AI 生成视频，按分钟计费。',
    'hero.startBtn': '开始您的项目',
    'hero.portfolioBtn': '查看作品集',
    'hero.feat1': '从剧本到屏幕',
    'hero.feat2': '4K 分辨率',
    'hero.feat3': '按分钟计费',

    // Partners
    'partners.title': '受到全球创新团队的信任',

    // Features
    'features.title1': '您的专属',
    'features.title2': 'AI 制作工作室',
    'features.subtitle': '我们弥合了您的想象力与最终渲染之间的差距。将 AIGC 的技术复杂性交给我们。',
    'features.item1.title': '从概念到创作',
    'features.item1.desc': '带来您的剧本、分镜或仅仅是一个初步想法。我们负责提示词工程、生成和剪辑。',
    'features.item2.title': '电影级视觉效果',
    'features.item2.desc': '我们利用最前沿的 AI 视频模型，确保您的项目看起来像高预算制作。',
    'features.item3.title': '透明定价',
    'features.item3.desc': '没有隐藏费用或复杂的订阅。您只需为最终批准的视频按分钟支付固定费率。',
    'features.item4.title': '专业音频',
    'features.item4.desc': '使用超逼真的 AI 配音、定制音效设计和氛围背景音乐来完善您的视频。',
    'features.item5.title': '快速交付',
    'features.item5.desc': '省去传统制作的数周时间。我们在几天内交付初稿，让您的内容计划快速推进。',
    'features.item6.title': '协作修改',
    'features.item6.desc': '我们与您密切合作以完善生成内容。您的反馈直接决定视频的最终剪辑。',

    // Gallery
    'gallery.title1': '精选',
    'gallery.title2': '项目',
    'gallery.subtitle': '看看我们最近为客户制作的一些视频。从商业广告到短片，我们将任何剧本变为现实。',
    'gallery.startBtn': '开始您的项目',
    'gallery.type1': '科幻短片预告',
    'gallery.type2': '香水商业广告',
    'gallery.type3': '纪录片片头',
    'gallery.type4': '旅行社宣传片',
    'gallery.type5': '音乐视频视觉',
    'gallery.type6': '建筑展示',
    'gallery.type7': '游戏概念预告',

    // Training Program
    'training.title1': '掌握 AI 视频',
    'training.title2': '全流程线下集训营',
    'training.subtitle': '加入为期 6 天的线下高强度集训。学习独家 NewWay 节点化工作流，零基础起步，结业即可直接对接商业接单。',
    'training.feat1.title': '零基础可学',
    'training.feat1.desc': '从 AI 商业认知到进阶提示词体系，手把手带您入门。',
    'training.feat2.title': 'NewWay 工作流',
    'training.feat2.desc': '掌握标准化、可复用、高效率的节点化生产系统。',
    'training.feat3.title': '商业接单直通车',
    'training.feat3.desc': '全流程商业案例拆解，结业即可直接对接平台真实订单。',
    'training.cta': '立即报名集训',

    // Creator Join
    'creator.title1': '加入我们的',
    'creator.title2': '创作者网络',
    'creator.subtitle': '您是一位才华横溢的 AI 视频创作者吗？提交您的作品集加入我们，开始接收来自我们客户的付费视频生成订单。',
    'creator.benefit1.title': '稳定的订单',
    'creator.benefit1.desc': '与寻找您特定视觉风格的客户进行匹配。',
    'creator.benefit2.title': '公平的报酬',
    'creator.benefit2.desc': '为您生成的内容赚取具有竞争力的每分钟费率。',
    'creator.benefit3.title': '专注于创作',
    'creator.benefit3.desc': '我们处理客户沟通和计费，您只需专注于艺术创作。',
    'creator.form.name': '创作者姓名 / 工作室',
    'creator.form.name.placeholder': '李四',
    'creator.form.email': '电子邮件地址',
    'creator.form.email.placeholder': 'lisi@example.com',
    'creator.form.portfolio': '作品集链接',
    'creator.form.portfolio.placeholder': 'YouTube, Vimeo 或网站 URL',
    'creator.form.specialty': '主要风格 / 专长',
    'creator.form.specialty.placeholder': '选择您的主要风格...',
    'creator.form.specialty.opt1': '照片级真实 / 电影级',
    'creator.form.specialty.opt2': '动漫 / 2D 动画',
    'creator.form.specialty.opt3': '3D / CGI',
    'creator.form.specialty.opt4': '抽象 / 实验性',
    'creator.form.bio': '工作流程与工具',
    'creator.form.bio.placeholder': '告诉我们您使用的 AI 工具（Midjourney, Runway, Pika 等）以及您的一般工作流程...',
    'creator.form.submit': '申请加入',
    'creator.alert': '申请已收到！我们将审核您的作品集并尽快与您联系。',

    // Contact
    'contact.title1': '让我们制作您的',
    'contact.title2': '视频',
    'contact.subtitle': '有剧本、分镜或只是一个疯狂的想法？将详细信息发送给我们。我们将评估您的概念并为您的 AI 生成杰作提供时间表。',
    'contact.step1.title': '提交您的想法',
    'contact.step1.desc': '填写表单，提供您的剧本或概念以及预计的视频长度。',
    'contact.step2.title': '评估与报价',
    'contact.step2.desc': '我们将在 24 小时内回复您，确认详细信息并锁定每分钟费率。',
    'contact.step3.title': '开始制作',
    'contact.step3.desc': '坐下来，让我们的 AI 艺术家生成、剪辑并打磨您的视频至完美。',
    'contact.form.name': '您的姓名',
    'contact.form.name.placeholder': '张三',
    'contact.form.email': '电子邮件地址',
    'contact.form.email.placeholder': 'zhangsan@example.com',
    'contact.form.length': '预计视频长度',
    'contact.form.length.placeholder': '选择预计长度...',
    'contact.form.length.opt1': '1 分钟以内（短片/广告）',
    'contact.form.length.opt2': '1 - 3 分钟',
    'contact.form.length.opt3': '3 - 5 分钟',
    'contact.form.length.opt4': '5 分钟以上',
    'contact.form.details': '项目详情与剧本',
    'contact.form.details.placeholder': '告诉我们视觉风格、基调，并在此处粘贴您的剧本或大纲...',
    'contact.form.submit': '提交项目请求',
    'contact.alert': '感谢您的联系！我们将审核您的项目详细信息并尽快回复您。',

    // Footer
    'footer.desc': '您的高端 AI 生成视频制作专属合作伙伴。您写剧本，我们创造世界。',
    'footer.services': '服务',
    'footer.services.1': '商业广告',
    'footer.services.2': '音乐视频',
    'footer.services.3': '短片',
    'footer.services.4': '讲解视频',
    'footer.studio': '工作室',
    'footer.legal': '法律',
    'footer.legal.1': '隐私政策',
    'footer.legal.2': '服务条款',
    'footer.rights': 'NewWay. 保留所有权利。',
  },
  'zh-HK': {
    // Navbar
    'nav.howItWorks': '運作原理',
    'nav.portfolio': '作品集',
    'nav.startProject': '發起專案',
    'nav.getQuote': '獲取報價',
    'nav.login': '登入',
    
    // Hero
    'hero.badge': '現已接受新影片專案',
    'hero.title1': '將劇本轉化為',
    'hero.title2': '電影級 AI 影片',
    'hero.subtitle': '您提供創意，我們創造奇蹟。我們根據您的想法量身定制高品質的 AI 生成影片，按分鐘計費。',
    'hero.startBtn': '開始您的專案',
    'hero.portfolioBtn': '查看作品集',
    'hero.feat1': '從劇本到螢幕',
    'hero.feat2': '4K 解析度',
    'hero.feat3': '按分鐘計費',

    // Partners
    'partners.title': '受到全球創新團隊的信任',

    // Features
    'features.title1': '您的專屬',
    'features.title2': 'AI 製作工作室',
    'features.subtitle': '我們彌合了您的想像力與最終渲染之間的差距。將 AIGC 的技術複雜性交給我們。',
    'features.item1.title': '從概念到創作',
    'features.item1.desc': '帶來您的劇本、分鏡或僅僅是一個初步想法。我們負責提示詞工程、生成和剪輯。',
    'features.item2.title': '電影級視覺效果',
    'features.item2.desc': '我們利用最前沿的 AI 影片模型，確保您的專案看起來像高預算製作。',
    'features.item3.title': '透明定價',
    'features.item3.desc': '沒有隱藏費用或複雜的訂閱。您只需為最終批准的影片按分鐘支付固定費率。',
    'features.item4.title': '專業音訊',
    'features.item4.desc': '使用超逼真的 AI 配音、定制音效設計和氛圍背景音樂來完善您的影片。',
    'features.item5.title': '快速交付',
    'features.item5.desc': '省去傳統製作的數週時間。我們在幾天內交付初稿，讓您的內容計畫快速推進。',
    'features.item6.title': '協作修改',
    'features.item6.desc': '我們與您密切合作以完善生成內容。您的反饋直接決定影片的最終剪輯。',

    // Gallery
    'gallery.title1': '精選',
    'gallery.title2': '專案',
    'gallery.subtitle': '看看我們最近為客戶製作的一些影片。從商業廣告到短片，我們將任何劇本變為現實。',
    'gallery.startBtn': '開始您的專案',
    'gallery.type1': '科幻短片預告',
    'gallery.type2': '香水商業廣告',
    'gallery.type3': '紀錄片片頭',
    'gallery.type4': '旅行社宣傳片',
    'gallery.type5': '音樂影片視覺',
    'gallery.type6': '建築展示',
    'gallery.type7': '遊戲概念預告',

    // Training Program
    'training.title1': '掌握 AI 影片',
    'training.title2': '全流程線下集訓營',
    'training.subtitle': '加入為期 6 天的線下高強度集訓。學習獨家 NewWay 節點化工作流，零基礎起步，結業即可直接對接商業接單。',
    'training.feat1.title': '零基礎可學',
    'training.feat1.desc': '從 AI 商業認知到進階提示詞體系，手把手帶您入門。',
    'training.feat2.title': 'NewWay 工作流',
    'training.feat2.desc': '掌握標準化、可復用、高效率的節點化生產系統。',
    'training.feat3.title': '商業接單直通車',
    'training.feat3.desc': '全流程商業案例拆解，結業即可直接對接平台真實訂單。',
    'training.cta': '立即報名集訓',

    // Creator Join
    'creator.title1': '加入我們的',
    'creator.title2': '創作者網絡',
    'creator.subtitle': '您是一位才華橫溢的 AI 影片創作者嗎？提交您的作品集加入我們，開始接收來自我們客戶的付費影片生成訂單。',
    'creator.benefit1.title': '穩定的訂單',
    'creator.benefit1.desc': '與尋找您特定視覺風格的客戶進行匹配。',
    'creator.benefit2.title': '公平的報酬',
    'creator.benefit2.desc': '為您生成的內容賺取具有競爭力的每分鐘費率。',
    'creator.benefit3.title': '專注於創作',
    'creator.benefit3.desc': '我們處理客戶溝通和計費，您只需專注於藝術創作。',
    'creator.form.name': '創作者姓名 / 工作室',
    'creator.form.name.placeholder': '李四',
    'creator.form.email': '電子郵件地址',
    'creator.form.email.placeholder': 'lisi@example.com',
    'creator.form.portfolio': '作品集連結',
    'creator.form.portfolio.placeholder': 'YouTube, Vimeo 或網站 URL',
    'creator.form.specialty': '主要風格 / 專長',
    'creator.form.specialty.placeholder': '選擇您的主要風格...',
    'creator.form.specialty.opt1': '照片級真實 / 電影級',
    'creator.form.specialty.opt2': '動漫 / 2D 動畫',
    'creator.form.specialty.opt3': '3D / CGI',
    'creator.form.specialty.opt4': '抽象 / 實驗性',
    'creator.form.bio': '工作流程與工具',
    'creator.form.bio.placeholder': '告訴我們您使用的 AI 工具（Midjourney, Runway, Pika 等）以及您的一般工作流程...',
    'creator.form.submit': '申請加入',
    'creator.alert': '申請已收到！我們將審核您的作品集並盡快與您聯絡。',

    // Contact
    'contact.title1': '讓我們製作您的',
    'contact.title2': '影片',
    'contact.subtitle': '有劇本、分鏡或只是一個瘋狂的想法？將詳細資訊發送給我們。我們將評估您的概念並為您的 AI 生成傑作提供時間表。',
    'contact.step1.title': '提交您的想法',
    'contact.step1.desc': '填寫表單，提供您的劇本或概念以及預計的影片長度。',
    'contact.step2.title': '評估與報價',
    'contact.step2.desc': '我們將在 24 小時內回覆您，確認詳細資訊並鎖定每分鐘費率。',
    'contact.step3.title': '開始製作',
    'contact.step3.desc': '坐下來，讓我們的 AI 藝術家生成、剪輯並打磨您的影片至完美。',
    'contact.form.name': '您的姓名',
    'contact.form.name.placeholder': '陳大文',
    'contact.form.email': '電子郵件地址',
    'contact.form.email.placeholder': 'chan@example.com',
    'contact.form.length': '預計影片長度',
    'contact.form.length.placeholder': '選擇預計長度...',
    'contact.form.length.opt1': '1 分鐘以內（短片/廣告）',
    'contact.form.length.opt2': '1 - 3 分鐘',
    'contact.form.length.opt3': '3 - 5 分鐘',
    'contact.form.length.opt4': '5 分鐘以上',
    'contact.form.details': '專案詳情與劇本',
    'contact.form.details.placeholder': '告訴我們視覺風格、基調，並在此處粘貼您的劇本或大綱...',
    'contact.form.submit': '提交專案請求',
    'contact.alert': '感謝您的聯絡！我們將審核您的專案詳細資訊並盡快回覆您。',

    // Footer
    'footer.desc': '您的高端 AI 生成影片製作專屬合作夥伴。您寫劇本，我們創造世界。',
    'footer.services': '服務',
    'footer.services.1': '商業廣告',
    'footer.services.2': '音樂影片',
    'footer.services.3': '短片',
    'footer.services.4': '講解影片',
    'footer.studio': '工作室',
    'footer.legal': '法律',
    'footer.legal.1': '隱私政策',
    'footer.legal.2': '服務條款',
    'footer.rights': 'NewWay. 保留所有權利。',
  }
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('en');

  const t = (key: string): string => {
    // The keys in our translations object are flat strings (e.g., 'nav.howItWorks')
    // We can access them directly instead of splitting by dot.
    const value = (translations[language] as Record<string, string>)[key];
    return value || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
