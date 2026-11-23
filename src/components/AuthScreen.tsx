import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle,
  AtSign,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Store,
  User,
} from 'lucide-react';
import { FIREBASE_PROJECT_ID, auth } from '../firebase';
import { ensureUserProfile } from '../services/posRepository';

const USERNAME_REGEX = /^[a-z0-9._-]{3,30}$/;
const INTERNAL_AUTH_DOMAIN = 'kasirpos.app';

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

function toInternalAuthEmail(username: string): string {
  return `${username}@${INTERNAL_AUTH_DOMAIN}`;
}

function mapAuthError(err: unknown): {
  message: string;
  needsProviderEnable?: boolean;
} {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  if (code === 'auth/operation-not-allowed') {
    return {
      message:
        'Provider Email/Password belum diaktifkan di Firebase Console (dibutuhkan Firebase untuk autentikasi Username & Kata Sandi).',
      needsProviderEnable: true,
    };
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return {
      message: 'Username atau kata sandi salah. Silakan periksa kembali.',
    };
  }
  if (code === 'auth/email-already-in-use') {
    return {
      message:
        'Username ini sudah digunakan. Silakan pilih username lain atau masuk di tab Masuk Akun.',
    };
  }
  if (code === 'auth/weak-password') {
    return { message: 'Kata sandi terlalu lemah (minimal 6 karakter).' };
  }
  if (code === 'auth/invalid-email') {
    return {
      message:
        'Format username tidak valid. Gunakan huruf, angka, titik (.), garis bawah (_), atau tanda hubung (-).',
    };
  }
  if (code === 'auth/too-many-requests') {
    return {
      message: 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.',
    };
  }
  return {
    message:
      err instanceof Error ? err.message : 'Terjadi kesalahan saat autentikasi.',
  };
}

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    needsProviderEnable?: boolean;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const rawInput = username.trim();
    if (!rawInput || !password) {
      setError({ message: 'Username dan kata sandi wajib diisi.' });
      return;
    }

    let authIdentifier = '';

    if (mode === 'register') {
      if (!displayName.trim()) {
        setError({ message: 'Nama lengkap wajib diisi.' });
        return;
      }
      if (rawInput.includes('@')) {
        setError({
          message:
            'Pendaftaran menggunakan username tanpa email (contoh: admin_toko atau budi01).',
        });
        return;
      }
      const cleanUsername = normalizeUsername(rawInput);
      if (!USERNAME_REGEX.test(cleanUsername)) {
        setError({
          message:
            'Username harus 3–30 karakter dan hanya boleh huruf, angka, titik (.), garis bawah (_), atau tanda hubung (-).',
        });
        return;
      }
      if (password.length < 6) {
        setError({ message: 'Kata sandi minimal 6 karakter.' });
        return;
      }
      if (password !== confirmPassword) {
        setError({ message: 'Konfirmasi kata sandi tidak cocok.' });
        return;
      }
      authIdentifier = toInternalAuthEmail(cleanUsername);
    } else {
      // Login: supports username; also stays compatible if user had an earlier email account
      if (rawInput.includes('@') && !rawInput.startsWith('@')) {
        authIdentifier = rawInput.toLowerCase();
      } else {
        const cleanUsername = normalizeUsername(rawInput);
        if (!USERNAME_REGEX.test(cleanUsername)) {
          setError({
            message:
              'Username tidak valid. Gunakan 3–30 karakter (huruf, angka, ., _, -).',
          });
          return;
        }
        authIdentifier = toInternalAuthEmail(cleanUsername);
      }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, authIdentifier, password);
      } else {
        const cred = await createUserWithEmailAndPassword(
          auth,
          authIdentifier,
          password
        );
        await updateProfile(cred.user, { displayName: displayName.trim() });
        await ensureUserProfile(
          cred.user.uid,
          displayName.trim(),
          storeName.trim() || 'KasirPOS Store'
        );
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const consoleAuthUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Top Brand Band */}
        <div className="bg-[#0F172A] px-6 py-5 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight">
                KasirPOS
              </h1>
              <p className="text-xs text-white/85">
                Sistem Kasir & Dashboard Pengelolaan Admin
              </p>
            </div>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 p-1.5">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`rounded-lg py-2 text-xs font-bold transition-colors ${
              mode === 'login'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Masuk Akun
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`rounded-lg py-2 text-xs font-bold transition-colors ${
              mode === 'register'
                ? 'bg-white text-[#0F172A] shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Daftar Akun Baru
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 p-6">
          {mode === 'register' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Nama Lengkap Admin
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    maxLength={80}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Nama Toko / Kafe
                </label>
                <div className="relative">
                  <Store className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    maxLength={100}
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Contoh: Kopi Nusantara"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-100"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Username
            </label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={mode === 'register' ? 30 : 80}
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.replace(/\s+/g, ''))
                }
                placeholder="Contoh: admin_toko"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-100"
              />
            </div>
            {mode === 'register' && (
              <p className="mt-1 text-[11px] text-slate-500">
                Tanpa email. Gunakan 3–30 karakter (huruf, angka, titik, _, atau -).
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Kata Sandi
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-10 pl-9 text-sm text-slate-900 focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label="Tampilkan atau sembunyikan sandi"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Konfirmasi Kata Sandi
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi kata sandi"
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-100"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <div className="flex items-start gap-2 font-semibold">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error.message}</span>
              </div>
              {error.needsProviderEnable && (
                <div className="mt-2 space-y-1 border-t border-rose-200 pt-2 text-[11px] text-rose-800">
                  <p>
                    1. Buka{' '}
                    <a
                      href={consoleAuthUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold underline"
                    >
                      Firebase Console → Authentication → Sign-in method
                    </a>
                  </p>
                  <p>
                    2. Pilih <strong>Email/Password</strong>, aktifkan{' '}
                    <strong>Enable</strong>, lalu klik <strong>Save</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0F172A] text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#1E293B] disabled:bg-slate-300"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>
              {loading
                ? 'Memproses...'
                : mode === 'login'
                  ? 'Masuk ke KasirPOS'
                  : 'Buat Akun & Mulai'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
