import React, { useState, useEffect } from 'react';
import { architectureDocs } from '../data/architectureDocs';

interface ArchitectureDocsModalProps {
  onClose: () => void;
  language: 'en' | 'ar';
}

export const ArchitectureDocsModal: React.FC<ArchitectureDocsModalProps> = ({
  onClose,
  language,
}) => {
  const [activeDocId, setActiveDocId] = useState(architectureDocs[0].id);
  const currentDoc = architectureDocs.find((d) => d.id === activeDocId) || architectureDocs[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-surface-container-lowest border border-outline-variant rounded-2xl max-w-4xl w-full h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Top Bar */}
        <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between bg-surface-container-low/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">
                menu_book
              </span>
            </div>
            <div>
              <h2 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'المخطط الهندسي ودستور النظام' : 'SaaS Architecture & Engineering Constitution'}
              </h2>
              <p className="text-label-sm text-on-surface-variant font-code-num">
                Sarraf Ops v3.4.1 System & Technical Architecture Specification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body Layout: Sidebar + Document Content */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Docs Navigation Sidebar */}
          <aside className="w-full md:w-64 border-b md:border-b-0 border-e border-outline-variant bg-surface-container-low/50 p-3 space-y-1.5 overflow-y-auto shrink-0">
            <span className="text-label-xs text-outline font-semibold uppercase tracking-wider px-2 block mb-1">
              {language === 'ar' ? 'ملفات التخطيط المعتمدة:' : 'Approved Master Specs:'}
            </span>
            {architectureDocs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setActiveDocId(doc.id)}
                className={`w-full text-start p-2.5 rounded-xl text-label-md transition-all flex flex-col cursor-pointer ${
                  activeDocId === doc.id
                    ? 'bg-primary text-on-primary font-semibold shadow-xs'
                    : 'text-on-surface hover:bg-surface-container'
                }`}
              >
                <span className={`font-code-num text-xs ${activeDocId === doc.id ? 'opacity-80' : 'text-primary'}`}>{doc.filename}</span>
                <span className="font-medium text-body-sm truncate mt-0.5">{doc.title}</span>
              </button>
            ))}
          </aside>

          {/* Document Content Viewport */}
          <main className="flex-1 p-6 sm:p-8 overflow-y-auto bg-surface-container-lowest">
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="pb-4 border-b border-outline-variant">
                <span className="text-label-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold font-code-num border border-primary/20">
                  {currentDoc.category}
                </span>
                <h1 className="text-headline-md font-bold text-on-surface mt-2.5">
                  {currentDoc.title}
                </h1>
                <p className="text-body-md text-on-surface-variant mt-1.5 leading-relaxed">
                  {currentDoc.summary}
                </p>
              </div>

              {/* Rendered content */}
              <div className="prose prose-sm max-w-none text-on-surface space-y-3 font-body-md whitespace-pre-wrap font-sans leading-relaxed">
                {currentDoc.content}
              </div>
            </div>
          </main>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-surface-container-low/80 border-t border-outline-variant flex items-center justify-between text-label-sm text-on-surface-variant">
          <span className="font-code-num text-xs">Document: {currentDoc.filename}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-on-primary rounded-xl text-label-sm font-semibold active:scale-95 transition-all shadow-xs hover:bg-primary/90 cursor-pointer"
          >
            {language === 'ar' ? 'إغلاق' : 'Close Viewer'}
          </button>
        </div>
      </div>
    </div>
  );
};
