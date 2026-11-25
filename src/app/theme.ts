import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'find-daycare:theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';
const storedListeners = new Set<() => void>();
let fallbackStoredTheme: Theme | null = null;

export function parseTheme(value: unknown): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

export function readStoredTheme(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY)) ?? fallbackStoredTheme;
  } catch {
    return fallbackStoredTheme;
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    fallbackStoredTheme = null;
  } catch {
    // ストレージが使えない環境ではメモリ上の切り替えだけを維持する。
    fallbackStoredTheme = theme;
  }
}

export function readSystemTheme(): Theme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(stored: Theme | null, system: Theme): Theme {
  return stored ?? system;
}

export function applyThemePreference(stored: Theme | null): void {
  if (stored) {
    document.documentElement.dataset.theme = stored;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export function initTheme(): void {
  applyThemePreference(readStoredTheme());
}

function subscribeSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function subscribeStoredTheme(onChange: () => void): () => void {
  storedListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      fallbackStoredTheme = null;
      applyThemePreference(readStoredTheme());
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    storedListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const stored = useSyncExternalStore(subscribeStoredTheme, readStoredTheme);
  const system = useSyncExternalStore(subscribeSystemTheme, readSystemTheme);
  const theme = resolveTheme(stored, system);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    writeStoredTheme(next);
    applyThemePreference(next);
    for (const listener of storedListeners) listener();
  };

  return { theme, toggleTheme };
}
