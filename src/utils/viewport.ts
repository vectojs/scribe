/**
 * Viewport + DPR definitions for responsive + visual regression.
 *
 * Breakpoints mirror the spec: 390/768/1024/2560, plus the shell's functional
 * thresholds at 640 (toolbar hamburger) and 900 (drawer overlay).
 * Each is paired with DPR variants 1 / 1.5 / 2 / 3 for HiDPI coverage.
 */

export type ViewportPreset = {
  name: string;
  width: number;
  height: number;
  /** Playwright `deviceScaleFactor` — maps directly to `window.devicePixelRatio`. */
  deviceScaleFactor: number;
};

/** Functional breakpoints exposed for CSS/JS parity. */
export const BREAKPOINTS = {
  /** Small mobile — iPhone SE / 390 class */
  smallMobile: 390,
  /** Toolbar collapses to hamburger below this */
  toolbarHamburger: 640,
  /** Tablet portrait */
  tablet: 768,
  /** Explorer/TOC drawers become overlay below this */
  drawerOverlay: 900,
  /** Tablet landscape / small desktop */
  desktop: 1024,
  /** Large desktop / 1440p */
  large: 2560,
} as const;

export const DPR_VARIANTS = [1, 1.5, 2, 3] as const;

/**
 * Canonical 4 viewports for smoke / visual regression.
 * Heights chosen to exercise the 0-height mobile URL-bar guard:
 * - 390×844  (iPhone 12/13 portraît — dvh vs vh divergence)
 * - 768×1024 (iPad portrait)
 * - 1024×768 (iPad landscape / small desktop)
 * - 2560×1440 (large desktop)
 */
export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { name: 'mobile-390', width: 390, height: 844, deviceScaleFactor: 1 },
  { name: 'tablet-768', width: 768, height: 1024, deviceScaleFactor: 1 },
  { name: 'desktop-1024', width: 1024, height: 768, deviceScaleFactor: 1 },
  { name: 'large-2560', width: 2560, height: 1440, deviceScaleFactor: 1 },
] as const;

/** Expand presets across DPR variants for DPR smoke. */
export function viewportsWithDpr(
  base: readonly ViewportPreset[] = VIEWPORT_PRESETS,
): ViewportPreset[] {
  const out: ViewportPreset[] = [];
  for (const vp of base) {
    for (const dpr of DPR_VARIANTS) {
      out.push({
        name: `${vp.name}@${dpr}x`,
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: dpr,
      });
    }
  }
  return out;
}

/**
 * Whether a width is in overlay-drawer mode (< 900).
 */
export function isDrawerOverlay(width: number): boolean {
  return width < BREAKPOINTS.drawerOverlay;
}

/**
 * Whether a width is in hamburger-toolbar mode (< 640).
 */
export function isHamburgerMode(width: number): boolean {
  return width < BREAKPOINTS.toolbarHamburger;
}

/**
 * Layout mode derived from width — mirrors the CSS media queries.
 */
export function layoutMode(width: number): 'mobile' | 'tablet' | 'desktop' | 'large' {
  if (width < BREAKPOINTS.tablet) return 'mobile';
  if (width < BREAKPOINTS.desktop) return 'tablet';
  if (width < BREAKPOINTS.large) return 'desktop';
  return 'large';
}
