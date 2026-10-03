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
    <nav className="md:hidden fixed bottom-0 left-0 w-full z-40 flex justify-around items-center px-gutter-compact py-1.5 border-t border-outline-variant bg-surface-container-lowest shadow-lg">
      {/* Tab 1: Dashboard */}
      <button
        onClick={() => onSelectTab('dashboard')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg active:scale-95 transition-all ${
          currentTab === 'dashboard'
            ? 'bg-primary-container text-on-primary-container'
            : 'text-on-surface-variant hover:bg-surface-container-low'
        }`}
      >
        <span className="material-symbols-outlined text-xl">dashboard</span>
        <span className="text-label-sm font-medium mt-0.5">
          {language === 'ar' ? 'الرئيسية' : 'Dashboard'}
        </span>
      </button>

      {/* Tab 2: Ledger */}
      <button
        onClick={() => onSelectTab('ledger')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg active:scale-95 transition-all ${
          currentTab === 'ledger'
            ? 'bg-primary-container text-on-primary-container font-semibold'
            : 'text-on-surface-variant hover:bg-surface-container-low'
        }`}
      >
        <span className="material-symbols-outlined text-xl">receipt_long</span>
        <span className="text-label-sm font-medium mt-0.5">
          {language === 'ar' ? 'السجل' : 'Ledger'}
        </span>
      </button>

      {/* Tab 3: Devices */}
      <button
        onClick={() => onSelectTab('devices')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg relative active:scale-95 transition-all ${
          currentTab === 'devices'
            ? 'bg-primary-container text-on-primary-container'
            : 'text-on-surface-variant hover:bg-surface-container-low'
        }`}
      >
        <span className="material-symbols-outlined text-xl">point_of_sale</span>
        <span className="text-label-sm font-medium mt-0.5">
          {language === 'ar' ? 'الأجهزة' : 'Devices'}
        </span>
        {hasOfflineDevices && (
          <span className="absolute top-1 right-2.5 w-2 h-2 rounded-full bg-error ring-1 ring-white"></span>
        )}
      </button>

      {/* Tab 4: Rails / Settings */}
      <button
        onClick={() => onSelectTab('rails')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg active:scale-95 transition-all ${
          currentTab === 'rails'
            ? 'bg-primary-container text-on-primary-container'
            : 'text-on-surface-variant hover:bg-surface-container-low'
        }`}
      >
        <span className="material-symbols-outlined text-xl">tune</span>
        <span className="text-label-sm font-medium mt-0.5">
          {language === 'ar' ? 'المسارات' : 'Rails'}
        </span>
      </button>
    </nav>
  );
};
