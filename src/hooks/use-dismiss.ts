'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Shared dismiss behavior for popovers, menus, and sheets (#175, #176):
 * Escape closes, as does a pointer-down outside the anchored element.
 * Listeners attach only while `open`, so idle pages carry no global handlers.
 * The latest onDismiss is used without rebinding (same pattern as Modal). */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const dismiss = () => onDismissRef.current();
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) dismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref]);
}
