import React, { useEffect } from 'react';
import { Workspace, User } from '../types';
import { RoleBadge } from './RoleBadge';

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

type NavItem = {
  id: string;
  icon: string;
  ar: string;
  en: string;
  badge?: string;
};

const navItems: NavItem[] = [
  { id: 'dashboard', icon: 'dashboard', ar: 'لوحة التحكم والسيولة', en: 'Liquidity dashboard' },
  { id: 'ledger', icon: 'receipt_long', ar: 'دفتر المعاملات الفورية', en: 'Live transaction ledger' },
  { id: 'analytics', icon: 'monitoring', ar: 'التحليلات والتقارير', en: 'Analytics & reports' },
  { id: 'integrations', icon: 'storefront', ar: 'نقاط الربط والتكاملات', en: 'Gateway & integrations' },
  { id: 'rails', icon: 'account_balance', ar: 'تسوية المحافظ والحدود', en: 'Wallets & limits' },
  { id: 'devices', icon: 'devices', ar: 'أجهزة الالتقاط والربط', en: 'Capture device fleet' },
  { id: 'audit', icon: 'shield_lock', ar: 'سجل الأمان والتدقيق', en: 'Security & audit log' },
  { id: 'settings', icon: 'tune', ar: 'إعدادات مساحة العمل', en: 'Workspace settings' },
  { id: 'subscriptions', icon: 'workspace_premium', ar: 'الباقات والاشتراك', en: 'Plans & subscription' },
];

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
  const isArabic = language === 'ar';

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const selectTab = (tab: string) => {
    onSelectTab(tab);
    onClose();
  };

  return (
    <>
      {isOpen && <button className="fixed inset-0 sarraf-modal-backdrop z-50 lg:hidden" onClick={onClose} aria-label="Close navigation" />}

      <aside
        id="sideDrawer"
        className={`sarraf-desktop-nav fixed inset-y-0 ${isArabic ? 'right-0 border-l' : 'left-0 border-r'} w-[280px] max-w-[88vw] z-50 flex flex-col border-white/10 bg-[#06102b] text-white transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : isArabic ? 'translate-x-full' : '-translate-x-full'
        }`}
      >
        <div className="px-4 pt-4 pb-3 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded bg-blue-600 text-white flex items-center justify-center font-black text-lg shrink-0">
                ص
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-extrabold text-base tracking-tight truncate">Sarraf Ops</h2>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 sarraf-status-dot" />
                </div>
                <p className="text-[10px] text-slate-400 truncate">
                  {isArabic ? 'بوابة إدارة السيولة والمطابقة' : 'Liquidity & reconciliation console'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="lg:hidden w-8 h-8 rounded border border-white/10 text-slate-300 hover:bg-white/10" aria-label="Close Drawer">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <div className="mt-4 px-3 py-2.5 rounded bg-white/[0.055] border border-white/10">
            <p className="text-[10px] text-slate-400">{isArabic ? 'مساحة العمل' : 'Workspace'}</p>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <p className="text-xs font-bold truncate">{isArabic ? workspace.nameAr || workspace.name : workspace.name}</p>
              <span className="material-symbols-outlined text-sm text-blue-300">expand_more</span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[9px] uppercase tracking-[0.16em] text-slate-500 font-bold">
              {isArabic ? 'التشغيل' : 'Operations'}
            </span>
            <span className="text-[9px] text-emerald-300 font-code-num">v3.4</span>
          </div>

          <nav className="space-y-1" aria-label={isArabic ? 'التنقل الرئيسي' : 'Primary navigation'}>
            {navItems.map((item) => {
              const active = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => selectTab(item.id)}
                  className={`sarraf-nav-item ${active ? 'sarraf-nav-item-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="material-symbols-outlined text-[19px]">{item.icon}</span>
                  <span className="flex-1 truncate">{isArabic ? item.ar : item.en}</span>
                  {item.badge && <span className="sarraf-nav-badge">{item.badge}</span>}
                </button>
              );
            })}

            {currentUser?.isPlatformAdmin && (
              <button onClick={() => selectTab('platform')} className={`sarraf-nav-item ${currentTab === 'platform' ? 'sarraf-nav-item-active' : ''}`}>
                <span className="material-symbols-outlined text-[19px]">shield_person</span>
                <span className="flex-1 truncate">{isArabic ? 'لوحة صاحب المنصة' : 'Platform owner console'}</span>
              </button>
            )}
          </nav>

          <button
            onClick={() => {
              onOpenOnboarding();
              onClose();
            }}
            className="mt-4 w-full min-h-11 px-3 rounded bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2 text-sm font-extrabold transition-colors"
          >
            <span className="material-symbols-outlined text-lg">bolt</span>
            <span>{isArabic ? 'تشغيل دليل الإعداد' : 'Launch setup guide'}</span>
          </button>
        </div>

        <div className="px-3 py-3 border-t border-white/10 space-y-2">
          {currentUser && (
            <div className="px-3 py-2.5 rounded bg-white/[0.055] border border-white/10 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-slate-400">{isArabic ? 'المستخدم الحالي' : 'Active account'}</p>
                <p className="text-xs font-bold truncate" dir="auto">{currentUser.fullName}</p>
              </div>
              <RoleBadge role={currentUser.role} language={language} />
            </div>
          )}

          <div className="flex items-center justify-between px-3 py-2 text-[11px] text-slate-300">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${devicesOnlineCount > 0 ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {isArabic ? 'حالة الاتصال' : 'Connection'}
            </span>
            <span className="font-code-num font-bold">{devicesOnlineCount}/{totalDevicesCount}</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {onToggleTheme && (
              <button onClick={onToggleTheme} className="sarraf-nav-footer-button" title={isArabic ? 'تبديل المظهر' : 'Toggle theme'}>
                <span className="material-symbols-outlined text-base">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
              </button>
            )}
            <button onClick={onSwitchWorkspace} className="sarraf-nav-footer-button" title={isArabic ? 'تبديل مساحة العمل' : 'Switch workspace'}>
              <span className="material-symbols-outlined text-base">swap_horiz</span>
            </button>
            <button onClick={onLogout} className="sarraf-nav-footer-button text-red-300 hover:text-red-200" title={isArabic ? 'تسجيل الخروج' : 'Sign out'}>
              <span className="material-symbols-outlined text-base">logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
