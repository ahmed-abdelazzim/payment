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
    <header className="sticky top-0 z-40 w-full bg-surface-container-lowest/85 backdrop-blur-md border-b border-outline-variant/80 shadow-xs transition-colors">
      <div className="max-w-7xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between">
        {/* Leading & Brand Cluster */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-primary font-bold">
            <div className="w-8 h-8 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-lg">
                account_balance_wallet
              </span>
            </div>
            <span className="text-title-md font-extrabold tracking-tight">Sarraf Ops</span>
            <span className="text-label-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
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
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Live Terminal Connection Pill */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-low border border-outline-variant shadow-xs">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                devicesOnlineCount > 0 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-outline'
              }`}
            ></span>
            <span className="text-label-sm font-code-num text-on-surface whitespace-nowrap font-medium">
              {devicesOnlineCount}/{totalDevicesCount} {language === 'ar' ? 'أجهزة متصلة' : 'Online'}
            </span>
          </div>

          {/* Home Link */}
          {onNavigateHome && (
            <button
              onClick={onNavigateHome}
              title={language === 'ar' ? 'الصفحة الرئيسية للمنصة' : 'Public Website'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant bg-surface-container-low text-label-sm font-semibold text-on-surface hover:bg-surface-container transition-all active:scale-95 cursor-pointer"
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant bg-surface-container-low text-label-sm font-semibold text-primary hover:bg-surface-container transition-all active:scale-95 cursor-pointer"
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-primary/30 bg-primary/10 text-label-sm font-bold text-primary hover:bg-primary/20 transition-all active:scale-95 cursor-pointer"
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
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-label-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface active:scale-95 transition-all cursor-pointer border border-transparent hover:border-outline-variant"
            aria-label="Switch Language"
          >
            <span className="material-symbols-outlined text-sm">translate</span>
            <span className={`font-bold ${language === 'en' ? 'text-primary' : 'text-on-surface-variant'}`}>
              EN
            </span>
            <span className="text-outline/40">|</span>
            <span className={`font-bold ${language === 'ar' ? 'text-primary' : 'text-on-surface-variant'}`}>
              عربي
            </span>
          </button>

          {/* Night Mode Theme Toggle */}
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              id="themeToggle"
              className="flex items-center justify-center w-8 h-8 rounded-xl text-on-surface-variant hover:text-primary hover:bg-surface-container active:scale-90 transition-all cursor-pointer border border-transparent hover:border-outline-variant"
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
            className="flex items-center gap-2 p-1.5 rounded-xl text-on-surface-variant hover:bg-surface-container active:scale-95 transition-all cursor-pointer border border-transparent hover:border-outline-variant"
            title="Open Workspace Menu"
            aria-label="Toggle Drawer"
          >
            <div className="w-7 h-7 rounded-lg bg-primary text-on-primary font-bold text-label-xs flex items-center justify-center shadow-xs">
              {currentUser ? currentUser.fullName[0].toUpperCase() : workspace.initials}
            </div>
            <span className="material-symbols-outlined text-xl">menu</span>
          </button>
        </div>
      </div>
    </header>
  );
};
