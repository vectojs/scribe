/**
 * Theme toggle that reuses Markdown PRESET_THEMES.
 *
 * Light = githubLight, Dark = dracula (matches docs palette). The preview
 * Markdown entity is re-themed via `markdown.setTheme(...)`; the surrounding
 * HTML shell tokens and TextArea colors follow via CSS variables + TextArea
 * prop updates.
 */

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'scribe:theme-mode-v1';

export const PRESET_FOR_MODE: Record<ThemeMode, string> = {
  light: 'githubLight',
  dark: 'dracula',
};

export function resolveInitialTheme(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // ignore storage access errors (e.g., blocked)
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return prefersDark ? 'dark' : 'light';
}

export function persistTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function toggleMode(mode: ThemeMode): ThemeMode {
  return mode === 'light' ? 'dark' : 'light';
}

export type ThemeTokens = {
  shellBg: string;
  shellFg: string;
  paneBg: string;
  border: string;
};

export const TOKENS_BY_MODE: Record<ThemeMode, ThemeTokens> = {
  light: {
    shellBg: '#f7f4ee',
    shellFg: '#1a1a1a',
    paneBg: '#fffdf9',
    border: '#e5ddd3',
  },
  dark: {
    shellBg: '#0f1115',
    shellFg: '#e6e2de',
    paneBg: '#1a1e24',
    border: '#2a2f3a',
  },
};
