import React, { useState } from 'react';

interface LandingPageViewProps {
  language: 'en' | 'ar';
  onToggleLanguage: () => void;
  onNavigate: (path: string) => void;
  isLoggedIn: boolean;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const LandingPageView: React.FC<LandingPageViewProps> = ({
  language,
  onToggleLanguage,
  onNavigate,
  isLoggedIn,
  theme,
  onToggleTheme,
}) => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const faqs = [
    {
      q: language === 'ar' ? 'هل التجربة مجانية فعلًا؟' : 'Is the trial truly free?',
      a: language === 'ar'
        ? 'نعم، تقدر تجرب النظام 7 أيام مع ربط هاتف واحد، بدون كريديت كارد وبدون أي دفع مسبق.'
        : 'Yes, you can test the system for 7 full days connecting 1 terminal, with zero credit card and no upfront payment.',
    },
    {
      q: language === 'ar' ? 'ماذا يحدث بعد انتهاء التجربة؟' : 'What happens after the trial ends?',
      a: language === 'ar'
        ? 'تتوقف صلاحيات المتابعة الجديدة حتى الاشتراك، مع إمكانية دخول حسابك وقراءة بياناتك السابقة وفق سياسة الاحتفاظ.'
        : 'New transaction ingestion is paused until subscribing, while maintaining full access to sign in, review past historical records, and manage account settings.',
    },
    {
      q: language === 'ar' ? 'هل لازم أغيّر حسابي بعد الاشتراك؟' : 'Do I need to create a new account upon subscribing?',
      a: language === 'ar'
        ? 'لا، كمل من نفس الحساب، وتُفعّل صلاحيات الباقة بعد تأكيد الدفع.'
        : 'No, you continue seamlessly from the exact same workspace. Plan limits and entitlements activate upon payment confirmation.',
    },
    {
      q: language === 'ar' ? 'هل أقدر أستخدم الموقع من الآيفون؟' : 'Can I use the platform from an iPhone?',
      a: language === 'ar'
        ? 'يمكنك متابعة حسابك من المتصفح. التقاط رسائل الدفع يعتمد على توافق جهاز الاستقبال وطريقة الربط المدعومة.'
        : 'You can manage and monitor your dashboard from any mobile browser including iPhone. Real-time background SMS capture requires a dedicated supported terminal (such as an independent Android work phone).',
    },
    {
      q: language === 'ar' ? 'هل كل رسالة تعني إن الدفع مؤكد؟' : 'Does every message imply guaranteed settlement?',
      a: language === 'ar'
        ? 'النظام يعرض حالة العملية وفق البيانات المتاحة وسياسة التحقق، وقد تحتاج بعض العمليات إلى مراجعة.'
        : 'The system reflects transaction status according to captured data and verification policies. Ambiguous or anomaly events are queued for operational review.',
    },
  ];

