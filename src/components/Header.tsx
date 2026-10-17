import React from 'react';
import { Workspace, User } from '../types';

interface HeaderProps {
  workspace: Workspace;
  currentUser?: User;
  devicesOnlineCount: number;
  totalDevicesCount: number;
  language: 'en' | 'ar';
  onToggleLanguage: () => void;
  onToggleDrawer: () => void;
  onOpenOnboarding: () => void;
  onOpenSubscriptions?: () => void;
  onOpenIntegrations?: () => void;
  onNavigateHome?: () => void;
  currentTab: string;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  workspace,
  currentUser,
  devicesOnlineCount,
  totalDevicesCount,
  language,
  onToggleLanguage,
  onToggleDrawer,
  onOpenOnboarding,
  onOpenSubscriptions,
  onOpenIntegrations,
  onNavigateHome,
  currentTab,
  theme,
  onToggleTheme,
}) => {
  const isArabic = language === 'ar';
  const workspaceName = isArabic ? workspace.nameAr || workspace.name : workspace.name;
  const userInitial = currentUser?.fullName?.trim()?.[0]?.toUpperCase() || workspace.initials || 'S';

  return (
    <header className="sarraf-app-header sticky top-0 z-40 border-b border-outline-variant/90 bg-surface-container-lowest/95 backdrop-blur-xl">
      <div className="h-16 px-4 lg:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onToggleDrawer}
            className="sarraf-mobile-menu sarraf-icon-button"
            aria-label={isArabic ? 'فتح قائمة مساحة العمل' : 'Open workspace menu'}
          >
            <span className="material-symbols-outlined">menu</span>
          </button>

          <div className="sarraf-mobile-brand items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded bg-primary text-on-primary flex items-center justify-center font-black">ص</div>
            <div className="leading-tight min-w-0">
              <p className="text-xs font-extrabold text-on-surface truncate">Sarraf Ops</p>
              <p className="text-[9px] text-on-surface-variant truncate">{isArabic ? 'تشغيل المدفوعات' : 'Payment operations'}</p>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded bg-primary text-on-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-xl">account_balance</span>
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-label-xs text-on-surface-variant font-semibold">
                {isArabic ? 'مساحة العمل النشطة' : 'Active workspace'}
              </p>
              <p className="text-body-sm text-on-surface font-extrabold truncate">{workspaceName}</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded border border-outline-variant bg-surface-container-low">
            <span className={`w-2 h-2 rounded-full ${devicesOnlineCount > 0 ? 'bg-emerald-500 sarraf-status-dot' : 'bg-slate-400'}`} />
            <span className="text-label-xs font-code-num font-bold text-on-surface whitespace-nowrap">
              {devicesOnlineCount}/{totalDevicesCount}
            </span>
            <span className="text-label-xs text-on-surface-variant whitespace-nowrap">
              {isArabic ? 'أجهزة متصلة' : 'devices online'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {onNavigateHome && (
            <button onClick={onNavigateHome} className="sarraf-header-action" title={isArabic ? 'الرئيسية' : 'Home'}>
              <span className="material-symbols-outlined text-[18px]">home</span>
              <span className="hidden xl:inline">{isArabic ? 'الرئيسية' : 'Home'}</span>
            </button>
          )}

          <button onClick={onOpenOnboarding} className="sarraf-header-action sarraf-header-desktop-action" title={isArabic ? 'دليل البدء' : 'Setup guide'}>
            <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
            <span className="hidden xl:inline">{isArabic ? 'دليل البدء' : 'Setup'}</span>
          </button>

          {onOpenSubscriptions && (
            <button onClick={onOpenSubscriptions} className="sarraf-header-action sarraf-header-desktop-action" title={isArabic ? 'الباقات' : 'Plans'}>
              <span className="material-symbols-outlined text-[18px]">workspace_premium</span>
              <span className="hidden xl:inline">{isArabic ? 'الباقات' : 'Plans'}</span>
            </button>
          )}

          {onOpenIntegrations && (
            <button
              onClick={onOpenIntegrations}
              className={`sarraf-header-action sarraf-header-desktop-action ${currentTab === 'integrations' ? 'sarraf-header-action-active' : ''}`}
              title={isArabic ? 'بوابة الدفع' : 'Payment gateway'}
            >
              <span className="material-symbols-outlined text-[18px]">storefront</span>
              <span className="hidden xl:inline">{isArabic ? 'بوابة الدفع' : 'Gateway'}</span>
            </button>
          )}

          <span className="hidden sm:block h-6 w-px bg-outline-variant mx-1" />

          <button onClick={onToggleLanguage} id="langToggle" className="sarraf-icon-button" aria-label="Switch Language" title={isArabic ? 'English' : 'العربية'}>
            <span className="material-symbols-outlined text-[19px]">translate</span>
            <span className="text-[10px] font-bold">{isArabic ? 'EN' : 'AR'}</span>
          </button>

          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              id="themeToggle"
              className="sarraf-icon-button"
              title={theme === 'dark' ? (isArabic ? 'الوضع النهاري' : 'Light mode') : (isArabic ? 'الوضع الليلي' : 'Dark mode')}
              aria-label="Toggle Theme"
            >
              <span className="material-symbols-outlined text-[19px]">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
            </button>
          )}

          <button onClick={onToggleDrawer} className="sarraf-profile-button" aria-label="Toggle Drawer" title={currentUser?.fullName || workspaceName}>
            <span className="hidden md:block text-end leading-tight max-w-28">
              <span className="block text-[11px] font-bold truncate text-on-surface">{currentUser?.fullName || workspaceName}</span>
              <span className="block text-[9px] text-on-surface-variant truncate">{isArabic ? 'مدير العمليات' : 'Operations admin'}</span>
            </span>
            <span className="w-8 h-8 rounded bg-primary text-on-primary font-extrabold text-label-sm flex items-center justify-center">{userInitial}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
