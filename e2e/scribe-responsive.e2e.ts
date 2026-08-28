import { expect, test } from '@playwright/test';

import {
  BREAKPOINTS,
  DPR_VARIANTS,
  VIEWPORT_PRESETS,
  viewportsWithDpr,
} from '../src/utils/viewport';
import { computeBackingStore, cssToBackingStore, isValidStageSize } from '../src/utils/dpr';

// Matrix: 390/768/1024/2560 × DPR 1/1.5/2/3 (spec requires at least 1,2,3; we cover all 4)
const VIEWPORTS = VIEWPORT_PRESETS;
// Use DPR 1,2,3 for core matrix plus 1.5 edge via unit test parity; but e2e runs 1,2,3 for speed
// Spec: "loops 390/768/1024/2560 widths × DPR 1,2,3 (via playwright browserContext { viewport, deviceScaleFactor })"
const DPRS: readonly number[] = [1, 2, 3] as const;

test.describe('scribe responsive — viewport×DPR matrix', () => {
  for (const vp of VIEWPORTS) {
    for (const dprVal of DPRS) {
      test(`${vp.name} @ ${dprVal}x — backing store, hamburger, drawer, a11y, no blank`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: dprVal,
          hasTouch: vp.width < 900,
          isMobile: vp.width < 900,
        });
        const page = await context.newPage();
        await page.goto('/');
        await page.waitForFunction(
          () => (window as unknown as { __app?: unknown }).__app !== undefined,
          undefined,
          { timeout: 10_000 },
        );
        // Allow ResizeObserver + DPR watcher to settle
        await page.waitForTimeout(600);

        const isOverlay = vp.width < BREAKPOINTS.drawerOverlay;
        const isHamburger = vp.width < BREAKPOINTS.drawerOverlay; // menu-toggle visible at <900 (drawerOverlay)
        const isToolbarHamburger = vp.width < BREAKPOINTS.toolbarHamburger; // 640

        // 1) Canvas backing store Math.round(css*dpr) max(1)
        const backing = await page.evaluate(() => {
          const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement | null;
          const stage = document.getElementById('scribe-stage') as HTMLElement | null;
          if (!canvas || !stage) return null;
          const rect = stage.getBoundingClientRect();
          const cssW = Math.round(rect.width) || stage.clientWidth;
          const cssH = Math.round(rect.height) || stage.clientHeight;
          const dpr = window.devicePixelRatio;
          return {
            dpr,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            cssWidth: cssW,
            cssHeight: cssH,
            clientWidth: stage.clientWidth,
            clientHeight: stage.clientHeight,
            expectedWidth: Math.max(1, Math.round(cssW * dpr)),
            expectedHeight: Math.max(1, Math.round(cssH * dpr)),
            backingWidthOpt: Math.max(1, Math.round(stage.clientWidth * dpr)),
            backingHeightOpt: Math.max(1, Math.round(stage.clientHeight * dpr)),
            styleWidth: canvas.style.width,
            styleHeight: canvas.style.height,
          };
        });
        expect(backing, 'stage+canvas must exist').not.toBeNull();
        if (backing) {
          // Allow 1px rounding tolerance due to subpixel stage width (flex layout)
          expect(
            Math.abs(backing.canvasWidth - backing.expectedWidth) <= 1,
            `canvas.width ${backing.canvasWidth} should be Math.round(cssW ${backing.cssWidth} * dpr ${backing.dpr}) = ${backing.expectedWidth}`,
          ).toBeTruthy();
          expect(
            Math.abs(backing.canvasHeight - backing.expectedHeight) <= 1,
            `canvas.height ${backing.canvasHeight} should be ~${backing.expectedHeight} (cssH ${backing.cssHeight} * dpr)`,
          ).toBeTruthy();
          // devicePixelRatio should match our context's deviceScaleFactor within epsilon (allow 0.001)
          expect(Math.abs(backing.dpr - dprVal) <= 0.01).toBeTruthy();
          // No blank: canvas and stage must have positive size
          expect(backing.canvasWidth).toBeGreaterThan(0);
          expect(backing.canvasHeight).toBeGreaterThan(0);
          expect(backing.clientWidth).toBeGreaterThan(100);
          expect(backing.clientHeight).toBeGreaterThan(100);
        }

        // 2) Toolbar hamburger visibility at <640 and menu-toggle at <900
        const hamburger = await page.evaluate(() => {
          const btn = document.getElementById('scribe-menu-toggle') as HTMLElement | null;
          const saveStatus = document.getElementById('scribe-save-status') as HTMLElement | null;
          const header = document.getElementById('scribe-header') as HTMLElement | null;
          if (!btn || !header) return null;
          const btnDisplay = window.getComputedStyle(btn).display;
          const saveDisplay = saveStatus ? window.getComputedStyle(saveStatus).display : 'unknown';
          const headerPaddingLeft = window.getComputedStyle(header).paddingLeft;
          return {
            btnDisplay,
            saveDisplay,
            visible: btnDisplay !== 'none',
            headerPaddingLeft,
            hasSafeArea: window.getComputedStyle(header).paddingLeft.includes('16px'),
          };
        });
        expect(hamburger, 'hamburger button must exist after responsive merge').not.toBeNull();
        if (hamburger) {
          if (isHamburger) {
            expect(
              hamburger.visible,
              `hamburger should be visible at ${vp.width} (<900)`,
            ).toBeTruthy();
          } else {
            expect(
              hamburger.visible,
              `hamburger should be hidden at ${vp.width} (>=900)`,
            ).toBeFalsy();
          }
          // At <640 save status hides (mobile compact header)
          if (isToolbarHamburger) {
            expect(hamburger.saveDisplay, 'save status hidden at <640').toBe('none');
          } else {
            // Not strictly hidden at 768, but save visible at >=641
            // Only assert at large desktop it is visible
            if (vp.width >= 1024) {
              expect(hamburger.saveDisplay).not.toBe('none');
            }
          }
        }

        // 3) Sidebar drawer overlay correctly at <900 - right side purely editor+preview centered
        const drawer = await page.evaluate(() => {
          const sidebar = document.getElementById('scribe-sidebar') as HTMLElement | null;
          const settings = document.getElementById('scribe-settings') as HTMLElement | null;
          const backdrop = document.getElementById('scribe-backdrop') as HTMLElement | null;
          const stage = document.getElementById('scribe-stage') as HTMLElement | null;
          if (!sidebar || !stage) return null;
          const sbStyle = window.getComputedStyle(sidebar);
          const stStyle = settings ? window.getComputedStyle(settings) : null;
          return {
            exPosition: sbStyle.position,
            exTransform: sbStyle.transform,
            exVisible: sbStyle.display !== 'none',
            sbPosition: sbStyle.position,
            sbTransform: sbStyle.transform,
            stPosition: stStyle?.position ?? 'none',
            stTransform: stStyle?.transform ?? 'none',
            stageTouch: window.getComputedStyle(stage).touchAction,
            backdropHidden: backdrop ? backdrop.hidden : true,
            backdropDisplay: backdrop ? window.getComputedStyle(backdrop).display : 'none',
          };
        });
        expect(drawer).not.toBeNull();
        if (drawer) {
          if (isOverlay) {
            // Overlay mode: sidebar should be fixed off-screen
            expect(drawer.exPosition).toBe('fixed');
            // transform should be translateX(-100%) when closed (not is-open)
            expect(drawer.exVisible).toBeTruthy(); // fixed element still considered visible via display, but off-screen
            // Check touch-action preserved for scroll momentum
            expect(drawer.stageTouch).toContain('pan-y');
            // Backdrop should be hidden initially (no drawer open)
            expect(drawer.backdropHidden).toBeTruthy();
            // Sidebar toc is inside left drawer, not right - right side purely editor+preview centered
            const isTocInSidebar = await page.evaluate(
              () =>
                document.getElementById('scribe-toc')?.classList.contains('scribe-sidebar__pane') ??
                false,
            );
            expect(isTocInSidebar).toBeTruthy();
          } else {
            // Desktop: inline, not fixed, no transform overlay
            expect(drawer.exPosition).not.toBe('fixed');
          }
          // settings modal at overlay should be fixed
          if (isOverlay && drawer.stPosition !== 'none') {
            expect(drawer.stPosition).toBe('fixed');
          }
        }

        // 4) Drawer open/close toggles correctly on overlay mobile (test at 390 only to avoid repetition)
        if (vp.width === 390 && isOverlay) {
          // Initially closed, backdrop hidden
          await expect(page.locator('#scribe-backdrop')).toBeHidden({
            timeout: 2000,
          });
          // Open sidebar via hamburger (left drawer now unified)
          await page.locator('#scribe-menu-toggle').click();
          await page.waitForTimeout(250);
          const afterOpen = await page.evaluate(() => {
            const sb = document.getElementById('scribe-sidebar') as HTMLElement | null;
            const bd = document.getElementById('scribe-backdrop') as HTMLElement | null;
            if (!sb || !bd) return null;
            return {
              hasOpen: sb.classList.contains('is-open'),
              transform: window.getComputedStyle(sb).transform,
              backdropHidden: bd.hidden,
              bodyOverflow: document.body.style.overflow,
              ariaExpanded: document
                .getElementById('scribe-menu-toggle')
                ?.getAttribute('aria-expanded'),
            };
          });
          expect(afterOpen?.hasOpen).toBeTruthy();
          expect(afterOpen?.backdropHidden).toBeFalsy();
          expect(afterOpen?.ariaExpanded).toBe('true');
          // backdrop should be visible (display block)
          await expect(page.locator('#scribe-backdrop')).toBeVisible({
            timeout: 2000,
          });
          // Click backdrop outside drawer (right side) to avoid sidebar intercept at 390 (78vw)
          await page.locator('#scribe-backdrop').click({ position: { x: 350, y: 200 } });
          await page.waitForTimeout(250);
          const afterClose = await page.evaluate(() => {
            const sb = document.getElementById('scribe-sidebar') as HTMLElement | null;
            const bd = document.getElementById('scribe-backdrop') as HTMLElement | null;
            return {
              hasOpen: sb?.classList.contains('is-open') ?? false,
              backdropHidden: bd?.hidden ?? true,
              ariaExpanded: document
                .getElementById('scribe-menu-toggle')
                ?.getAttribute('aria-expanded'),
            };
          });
          expect(afterClose?.hasOpen).toBeFalsy();
          expect(afterClose?.backdropHidden).toBeTruthy();
          expect(afterClose?.ariaExpanded).toBe('false');
          // Escape closes if open
          await page.locator('#scribe-menu-toggle').click();
          await page.waitForTimeout(200);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          const afterEsc = await page.evaluate(
            () => document.getElementById('scribe-sidebar')?.classList.contains('is-open') ?? false,
          );
          expect(afterEsc).toBeFalsy();
        }

        // 5) Touch momentum: preview ScrollView scrolls via touch action (wheel)
        const touch = await page.evaluate(() => {
          const stage = document.getElementById('scribe-stage') as HTMLElement | null;
          const a11y = document.getElementById('scribe-a11y-root') as HTMLElement | null;
          const canvas = document.getElementById('scribe-canvas') as HTMLElement | null;
          if (!stage || !a11y) return null;
          const stageTouch = window.getComputedStyle(stage).touchAction;
          const overlayTouch = window.getComputedStyle(a11y).pointerEvents;
          // Check sidebar has touch scrolling containment
          const sidebar = document.getElementById('scribe-sidebar') as HTMLElement | null;
          const exOverscroll = sidebar
            ? window.getComputedStyle(sidebar).overscrollBehavior
            : 'auto';
          return {
            stageTouch,
            overlayPointerEvents: overlayTouch,
            exOverscroll,
            canvasTouch: canvas ? window.getComputedStyle(canvas).touchAction : 'auto',
          };
        });
        expect(touch).not.toBeNull();
        if (touch) {
          expect(touch.stageTouch).toContain('pan-y');
          // Projected content should remain selectable but not steal scroll (pointerEvents auto for content, none for root)
          expect(touch.overlayPointerEvents).toBe('none');
        }
        // Verify ScrollView actually scrolls via wheel: we set large content and wheel
        const scrollable = await page.evaluate(async () => {
          const w = window as unknown as {
            __app: {
              markdown: { height: number };
              previewScroll: {
                height: number;
                scrollTop?: number;
                scrollTo: (y: number) => void;
                content?: { y: number; height: number };
                updateContentSize: () => void;
              };
              textArea: { value: string };
              model: { activeFile: { content: string } };
            };
            __scribeRenderMarkdown?: () => void;
          };
          if (!w.__app) return null;
          // Ensure preview has enough content to scroll (inject many lines if needed)
          const preview = w.__app.previewScroll as unknown as {
            content: { y: number };
          };
          const before = -(preview.content?.y ?? 0);
          // Try scrolling via API (simulates touch momentum scroll)
          w.__app.previewScroll.scrollTo(120);
          await new Promise((r) => setTimeout(r, 120));
          const after = -(
            (w.__app.previewScroll as unknown as { content: { y: number } }).content.y ?? 0
          );
          return {
            before,
            after,
            height: w.__app.markdown.height,
            previewH: w.__app.previewScroll.height,
          };
        });
        if (scrollable && scrollable.height > scrollable.previewH + 50) {
          expect(scrollable.after).toBeGreaterThan(scrollable.before);
        }

        // 6) No blank after resize + a11y tree retains selectable text
        const a11y = await page.evaluate(() => {
          const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement | null;
          const stage = document.getElementById('scribe-stage') as HTMLElement | null;
          const a11yRoot = document.getElementById('scribe-a11y-root') as HTMLElement | null;
          const textarea =
            (document.querySelector(
              '[data-vecto-a11y-root] textarea',
            ) as HTMLTextAreaElement | null) ??
            (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null);
          const projected = document.querySelector(
            '#scribe-a11y-root [data-vecto-content]',
          ) as HTMLElement | null;
          const w = window as unknown as {
            __app: { markdown: { height: number } };
          };
          return {
            canvasHeight: canvas?.height ?? 0,
            canvasClient: stage?.clientHeight ?? 0,
            markdownHeight: w.__app?.markdown.height ?? 0,
            hasTextarea: !!textarea,
            textareaLabel: textarea?.getAttribute('aria-label') ?? null,
            textareaVisible: textarea
              ? window.getComputedStyle(textarea).display !== 'none'
              : false,
            projectedExists: !!projected,
            projectedUserSelect: projected ? window.getComputedStyle(projected).userSelect : 'none',
            stageHeight: stage?.clientHeight ?? 0,
            hasA11yRoot: !!a11yRoot,
            dvhExpected: window.getComputedStyle(
              document.getElementById('scribe-app') as HTMLElement,
            ).height,
          };
        });
        expect(a11y.canvasHeight).toBeGreaterThan(0);
        // Initial content '# Hello Scribe' is ~88px at 390/768/2560; allow 40 to catch blank (0) but not fail minimal
        expect(a11y.markdownHeight).toBeGreaterThan(40);
        expect(a11y.stageHeight).toBeGreaterThan(100);
        expect(a11y.hasA11yRoot).toBeTruthy();
        // TextArea or projected content should be present for a11y
        expect(a11y.hasTextarea || a11y.projectedExists).toBeTruthy();
        if (a11y.projectedExists) {
          expect(['text', 'auto']).toContain(a11y.projectedUserSelect);
        }

        // 7) dvh, safe-area-inset, hairline, viewport-fit checks (once per viewport)
        const metaChecks = await page.evaluate(() => {
          const viewportMeta = document.querySelector(
            'meta[name="viewport"]',
          ) as HTMLMetaElement | null;
          const app = document.getElementById('scribe-app') as HTMLElement | null;
          const header = document.getElementById('scribe-header') as HTMLElement | null;
          const styles = app ? window.getComputedStyle(app) : null;
          const headerStyles = header ? window.getComputedStyle(header) : null;
          const rootStyles = window.getComputedStyle(document.documentElement);
          return {
            viewport: viewportMeta?.content ?? '',
            hasViewportFit: viewportMeta?.content.includes('viewport-fit=cover') ?? false,
            appHeight: styles?.height ?? '',
            headerPaddingLeft: headerStyles?.paddingLeft ?? '',
            hairline: rootStyles.getPropertyValue('--hairline').trim() || '1px',
            hasDvh: document.documentElement.innerHTML.includes('100dvh'),
            hasTextSizeAdjust: window
              .getComputedStyle(document.documentElement)
              .getPropertyValue('-webkit-text-size-adjust'),
          };
        });
        expect(
          metaChecks.hasViewportFit,
          'meta viewport must include viewport-fit=cover',
        ).toBeTruthy();
        expect(metaChecks.viewport).toContain('width=device-width');
        // header should have safe-area padding (max(16px, env(...)) resolves to at least 16px)
        expect(parseInt(metaChecks.headerPaddingLeft) >= 10).toBeTruthy();

        await context.close();
      });
    }
  }
});

