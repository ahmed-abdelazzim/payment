import React from 'react';

const ROLE_LABELS: Record<string, { ar: string; en: string }> = {
  owner: { ar: 'مالك', en: 'Owner' },
  admin: { ar: 'مدير', en: 'Admin' },
  manager: { ar: 'مشرف', en: 'Manager' },
  viewer: { ar: 'مشاهد', en: 'Viewer' },
};

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-primary/10 text-primary border-primary/25',
  admin: 'bg-secondary/10 text-secondary border-secondary/25',
  manager: 'bg-surface-container-high text-on-surface border-outline-variant',
  viewer: 'bg-surface-container text-on-surface-variant border-outline-variant',
};

interface RoleBadgeProps {
  role: string;
  language: 'en' | 'ar';
  className?: string;
}

export const RoleBadge: React.FC<RoleBadgeProps> = ({ role, language, className = '' }) => {
  const label = ROLE_LABELS[role]?.[language] ?? role;
  const style = ROLE_STYLES[role] ?? ROLE_STYLES.viewer;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 font-semibold ${style} ${className}`}
    >
      {label}
    </span>
  );
};
