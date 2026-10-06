import React from 'react';

interface ViewLoadingSkeletonProps {
  message?: string;
}

export const ViewLoadingSkeleton: React.FC<ViewLoadingSkeletonProps> = ({ message }) => {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-200">
      <div className="relative mb-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-xs">
          <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
        </div>
      </div>
      <p className="text-body-sm text-on-surface-variant font-medium">
        {message || 'جاري تحميل البيانات...'}
      </p>
    </div>
  );
};
