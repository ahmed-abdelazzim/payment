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
  onNavigateHome,
  theme,
  onToggleTheme,
}) => {
  return (
    <header className="fixed top-0 left-0 w-full z-40 bg-surface-container-lowest border-b border-outline-variant shadow-none">
      <div className="max-w-7xl mx-auto h-12 px-margin-mobile flex items-center justify-between">
        {/* Leading & Brand Cluster */}
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-space-xs text-primary">
            <span className="material-symbols-outlined text-primary text-xl">
              account_balance_wallet
            </span>
            <span className="text-title-md font-bold tracking-tight">Sarraf Ops</span>
            <span className="text-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-primary font-semibold">
              {language === 'ar' ? 'صرّاف مصر' : 'Enterprise'}
            </span>
          </div>

          <div className="h-4 w-px bg-outline-variant mx-1 hidden sm:block"></div>

          {/* Enterprise Workspace Context */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-body-md text-on-surface font-bold">
              {language === 'ar' ? workspace.nameAr || workspace.name : workspace.name}
            </span>
            <span className="text-label-sm text-on-surface-variant font-normal">
              · {language === 'ar' ? workspace.name : workspace.nameAr || workspace.name}
            </span>
          </div>
        </div>

        {/* Telemetry Badge & Global Actions */}
        <div className="flex items-center gap-2 sm:gap-space-md">
          {/* Live Terminal Connection Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container-low border border-outline-variant">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                devicesOnlineCount > 0 ? 'bg-primary animate-pulse' : 'bg-outline'
              }`}
            ></span>
            <span className="text-label-sm font-code-num text-on-surface whitespace-nowrap">
              {devicesOnlineCount}/{totalDevicesCount} {language === 'ar' ? 'أجهزة متصلة' : 'Devices Online'}
            </span>
          </div>

          {/* Home Link */}
          {onNavigateHome && (
            <button
              onClick={onNavigateHome}
              title={language === 'ar' ? 'الصفحة الرئيسية للمنصة' : 'Public Website'}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container transition-all active:scale-95 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">home</span>
              <span className="hidden md:inline">
                {language === 'ar' ? 'الرئيسية' : 'Home'}
              </span>
            </button>
          )}

          {/* Onboarding Launchpad Guide Trigger */}
          <button
            onClick={onOpenOnboarding}
            title={language === 'ar' ? 'دليل البدء السريع وضبط مساحة العمل' : 'Onboarding Launchpad'}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant bg-surface-container-low text-label-sm font-semibold text-primary hover:bg-surface-container transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-sm text-primary">rocket_launch</span>
            <span className="hidden md:inline">
              {language === 'ar' ? 'دليل البدء' : 'Setup Guide'}
            </span>
          </button>

          {/* Subscriptions & Plans Quick Access */}
          {onOpenSubscriptions && (
            <button
              onClick={onOpenSubscriptions}
              title={language === 'ar' ? 'الباقات والاشتراك' : 'Plans & Subscriptions'}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary/30 bg-primary/10 text-label-sm font-bold text-primary hover:bg-primary/20 transition-all active:scale-95 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">workspace_premium</span>
              <span className="hidden lg:inline">
                {language === 'ar' ? 'الباقات' : 'Plans'}
              </span>
            </button>
          )}

          {/* Language Switcher */}
          <button
            onClick={onToggleLanguage}
            id="langToggle"
            className="flex items-center gap-1 px-2 py-1 rounded text-label-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface active:scale-95 transition-all"
            aria-label="Switch Language"
          >
            <span className="material-symbols-outlined text-sm">translate</span>
            <span className={`font-bold ${language === 'en' ? 'text-primary' : 'text-on-surface-variant'}`}>
              EN
            </span>
            <span className="text-outline">|</span>
            <span className={`font-bold ${language === 'ar' ? 'text-primary' : 'text-on-surface-variant'}`}>
              العربية
            </span>
          </button>

          {/* Night Mode Theme Toggle */}
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              id="themeToggle"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container active:scale-90 transition-all cursor-pointer"
              title={theme === 'dark' ? (language === 'ar' ? 'تفعيل الوضع النهاري' : 'Switch to Light Mode') : (language === 'ar' ? 'تفعيل الوضع الليلي (Night Mode)' : 'Switch to Dark Mode')}
              aria-label="Toggle Theme"
            >
              <span className="material-symbols-outlined text-lg">
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
          )}

          {/* User Profile Avatar / Drawer Opener */}
          <button
            onClick={onToggleDrawer}
            className="flex items-center gap-1.5 p-1 rounded-lg text-on-surface-variant hover:bg-surface-container active:scale-95 transition-all"
            title="Open Workspace Menu"
            aria-label="Toggle Drawer"
          >
            <div className="w-7 h-7 rounded-full bg-primary text-on-primary font-bold text-label-xs flex items-center justify-center">
              {currentUser ? currentUser.fullName[0].toUpperCase() : workspace.initials}
            </div>
            <span className="material-symbols-outlined text-xl">menu</span>
          </button>
        </div>
      </div>
    </header>
  );
};
