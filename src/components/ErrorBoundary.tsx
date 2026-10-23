import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React ErrorBoundary:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-6 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto text-3xl font-bold">
              <span className="material-symbols-outlined text-4xl">error_outline</span>
            </div>
            
            <div className="space-y-2">
              <h1 className="text-xl font-extrabold text-white">
                تعذر تحميل الصفحة
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                حدث خطأ غير متوقع أثناء عرض هذه الواجهة. يرجى التحقق من اتصالك بالإنترنت والضغط على زر إعادة المحاولة.
              </p>
              <p className="text-xs text-slate-500 font-mono">
                An unexpected error occurred while loading this view.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-left font-mono text-xs text-rose-400 overflow-x-auto max-h-32">
                {this.state.error.message || 'Unknown render error'}
              </div>
            )}

            <button
              onClick={this.handleReload}
              className="w-full py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
              <span>إعادة المحاولة (Reload Page)</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
