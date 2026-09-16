'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Boxes, Lock, User, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const msg = searchParams.get('error');
    if (msg) setError(msg);
  }, [searchParams]);

  useEffect(() => {
    fetch('/api/auth/providers')
      .then((r) => r.json())
      .then((data) => setGoogleEnabled(Boolean(data?.google)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Invalid credentials');
        return;
      }

      const redirect = searchParams.get('from') || '/dashboard';
      router.push(redirect);
      router.refresh();
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputShell =
    'w-full pl-9 pr-3 py-2.5 rounded-lg border border-[#ece3dc] bg-white text-[#1c1512] text-sm placeholder:text-[#a2948b] transition-all focus:outline-none focus:border-[#ff6d4a] focus:ring-2 focus:ring-[#ff6d4a]/20';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="username" className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6f6259] mb-1.5">
          Username
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#a2948b]">
            <User size={15} />
          </div>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            autoComplete="username"
            className={inputShell}
            autoFocus
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6f6259] mb-1.5">
          Password
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#a2948b]">
            <Lock size={15} />
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            className={inputShell}
            required
          />
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 text-xs text-[#d43c2e] bg-[#d43c2e]/5 border border-[#d43c2e]/20 p-3 rounded-lg animate-in"
          role="alert"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 rounded-lg bg-[#ff6d4a] text-white text-sm font-semibold hover:bg-[#f2582f] transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-[0_10px_26px_-10px_rgba(255,109,74,0.45)] focus:outline-none focus:ring-2 focus:ring-[#ff6d4a]/40 focus:ring-offset-2 focus:ring-offset-white"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>Signing in...</span>
          </>
        ) : (
          <>
            <span>Sign in</span>
            <ArrowRight size={15} />
          </>
        )}
      </button>

      {googleEnabled && (
        <a
          href={`/api/auth/google/start?from=${encodeURIComponent(searchParams.get('from') || '/dashboard')}`}
          className="block w-full py-2.5 px-4 rounded-lg border border-[#d9cbc1] bg-white text-center text-sm font-medium text-[#1c1512] hover:border-[#a2948b] transition-colors focus:outline-none focus:ring-2 focus:ring-[#ff6d4a]/30"
        >
          Sign in with Google
        </a>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#fdfbfa]">
      {/* Ambient lighting — same treatment as the landing hero */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(52rem 30rem at 85% -8%, #ffe9e0 0%, transparent 62%), radial-gradient(38rem 26rem at -12% 30%, #fff1e8 0%, transparent 55%)',
        }}
      />

      {/* Back to site */}
      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-2 text-sm font-medium text-[#6f6259] hover:text-[#1c1512] transition-colors z-20"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ff6d4a] text-white shadow-[0_4px_14px_-4px_rgba(255,109,74,0.45)]">
          <Boxes size={14} />
        </span>
        <span className="font-display font-bold tracking-tight text-[#1c1512]">
          Buzz<span className="text-[#d84e2b]">box</span>
        </span>
      </Link>

      <div className="w-full max-w-md p-6 sm:p-8 rounded-2xl border border-[#ece3dc] bg-white/90 backdrop-blur-sm shadow-[0_24px_60px_-30px_rgba(28,21,18,0.28),0_2px_6px_rgba(28,21,18,0.05)] relative z-10 animate-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#ff6d4a] text-white mb-4 shadow-[0_4px_14px_-4px_rgba(255,109,74,0.5)]">
            <Boxes size={22} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1c1512] font-display">
            Buzz<span className="text-[#d84e2b]">box</span>
          </h1>
          <p className="text-xs text-[#6f6259] mt-1">The local-first growth command center</p>
        </div>

        <Suspense
          fallback={
            <div className="h-48 flex items-center justify-center text-[#a2948b]">
              <Loader2 size={24} className="animate-spin" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>

        <div className="mt-8 pt-4 border-t border-[#ece3dc] text-center">
          <p className="text-[11px] text-[#a2948b] font-mono tracking-wide">
            BUZZBOX · SIGNAL → PLAN → APPROVE → EXECUTE
          </p>
        </div>
      </div>
    </div>
  );
}
