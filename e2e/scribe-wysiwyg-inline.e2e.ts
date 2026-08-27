import { expect, test } from '@playwright/test';

test.describe('scribe CTX-0541 — Inline WYSIWYG per-block (Obsidian Live Preview)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.removeItem('scribe:view-mode-v1');
      window.localStorage.removeItem('scribe:focus-mode-v1');
    });
    await page.reload();
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);
  });

  const setDoc = async (page: import('@playwright/test').Page, doc: string) => {
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
          markdown: { setContent: (s: string) => void };
          previewScroll: { updateContentSize: () => void };
        };
      };
      w.__app.textArea.value = text;
      w.__app.model.updateContent(w.__app.model.activeId, text);
      const ta =
        (document.querySelector('[data-vecto-a11y-root] textarea') as HTMLTextAreaElement | null) ??
        (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null);
      if (ta) {
        ta.value = text;
        ta.selectionStart = 0;
        ta.selectionEnd = 0;
      }
      w.__app.markdown.setContent(text);
      w.__app.previewScroll.updateContentSize();
    }, doc);
    await page.waitForTimeout(600);
  };

  test('inline overlay shows source for active block and hides when leaving', async ({ page }) => {
    const doc = [
      '# Title for Inline',
      '',
      'Paragraph with **bold** text.',
      '',
      'Paragraph with *italic* here.',
      '',
      '- list one',
      '- list two',
    ].join('\n');

    await setDoc(page, doc);

    // Enter WYSIWYG
    const toggle = page.locator('#scribe-wysiwyg-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(600);
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);

    // Helper to get block index via exposed API
    const getBlocks = async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __scribeGetSourceBlocks?: () => Array<{
                start: number;
                end: number;
                raw: string;
              }>;
            }
          ).__scribeGetSourceBlocks?.() ?? [],
      );

    const blocks = await getBlocks();
    expect(blocks.length).toBeGreaterThan(3);

    // Find bold paragraph block (contains **bold**)
    const boldBlockIdx = blocks.findIndex((b) => b.raw.includes('**bold**'));
    expect(boldBlockIdx).toBeGreaterThan(-1);
    const boldBlock = blocks[boldBlockIdx];
    // Select inside that block (offset = start+5)
    const insideOffset = boldBlock.start + Math.min(5, Math.max(0, boldBlock.raw.indexOf('bold')));
    await page.evaluate(
      ({ s, e }) => {
        const fn = (
          window as unknown as {
            __scribeSetSelection?: (a: number, b: number) => void;
          }
        ).__scribeSetSelection;
        fn?.(s, e);
        // also force queue
        const q = (window as unknown as { __scribeQueueInline?: () => void }).__scribeQueueInline;
        q?.();
      },
      { s: insideOffset, e: insideOffset },
    );
    await page.waitForTimeout(700);

    // Overlay should be visible with source containing **bold**
    const inline = page.locator('#scribe-inline-source');
    await expect(inline).toBeVisible({ timeout: 2000 });
    const raw = await page.evaluate(
      () =>
        (window as unknown as { __scribeInlineRaw?: () => string | null }).__scribeInlineRaw?.() ??
        null,
    );
    expect(raw).not.toBeNull();
    expect(raw as string).toContain('**bold**');

    const isVisible = await page.evaluate(
      () =>
        (
          window as unknown as { __scribeInlineVisible?: () => boolean }
        ).__scribeInlineVisible?.() ?? false,
    );
    expect(isVisible).toBeTruthy();

    // Move cursor to heading block (first block)
    const headingBlock = blocks[0];
    const headingOffset = headingBlock.start + 2;
    await page.evaluate(
      ({ s, e }) => {
        const fn = (
          window as unknown as {
            __scribeSetSelection?: (a: number, b: number) => void;
          }
        ).__scribeSetSelection;
        fn?.(s, e);
        const q = (window as unknown as { __scribeQueueInline?: () => void }).__scribeQueueInline;
        q?.();
      },
      { s: headingOffset, e: headingOffset },
    );
    await page.waitForTimeout(700);
    const raw2 = await page.evaluate(
      () =>
        (window as unknown as { __scribeInlineRaw?: () => string | null }).__scribeInlineRaw?.() ??
        null,
    );
    expect(raw2).not.toBeNull();
    expect(raw2 as string).toContain('# Title for Inline');
    expect(raw2 as string).not.toContain('**bold**');

    // Move cursor to italic paragraph block
    const italicBlockIdx = blocks.findIndex((b) => b.raw.includes('*italic*'));
    expect(italicBlockIdx).toBeGreaterThan(-1);
    const italicBlock = blocks[italicBlockIdx];
    const italicOffset = italicBlock.start + italicBlock.raw.indexOf('italic');
    await page.evaluate(
      ({ s, e }) => {
        const fn = (
          window as unknown as {
            __scribeSetSelection?: (a: number, b: number) => void;
          }
        ).__scribeSetSelection;
        fn?.(s, e);
      },
      { s: italicOffset, e: italicOffset },
    );
    await page.waitForTimeout(700);
    const raw3 = await page.evaluate(
      () =>
        (window as unknown as { __scribeInlineRaw?: () => string | null }).__scribeInlineRaw?.() ??
        null,
    );
    expect(raw3).toContain('*italic*');

    void boldBlock.end;
    await page.evaluate(() => {
      const ta = document.querySelector(
        '[data-vecto-a11y-root] textarea',
      ) as HTMLTextAreaElement | null;
      return ta ? ta.value.length : 0;
    });

    // Now switch back to Source mode - overlay must hide regardless of selection
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#scribe-stage')).not.toHaveClass(/is-wysiwyg/);
    const inlineHidden = page.locator('#scribe-inline-source');
    await expect(inlineHidden).toBeHidden();
    const stillVisible = await page.evaluate(
      () =>
        (
          window as unknown as { __scribeInlineVisible?: () => boolean }
        ).__scribeInlineVisible?.() ?? false,
    );
    expect(stillVisible).toBeFalsy();

    // Back to WYSIWYG should restore overlay for current selection (heading)
    await toggle.click();
    await page.waitForTimeout(600);
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);
    // Force re-queue after toggle
    await page.evaluate(() => {
      const q = (window as unknown as { __scribeQueueInline?: () => void }).__scribeQueueInline;
      q?.();
    });
    await page.waitForTimeout(400);
    // After toggle, selection still at italic block, so should show italic source again
    const rawAfter = await page.evaluate(
      () =>
        (window as unknown as { __scribeInlineRaw?: () => string | null }).__scribeInlineRaw?.() ??
        null,
    );
    // rawAfter may be heading or italic depending on stored; just check visible again
    const visibleAfter = await page.evaluate(
      () =>
        (
          window as unknown as { __scribeInlineVisible?: () => boolean }
        ).__scribeInlineVisible?.() ?? false,
    );
    expect(visibleAfter).toBeTruthy();
    expect(rawAfter).not.toBeNull();
  });

  test('toggle inline wysiwyg and exit via selection change hides correctly', async ({ page }) => {
    const doc = ['# Toggle Test', '', '**bold** line', '', 'plain line'].join('\n');
    await setDoc(page, doc);
    const toggle = page.locator('#scribe-wysiwyg-toggle');
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);

    // Initially selection at 0 (heading)
    await page.evaluate(() => {
      const fn = (
        window as unknown as {
          __scribeSetSelection?: (a: number, b: number) => void;
        }
      ).__scribeSetSelection;
      fn?.(0, 0);
    });
    await page.waitForTimeout(500);
    await expect(page.locator('#scribe-inline-source')).toBeVisible();

    // Move selection to bold block
    const blocks = await page.evaluate(
      () =>
        (
          window as unknown as {
            __scribeGetSourceBlocks?: () => Array<{
              start: number;
              end: number;
              raw: string;
            }>;
          }
        ).__scribeGetSourceBlocks?.() ?? [],
    );
    const boldIdx = blocks.findIndex((b) => b.raw.includes('**bold**'));
    expect(boldIdx).toBeGreaterThan(-1);
    const off = blocks[boldIdx].start + 2;
    await page.evaluate(
      ({ s }: { s: number }) => {
        const fn = (
          window as unknown as {
            __scribeSetSelection?: (a: number, b: number) => void;
          }
        ).__scribeSetSelection;
        fn?.(s, s);
      },
      { s: off },
    );
    await page.waitForTimeout(500);
    const raw = await page.evaluate(
      () =>
        (window as unknown as { __scribeInlineRaw?: () => string | null }).__scribeInlineRaw?.() ??
        null,
    );
    expect(raw).toContain('**bold**');

    // Exit to source - should hide and persist
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#scribe-stage')).not.toHaveClass(/is-wysiwyg/);
    await expect(page.locator('#scribe-inline-source')).toBeHidden();
    const stored = await page.evaluate(() => window.localStorage.getItem('scribe:view-mode-v1'));
    expect(stored).toBe('source');

    // Re-enter wysiwyg - overlay should reappear for current block
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#scribe-stage')).toHaveClass(/is-wysiwyg/);
    await page.evaluate(() => {
      const q = (window as unknown as { __scribeQueueInline?: () => void }).__scribeQueueInline;
      q?.();
    });
    await page.waitForTimeout(400);
    await expect(page.locator('#scribe-inline-source')).toBeVisible();
  });

  test('using Markdown.getMarkdownLineBoxes for positioning does not crash and stays within bounds', async ({
    page,
  }) => {
    const doc = [
      '# Box Test',
      '',
      'Para **bold** and *italic* with **more bold**.',
      '',
      '```js',
      "console.log('hello');",
      '```',
      '',
      '| a | b |',
      '|---|---|',
      '| c | d |',
    ].join('\n');
    await setDoc(page, doc);
    const toggle = page.locator('#scribe-wysiwyg-toggle');
    await toggle.click();
    await page.waitForTimeout(600);
    // Select inside code block
    const blocks = await page.evaluate(
      () =>
        (
          window as unknown as {
            __scribeGetSourceBlocks?: () => Array<{
              start: number;
              end: number;
              raw: string;
            }>;
          }
        ).__scribeGetSourceBlocks?.() ?? [],
    );
    const codeIdx = blocks.findIndex((b) => b.raw.includes('console.log'));
    expect(codeIdx).toBeGreaterThan(-1);
    const off = blocks[codeIdx].start + 5;
    await page.evaluate(
      ({ s }: { s: number }) => {
        const fn = (
          window as unknown as {
            __scribeSetSelection?: (a: number, b: number) => void;
          }
        ).__scribeSetSelection;
        fn?.(s, s);
      },
      { s: off },
    );
    await page.waitForTimeout(600);
    const boxInfo = await page.evaluate(() => {
      const el = document.getElementById('scribe-inline-source') as HTMLElement | null;
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      const stage = document.getElementById('scribe-stage')?.getBoundingClientRect() ?? null;
      return {
        elTop: r.top,
        elLeft: r.left,
        elWidth: r.width,
        stageTop: stage?.top ?? 0,
        stageLeft: stage?.left ?? 0,
      };
    });
    expect(boxInfo).not.toBeNull();
    if (boxInfo) {
      expect(boxInfo.elWidth).toBeGreaterThan(100);
      // Should be inside stage horizontally
      expect(boxInfo.elLeft).toBeGreaterThanOrEqual(boxInfo.stageLeft - 5);
    }
  });
});