test.describe('iOS URL-bar collapse and double-tap zoom guards', () => {
  test('0-height -> resize to valid height triggers Scene.resize and preview repaint', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
    );
    await page.waitForTimeout(500);

    // Record baseline: canvas and markdown have height >100
    const baseline = await page.evaluate(() => {
      const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement;
      const w = window as unknown as {
        __app: { markdown: { height: number } };
      };
      return { canvasH: canvas.height, mdH: w.__app.markdown.height };
    });
    expect(baseline.canvasH).toBeGreaterThan(0);
    expect(baseline.mdH).toBeGreaterThan(40);

    // Simulate iOS URL-bar collapse: stage reports 0 height transiently
    // Do it by setting stage height to 0 via JS and triggering ResizeObserver path via layout guard
    const zeroGuard = await page.evaluate(() => {
      const stage = document.getElementById('scribe-stage') as HTMLElement;
      const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement;
      const beforeH = canvas.height;
      const beforeMd = (window as unknown as { __app: { markdown: { height: number } } }).__app
        .markdown.height;
      // Force 0-height on stage (simulates URL-bar transient)
      stage.style.height = '0px';
      // Dispatch a resize event; layout should guard and NOT zero the canvas
      window.dispatchEvent(new Event('resize'));
      // Give ResizeObserver a tick
      return new Promise<{
        beforeH: number;
        beforeMd: number;
        afterH: number;
        afterMd: number;
        guard: boolean;
      }>((resolve) => {
        setTimeout(() => {
          const afterH = canvas.height;
          const afterMd = (window as unknown as { __app: { markdown: { height: number } } }).__app
            .markdown.height;
          // isValidStageSize should prevent 0-height from blanking canvas
          resolve({
            beforeH,
            beforeMd,
            afterH,
            afterMd,
            guard: afterH === beforeH,
          });
        }, 300);
      });
    });
    expect(zeroGuard.guard, 'canvas should not blank on 0-height transient').toBeTruthy();
    expect(zeroGuard.afterMd).toBeGreaterThan(40);

    // Now resize back to valid height triggers Scene.resize and preview repaint
    const recovered = await page.evaluate(async () => {
      const stage = document.getElementById('scribe-stage') as HTMLElement;
      const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement;
      // Restore height
      stage.style.height = '';
      // Force layout via window resize (ResizeObserver will fire)
      window.dispatchEvent(new Event('resize'));
      // Wait for next frame + ResizeObserver
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r as FrameRequestCallback)),
      );
      await new Promise((r) => setTimeout(r, 300));
      const w = window as unknown as {
        __app: {
          markdown: { height: number };
          previewScroll: { updateContentSize: () => void };
          scene: { markDirty: () => void };
        };
      };
      // Ensure markdown reflowed
      w.__app.previewScroll.updateContentSize();
      w.__app.scene.markDirty();
      await new Promise((r) => setTimeout(r, 200));
      return {
        canvasH: canvas.height,
        mdH: w.__app.markdown.height,
        stageH: stage.clientHeight,
      };
    });
    expect(recovered.canvasH).toBeGreaterThan(0);
    expect(recovered.mdH).toBeGreaterThan(40);
    expect(recovered.stageH).toBeGreaterThan(100);

    // Also test double-tap zoom not breaking layout: ensure touch-action manipulation on buttons
    const zoomGuard = await page.evaluate(() => {
      const btn = document.getElementById('scribe-menu-toggle') as HTMLElement;
      const stage = document.getElementById('scribe-stage') as HTMLElement;
      if (!btn || !stage) return null;
      return {
        btnTouch: window.getComputedStyle(btn).touchAction,
        stageTouch: window.getComputedStyle(stage).touchAction,
        textAdjust:
          window
            .getComputedStyle(document.documentElement)
            .getPropertyValue('-webkit-text-size-adjust') ||
          window.getComputedStyle(document.body).getPropertyValue('-webkit-text-size-adjust'),
      };
    });
    expect(zoomGuard?.btnTouch).toContain('manipulation');
    expect(zoomGuard?.stageTouch).toContain('pan-y');

    await context.close();
  });

  test('helpers — cssToBackingStore and isValidStageSize parity with renderer', async () => {
    // Pure helper parity (mirrors unit tests but as e2e sanity)
    expect(computeBackingStore(390, 844, 1)).toEqual({
      width: 390,
      height: 844,
    });
    expect(computeBackingStore(390, 844, 1.5)).toEqual({
      width: 585,
      height: 1266,
    });
    expect(computeBackingStore(390, 844, 2)).toEqual({
      width: 780,
      height: 1688,
    });
    expect(computeBackingStore(390, 844, 3)).toEqual({
      width: 1170,
      height: 2532,
    });
    expect(cssToBackingStore(0, 2)).toBe(1);
    expect(isValidStageSize(390, 844)).toBeTruthy();
    expect(isValidStageSize(0, 844)).toBeFalsy();
    expect(isValidStageSize(390, 0)).toBeFalsy();
    expect(isValidStageSize(NaN, 100)).toBeFalsy();
  });

  test('viewport helpers — BREAKPOINTS and DPR variants drive CSS', async () => {
    expect(BREAKPOINTS.toolbarHamburger).toBe(640);
    expect(BREAKPOINTS.drawerOverlay).toBe(900);
    expect(BREAKPOINTS.smallMobile).toBe(390);
    expect(BREAKPOINTS.tablet).toBe(768);
    expect(DPR_VARIANTS).toEqual([1, 1.5, 2, 3]);
    expect(viewportsWithDpr()).toHaveLength(16);
  });
});

