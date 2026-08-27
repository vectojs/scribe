import { en, type TranslationKey } from './en';
import { zhCN } from './zh-CN';

export type Locale = 'en' | 'zh-CN';

export const LOCALES: readonly Locale[] = ['en', 'zh-CN'] as const;

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export const STORAGE_KEY = 'scribe:locale-v1';

export const HTML_LANG: Record<Locale, string> = {
  en: 'en',
  'zh-CN': 'zh-CN',
};

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  'zh-CN': zhCN as Record<TranslationKey, string>,
};

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh-CN';
}

export function resolveInitialLocale(storage?: Pick<Storage, 'getItem'>): Locale {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const raw = s?.getItem(STORAGE_KEY) ?? null;
    if (isLocale(raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    s?.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

let currentLocale: Locale = DEFAULT_LOCALE;

// Initialize from storage if available (safe for SSR/test without window)
try {
  currentLocale = resolveInitialLocale();
} catch {
  currentLocale = DEFAULT_LOCALE;
}

type Listener = (locale: Locale) => void;
const listeners = new Set<Listener>();

function notify(locale: Locale): void {
  for (const l of listeners) {
    try {
      l(locale);
    } catch {
      // ignore
    }
  }
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale)) return;
  currentLocale = locale;
  persistLocale(locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = HTML_LANG[locale];
  }
  notify(locale);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(
  key: TranslationKey,
  localeOrParams?: Locale | Record<string, string | number>,
  params?: Record<string, string | number>,
): string {
  let locale: Locale = currentLocale;
  let p: Record<string, string | number> | undefined = params;
  if (typeof localeOrParams === 'string' && isLocale(localeOrParams)) {
    locale = localeOrParams;
  } else if (localeOrParams && typeof localeOrParams === 'object') {
    p = localeOrParams as Record<string, string | number>;
  } else if (localeOrParams === undefined) {
    // keep defaults
  } else if (typeof localeOrParams === 'string') {
    // unknown string, treat as locale fallback
    locale = currentLocale;
  }
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  let value = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (p) {
    for (const [k, v] of Object.entries(p)) {
      value = value.replaceAll(`{${k}}`, String(v));
    }
  }
  return value;
}

export function translate(key: TranslationKey, params?: Record<string, string | number>): string {
  return t(key, currentLocale, params);
}

// For migration: if no locale stored yet, persist default zh-CN
export function ensurePersisted(): void {
  try {
    const s = typeof window !== 'undefined' ? window.localStorage : undefined;
    if (!s) return;
    const raw = s.getItem(STORAGE_KEY);
    if (!isLocale(raw)) {
      persistLocale(DEFAULT_LOCALE, s);
      // also sync html lang immediately
      if (typeof document !== 'undefined') {
        document.documentElement.lang = HTML_LANG[DEFAULT_LOCALE];
      }
      currentLocale = DEFAULT_LOCALE;
    } else {
      // ensure html lang matches stored locale
      currentLocale = raw;
      if (typeof document !== 'undefined') {
        document.documentElement.lang = HTML_LANG[raw];
      }
    }
  } catch {
    // ignore
  }
}

// Re-export keys for test convenience
export type { TranslationKey } from './en';
export { en, zhCN };
