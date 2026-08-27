import { describe, expect, test } from 'bun:test';

import { computeBackingStore } from '../src/utils/dpr';
import {
  BREAKPOINTS,
  DPR_VARIANTS,
  isDrawerOverlay,
  isHamburgerMode,
  layoutMode,
  VIEWPORT_PRESETS,
  viewportsWithDpr,
} from '../src/utils/viewport';

describe('viewport presets', () => {
  test('covers required breakpoints 390/768/1024/2560', () => {
    const widths = VIEWPORT_PRESETS.map((v) => v.width);
    expect(widths).toContain(390);
    expect(widths).toContain(768);
    expect(widths).toContain(1024);
    expect(widths).toContain(2560);
  });

  test('BREAKPOINTS expose functional thresholds', () => {
    expect(BREAKPOINTS.smallMobile).toBe(390);
    expect(BREAKPOINTS.tablet).toBe(768);
    expect(BREAKPOINTS.drawerOverlay).toBe(900);
    expect(BREAKPOINTS.toolbarHamburger).toBe(640);
    expect(BREAKPOINTS.desktop).toBe(1024);
    expect(BREAKPOINTS.large).toBe(2560);
  });

  test('DPR variants cover 1/1.5/2/3', () => {
    expect([...DPR_VARIANTS]).toEqual([1, 1.5, 2, 3]);
  });

  test('viewportsWithDpr expands 4 presets × 4 DPR = 16', () => {
    const all = viewportsWithDpr();
    expect(all).toHaveLength(16);
    expect(all.filter((v) => v.deviceScaleFactor === 2)).toHaveLength(4);
    expect(all.map((v) => v.name)).toContain('mobile-390@2x');
  });

  test('isDrawerOverlay / isHamburgerMode thresholds', () => {
    expect(isDrawerOverlay(899)).toBe(true);
    expect(isDrawerOverlay(900)).toBe(false);
    expect(isDrawerOverlay(1024)).toBe(false);
    expect(isHamburgerMode(639)).toBe(true);
    expect(isHamburgerMode(640)).toBe(false);
  });

  test('layoutMode mirrors CSS breakpoints', () => {
    expect(layoutMode(390)).toBe('mobile');
    expect(layoutMode(768)).toBe('tablet');
    expect(layoutMode(1024)).toBe('desktop');
    expect(layoutMode(2560)).toBe('large');
    expect(layoutMode(3000)).toBe('large');
  });

  test('backing store for each viewport at each DPR is Math.round(css*dpr) max(1)', () => {
    for (const vp of viewportsWithDpr()) {
      const backing = computeBackingStore(vp.width, vp.height, vp.deviceScaleFactor);
      expect(backing.width).toBe(Math.max(1, Math.round(vp.width * vp.deviceScaleFactor)));
      expect(backing.height).toBe(Math.max(1, Math.round(vp.height * vp.deviceScaleFactor)));
      // DPR smoke: backing must not be 0 even for tiny css
      expect(backing.width).toBeGreaterThan(0);
      expect(backing.height).toBeGreaterThan(0);
    }
  });
});

describe('responsive smoke — playwright deviceScaleFactor parity', () => {
  test('each preset maps to a playwright viewport + deviceScaleFactor', () => {
    for (const vp of VIEWPORT_PRESETS) {
      // Simulate what playwright would do: set viewportSize + deviceScaleFactor
      const playwrightConfig = {
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
      };
      expect(playwrightConfig.viewport.width).toBe(vp.width);
      expect(playwrightConfig.deviceScaleFactor).toBe(1);
      // Backing store derived from same DPR must be consistent with canvas sizing
      const backing = computeBackingStore(
        playwrightConfig.viewport.width,
        playwrightConfig.viewport.height,
        playwrightConfig.deviceScaleFactor,
      );
      expect(backing.width).toBe(vp.width);
    }
  });

  test('all DPR variants produce distinct backing stores for same viewport', () => {
    const base = VIEWPORT_PRESETS[0];
    const seen = new Set<number>();
    for (const dpr of DPR_VARIANTS) {
      const backing = computeBackingStore(base.width, base.height, dpr);
      expect(seen.has(backing.width)).toBe(false);
      seen.add(backing.width);
    }
    expect(seen.size).toBe(4);
  });
});
