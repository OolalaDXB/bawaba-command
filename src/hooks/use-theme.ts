import { useState, useEffect } from 'react';

export const THEMES = ['institutional', 'maisons', 'ludography', 'beau'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  institutional: 'Institutional',
  maisons: 'Maisons',
  ludography: 'Ludography',
  beau: 'Beau',
};

const STORAGE_KEY = 'bawaba-theme';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'institutional';
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  return stored && (THEMES as readonly string[]).includes(stored) ? stored : 'institutional';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (next: Theme) => setThemeState(next);

  return { theme, setTheme, themes: THEMES };
}
