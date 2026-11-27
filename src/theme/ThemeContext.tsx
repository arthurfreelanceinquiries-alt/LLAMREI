import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ThemeId } from '../types/llamrei';

export const THEME_META: Record<ThemeId, { label: string; short: string; tagline: string }> = {
  tactical: {
    label: 'Opsi C: Tactical Co-Commander',
    short: 'Tactical HUD',
    tagline: 'Void Black #050507 · Emerald Signal #00D992 · Jarvis HUD',
  },
  hybrid: {
    label: 'Opsi D: Hybrid Obsidian × Bento',
    short: 'Hybrid Bento',
    tagline: 'Obsidian #090A0F · Glass Bento · Indigo-Cyan',
  },
  obsidian: {
    label: 'Obsidian Intelligence',
    short: 'Obsidian',
    tagline: 'Tema gelap dengan aksen indigo',
  },
  light: {
    label: 'Cahaya',
    short: 'Cahaya',
    tagline: 'Tema terang dengan aksen indigo',
  },
  bento: {
    label: 'Opsi B: Midnight Bento Cockpit',
    short: 'Midnight Bento',
    tagline: 'TradingView × Revolut · Midnight Navy Glassmorphism',
  },
};

interface ThemeCtx {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'obsidian', setTheme: () => {} });

export function ThemeProvider({ initialTheme = 'obsidian', children }: { initialTheme?: ThemeId; children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('llamrei_theme') as ThemeId | null;
    return saved && Object.hasOwn(THEME_META, saved) ? saved : initialTheme;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('llamrei_theme', theme);
  }, [theme]);

  const setTheme = (id: ThemeId) => {
    setThemeState(id);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
