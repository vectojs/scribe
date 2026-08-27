import { describe, expect, test } from 'bun:test';

import {
  computeBackingStore,
  cssToBackingStore,
  DPR_EPSILON,
  effectiveDPR,
  hasDprChanged,
  isValidStageSize,
  markdownMaxWidth,
} from '../src/utils/dpr';

describe('dpr helpers', () => {
  test('DPR_EPSILON matches Scene.watchDevicePixelRatio', () => {
    expect(DPR_EPSILON).toBe(0.001);
  });

  test('effectiveDPR reads window.devicePixelRatio and guards NaN/Infinity/0', () => {
    const orig = (globalThis as unknown as { window?: unknown }).window;
    try {
      (globalThis as unknown as { window: { devicePixelRatio: number } }).window = {
        devicePixelRatio: 2,
      } as unknown as Window;
      expect(effectiveDPR()).toBe(2);
      (globalThis as unknown as { window: { devicePixelRatio: number } }).window = {
        devicePixelRatio: NaN,
      } as unknown as Window;
      expect(effectiveDPR()).toBe(1);
      (globalThis as unknown as { window: { devicePixelRatio: number } }).window = {
        devicePixelRatio: Infinity,
      } as unknown as Window;
      expect(effectiveDPR()).toBe(1);
      (globalThis as unknown as { window: { devicePixelRatio: number } }).window = {
        devicePixelRatio: 0,
      } as unknown as Window;
      expect(effectiveDPR()).toBe(1);
    } finally {
      if (orig === undefined) {
        delete (globalThis as unknown as { window?: unknown }).window;
      } else {
        (globalThis as unknown as { window?: unknown }).window = orig as Window;
      }
    }
  });

  test('effectiveDPR clamps to maxDPR and guards invalid maxDPR', () => {
    const orig = (globalThis as unknown as { window?: unknown }).window;
    try {
      (globalThis as unknown as { window: { devicePixelRatio: number } }).window = {
        devicePixelRatio: 3,
      } as unknown as Window;
      expect(effectiveDPR(2)).toBe(2);
      expect(effectiveDPR(3)).toBe(3);
      expect(effectiveDPR(undefined)).toBe(3);
      expect(effectiveDPR(NaN)).toBe(3);
      expect(effectiveDPR(Infinity)).toBe(3);
      expect(effectiveDPR(0)).toBe(3);
      expect(effectiveDPR(-1)).toBe(3);
    } finally {
      if (orig === undefined) delete (globalThis as unknown as { window?: unknown }).window;
      else (globalThis as unknown as { window?: unknown }).window = orig as Window;
    }
  });

  test('cssToBackingStore rounds and max(1) guards', () => {
    expect(cssToBackingStore(100, 2)).toBe(200);
    expect(cssToBackingStore(100, 1.5)).toBe(150);
    // 1.5× fractional DPR (common at 150% zoom) — must round, not floor
    expect(cssToBackingStore(390, 1.5)).toBe(585);
    expect(cssToBackingStore(768, 1.5)).toBe(1152);
    expect(cssToBackingStore(99.6, 2)).toBe(199);
    // max(1) guard
    expect(cssToBackingStore(0, 2)).toBe(1);
    expect(cssToBackingStore(1, 0.1)).toBe(1);
    // NaN/Infinity guards
    expect(cssToBackingStore(NaN, 2)).toBe(1);
    expect(cssToBackingStore(100, NaN)).toBe(100);
    expect(cssToBackingStore(Infinity, 2)).toBe(1);
  });

  test('computeBackingStore covers 1/1.5/2/3 for all breakpoints', () => {
    const cases: [number, number, number, { width: number; height: number }][] = [
      [390, 844, 1, { width: 390, height: 844 }],
      [390, 844, 1.5, { width: 585, height: 1266 }],
      [390, 844, 2, { width: 780, height: 1688 }],
      [390, 844, 3, { width: 1170, height: 2532 }],
      [768, 1024, 2, { width: 1536, height: 2048 }],
      [1024, 768, 2, { width: 2048, height: 1536 }],
      [2560, 1440, 2, { width: 5120, height: 2880 }],
      [2560, 1440, 3, { width: 7680, height: 4320 }],
    ];
    for (const [w, h, dpr, expected] of cases) {
      expect(computeBackingStore(w, h, dpr)).toEqual(expected);
    }
  });

  test('hasDprChanged uses epsilon 0.001', () => {
    expect(hasDprChanged(1, 1.0005)).toBe(false);
    expect(hasDprChanged(1, 1.001)).toBe(false);
    expect(hasDprChanged(1, 1.0011)).toBe(true);
    expect(hasDprChanged(2, 1.5)).toBe(true);
  });

  test('isValidStageSize guards 0-height iOS URL-bar transient', () => {
    expect(isValidStageSize(390, 844)).toBe(true);
    expect(isValidStageSize(0, 844)).toBe(false);
    expect(isValidStageSize(390, 0)).toBe(false);
    expect(isValidStageSize(NaN, 100)).toBe(false);
    expect(isValidStageSize(100, Infinity)).toBe(false);
  });

  test('markdownMaxWidth keeps 320 floor', () => {
    expect(markdownMaxWidth(390)).toBe(358);
    expect(markdownMaxWidth(320)).toBe(320);
    expect(markdownMaxWidth(200)).toBe(320);
    expect(markdownMaxWidth(1024)).toBe(860);
    expect(markdownMaxWidth(2560)).toBe(860);
    expect(markdownMaxWidth(900)).toBe(860);
    expect(markdownMaxWidth(NaN)).toBe(320);
  });

  test('markdownMaxWidth caps at centered 860 (Obsidian/Typora)', () => {
    expect(markdownMaxWidth(1200)).toBe(860);
    expect(markdownMaxWidth(1920)).toBe(860);
    expect(markdownMaxWidth(400)).toBe(368);
  });
});
