import React, { useEffect } from 'react';
import { Workspace, User } from '../types';

interface NavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
  currentUser?: User;
  devicesOnlineCount: number;
  totalDevicesCount: number;
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenOnboarding: () => void;
  onSwitchWorkspace: () => void;
  onLogout: () => void;
  language: 'en' | 'ar';
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  isOpen,
  onClose,
  workspace,
  currentUser,
  devicesOnlineCount,
  totalDevicesCount,
  currentTab,
  onSelectTab,
  onOpenOnboarding,
  onSwitchWorkspace,
  onLogout,
  language,
  theme,
  onToggleTheme,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Slide-out Drawer */}
      <aside
        id="sideDrawer"
        className={`fixed inset-y-0 ${
          language === 'ar' ? 'left-0 border-r' : 'right-0 border-l'
        } w-80 max-w-full z-50 flex flex-col justify-between p-margin-mobile border-outline-variant bg-surface-container-lowest shadow-2xl transition-transform duration-200 ease-in-out ${
          isOpen
            ? 'translate-x-0'
            : language === 'ar'
            ? '-translate-x-full'
            : 'translate-x-full'
        }`}
      >
        {/* Header / Profile Area */}
        <div className="space-y-space-md">
          <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant">
            <div className="flex items-center gap-space-sm">
              <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center font-bold text-title-md">
                {workspace.initials || workspace.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <h3 className="text-title-sm text-on-surface font-bold truncate">
                  {language === 'ar' ? workspace.nameAr || workspace.name : workspace.name}
                </h3>
                <p className="text-label-xs text-on-surface-variant truncate">
                  {currentUser?.email || workspace.subTitle}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-on-surface-variant hover:bg-surface-container rounded-lg"
              aria-label="Close Drawer"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          {/* User Role Card */}
          {currentUser && (
            <div className="p-3 rounded-xl bg-surface-container-low border border-outline-variant flex items-center justify-between">
              <div>
                <span className="text-label-xs text-on-surface-variant block">
                  {language === 'ar' ? 'المستخدم الحالي' : 'Active Account'}
                </span>
                <span className="text-body-sm font-bold text-on-surface">
                  {currentUser.fullName}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-label-xs font-bold bg-primary text-on-primary uppercase">
                {currentUser.role}
              </span>
            </div>
          )}

          {/* Meta status */}
          <div className="p-2.5 rounded-xl bg-surface-container-low border border-outline-variant flex items-center justify-between">
            <span className="text-label-sm text-on-surface-variant">
              {language === 'ar' ? 'حالة اتصال الأجهزة' : 'Terminals Status'}
            </span>
            <span className="text-label-sm font-code-num text-primary font-bold">
              {devicesOnlineCount}/{totalDevicesCount} {language === 'ar' ? 'أجهزة متصلة' : 'Online'}
            </span>
          </div>

          {/* Drawer Navigation Tabs */}
          <nav className="space-y-1">
            <button
              onClick={() => {
                onSelectTab('dashboard');
                onClose();
              }}
              className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                currentTab === 'dashboard'
                  ? 'bg-surface-container text-primary font-semibold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-xl">dashboard</span>
              <span className="text-body-md">
                {language === 'ar' ? 'لوحة المراقبة الحية' : 'Live Dashboard'}
              </span>
            </button>

            <button
              onClick={() => {
                onSelectTab('ledger');
                onClose();
              }}
              className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                currentTab === 'ledger'
                  ? 'bg-surface-container text-primary font-semibold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-xl">fact_check</span>
              <span className="text-body-md">
                {language === 'ar' ? 'طابور المطابقة والمعاملات' : 'Reconciliation Queue'}
              </span>
            </button>

            <button
              onClick={() => {
                onSelectTab('rails');
                onClose();
              }}
              className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                currentTab === 'rails'
                  ? 'bg-surface-container text-primary font-semibold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-xl">hub</span>
              <span className="text-body-md">
                {language === 'ar' ? 'مسارات التسوية والحدود' : 'Payment Sources & Limits'}
              </span>
            </button>

            <button
              onClick={() => {
                onSelectTab('devices');
                onClose();
              }}
              className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                currentTab === 'devices'
                  ? 'bg-surface-container text-primary font-semibold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-xl">devices</span>
              <span className="text-body-md">
                {language === 'ar' ? 'أسطول أجهزة الدفع (POS)' : 'POS Terminal Fleet'}
              </span>
            </button>

            <button
              onClick={() => {
                onSelectTab('audit');
                onClose();
              }}
              className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                currentTab === 'audit'
                  ? 'bg-surface-container text-primary font-semibold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-xl">admin_panel_settings</span>
              <span className="text-body-md">
                {language === 'ar' ? 'سجلات الأمان والتدقيق' : 'Audit & Security Logs'}
              </span>
            </button>

            <button
              onClick={() => {
                onSelectTab('settings');
                onClose();
              }}
              className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                currentTab === 'settings'
                  ? 'bg-surface-container text-primary font-semibold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-xl">settings</span>
              <span className="text-body-md">
                {language === 'ar' ? 'إعدادات المؤسسة والفريق' : 'Workspace & Team'}
              </span>
            </button>

            {/* Subscriptions & Plans */}
            <button
              onClick={() => {
                onSelectTab('subscriptions');
                onClose();
              }}
              className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                currentTab === 'subscriptions'
                  ? 'bg-surface-container text-primary font-semibold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined text-xl text-primary">workspace_premium</span>
              <span className="text-body-md font-medium">
                {language === 'ar' ? 'الباقات والاشتراك' : 'Plans & Subscriptions'}
              </span>
            </button>

            {/* Platform Owner Console (Protected for Platform Master) */}
            {currentUser?.isPlatformAdmin && (
              <button
                onClick={() => {
                  onSelectTab('platform');
                  onClose();
                }}
                className={`w-full flex items-center gap-space-sm px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right ${
                  currentTab === 'platform'
                    ? 'bg-primary/10 text-primary font-bold border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary'
                    : 'text-primary hover:bg-primary/5 font-semibold'
                }`}
              >
                <span className="material-symbols-outlined text-xl">shield_person</span>
                <span className="text-body-md">
                  {language === 'ar' ? 'لوحة صاحب المنصة' : 'Platform Owner Console'}
                </span>
              </button>
            )}

            <button
              onClick={() => {
                onOpenOnboarding();
                onClose();
              }}
              className="w-full flex items-center gap-space-sm text-primary hover:bg-surface-container-low px-space-md py-space-sm rounded-lg transition-colors text-left rtl:text-right font-medium"
            >
              <span className="material-symbols-outlined text-xl">rocket_launch</span>
              <span className="text-body-md">
                {language === 'ar' ? 'دليل البدء والإعداد' : 'Setup Guide & Launchpad'}
              </span>
            </button>
          </nav>
        </div>

        {/* Drawer Footer Actions */}
        <div className="border-t border-outline-variant pt-space-sm space-y-2">
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className="w-full py-2 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-lg text-label-sm font-semibold border border-outline-variant flex items-center justify-between px-3 active:scale-95 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-primary">
                  {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                </span>
                <span>
                  {theme === 'dark'
                    ? (language === 'ar' ? 'الوضع النهاري' : 'Light Mode')
                    : (language === 'ar' ? 'الوضع الليلي (Night Mode)' : 'Night Mode')}
                </span>
              </div>
              <span className="text-label-xs font-mono px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-bold">
                {theme === 'dark' ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          <button
            onClick={onSwitchWorkspace}
            className="w-full py-2 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-lg text-label-sm font-semibold border border-outline-variant flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-base">swap_horiz</span>
            <span>{language === 'ar' ? 'تبديل مساحة العمل' : 'Switch Merchant Workspace'}</span>
          </button>

          <button
            onClick={onLogout}
            className="w-full py-2 text-error hover:bg-error-container/20 rounded-lg text-label-sm font-semibold border border-error/20 flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-base">logout</span>
            <span>{language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}</span>
          </button>
        </div>
      </aside>
    </>
  );
};
