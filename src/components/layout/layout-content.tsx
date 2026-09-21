'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NavRail } from './nav-rail';
import { HeaderBar } from './header-bar';
import { MobileNav } from './mobile-nav';
import { AppShell } from './app-shell';
import { CommandPalette } from '../command-palette';

const AUTH_PATHS = ['/login'];
// Public marketing pages — no auth check, no app shell.
const PUBLIC_PATHS = ['/'];

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const isAuthPath = AUTH_PATHS.some((p) => pathname.startsWith(p));
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname === p);

  useEffect(() => {
    if (isAuthPath || isPublicPath) return;
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          router.replace(`/login?from=${encodeURIComponent(pathname)}`);
          return;
        }
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) router.replace(`/login?from=${encodeURIComponent(pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthPath, isPublicPath, pathname, router]);

  if (isAuthPath || isPublicPath) {
    return <>{children}</>;
  }

  if (!authChecked) {
    return <div className="min-h-screen" />;
  }

  return (
    <>
      <HeaderBar />
      <div className="flex min-h-[calc(100vh-var(--header-height))]">
        <NavRail />
        <AppShell>{children}</AppShell>
      </div>
      <MobileNav />
      <CommandPalette />
    </>
  );
}
