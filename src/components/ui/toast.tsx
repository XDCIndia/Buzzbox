'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  add: (type: ToastType, message: string) => void;
  dismiss: (id: string) => void;
}

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  add: (type, message) => {
    const id = Math.random().toString(36).slice(2, 8);
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    // Auto-dismiss after 4 seconds
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Convenience functions
export const toast = {
  success: (msg: string) => useToast.getState().add('success', msg),
  error: (msg: string) => useToast.getState().add('error', msg),
  warning: (msg: string) => useToast.getState().add('warning', msg),
  info: (msg: string) => useToast.getState().add('info', msg),
};

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: 'bg-success/15 border-success/30 text-success',
  error: 'bg-destructive/15 border-destructive/30 text-destructive',
  warning: 'bg-warning/15 border-warning/30 text-warning',
  info: 'bg-info/15 border-info/30 text-info',
};

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICONS[t.type];

  useEffect(() => {
    // Keyboard accessibility — dismiss on Escape
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg animate-slide-in ${COLORS[t.type]}`}
      role="alert"
    >
      <Icon size={16} className="shrink-0" />
      <span className="text-sm flex-1 text-foreground">{t.message}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
        <X size={14} />
      </button>
    </div>
  );
}
