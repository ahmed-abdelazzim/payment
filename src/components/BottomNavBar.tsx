import React from 'react';

interface BottomNavBarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  hasOfflineDevices: boolean;
  language: 'en' | 'ar';
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  currentTab,
  onSelectTab,
  hasOfflineDevices,
  language,
}) => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 w-full z-40 flex justify-around items-center px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] border-t border-outline-variant/80 bg-surface-container-lowest/90 backdrop-blur-md shadow-lg transition-colors">
      {/* Tab 1: Dashboard */}
      <button
        onClick={() => onSelectTab('dashboard')}
        className={`flex flex-col items-center justify-center py-1.5 px-3.5 rounded-2xl active:scale-90 transition-all cursor-pointer ${
          currentTab === 'dashboard'
            ? 'bg-primary/10 text-primary font-bold shadow-xs border border-primary/20'
            : 'text-on-surface-variant hover:bg-surface-container'
        }`}
      >
        <span className="material-symbols-outlined text-xl">dashboard</span>
        <span className="text-label-xs font-semibold mt-0.5">
          {language === 'ar' ? 'الرئيسية' : 'Dashboard'}
        </span>
      </button>

      {/* Tab 2: Ledger */}
      <button
        onClick={() => onSelectTab('ledger')}
        className={`flex flex-col items-center justify-center py-1.5 px-3.5 rounded-2xl active:scale-90 transition-all cursor-pointer ${
          currentTab === 'ledger'
            ? 'bg-primary/10 text-primary font-bold shadow-xs border border-primary/20'
            : 'text-on-surface-variant hover:bg-surface-container'
        }`}
      >
        <span className="material-symbols-outlined text-xl">receipt_long</span>
        <span className="text-label-xs font-semibold mt-0.5">
          {language === 'ar' ? 'السجل' : 'Ledger'}
        </span>
      </button>

      {/* Tab 3: Devices */}
      <button
        onClick={() => onSelectTab('devices')}
        className={`flex flex-col items-center justify-center py-1.5 px-3.5 rounded-2xl relative active:scale-90 transition-all cursor-pointer ${
          currentTab === 'devices'
            ? 'bg-primary/10 text-primary font-bold shadow-xs border border-primary/20'
            : 'text-on-surface-variant hover:bg-surface-container'
        }`}
      >
        <span className="material-symbols-outlined text-xl">point_of_sale</span>
        <span className="text-label-xs font-semibold mt-0.5">
          {language === 'ar' ? 'الأجهزة' : 'Devices'}
        </span>
        {hasOfflineDevices && (
          <span className="absolute top-1.5 right-3 w-2 h-2 rounded-full bg-error ring-2 ring-surface-container-lowest animate-pulse"></span>
        )}
      </button>

      {/* Tab 4: Rails */}
      <button
        onClick={() => onSelectTab('rails')}
        className={`flex flex-col items-center justify-center py-1.5 px-3.5 rounded-2xl active:scale-90 transition-all cursor-pointer ${
          currentTab === 'rails'
            ? 'bg-primary/10 text-primary font-bold shadow-xs border border-primary/20'
            : 'text-on-surface-variant hover:bg-surface-container'
        }`}
      >
        <span className="material-symbols-outlined text-xl">tune</span>
        <span className="text-label-xs font-semibold mt-0.5">
          {language === 'ar' ? 'المسارات' : 'Rails'}
        </span>
      </button>
    </nav>
  );
};
