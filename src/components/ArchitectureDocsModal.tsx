import React, { useState } from 'react';
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

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl max-w-4xl w-full h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Top Bar */}
        <div className="px-margin-mobile py-space-sm border-b border-outline-variant flex items-center justify-between bg-surface-bright">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl">
              menu_book
            </span>
            <div>
              <h2 className="text-title-md font-bold text-on-surface">
                {language === 'ar' ? 'المخطط الهندسي ودستور النظام' : 'SaaS Architecture & Engineering Constitution'}
              </h2>
              <p className="text-label-sm text-on-surface-variant font-code-num">
                Sarraf Ops v3.4.1 Planning Specification (Sections 1-75, 4A, 4B, 12A)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:bg-surface-container rounded"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body Layout: Sidebar + Document Content */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Docs Navigation Sidebar */}
          <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-outline-variant bg-surface-container-low p-space-sm space-y-1 overflow-y-auto shrink-0">
            <span className="text-label-sm text-outline font-semibold uppercase tracking-wider px-2 block mb-1">
              {language === 'ar' ? 'ملفات التخطيط المعتمدة:' : 'Approved Master Specs:'}
            </span>
            {architectureDocs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setActiveDocId(doc.id)}
                className={`w-full text-left p-2 rounded-lg text-label-md transition-all flex flex-col ${
                  activeDocId === doc.id
                    ? 'bg-primary text-on-primary font-semibold shadow-sm'
                    : 'text-on-surface hover:bg-surface-container'
                }`}
              >
                <span className="font-code-num text-xs opacity-80">{doc.filename}</span>
                <span className="font-medium text-body-md truncate">{doc.title}</span>
              </button>
            ))}
          </aside>

          {/* Document Content Viewport */}
          <main className="flex-1 p-space-lg overflow-y-auto bg-surface-container-lowest">
            <div className="max-w-2xl mx-auto space-y-space-md">
              <div className="pb-space-sm border-b border-outline-variant">
                <span className="text-label-sm px-2 py-0.5 rounded bg-surface-container text-primary font-semibold font-code-num">
                  {currentDoc.category}
                </span>
                <h1 className="text-headline-md font-bold text-on-surface mt-1">
                  {currentDoc.title}
                </h1>
                <p className="text-body-md text-on-surface-variant mt-1">
                  {currentDoc.summary}
                </p>
              </div>

              {/* Rendered content */}
              <div className="prose prose-sm max-w-none text-on-surface space-y-space-sm font-body-md whitespace-pre-wrap font-sans">
                {currentDoc.content}
              </div>
            </div>
          </main>
        </div>

        {/* Modal Footer */}
        <div className="px-margin-mobile py-2.5 bg-surface-container-low border-t border-outline-variant flex items-center justify-between text-label-sm text-on-surface-variant">
          <span className="font-code-num">Document: {currentDoc.filename}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-primary text-on-primary rounded text-label-sm font-semibold active:scale-95 transition-all shadow-sm"
          >
            {language === 'ar' ? 'إغلاق' : 'Close Viewer'}
          </button>
        </div>
      </div>
    </div>
  );
};