  return (
    <div className="min-h-screen bg-surface-container-lowest text-on-surface antialiased selection:bg-primary/20 selection:text-primary">
      {/* 1. Navigation Bar */}
      <header className="sticky top-0 z-40 bg-surface-container-lowest/90 backdrop-blur-md border-b border-outline-variant">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate('/')}
              className="flex items-center gap-2 cursor-pointer focus:outline-none"
            >
              <div className="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-xs">
                <span className="material-symbols-outlined text-xl">account_balance_wallet</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-title-md font-extrabold tracking-tight text-on-surface">
                  Sarraf Ops
                </span>
                <span className="text-label-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
                  {language === 'ar' ? 'صرّاف' : 'Operations'}
                </span>
              </div>
            </button>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-body-sm font-semibold text-on-surface-variant">
            <button
              onClick={() => scrollToSection('problem')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'لماذا صرّاف؟' : 'Why Sarraf?'}
            </button>
            <button
              onClick={() => scrollToSection('features')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'المميزات' : 'Features'}
            </button>
            <button
              onClick={() => scrollToSection('gateways')}
              className="hover:text-primary transition-colors cursor-pointer text-primary font-bold"
            >
              {language === 'ar' ? 'بوابة الدفع والمتاجر' : 'Store Gateways'}
            </button>
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'كيف يعمل؟' : 'How it Works'}
            </button>
            <button
              onClick={() => scrollToSection('pricing')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'الباقات' : 'Pricing'}
            </button>
            <button
              onClick={() => scrollToSection('faq')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'الأسئلة الشائعة' : 'FAQ'}
            </button>
          </nav>

          {/* Actions & Language */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Night Mode Toggle */}
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className="w-8 h-8 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all flex items-center justify-center cursor-pointer active:scale-90"
                title={theme === 'dark' ? (language === 'ar' ? 'الوضع النهاري' : 'Light Mode') : (language === 'ar' ? 'الوضع الليلي (Night Mode)' : 'Dark Mode')}
                aria-label="Toggle Night Mode"
              >
                <span className="material-symbols-outlined text-lg">
                  {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                </span>
              </button>
            )}

            {/* Language Toggle */}
            <button
              onClick={onToggleLanguage}
              className="px-2.5 py-1 rounded-lg text-label-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all flex items-center gap-1 cursor-pointer"
              aria-label="Switch language"
            >
              <span className="material-symbols-outlined text-base">translate</span>
              <span>{language === 'ar' ? 'EN' : 'العربية'}</span>
            </button>

            {/* Auth / Dashboard CTA */}
            {isLoggedIn ? (
              <button
                onClick={() => onNavigate('/app')}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-label-md hover:bg-primary/90 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
              >
                <span className="material-symbols-outlined text-lg">dashboard</span>
                <span>{language === 'ar' ? 'افتح حسابك' : 'Open Dashboard'}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNavigate('/login')}
                  className="hidden sm:inline-flex px-3.5 py-2 rounded-xl text-label-md font-semibold text-on-surface hover:bg-surface-container transition-all cursor-pointer"
                >
                  {language === 'ar' ? 'تسجيل الدخول' : 'Sign In'}
                </button>
                <button
                  onClick={() => onNavigate('/signup')}
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-label-md hover:bg-primary/90 transition-all flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                >
                  <span>{language === 'ar' ? 'جرّب مجانًا 7 أيام' : 'Try Free 7 Days'}</span>
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="relative pt-12 pb-16 sm:pt-20 sm:pb-24 overflow-hidden border-b border-outline-variant/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-label-sm font-bold mb-6">
            <span className="material-symbols-outlined text-base">bolt</span>
            <span>{language === 'ar' ? 'متابعة مدفوعاتك تبدأ من هنا' : 'Your Payment Telemetry Starts Here'}</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-display-sm sm:text-display-md font-extrabold tracking-tight text-on-surface mb-6 leading-tight">
            {language === 'ar' ? 'كل تحويل يوصلك… خليه واضح قدامك' : 'Every payment that arrives… crystal clear in front of you'}
          </h1>

          {/* Subhead */}
          <p className="text-body-lg sm:text-title-md text-on-surface-variant max-w-3xl mx-auto mb-8 leading-relaxed font-normal">
            {language === 'ar'
              ? 'مع صرّاف، اجمع رسائل وإشعارات الدفع من المصادر المدعومة، ورتّب تحويلات عملائك في لوحة واحدة. تابع محافظك وأجهزة الاستقبال، راجع العمليات التي تحتاج تحققًا، واستقبل التنبيهات التي تساعدك تدير شغلك بثقة ووضوح.'
              : 'With Sarraf Ops, unify payment notifications from supported Egyptian payment channels into a single operational ledger. Monitor capture terminals, review unverified payments, and receive proactive limit alerts to run your business with confidence.'}
          </p>

          {/* Call to Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 mb-5">
            <button
              onClick={() => onNavigate(isLoggedIn ? '/app' : '/signup')}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-primary text-on-primary font-bold text-title-sm hover:bg-primary/90 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
            >
              <span className="material-symbols-outlined text-xl">rocket_launch</span>
              <span>{language === 'ar' ? 'ابدأ تجربتك المجانية' : 'Start Your Free Trial'}</span>
            </button>

            <button
              onClick={() => scrollToSection('features')}
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-title-sm border border-outline-variant transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <span>{language === 'ar' ? 'شوف المميزات والباقات' : 'Explore Features & Plans'}</span>
              <span className="material-symbols-outlined text-xl">expand_more</span>
            </button>
          </div>

          {/* Trust Note */}
          <p className="text-label-md font-semibold text-on-surface-variant/90">
            {language === 'ar'
              ? '7 أيام مجانًا • ربط هاتف واحد • بدون كريديت كارد أو دفع مسبق'
              : '7 Days Free • 1 Terminal Connection • No Credit Card Required'}
          </p>
        </div>

        {/* Realistic Dashboard Mock Preview */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-12 sm:mt-16">
          {/* Illustrative Watermark Badge Placed Above Mock Box */}
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high/90 text-on-surface-variant border border-outline-variant text-label-xs font-semibold shadow-xs">
              <span className="material-symbols-outlined text-sm text-primary">visibility</span>
              <span>{language === 'ar' ? 'معاينة ببيانات توضيحية' : 'Illustrative Preview with Sample Data'}</span>
            </span>
            <span className="text-label-xs font-mono text-on-surface-variant/70 hidden sm:inline">
              Sarraf Ops Enterprise
            </span>
          </div>

          <div className="relative rounded-2xl border border-outline-variant bg-surface-container-low shadow-xl overflow-hidden p-4 sm:p-6">
            {/* Mock Header Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-outline-variant mb-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-primary animate-pulse"></span>
                <span className="font-bold text-title-sm text-on-surface">
                  {language === 'ar' ? 'دفتر العمليات اللحظي — صرّاف مصر' : 'Real-time Payment Ledger'}
                </span>
                <span className="text-label-xs font-mono px-2 py-0.5 rounded bg-surface-container-high text-primary font-bold">
                  {language === 'ar' ? 'مساحة العمل التجريبية' : 'Sample Workspace'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-label-xs font-mono text-on-surface-variant">
                <span>{language === 'ar' ? 'سقف اليوم:' : 'Daily Cap:'} 28,450 / 60,000 EGP</span>
              </div>
            </div>

            {/* Mock Table Records */}
            <div className="overflow-x-auto rounded-xl bg-surface-container-lowest border border-outline-variant/60">
              <table className="w-full text-left rtl:text-right border-collapse text-body-sm">
                <thead>
                  <tr className="border-b border-outline-variant text-label-xs font-semibold text-on-surface-variant bg-surface-container-low/50">
                    <th className="py-2.5 px-3">{language === 'ar' ? 'المصدر' : 'Source'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'المرسل' : 'Sender'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'رقم المرجع' : 'Reference'}</th>
                    <th className="py-2.5 px-3">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40 font-mono text-label-sm">
                  <tr className="hover:bg-surface-container-low/40">
                    <td className="py-2.5 px-3 font-sans font-semibold text-on-surface flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      InstaPay (IPN)
                    </td>
                    <td className="py-2.5 px-3 font-bold text-primary">1,250.00 EGP</td>
                    <td className="py-2.5 px-3 font-sans text-on-surface">أحمد ممدوح - البنك الأهلي</td>
                    <td className="py-2.5 px-3 text-on-surface-variant">IPN20261003492</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-primary/10 text-primary">
                        <span className="material-symbols-outlined text-[13px]">check_circle</span>
                        {language === 'ar' ? 'مؤكد لحظياً' : 'Confirmed'}
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-surface-container-low/40">
                    <td className="py-2.5 px-3 font-sans font-semibold text-on-surface flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span>
                      Vodafone Cash
                    </td>
                    <td className="py-2.5 px-3 font-bold text-on-surface">450.00 EGP</td>
                    <td className="py-2.5 px-3 font-sans text-on-surface">01099887766</td>
                    <td className="py-2.5 px-3 text-on-surface-variant">VF9912048</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-primary/10 text-primary">
                        <span className="material-symbols-outlined text-[13px]">check_circle</span>
                        {language === 'ar' ? 'مؤكد لحظياً' : 'Confirmed'}
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-surface-container-low/40">
                    <td className="py-2.5 px-3 font-sans font-semibold text-on-surface flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      Orange Cash
                    </td>
                    <td className="py-2.5 px-3 font-bold text-on-surface">320.00 EGP</td>
                    <td className="py-2.5 px-3 font-sans text-on-surface">01223344556</td>
                    <td className="py-2.5 px-3 text-on-surface-variant">OC7741029</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 text-amber-600">
                        <span className="material-symbols-outlined text-[13px]">pending</span>
                        {language === 'ar' ? 'قيد المراجعة' : 'In Review'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Problem Section */}
      <section id="problem" className="py-16 sm:py-24 border-b border-outline-variant/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <span className="text-label-sm font-bold text-primary uppercase tracking-wider block mb-2">
              {language === 'ar' ? 'التحدي اليومي' : 'The Operational Challenge'}
            </span>
            <h2 className="text-headline-sm sm:text-headline-md font-extrabold text-on-surface mb-4">
              {language === 'ar' ? 'شغلك بيكبر… ومتابعة التحويلات لازم تبقى أسهل' : 'Your business is scaling… transaction tracking must be simpler'}
            </h2>
            <p className="text-body-md text-on-surface-variant leading-relaxed">
              {language === 'ar'
                ? 'لما الرسائل تزيد، والمحافظ تتعدد، وأكتر من عميل يحوّل في نفس الوقت، المتابعة اليدوية بتاخد وقت وبتفتح باب للّخبطة. صرّاف يساعدك تجمع المعلومات، تراجعها، وتوصل للتحويل اللي بتدور عليه بسرعة.'
                : 'As customer volume surges, multiple wallets fill up, and simultaneous transfers arrive, manual checking becomes a bottleneck prone to confusion. Sarraf Ops helps aggregate payment alerts, verify their integrity, and locate any specific transfer in seconds.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/80 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">mark_chat_read</span>
              </div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'رسائل متفرقة؟' : 'Fragmented SMS feeds?'}
              </h3>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'اجمع التحويلات من المصادر المدعومة في مكان واحد.'
                  : 'Aggregate incoming payment notifications from supported Egyptian channels into a single unified ledger.'}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/80 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">devices</span>
              </div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'أكثر من محفظة أو هاتف؟' : 'Multiple wallets or terminals?'}
              </h3>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'تابع كل مصدر استقبال بصورة واضحة.'
                  : 'Monitor each receiving source, phone telemetry, battery level, and connection status in real-time.'}
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/80 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">verified_user</span>
              </div>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'عملية تحتاج مراجعة؟' : 'A transaction needing verification?'}
              </h3>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'اعرف حالتها وتفاصيلها بدل الاعتماد على لقطة شاشة فقط.'
                  : 'Inspect transaction details, timestamps, and verification audit trails instead of blindly relying on client screenshots.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Features Section */}
      <section id="features" className="py-16 sm:py-24 border-b border-outline-variant/60 bg-surface-container-low/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <span className="text-label-sm font-bold text-primary uppercase tracking-wider block mb-2">
              {language === 'ar' ? 'مميزات المنتج' : 'Platform Capabilities'}
            </span>
            <h2 className="text-headline-sm sm:text-headline-md font-extrabold text-on-surface mb-3">
              {language === 'ar' ? 'أدوات تساعدك تتابع فلوس شغلك' : 'Tools Designed to Monitor Your Business Cash Flow'}
            </h2>
            <p className="text-body-md text-on-surface-variant">
              {language === 'ar'
                ? 'وظائف عملية منفذة فعلياً لإدارة ومطابقة مدفوعات العملاء بدون تعقيد'
                : 'Engineered capabilities to organize, verify, and streamline customer payment ingestion.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Feature 1 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">view_list</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'لوحة واحدة للتحويلات' : 'Single Ledger Dashboard'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'تابع العمليات، وابحث بالمبلغ أو المرسل أو رقم المرجع، ووصل للتفاصيل بسهولة.'
                  : 'Track transactions, filter by amount, sender, or reference code, and view details seamlessly.'}
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">hub</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'إدارة مصادر الاستقبال' : 'Payment Sources Management'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'أضف محافظك وحساباتك المدعومة، وحدد مصدر الاستقبال المناسب لتعليمات الدفع الجديدة.'
                  : 'Configure supported wallets and accounts, routing customer instructions to optimal destinations.'}
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">phonelink_ring</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'ربط هواتف العمل' : 'Work Phone Terminals'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'اجمع الرسائل من أجهزة الالتقاط المرتبطة بحسابك، وتابع حالة اتصالها.'
                  : 'Capture payment SMS feeds from dedicated work terminals, tracking their battery and health.'}
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">history_toggle_off</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'التعامل مع التكرار والتأخير' : 'Deduplication & Delay Defense'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'قلّل الاحتساب المكرر، وتابع الرسائل المتأخرة والعمليات التي تحتاج ترتيبًا أو مراجعة.'
                  : 'Mitigate duplicate counting, handle delayed cellular delivery, and sort unverified items.'}
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">notifications_active</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'تنبيهات الحدود وحالة الأجهزة' : 'Limit & Terminal Alerts'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'تابع الاستخدام المرصود وحداثة البيانات، واستقبل تنبيهات تساعدك تتصرف قبل استمرار المشكلة.'
                  : 'Track tracked turnover volume and terminal freshness, receiving alerts before capacity limits hit.'}
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">fact_check</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'مراجعة أوضح للعمليات' : 'Clear Transaction Review'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'شاهد تفاصيل العملية وحالة التحقق والمراجعة، مع سجل للإجراءات التي اتخذها فريقك.'
                  : 'Inspect event payloads, parsing parameters, and audit trails of actions taken by operators.'}
              </p>
            </div>

            {/* Feature 7 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">send</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'تنبيهات وتكاملات' : 'Webhooks & Integrations'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'اربط القنوات والتكاملات المتاحة، مثل Telegram وWebhooks، حسب مميزات باقتك.'
                  : 'Dispatch instant confirmed payment notifications to Telegram bots and your external webhooks.'}
              </p>
            </div>

            {/* Feature 8 */}
            <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 transition-all space-y-2.5 shadow-xs">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-xl">devices_other</span>
              </div>
              <h3 className="text-title-sm font-bold text-on-surface">
                {language === 'ar' ? 'واجهة تناسب يومك' : 'Adaptive Everyday UI'}
              </h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'استخدم النظام بالعربية أو الإنجليزية، من الموبايل أو الكمبيوتر.'
                  : 'Enjoy high-contrast, responsive layouts supporting Arabic RTL and English across desktop and mobile.'}
              </p>
            </div>
          </div>

          {/* Honest Disclosure Banner */}
          <div className="mt-8 p-4 rounded-xl bg-surface-container-low border border-outline-variant/80 text-body-xs text-on-surface-variant flex items-start gap-3 max-w-4xl mx-auto">
            <span className="material-symbols-outlined text-primary text-xl shrink-0 mt-0.5">info</span>
            <div>
              <span className="font-bold text-on-surface block mb-0.5">
                {language === 'ar' ? 'ملاحظة تشغيلية مهمة:' : 'Operational Integrity Note:'}
              </span>
              <p>
                {language === 'ar'
                  ? 'صرّاف يوفر أدوات تنظيم ومراقبة لحظية لرسائل وإشعارات الدفع. التقاط الرسالة ومطابقة الرصيد يساعدان في تسريع المتابعة اليومية، ولا يحلان محل التسوية الرسمية أو كشف الحساب البنكي المعتمد.'
                  : 'Sarraf Ops provides real-time telemetry and parsing for notification events. Telemetry ingestion aids daily operations and does not substitute for official banking settlement statements.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4.5 Payment Gateway & E-Commerce Integration Section */}
      <section id="gateways" className="py-16 sm:py-24 border-b border-outline-variant/60 bg-gradient-to-b from-surface-container-low/30 to-surface-container-lowest">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <span className="text-label-sm font-bold text-primary uppercase tracking-wider block mb-2">
              {language === 'ar' ? 'بوابة الدفع ومساحة عمل المتاجر' : 'E-Commerce Payment Gateway'}
            </span>
            <h2 className="text-headline-sm sm:text-headline-md font-extrabold text-on-surface mb-3">
              {language === 'ar'
                ? 'اربط متجرك واقبل فودافون كاش وإنستاباي مع تأكيد فوري'
                : 'Turn Sarraf into your Store’s Automated Payment Gateway'}
            </h2>
            <p className="text-body-md text-on-surface-variant leading-relaxed">
              {language === 'ar'
                ? 'حوّل صرّاف إلى بوابة دفع إلكترونية متكاملة لموقعك على WooCommerce أو Shopify أو Easy Orders. أموالك تصل مباشرة إلى محفظتك بدون أي وسيط مالي، مع تأكيد آلي فوري للطلبات.'
                : 'Connect your store on WooCommerce, Shopify, or Easy Orders with instant automated order confirmation. Customer funds go directly to your wallet without intermediary cuts.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* WooCommerce Card */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant hover:border-purple-500/50 transition-all shadow-xs hover:shadow-md space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-black text-xl">
                W
              </div>
              <h3 className="text-title-md font-bold text-on-surface">WooCommerce</h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'إضافة ووردبريس رسمية جاهزة للتحميل بملف ZIP. تدعم ووكومرس الحديث بنظام HPOS وتحدث حالة الطلب لمكتمل فور التحويل.'
                  : 'Ready-to-install WordPress plugin (.ZIP). HPOS compatible, auto-completes orders upon payment.'}
              </p>
            </div>

            {/* Shopify Card */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant hover:border-emerald-500/50 transition-all shadow-xs hover:shadow-md space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-black text-xl">
                S
              </div>
              <h3 className="text-title-md font-bold text-on-surface">Shopify</h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'وسيلة دفع مخصصة لمتجرك على شوبيفاي مع ربط Webhooks الطلبات لتأكيد الدفع والمزامنة التلقائية.'
                  : 'Custom payment method for Shopify stores with seamless webhook synchronization.'}
              </p>
            </div>

            {/* Easy Orders Card */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant hover:border-blue-500/50 transition-all shadow-xs hover:shadow-md space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-black text-xl">
                EO
              </div>
              <h3 className="text-title-md font-bold text-on-surface">Easy Orders</h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'تكامل مباشر وسهل مع منصة إيزي أوردرز الأكثر انتشاراً في مصر، مع توجيه المشتري لصفحة الدفع الآلية.'
                  : 'Native direct integration with Easy Orders platform in Egypt with auto-redirect.'}
              </p>
            </div>

            {/* Drop-in SDK & Custom Card */}
            <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant hover:border-primary/50 transition-all shadow-xs hover:shadow-md space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-black text-xl">
                <span className="material-symbols-outlined text-2xl">code</span>
              </div>
              <h3 className="text-title-md font-bold text-on-surface">Drop-in JS SDK</h3>
              <p className="text-body-xs text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'كود جافاسكريبت سطرين فقط لفتح نافذة دفع منبثقة أو روابط دفع سريعة لمشاركتها على واتساب والسوشيال ميديا.'
                  : 'Two lines of JavaScript for checkout modal popup or instant shareable payment links.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. How it Works Section */}
      <section id="how-it-works" className="py-16 sm:py-24 border-b border-outline-variant/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <span className="text-label-sm font-bold text-primary uppercase tracking-wider block mb-2">
              {language === 'ar' ? 'خطوات التشغيل' : 'Implementation Guide'}
            </span>
            <h2 className="text-headline-sm sm:text-headline-md font-extrabold text-on-surface mb-3">
              {language === 'ar' ? 'ابدأ بأربع خطوات بسيطة' : 'Get Started in 4 Simple Steps'}
            </h2>
            <p className="text-body-md text-on-surface-variant">
              {language === 'ar'
                ? 'تهيئة مساحة عملك وربط أول هاتف التقاط في دقائق معدودة'
                : 'Configure your merchant workspace and connect your first capture terminal in minutes.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
            {/* Step 1 */}
            <div className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/80 relative space-y-3">
              <span className="text-display-xs font-mono font-extrabold text-primary/30 block">01</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'أنشئ حسابك' : '1. Create Your Account'}
              </h3>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'ابدأ تجربة مجانية لمدة 7 أيام بدون كريديت كارد وبدون دفع مسبق.'
                  : 'Start your 7-day free trial immediately without a credit card or upfront payment.'}
              </p>
            </div>

            {/* Step 2 */}
            <div className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/80 relative space-y-3">
              <span className="text-display-xs font-mono font-extrabold text-primary/30 block">02</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'أضف مصدر استقبال' : '2. Add Receiving Source'}
              </h3>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'حدد المحفظة أو الحساب المدعوم الذي تريد متابعته.'
                  : 'Specify the wallet or supported payment account you want to monitor.'}
              </p>
            </div>

            {/* Step 3 */}
            <div className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/80 relative space-y-3">
              <span className="text-display-xs font-mono font-extrabold text-primary/30 block">03</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'اربط هاتف العمل' : '3. Connect Work Phone'}
              </h3>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'اتبع خطوات إعداد جهاز الالتقاط المناسب.'
                  : 'Follow pairing steps to link the dedicated capture terminal.'}
              </p>
            </div>

            {/* Step 4 */}
            <div className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/80 relative space-y-3">
              <span className="text-display-xs font-mono font-extrabold text-primary/30 block">04</span>
              <h3 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'تابع أول تحويل' : '4. Track First Payment'}
              </h3>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {language === 'ar'
                  ? 'شاهد الرسالة وحالة العملية داخل لوحة حسابك.'
                  : 'View incoming messages and verified transaction records inside your dashboard.'}
              </p>
            </div>
          </div>

          {/* Device Compatibility Notice */}
          <div className="mt-10 p-5 rounded-2xl bg-surface-container-low border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl">phonelink_setup</span>
              </div>
              <div>
                <h4 className="text-title-sm font-bold text-on-surface mb-1">
                  {language === 'ar' ? 'توافق الأجهزة وطريقة الالتقاط' : 'Terminal Compatibility Guidelines'}
                </h4>
                <p className="text-body-xs text-on-surface-variant leading-relaxed max-w-2xl">
                  {language === 'ar'
                    ? 'فتح الموقع من الآيفون يتيح لك إدارة حسابك ومتابعة التحويلات بالكامل. أما التقاط رسائل الدفع الخلفية فيتطلب جهاز استقبال متوافق (مثل هاتف أندرويد مستقل مخصص للعمل يعمل بتطبيق الالتقاط المعتمد).'
                    : 'Opening the web app from an iPhone enables full dashboard access and management. Real-time background SMS capture requires a compatible receiving terminal (such as an independent Android device running MacroDroid/Sarraf Agent).'}
                </p>
              </div>
            </div>

            <button
              onClick={() => onNavigate(isLoggedIn ? '/app' : '/signup')}
              className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-label-sm hover:bg-primary/90 transition-all shrink-0 cursor-pointer shadow-xs active:scale-95"
            >
              {language === 'ar' ? 'ابدأ الآن مجاناً' : 'Get Started Free'}
            </button>
          </div>
        </div>
      </section>

      {/* 6. Pricing & Plans Section */}
      <section id="pricing" className="py-16 sm:py-24 border-b border-outline-variant/60 bg-surface-container-low/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <span className="text-label-sm font-bold text-primary uppercase tracking-wider block mb-2">
              {language === 'ar' ? 'الاشتراكات والأسعار' : 'Transparent Pricing'}
            </span>
            <h2 className="text-headline-sm sm:text-headline-md font-extrabold text-on-surface mb-3">
              {language === 'ar' ? 'اختار الباقة اللي تناسب حجم شغلك' : 'Select the Plan Fitting Your Business Scale'}
            </h2>
            <p className="text-body-md text-on-surface-variant">
              {language === 'ar'
                ? 'ابدأ بتجربة مجانية لمدة 7 أيام، ولما تتأكد إن صرّاف مناسب لك، اختار عدد هواتف العمل والمدة المناسبة.'
                : 'Start with 7 days free trial. Once verified, choose the capture capacity and billing cycle that fits your operations.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {/* Monthly 3 Phones */}
            <div className="flex flex-col">
              <div className="h-7 mb-2 hidden md:block" aria-hidden="true" />
              <div className="rounded-2xl p-6 bg-surface-container-lowest border border-outline-variant flex flex-col justify-between hover:border-primary/50 transition-all shadow-xs flex-1">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'الباقة الشهرية — 3 هواتف' : 'Monthly Plan — 3 Phones'}
                  </h3>
                  <p className="text-body-xs text-on-surface-variant mb-4">
                    {language === 'ar' ? 'ربط حتى 3 هواتف لاستقبال الرسائل' : 'Connect up to 3 capture phones'}
                  </p>

                  <div className="p-4 rounded-xl bg-surface-container-low mb-5 flex items-baseline gap-1">
                    <span className="text-display-xs font-mono font-extrabold text-on-surface">499</span>
                    <span className="text-title-sm font-bold text-primary">{language === 'ar' ? 'جنيهًا' : 'EGP'}</span>
                    <span className="text-label-sm text-on-surface-variant font-normal">
                      / {language === 'ar' ? 'شهريًا' : 'month'}
                    </span>
                  </div>

                  <div className="space-y-2.5 mb-6 text-body-sm text-on-surface">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'ربط حتى 3 هواتف التقاط' : 'Up to 3 capture phones'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'لوحة قيود وتدقيق لحظي' : 'Real-time reconciliation ledger'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'تأمين مشفر HMAC-SHA256' : 'HMAC-SHA256 signature defense'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'مراقبة سقوف البنك المركزي' : 'CBE turnover ceiling monitoring'}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onNavigate(isLoggedIn ? '/app' : '/signup?plan=plan_monthly_3')}
                  className="w-full py-2.5 px-4 rounded-xl font-bold text-label-md bg-surface-container-high hover:bg-surface-container text-on-surface border border-outline-variant flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
                >
                  <span>{language === 'ar' ? 'ابدأ مجانًا ثم اشترك' : 'Start Free Then Subscribe'}</span>
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </div>
            </div>

            {/* Monthly 5 Phones */}
            <div className="flex flex-col">
              <div className="h-7 mb-2 hidden md:block" aria-hidden="true" />
              <div className="rounded-2xl p-6 bg-surface-container-lowest border border-outline-variant flex flex-col justify-between hover:border-primary/50 transition-all shadow-xs flex-1">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'الباقة الشهرية — 5 هواتف' : 'Monthly Plan — 5 Phones'}
                  </h3>
                  <p className="text-body-xs text-on-surface-variant mb-4">
                    {language === 'ar' ? 'ربط حتى 5 هواتف لاستقبال الرسائل' : 'Connect up to 5 capture phones'}
                  </p>

                  <div className="p-4 rounded-xl bg-surface-container-low mb-5 flex items-baseline gap-1">
                    <span className="text-display-xs font-mono font-extrabold text-on-surface">799</span>
                    <span className="text-title-sm font-bold text-primary">{language === 'ar' ? 'جنيهًا' : 'EGP'}</span>
                    <span className="text-label-sm text-on-surface-variant font-normal">
                      / {language === 'ar' ? 'شهريًا' : 'month'}
                    </span>
                  </div>

                  <div className="space-y-2.5 mb-6 text-body-sm text-on-surface">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'ربط حتى 5 هواتف التقاط' : 'Up to 5 capture phones'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'لوحة قيود وتدقيق لحظي' : 'Real-time reconciliation ledger'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'تنبيهات فورية عبر تيليجرام' : 'Instant Telegram bot alerts'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                      <span>{language === 'ar' ? 'سجلات تدقيق أمان كاملة' : 'Immutable security audit trail'}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onNavigate(isLoggedIn ? '/app' : '/signup?plan=plan_monthly_5')}
                  className="w-full py-2.5 px-4 rounded-xl font-bold text-label-md bg-surface-container-high hover:bg-surface-container text-on-surface border border-outline-variant flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
                >
                  <span>{language === 'ar' ? 'ابدأ مجانًا ثم اشترك' : 'Start Free Then Subscribe'}</span>
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </div>
            </div>

            {/* Annual 10 Phones */}
            <div className="flex flex-col">
              <div className="h-7 mb-2 flex items-center justify-center">
                <span className="animate-slide-down-fade inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-primary text-on-primary text-label-xs font-bold shadow-xs whitespace-nowrap">
                  <span className="material-symbols-outlined text-sm">stars</span>
                  <span>{language === 'ar' ? 'أفضل قيمة — توفير شهرين' : 'Best Value — 2 Months Free'}</span>
                </span>
              </div>

              <div className="rounded-2xl p-6 bg-surface-container-lowest border-2 border-primary flex flex-col justify-between shadow-lg ring-2 ring-primary/20 flex-1">
                <div>
                  <h3 className="text-title-md font-bold text-on-surface mb-1">
                    {language === 'ar' ? 'الباقة السنوية — 10 هواتف' : 'Annual Plan — 10 Phones'}
                  </h3>
                <p className="text-body-xs text-on-surface-variant mb-4">
                  {language === 'ar' ? 'ربط حتى 10 هواتف لاستقبال الرسائل' : 'Connect up to 10 capture phones'}
                </p>

                <div className="p-4 rounded-xl bg-surface-container-low mb-5 flex items-baseline gap-1">
                  <span className="text-display-xs font-mono font-extrabold text-on-surface">7,990</span>
                  <span className="text-title-sm font-bold text-primary">{language === 'ar' ? 'جنيهًا' : 'EGP'}</span>
                  <span className="text-label-sm text-on-surface-variant font-normal">
                    / {language === 'ar' ? 'سنويًا' : 'year'}
                  </span>
                </div>

                <div className="space-y-2.5 mb-6 text-body-sm text-on-surface">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                    <span className="font-bold">{language === 'ar' ? 'ربط حتى 10 هواتف التقاط' : 'Up to 10 capture phones'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                    <span>{language === 'ar' ? 'تشمل كل مميزات المنتج المتاحة فعلياً' : 'All implemented platform features'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                    <span>{language === 'ar' ? 'ربط ويبهوك ERP وتنبيهات تيليجرام' : 'ERP Webhooks & Telegram feeds'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                    <span>{language === 'ar' ? 'تصدير كشوفات العمليات CSV' : 'Ledger CSV report exports'}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onNavigate(isLoggedIn ? '/app' : '/signup?plan=plan_annual_10')}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-label-md bg-primary text-on-primary hover:bg-primary/90 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-95"
              >
                <span>{language === 'ar' ? 'اختار الباقة السنوية' : 'Select Annual Plan'}</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>

          <p className="text-center text-label-sm text-on-surface-variant mt-6">
            {language === 'ar'
              ? 'عدد الهواتف يشير إلى أجهزة التقاط رسائل الدفع المرتبطة بمساحة عملك، وليس عدد أعضاء الفريق أو المحافظ.'
              : 'Number of phones strictly refers to message capture terminals linked to your workspace, not team members or wallets.'}
          </p>
        </div>
      </section>

      {/* 7. FAQ Section */}
      <section id="faq" className="py-16 sm:py-24 border-b border-outline-variant/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <span className="text-label-sm font-bold text-primary uppercase tracking-wider block mb-2">
              {language === 'ar' ? 'إجابات مباشرة' : 'Direct Answers'}
            </span>
            <h2 className="text-headline-sm sm:text-headline-md font-extrabold text-on-surface">
              {language === 'ar' ? 'الأسئلة الشائعة' : 'Frequently Asked Questions'}
            </h2>
          </div>

          <div className="space-y-3.5">
            {faqs.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div
                  key={index}
                  className="rounded-xl border border-outline-variant bg-surface-container-low overflow-hidden transition-all"
                >
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full p-4.5 text-left rtl:text-right flex items-center justify-between gap-4 font-bold text-title-sm text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
                  >
                    <span>{faq.q}</span>
                    <span className={`material-symbols-outlined text-xl text-primary transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                      keyboard_arrow_down
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4.5 pb-4.5 text-body-sm text-on-surface-variant border-t border-outline-variant/50 pt-3 leading-relaxed">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 8. Closing Call to Action Section */}
      <section className="py-16 sm:py-20 bg-primary/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary text-on-primary flex items-center justify-center mx-auto mb-5 shadow-sm">
            <span className="material-symbols-outlined text-3xl">verified</span>
          </div>

          <h2 className="text-headline-sm sm:text-headline-md font-extrabold text-on-surface mb-3">
            {language === 'ar' ? 'جرّب صرّاف على شغلك الحقيقي' : 'Experience Sarraf Ops on Your Real Workflow'}
          </h2>

          <p className="text-body-md text-on-surface-variant max-w-2xl mx-auto mb-8 leading-relaxed font-normal">
            {language === 'ar'
              ? 'ابدأ بهاتف واحد لمدة 7 أيام، وشوف بنفسك إزاي تنظيم التحويلات والمتابعة من مكان واحد يساعدك في يومك.'
              : 'Begin with 1 capture phone for 7 full days, and witness how unifying your payments in one place clarifies your daily business.'}
          </p>

          <button
            onClick={() => onNavigate(isLoggedIn ? '/app' : '/signup')}
            className="px-8 py-3.5 rounded-xl bg-primary text-on-primary font-bold text-title-sm hover:bg-primary/90 transition-all inline-flex items-center gap-2 cursor-pointer shadow-md active:scale-95 mb-4"
          >
            <span>{language === 'ar' ? 'ابدأ تجربتك المجانية الآن' : 'Start Your Free Trial Now'}</span>
            <span className="material-symbols-outlined text-xl">arrow_forward</span>
          </button>

          <p className="text-label-sm font-semibold text-on-surface-variant/80">
            {language === 'ar'
              ? '7 أيام مجانًا • ربط هاتف واحد • لا حاجة لأي كريديت كارد أو دفع مسبق'
              : '7 Days Free • 1 Terminal • No Credit Card Required'}
          </p>
        </div>
      </section>

      {/* 9. Footer */}
      <footer className="py-8 border-t border-outline-variant bg-surface-container-lowest text-on-surface-variant text-body-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-on-surface">Sarraf Ops</span>
            <span>·</span>
            <span>{language === 'ar' ? 'نظام تشغيل ومراقبة التحويلات التجارية' : 'Commercial Payment Telemetry Platform'}</span>
          </div>

          <div className="flex items-center gap-4 text-label-xs font-medium">
            <button
              onClick={() => scrollToSection('features')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'المميزات' : 'Features'}
            </button>
            <button
              onClick={() => scrollToSection('pricing')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'الباقات' : 'Pricing'}
            </button>
            <button
              onClick={() => onNavigate('/login')}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'دخول' : 'Sign In'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