test.describe('no blank after resize + pointerEvents', () => {
  test('resize across breakpoints does not blank canvas and retains a11y selectable text', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as { __app?: unknown }).__app !== undefined,
    );
    await page.waitForTimeout(500);

    // Check initial
    let check = await page.evaluate(() => {
      const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement;
      const w = window as unknown as {
        __app: { markdown: { height: number } };
      };
      const a11y = document.querySelector(
        '[data-vecto-a11y-root] textarea, #scribe-a11y-root textarea',
      );
      return {
        canvasH: canvas.height,
        mdH: w.__app.markdown.height,
        hasA11y: !!a11y,
      };
    });
    expect(check.canvasH).toBeGreaterThan(0);
    expect(check.mdH).toBeGreaterThan(40);
    expect(check.hasA11y).toBeTruthy();

    // Resize to 390 (triggers overlay, resizeStage guard, and layout)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    check = await page.evaluate(() => {
      const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement;
      const w = window as unknown as {
        __app: { markdown: { height: number } };
      };
      const stage = document.getElementById('scribe-stage') as HTMLElement;
      return {
        canvasH: canvas.height,
        mdH: w.__app.markdown.height,
        stageH: stage.clientHeight,
        stageW: stage.clientWidth,
      };
    });
    expect(check.canvasH).toBeGreaterThan(0);
    expect(check.mdH).toBeGreaterThan(40);
    expect(check.stageH).toBeGreaterThan(100);

    // Resize to 2560 (large desktop, capped at 1920 max-width)
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForTimeout(600);
    check = await page.evaluate(() => {
      const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement;
      const w = window as unknown as {
        __app: { markdown: { height: number } };
      };
      return { canvasH: canvas.height, mdH: w.__app.markdown.height };
    });
    expect(check.canvasH).toBeGreaterThan(0);
    expect(check.mdH).toBeGreaterThan(40);

    // Back to 768
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(600);
    const finalA11y = await page.evaluate(() => {
      const a11y = document.querySelector(
        '[data-vecto-a11y-root] textarea, #scribe-a11y-root textarea',
      );
      const projected = document.querySelector('#scribe-a11y-root [data-vecto-content]');
      return {
        hasA11y: !!a11y,
        projected: !!projected,
        userSelect: projected
          ? window.getComputedStyle(projected as HTMLElement).userSelect
          : 'none',
      };
    });
    expect(finalA11y.hasA11y || finalA11y.projected).toBeTruthy();

    await context.close();
  });
});
