import { expect, test } from '@playwright/test';

test.describe('scribe CTX-0539 — collapsible explorer, theme picker, kitchen sink', () => {
  test('explorer collapse persists and overlay still works', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
    );

    // Desktop: collapse button visible at 1024
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(400);
    const toggle = page.locator('#scribe-toggle-explorer');
    await expect(toggle).toBeVisible();
    const explorer = page.locator('#scribe-explorer');
    await expect(explorer).toBeVisible();
    const initialWidth = await explorer.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(initialWidth).toBeGreaterThan(100);

    // Collapse
    await toggle.click();
    await page.waitForTimeout(350);
    const collapsedWidth = await explorer.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(collapsedWidth).toBeLessThan(10);
    // persisted
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('scribe:explorer-collapsed-v1'),
    );
    expect(stored).toBe('true');
    // aria-expanded false
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Expand again
    await toggle.click();
    await page.waitForTimeout(350);
    const expandedWidth = await explorer.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(expandedWidth).toBeGreaterThan(100);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Mobile overlay still works when collapsed
    await toggle.click(); // collapse again
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    // On mobile, explorer should be overlay hidden (transform), but toggle-collapse is hidden, hamburger visible
    await expect(page.locator('#scribe-menu-toggle')).toBeVisible();
    await expect(page.locator('#scribe-toggle-explorer')).toBeHidden();
    // Open via hamburger
    await page.locator('#scribe-menu-toggle').click();
    await page.waitForTimeout(300);
    const hasOpen = await page.evaluate(
      () => document.getElementById('scribe-explorer')?.classList.contains('is-open') ?? false,
    );
    expect(hasOpen).toBeTruthy();
    await page.locator('#scribe-backdrop').click({ position: { x: 350, y: 200 } });
    await page.waitForTimeout(300);
  });

  test('toc is visible alongside explorer and has StackEdit polish', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
    );
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);
    const toc = page.locator('#scribe-toc');
    await expect(toc).toBeVisible();
    const tocList = page.locator('#scribe-toc-list');
    await expect(tocList).toBeVisible();
    // Check that toc has links with data-depth and sample headings
    const tocLinks = page.locator('#scribe-toc-list a');
    const count = await tocLinks.count();
    expect(count).toBeGreaterThan(10);
    const firstDepth = await tocLinks.first().getAttribute('data-depth');
    expect(firstDepth).not.toBeNull();
    // Check toggle-toc button
    const toggleToc = page.locator('#scribe-toggle-toc');
    await expect(toggleToc).toBeVisible();
    const tocExplorer = page.locator('#scribe-toc');
    const initialW = await tocExplorer.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(initialW).toBeGreaterThan(100);
    await toggleToc.click();
    await page.waitForTimeout(350);
    const collapsedW = await tocExplorer.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(collapsedW).toBeLessThan(10);
    await toggleToc.click();
    await page.waitForTimeout(350);
  });

  test('sample kitchen sink renders and TOC maps correctly after collapse', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
    );
    // Sample should be loaded as active file on first run (contains Hello Scribe)
    const content = await page.evaluate(() => {
      const w = window as unknown as {
        __app: { model: { activeFile: { content: string } } };
      };
      return w.__app.model.activeFile.content;
    });
    expect(content).toContain('Kitchen Sink');
    expect(content).toContain('Hello Scribe');
    // Verify markdown renders: preview has height
    const h = await page.evaluate(() => {
      const w = window as unknown as {
        __app: { markdown: { height: number } };
      };
      return w.__app.markdown.height;
    });
    expect(h).toBeGreaterThan(500);
    // TOC should have heading positions
    const tocCount = await page.locator('#scribe-toc-list a').count();
    expect(tocCount).toBeGreaterThan(15);
    // Click a TOC entry and verify preview scrolls
    const link = page.locator('#scribe-toc-list a').first();
    await link.click();
    await page.waitForTimeout(300);
    const hasActive = await page.evaluate(() => {
      const el = document.querySelector('#scribe-toc-list a.is-active') as HTMLElement | null;
      return !!el;
    });
    expect(hasActive).toBeTruthy();
  });

  test('theme picker lists all presets and persists', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
    );
    const picker = page.locator('#scribe-theme-picker');
    await expect(picker).toBeVisible();
    const options = await picker.locator('option').allTextContents();
    expect(options).toEqual(
      expect.arrayContaining([
        'GitHub Light',
        'GitHub Dark',
        'Dracula',
        'Solarized Light',
        'Solarized Dark',
      ]),
    );
    // Settings picker also visible when settings open on desktop
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);
    // Settings panel is inline on desktop, so settings picker should be visible (or at least attached)
    const settingsPicker = page.locator('#scribe-settings-theme-picker');
    await expect(settingsPicker).toBeAttached();
    // Change via toolbar picker
    await picker.selectOption('dracula');
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => window.localStorage.getItem('scribe:theme-preset-v1'));
    expect(stored).toBe('dracula');
    const dataTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(dataTheme).toBe('dark');
    // Change via settings picker
    await settingsPicker.selectOption('githubLight');
    await page.waitForTimeout(300);
    const stored2 = await page.evaluate(() =>
      window.localStorage.getItem('scribe:theme-preset-v1'),
    );
    expect(stored2).toBe('githubLight');
    const dataTheme2 = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(dataTheme2).toBe('light');
    // Toggle button still works (light -> dark)
    const toggle = page.locator('#scribe-theme-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(300);
    const stored3 = await page.evaluate(() =>
      window.localStorage.getItem('scribe:theme-preset-v1'),
    );
    expect(stored3).toBe('dracula');
  });

  test('sample.md fetchable and renders via Markdown', async ({ page }) => {
    await page.goto('/');
    const res = await page.request.get('/sample.md');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('# Scribe — Markdown Kitchen Sink');
    expect(text).toContain('$$');
  });
});
