import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID } from '../firebase';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  isQuotaError: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', isQuotaError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const raw = error?.message || 'Terjadi kesalahan pada aplikasi.';
    const isQuotaError = raw.toLowerCase().includes('quota exceeded');
    return {
      hasError: true,
      message: raw,
      isQuotaError,
    };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const upgradeUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data?openUpgradeDialog=true`;

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            {this.state.isQuotaError
              ? 'Batas Kuota Harian Firestore Tercapai'
              : 'Terjadi Gangguan Koneksi Database'}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            {this.state.isQuotaError
              ? 'Kuota gratis harian Firestore telah habis dan akan direset keesokan hari, atau Anda dapat meningkatkan paket di Firebase Console.'
              : 'Aplikasi mengalami kesalahan saat berkomunikasi dengan Firestore. Silakan muat ulang halaman untuk mencoba kembali.'}
          </p>

          {this.state.isQuotaError && (
            <a
              href={upgradeUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs font-semibold text-[#1B8EE6] underline"
            >
              Buka Pengaturan Kuota Firebase Console
            </a>
          )}

          <div className="mt-4 max-h-28 overflow-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] text-slate-500">
            {this.state.message}
          </div>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1B8EE6] text-xs font-bold text-white hover:bg-[#1479C9]"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Muat Ulang Aplikasi</span>
          </button>
        </div>
      </div>
    );
  }
}
