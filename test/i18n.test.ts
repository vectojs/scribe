import { describe, expect, test } from 'bun:test';

import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import { DEFAULT_LOCALE, dictionaries, isLocale, resolveInitialLocale, t } from '../src/i18n';

describe('i18n dictionaries', () => {
  test('en and zh-CN have identical keys', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhCN as Record<string, string>).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  test('every key has non-empty translation in both locales', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      const enVal = en[key];
      const zhVal = (zhCN as Record<string, string>)[key];
      expect(enVal.length, `en:${key} empty`).toBeGreaterThan(0);
      expect(zhVal.length, `zh-CN:${key} empty`).toBeGreaterThan(0);
    }
  });

  test('dictionaries map contains both locales', () => {
    expect(dictionaries.en).toBeDefined();
    expect(dictionaries['zh-CN']).toBeDefined();
    expect(Object.keys(dictionaries).sort()).toEqual(['en', 'zh-CN'].sort());
  });

  test('required UI chrome keys exist', () => {
    const required: Array<keyof typeof en> = [
      // header/toolbar
      'toolbar.bold.title',
      'toolbar.bold.label',
      'toolbar.italic.title',
      'toolbar.italic.label',
      'toolbar.code.title',
      'toolbar.h1.title',
      'toolbar.h2.title',
      'toolbar.h3.title',
      'toolbar.quote.title',
      'toolbar.link.title',
      'toolbar.image.title',
      'toolbar.table.title',
      'toolbar.math.title',
      'toolbar.mathBlock.title',
      'toolbar.list.title',
      // explorer/outline
      'explorer.title',
      'explorer.navLabel',
      'toc.title',
      'toc.titleWithCount',
      'toc.empty',
      // settings
      'settings.livePreview',
      'settings.scrollSync',
      'settings.title',
      'settings.export.title',
      'toolbar.theme.toggle.text',
      // files
      'files.kitchenSink',
      'files.welcome',
      'files.notes',
      'files.untitled',
    ];
    for (const k of required) {
      expect(en[k], `missing en:${k}`).toBeDefined();
      expect((zhCN as any)[k], `missing zh-CN:${k}`).toBeDefined();
    }
  });

  test('zh-CN translations differ from en for UI chrome (at least some)', () => {
    const chromeKeys: Array<keyof typeof en> = [
      'explorer.title',
      'toc.title',
      'settings.livePreview',
      'settings.scrollSync',
      'toolbar.bold.label',
      'header.save.saved',
    ];
    let diffCount = 0;
    for (const k of chromeKeys) {
      if (en[k] !== (zhCN as any)[k]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  test('file name translations are distinct', () => {
    expect(en['files.kitchenSink']).toBe('Kitchen Sink.md');
    expect((zhCN as any)['files.kitchenSink']).toBe('综合示例.md');
    expect(en['files.welcome']).toBe('Welcome.md');
    expect((zhCN as any)['files.welcome']).toBe('欢迎.md');
    expect(en['files.notes']).toBe('Notes.md');
    expect((zhCN as any)['files.notes']).toBe('笔记.md');
  });

  test('t function respects locale param and fallback', () => {
    expect(t('explorer.title', 'en')).toBe('Explorer');
    expect(t('explorer.title', 'zh-CN')).toBe('文件');
    expect(t('toc.empty', 'en')).toBe('No headings');
    expect(t('toc.empty', 'zh-CN')).toBe('暂无标题');
    // param replacement
    expect(t('toc.titleWithCount', 'en', { count: 3 })).toBe('Outline (3)');
    expect(t('toc.titleWithCount', 'zh-CN', { count: 3 })).toBe('大纲 (3)');
    expect(t('explorer.rename.label', 'zh-CN', { name: 'test.md' })).toContain('test.md');
  });

  test('default locale is zh-CN', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN');
  });

  test('isLocale guards', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('zh-CN')).toBe(true);
    expect(isLocale('zh-cn')).toBe(false);
    expect(isLocale('ja')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  test('resolveInitialLocale defaults to zh-CN when storage empty', () => {
    const fake = { getItem: () => null } as Pick<Storage, 'getItem'>;
    expect(resolveInitialLocale(fake)).toBe('zh-CN');
  });

  test('resolveInitialLocale reads persisted value', () => {
    const fakeEn = { getItem: () => 'en' } as Pick<Storage, 'getItem'>;
    expect(resolveInitialLocale(fakeEn)).toBe('en');
    const fakeZh = { getItem: () => 'zh-CN' } as Pick<Storage, 'getItem'>;
    expect(resolveInitialLocale(fakeZh)).toBe('zh-CN');
  });

  test('resolveInitialLocale falls back to zh-CN on invalid stored value (migrate existing users)', () => {
    const fakeInvalid = { getItem: () => 'fr' } as Pick<Storage, 'getItem'>;
    expect(resolveInitialLocale(fakeInvalid)).toBe('zh-CN');
    const fakeEmpty = { getItem: () => '' } as Pick<Storage, 'getItem'>;
    expect(resolveInitialLocale(fakeEmpty)).toBe('zh-CN');
  });
});
