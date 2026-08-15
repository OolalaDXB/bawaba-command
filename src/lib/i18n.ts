import { useSyncExternalStore } from 'react';

/**
 * Minimal FR/EN language state for the console. Persisted in localStorage,
 * defaults to the browser language. Pages opt in screen by screen — the
 * entrance (Chooser) is translated first; the rest of the console follows.
 */
export type Lang = 'en' | 'fr';

const KEY = 'bawaba-lang';
const listeners = new Set<() => void>();

function detect(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'fr' || stored === 'en') return stored;
    return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = detect();

export function setLang(l: Lang): void {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  listeners.forEach(fn => fn());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => listeners.delete(fn); },
    () => current,
  );
}
