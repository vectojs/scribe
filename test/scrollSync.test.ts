import { describe, expect, test } from 'bun:test';

import {
  clamp,
  debounce,
  mapEditorLineToPreviewOffset,
  mapEditorToPreview,
  mapPreviewOffsetToEditorLine,
  mapPreviewToEditor,
  SyncGuard,
} from '../src/editor/ScrollSync';

describe('ScrollSync — proportional mapping', () => {
  test('editor at top maps to preview top', () => {
    const p = mapEditorToPreview(
      { scrollTop: 0, scrollHeight: 1000, viewportHeight: 400 },
      { scrollTop: 0, scrollHeight: 2000, viewportHeight: 400 },
    );
    expect(p).toBe(0);
  });

  test('editor at bottom maps to preview bottom', () => {
    const eMax = 600; // 1000-400
    const pMax = 1600; // 2000-400
    const p = mapEditorToPreview(
      { scrollTop: eMax, scrollHeight: 1000, viewportHeight: 400 },
      { scrollTop: 0, scrollHeight: 2000, viewportHeight: 400 },
    );
    expect(p).toBe(pMax);
  });

  test('editor mid maps proportionally', () => {
    const p = mapEditorToPreview(
      { scrollTop: 300, scrollHeight: 1000, viewportHeight: 400 },
      { scrollTop: 0, scrollHeight: 2000, viewportHeight: 400 },
    );
    // ratio 0.5 → 800
    expect(p).toBe(800);
  });

  test('clamps when no overflow', () => {
    expect(
      mapEditorToPreview(
        { scrollTop: 100, scrollHeight: 300, viewportHeight: 400 },
        { scrollTop: 0, scrollHeight: 2000, viewportHeight: 400 },
      ),
    ).toBe(0);
    expect(
      mapPreviewToEditor(
        { scrollTop: 100, scrollHeight: 300, viewportHeight: 400 },
        { scrollTop: 0, scrollHeight: 1000, viewportHeight: 400 },
      ),
    ).toBe(0);
  });

  test('preview to editor mirrors correctly', () => {
    const e = mapPreviewToEditor(
      { scrollTop: 800, scrollHeight: 2000, viewportHeight: 400 },
      { scrollTop: 0, scrollHeight: 1000, viewportHeight: 400 },
    );
    expect(e).toBe(300);
  });

  test('clamp clamps correctly', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(12, 0, 10)).toBe(10);
  });
});

describe('ScrollSync — line-box mapping', () => {
  const boxes = [
    { y: 0, height: 20 },
    { y: 40, height: 20 },
    { y: 90, height: 30 },
    { y: 150, height: 20 },
  ];

  test('line 0 maps near top', () => {
    const off = mapEditorLineToPreviewOffset(0, 4, boxes, 400);
    expect(off).toBe(0);
  });

  test('last line maps near last box', () => {
    const off = mapEditorLineToPreviewOffset(3, 4, boxes, 400);
    // last box y =150 -16 padding =134
    expect(off).toBe(134);
  });

  test('mid line maps to middle box', () => {
    // ratio 0.55 → idx floor(2.22)=2 → y90-16=74
    const mid = mapEditorLineToPreviewOffset(5, 10, boxes, 400);
    expect(mid).toBe(74);
  });

  test('empty boxes returns 0', () => {
    expect(mapEditorLineToPreviewOffset(5, 10, [], 400)).toBe(0);
  });

  test('preview offset to editor line', () => {
    expect(mapPreviewOffsetToEditorLine(0, boxes, 10)).toBe(0);
    expect(mapPreviewOffsetToEditorLine(45, boxes, 10)).toBeGreaterThan(0);
    expect(mapPreviewOffsetToEditorLine(200, boxes, 4)).toBe(3);
  });
});

describe('SyncGuard — loop prevention', () => {
  test('prevents immediate feedback', () => {
    const g = new SyncGuard(80);
    expect(g.shouldSyncFromEditor(1000)).toBe(true);
    g.markPreviewSync(1000);
    expect(g.shouldSyncFromEditor(1020)).toBe(false);
    expect(g.shouldSyncFromEditor(1100)).toBe(true);
    g.markEditorSync(1100);
    expect(g.shouldSyncFromPreview(1120)).toBe(false);
    expect(g.shouldSyncFromPreview(1200)).toBe(true);
  });

  test('debounce trailing edge', async () => {
    let calls = 0;
    const fn = debounce(() => calls++, 10) as () => void;
    fn();
    fn();
    fn();
    expect(calls).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
  });
});
