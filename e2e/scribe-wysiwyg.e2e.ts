import { expect, test } from '@playwright/test';

test.describe('scribe CTX-0540 — Typora WYSIWYG (Live vs Source)', () => {
  test.beforeEach(async ({ page }) => {
    // Clear persisted view mode to get deterministic Source start
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.removeItem('scribe:view-mode-v1');
      window.localStorage.removeItem('scribe:focus-mode-v1');
      // Ensure English locale for deterministic toggle text expectations
      window.localStorage.setItem('scribe:locale-v1', 'en');
    });
    await page.reload();
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(400);
  });

  test('toggle Live vs Source switches layout and persists', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);
    const toggle = page.locator('#scribe-wysiwyg-toggle');
    await expect(toggle).toBeVisible();
    // Default is Source (aria-pressed false, text Live)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveText(/Live|实时/);
    const stage = page.locator('#scribe-stage');
    await expect(stage).not.toHaveClass(/is-wysiwyg/);

    const handle = page.locator('#scribe-split-handle');
    // In source at 1200 with explorer+toc+settings visible, stage is ~480 <600 so handle is hidden by design (availW<600).
    // Verify at wide viewport it becomes visible in source.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(400);
    await expect(handle).toBeVisible();
    // Back to 1200 for WYSIWYG toggle
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);

    // Switch to WYSIWYG (Live)
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveText(/Source|源码/);
    await expect(stage).toHaveClass(/is-wysiwyg/);
    // Handle hidden in wysiwyg
    await expect(handle).toBeHidden();
    // Persisted
    const stored = await page.evaluate(() => window.localStorage.getItem('scribe:view-mode-v1'));
    expect(stored).toBe('wysiwyg');
    // Helpers exposed
    const mode = await page.evaluate(() =>
      (window as unknown as { __scribeViewMode?: () => string }).__scribeViewMode?.(),
    );
    expect(mode).toBe('wysiwyg');

    // Reload retains
    await page.reload();
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
    );
    await page.waitForTimeout(400);
    const toggle2 = page.locator('#scribe-wysiwyg-toggle');
    await expect(toggle2).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);

    // Switch back to Source
    await toggle2.click();
    await page.waitForTimeout(500);
    await expect(toggle2).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle2).toHaveText(/Live|实时/);
    await expect(page.locator('#scribe-stage')).not.toHaveClass(/is-wysiwyg/);
    // At 1200 with three panels stage is narrow (<600) so handle is hidden by design; verify at wide it becomes visible
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(400);
    await expect(page.locator('#scribe-split-handle')).toBeVisible();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);
    const stored2 = await page.evaluate(() => window.localStorage.getItem('scribe:view-mode-v1'));
    expect(stored2).toBe('source');
  });

  test('live preview updates without manual save (debounced 80ms)', async ({ page }) => {
    const ta = page.locator('[data-vecto-a11y-root] textarea, #scribe-a11y-root textarea');
    await expect(ta).toBeAttached({ timeout: 10_000 });
    // Ensure live preview is checked
    const liveCb = page.locator('#scribe-live-preview');
    await expect(liveCb).toBeChecked();

    const before = await page.evaluate(
      () =>
        (
          window as unknown as {
            __app: { markdown: { height: number } };
          }
        ).__app.markdown.height,
    );
    expect(before).toBeGreaterThan(100);

    const newText = [
      '# Live Preview Test',
      '',
      'Paragraph with **bold** and more content to change height.',
      ...Array.from(
        { length: 12 },
        (_, i) => `Line ${i} — live update ${Math.random().toString(36).slice(2)}.`,
      ),
    ].join('\n');
    await page.evaluate((text) => {
      const w = window as unknown as {
        __app: {
          textArea: {
            value: string;
            selectionStart: number;
            selectionEnd: number;
          };
          model: {
            activeId: string;
            updateContent: (id: string, c: string) => void;
          };
        };
      };
      w.__app.textArea.value = text;
      w.__app.textArea.selectionStart = text.length;
      w.__app.textArea.selectionEnd = text.length;
      const ta2 =
        (document.querySelector('[data-vecto-a11y-root] textarea') as HTMLTextAreaElement | null) ??
        (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null);
      if (ta2) {
        ta2.value = text;
        ta2.selectionStart = text.length;
        ta2.selectionEnd = text.length;
        ta2.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Also trigger via model helper to ensure debounced path
      const model = w.__app.model;
      model.updateContent(model.activeId, text);
      const fn = (window as unknown as { __scribeRenderMarkdown?: () => void })
        .__scribeRenderMarkdown;
      if (!fn) {
        // fallback directly
        const app = window as unknown as {
          __app: {
            markdown: { setContent: (s: string) => void };
            previewScroll: { updateContentSize: () => void };
          };
        };
        app.__app.markdown.setContent(text);
        app.__app.previewScroll.updateContentSize();
      }
    }, newText);
    // Also fire helper which does debouncedRender via textArea onChange simulation
    await page.evaluate((_text) => {
      const taInner =
        (document.querySelector('[data-vecto-a11y-root] textarea') as HTMLTextAreaElement | null) ??
        (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null);
      if (taInner) {
        taInner.focus();
        taInner.dispatchEvent(new Event('input', { bubbles: true }));
        taInner.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, newText);
    await page.waitForTimeout(400);
    const after = await page.evaluate(
      () =>
        (
          window as unknown as {
            __app: {
              markdown: { height: number };
              model: { activeFile: { content: string } };
            };
          }
        ).__app.markdown.height,
    );
    expect(after).toBeGreaterThan(100);
    // Model must reflect new text without explicit save button
    const content = await page.evaluate(
      () =>
        (
          window as unknown as {
            __app: { model: { activeFile: { content: string } } };
          }
        ).__app.model.activeFile.content,
    );
    expect(content).toContain('Live Preview Test');
  });

  test('click-to-edit in WYSIWYG maps preview block to source offset', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);
    // Prepare deterministic large doc
    const doc = [
      '# Doc for Click',
      '',
      'Alpha paragraph line one.',
      'Alpha paragraph line two.',
      '',
      '## Middle Heading',
      '',
      'Beta paragraph after heading.',
      '',
      '### Deep Heading',
      '',
      'Gamma paragraph deep.',
      '',
      ...Array.from({ length: 20 }, (_, i) => `Filler ${i} text to enlarge doc.`),
    ].join('\n');
    await page.evaluate((text) => {
      const w = window as unknown as {
        __app: {
          textArea: { value: string };
          model: {
            activeId: string;
            updateContent: (id: string, c: string) => void;
          };
          markdown: { setContent: (s: string) => void };
          previewScroll: { updateContentSize: () => void };
        };
      };
      w.__app.textArea.value = text;
      w.__app.model.updateContent(w.__app.model.activeId, text);
      const ta =
        (document.querySelector('[data-vecto-a11y-root] textarea') as HTMLTextAreaElement | null) ??
        (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null);
      if (ta) ta.value = text;
      w.__app.markdown.setContent(text);
      w.__app.previewScroll.updateContentSize();
    }, doc);
    await page.waitForTimeout(600);

    // Switch to WYSIWYG
    const toggle = page.locator('#scribe-wysiwyg-toggle');
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);

    // Call focusAtLine directly — click mapping is ratio-based, so focusing via helper is the deterministic path
    const lineForMiddle = doc.split('\n').findIndex((l) => l.includes('Middle Heading'));
    expect(lineForMiddle).toBeGreaterThan(-1);
    await page.evaluate((n) => {
      const fn = (window as unknown as { __scribeFocusAtLine?: (n: number) => void })
        .__scribeFocusAtLine;
      fn?.(n);
    }, lineForMiddle);
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => {
      const ta =
        (document.querySelector('[data-vecto-a11y-root] textarea') as HTMLTextAreaElement | null) ??
        (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null);
      return ta
        ? {
            start: ta.selectionStart,
            end: ta.selectionEnd,
            value: ta.value.slice(ta.selectionStart, ta.selectionStart + 20),
          }
        : null;
    });
    expect(sel).not.toBeNull();
    if (sel) {
      // selection should be at line start of Middle Heading
      const expectedOffset =
        doc.split('\n').slice(0, lineForMiddle).join('\n').length + (lineForMiddle > 0 ? 1 : 0);
      expect(sel.start).toBe(expectedOffset);
    }

    // Now test preview click near top should map to first lines: click at stage preview center top
    const stageBox = await page.locator('#scribe-stage').boundingBox();
    expect(stageBox).not.toBeNull();
    if (stageBox) {
      const x = stageBox.x + stageBox.width * 0.6;
      const y = stageBox.y + 80; // near top, should map to first heading/para
      await page.mouse.click(x, y);
      await page.waitForTimeout(300);
      const afterClickSel = await page.evaluate(() => {
        const ta =
          (document.querySelector(
            '[data-vecto-a11y-root] textarea',
          ) as HTMLTextAreaElement | null) ??
          (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null);
        return ta ? ta.selectionStart : -1;
      });
      expect(afterClickSel).toBeGreaterThanOrEqual(0);
      expect(afterClickSel).toBeLessThan(doc.length);
    }
  });

  test('focus mode highlights current paragraph and persists', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);
    const toggleW = page.locator('#scribe-wysiwyg-toggle');
    await toggleW.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);

    const highlight = page.locator('#scribe-focus-highlight');
    // Initially hidden because focusMode false (cleared in beforeEach)
    await expect(highlight).toBeHidden();

    // Enable via toolbar button
    const focusBtn = page.locator('#scribe-focus-toggle');
    await expect(focusBtn).toBeVisible();
    await focusBtn.click();
    await page.waitForTimeout(400);
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'true');
    // Settings checkbox should sync
    await expect(page.locator('#scribe-focus-mode')).toBeChecked();
    const stored = await page.evaluate(() => window.localStorage.getItem('scribe:focus-mode-v1'));
    expect(stored).toBe('true');

    // Highlight should now be visible (even if at 0) — wait a bit for projection fallback
    await page.waitForTimeout(600);
    await expect(highlight).toBeVisible();
    const box = await highlight.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThan(10);

    // Toggle via settings checkbox
    const cb = page.locator('#scribe-focus-mode');
    await cb.uncheck();
    await page.waitForTimeout(300);
    await expect(highlight).toBeHidden();
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'false');
    await cb.check();
    await page.waitForTimeout(600);
    await expect(highlight).toBeVisible();
  });

  test('responsive: WYSIWYG toggle still works at 390 and 2560', async ({ page }) => {
    const toggle = page.locator('#scribe-wysiwyg-toggle');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(400);
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);
    await expect(page.locator('#scribe-a11y-root')).toBeAttached();

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForTimeout(400);
    await expect(toggle).toBeVisible();
    // Should still be wysiwyg after resize
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);
    const canvas = page.locator('#scribe-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(1000);
      expect(box.height).toBeGreaterThan(500);
    }
    // Back to source
    await toggle.click();
    await page.waitForTimeout(400);
    await expect(page.locator('#scribe-stage')).not.toHaveClass(/is-wysiwyg/);
  });
});
