/**
 * Theme toggle that reuses Markdown PRESET_THEMES.
 *
 * Light = githubLight, Dark = dracula (matches docs palette). The preview
 * Markdown entity is re-themed via `markdown.setTheme(...)`; the surrounding
 * HTML shell tokens and TextArea colors follow via CSS variables + TextArea
 * prop updates.
 *
 * CTX-0539 extends this to expose the full PRESET_THEMES list (githubLight,
 * githubDark, dracula, solarizedLight, solarizedDark) via a persisted preset
 * key while keeping the legacy `scribe:theme-mode-v1` (light/dark) for
 * migration.
 */

export type ThemeMode = 'light' | 'dark';

export type MarkdownPreset =
  | 'githubLight'
  | 'githubDark'
  | 'dracula'
  | 'solarizedLight'
  | 'solarizedDark';

export const THEME_STORAGE_KEY = 'scribe:theme-mode-v1';
export const THEME_PRESET_KEY = 'scribe:theme-preset-v1';

export const PRESET_FOR_MODE: Record<ThemeMode, MarkdownPreset> = {
  light: 'githubLight',
  dark: 'dracula',
};

export const ALL_PRESETS: readonly MarkdownPreset[] = [
  'githubLight',
  'githubDark',
  'dracula',
  'solarizedLight',
  'solarizedDark',
] as const;

const PRESET_TO_MODE: Record<MarkdownPreset, ThemeMode> = {
  githubLight: 'light',
  solarizedLight: 'light',
  githubDark: 'dark',
  dracula: 'dark',
  solarizedDark: 'dark',
};

export function isPresetName(value: unknown): value is MarkdownPreset {
  return typeof value === 'string' && (ALL_PRESETS as readonly string[]).includes(value);
}

export function getModeForPreset(preset: MarkdownPreset): ThemeMode {
  return PRESET_TO_MODE[preset] ?? 'light';
}

export function resolveInitialPreset(): MarkdownPreset {
  try {
    const rawPreset = window.localStorage.getItem(THEME_PRESET_KEY);
    if (isPresetName(rawPreset)) return rawPreset;
    const rawMode = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (rawMode === 'light' || rawMode === 'dark') return PRESET_FOR_MODE[rawMode];
  } catch {
    // ignore storage access errors (e.g., blocked)
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return prefersDark ? 'dracula' : 'githubLight';
}

export function resolveInitialTheme(): ThemeMode {
  return getModeForPreset(resolveInitialPreset());
}

export function persistPreset(preset: MarkdownPreset): void {
  try {
    window.localStorage.setItem(THEME_PRESET_KEY, preset);
    window.localStorage.setItem(THEME_STORAGE_KEY, getModeForPreset(preset));
  } catch {
    // ignore
  }
}

export function persistTheme(mode: ThemeMode): void {
  persistPreset(PRESET_FOR_MODE[mode]);
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
