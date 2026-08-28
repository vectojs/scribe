import { SVGEntity, type Entity } from '@vectojs/core';
import { type FencedBlockRenderOptions, registerFencedBlockRenderer } from '@vectojs/markdown';
import { Text } from '@vectojs/ui';

// ---------------------------------------------------------------------------
// Mermaid fenced-block renderer — spike (carryctx/mermaid-spike)
// ---------------------------------------------------------------------------
// Lazy-loads mermaid via dynamic import so the main bundle stays slim.
// After load, `renderMermaid(source)` returns an SVGEntity or null (fallback).
// An async per-diagram cache triggers a markdown rebuild via window event
// when the SVG becomes ready, reusing the existing "CodeBlock placeholder"
// pattern. Dark theme sync via MutationObserver.
//
// Tradeoffs are documented in the PR description.
// ---------------------------------------------------------------------------

let mermaidInstance: unknown = null;
let mermaidInitTheme: string | null = null;

// Cache key is `${theme}::${source}` so a theme switch regenerates SVGs.
const svgCache = new Map<string, string>();
const pendingRenders = new Map<string, Promise<string>>();

// Listeners for cache updates — main.ts subscribes and calls markdown.setContent().
const cacheUpdateListeners = new Set<() => void>();

export function onMermaidCacheUpdate(cb: () => void): () => void {
  cacheUpdateListeners.add(cb);
  return () => {
    cacheUpdateListeners.delete(cb);
  };
}

function notifyCacheUpdate(): void {
  for (const cb of cacheUpdateListeners) {
    try {
      cb();
    } catch (e) {
      console.error('[mermaid] cache listener failed', e);
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('scribe:mermaid-ready'));
  } catch {
    // ignore
  }
}

function getMermaidTheme(): 'dark' | 'default' {
  try {
    const dataTheme = document.documentElement.getAttribute('data-theme');
    // Scribe sets data-theme="dark"|"light" (via TOKENS_BY_MODE).
    // Mermaid themes: "dark" vs "default" (light). Use dark for data-theme dark.
    return dataTheme === 'dark' ? 'dark' : 'default';
  } catch {
    return 'default';
  }
}

// ── Visible loading state (CTX-0565) ─────────────────────────────────────
// First paint showed a plain CodeBlock for 1-2s while the mermaid chunk
// downloaded + diagrams rendered, indistinguishable from "unsupported".
// Expose a loading signal so the shell can show a placeholder + status hint.
// ──────────────────────────────────────────────────────────────────────────
let mermaidChunkLoading = false;
let mermaidLoadPromise: Promise<unknown> | null = null;
let lastLoadingNotified: boolean | null = null;
const loadingListeners = new Set<(loading: boolean) => void>();

function computeLoading(): boolean {
  return mermaidChunkLoading || pendingRenders.size > 0;
}

function notifyLoadingChange(): void {
  const loading = computeLoading();
  if (lastLoadingNotified === loading) return;
  lastLoadingNotified = loading;
  for (const cb of loadingListeners) {
    try {
      cb(loading);
    } catch (e) {
      console.error('[mermaid] loading listener failed', e);
    }
  }
  try {
    window.dispatchEvent(
      new CustomEvent(loading ? 'scribe:mermaid-loading' : 'scribe:mermaid-ready'),
    );
  } catch {
    // ignore
  }
}

export function onMermaidLoadingChange(cb: (loading: boolean) => void): () => void {
  loadingListeners.add(cb);
  try {
    cb(computeLoading());
  } catch {
    // ignore
  }
  return () => {
    loadingListeners.delete(cb);
  };
}

export function isMermaidLoading(): boolean {
  return computeLoading();
}

function createMermaidPlaceholder(opts: FencedBlockRenderOptions): Entity | null {
  try {
    const theme = opts.theme as unknown as Record<string, unknown>;
    const commentColor = theme.syntaxCommentColor as string | undefined;
    const quoteColor = theme.quoteBorderColor as string | undefined;
    const fallback = getMermaidTheme() === 'dark' ? '#9aa0a6' : '#8a7f6b';
    const color = (commentColor ?? quoteColor ?? fallback) as string;
    const aw =
      Number.isFinite(opts.availableWidth) && opts.availableWidth > 0 ? opts.availableWidth : 640;
    // Bilingual loading text — obvious that rendering is pending, not "unsupported".
    const msg = '⟳ Mermaid rendering… 首次加载约1s';
    return new Text(msg, {
      font: '13px ui-sans-serif, system-ui, -apple-system, sans-serif',
      color,
      maxWidth: Math.max(160, aw - 32),
      lineHeight: 20,
      selectable: true,
    });
  } catch (e) {
    console.error('[mermaid] placeholder failed', e);
    return null;
  }
}

export async function ensureMermaid(): Promise<unknown> {
  if (mermaidInstance) return mermaidInstance;
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidChunkLoading = true;
  notifyLoadingChange();
  mermaidLoadPromise = (async () => {
    try {
      // Dynamic import — vite code-splits mermaid into separate chunk.
      const mod: unknown = await import('mermaid');
      // mermaid 11 exports default with initialize/render; some bundlers expose named.
      const m: Record<string, unknown> =
        (mod as Record<string, unknown>).default !== undefined
          ? ((mod as Record<string, unknown>).default as Record<string, unknown>)
          : (mod as Record<string, unknown>);
      const initialize = m.initialize as ((cfg: unknown) => void) | undefined;
      if (typeof initialize === 'function') {
        initialize({
          startOnLoad: false,
          theme: getMermaidTheme(),
          securityLevel: 'strict',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        mermaidInitTheme = getMermaidTheme();
      }
      mermaidInstance = m;
      return m;
    } finally {
      mermaidChunkLoading = false;
      notifyLoadingChange();
      mermaidLoadPromise = null;
    }
  })();
  return mermaidLoadPromise;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `scribe-mermaid-${Date.now()}-${idCounter}`;
}

function syncMermaidTheme(): void {
  if (!mermaidInstance) return;
  const theme = getMermaidTheme();
  if (theme !== mermaidInitTheme) {
    const m = mermaidInstance as Record<string, unknown>;
    const initialize = m.initialize as ((cfg: unknown) => void) | undefined;
    if (typeof initialize === 'function') {
      try {
        initialize({
          startOnLoad: false,
          theme,
          securityLevel: 'strict',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        mermaidInitTheme = theme;
        // Invalidate cache — SVGs are theme-colored.
        svgCache.clear();
        notifyCacheUpdate();
      } catch (e) {
        console.error('[mermaid] re-initialize failed', e);
      }
    }
  }
}

// Watch data-theme attribute for live theme switching.
if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  try {
    const obs = new MutationObserver(() => {
      syncMermaidTheme();
    });
    // documentElement exists after main's mountScribe runs; guard.
    if (document.documentElement) {
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        try {
          obs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
          });
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // ignore
  }
}

export function registerMermaidRenderer(): void {
  registerFencedBlockRenderer('mermaid', {
    async load() {
      const m = (await ensureMermaid()) as Record<string, unknown>;

      // Return sync renderer — the registry calls this synchronously after load.
      return (source: string, _lang: string, opts: FencedBlockRenderOptions): Entity | null => {
        syncMermaidTheme();
        const theme = getMermaidTheme();
        const cacheKey = `${theme}::${source}`;
        const cached = svgCache.get(cacheKey);
        if (cached) {
          try {
            const entity = new SVGEntity(cached);
            // Clamp to availableWidth so wide diagrams don't overflow.
            const aw = opts.availableWidth;
            if (Number.isFinite(aw) && aw > 0 && entity.width > aw) {
              const scale = aw / entity.width;
              entity.width = aw;
              entity.height = Math.round(entity.height * scale);
            }
            return entity;
          } catch (e) {
            console.error('[mermaid] SVGEntity creation failed', e);
            return null;
          }
        }

        // Not cached — kick off async render if not already pending.
        if (!pendingRenders.has(cacheKey)) {
          const p = (async (): Promise<string> => {
            try {
              // mermaid 11 API: mermaid.render(id, code) or mermaid.mermaidAPI.render(id, code)
              const api = (m.mermaidAPI ?? m) as Record<string, unknown>;
              const renderFn =
                (api.render as ((id: string, text: string) => Promise<unknown>) | undefined) ??
                (m.render as ((id: string, text: string) => Promise<unknown>) | undefined);
              if (typeof renderFn !== 'function') {
                throw new Error('mermaid render function not found');
              }
              const id = nextId();
              // Ensure a container element exists? mermaid creates hidden div in body if no container given.
              const result = (await (
                renderFn as (id: string, txt: string) => Promise<unknown>
              ).call(m, id, source)) as unknown;
              let svg: string | undefined;
              if (typeof result === 'string') {
                svg = result;
              } else if (
                result &&
                typeof result === 'object' &&
                'svg' in (result as Record<string, unknown>)
              ) {
                svg = (result as Record<string, unknown>).svg as string;
              }
              if (typeof svg === 'string' && svg.includes('<svg')) {
                svgCache.set(cacheKey, svg);
                notifyCacheUpdate();
                return svg;
              }
              throw new Error('invalid svg result');
            } catch (err) {
              console.error('[mermaid] render failed', err);
              return '';
            } finally {
              pendingRenders.delete(cacheKey);
              notifyLoadingChange();
            }
          })();
          pendingRenders.set(cacheKey, p as Promise<string>);
          notifyLoadingChange();
          // Also handle promise resolution to notify even if sync check missed.
          void p.then((svg) => {
            if (svg) {
              // Already notified inside, but ensure second notify if cache was set.
            }
          });
        }

        // Visible loading placeholder — CTX-0565: instead of falling back to a
        // raw CodeBlock (indistinguishable from "unsupported"), show a muted
        // "Mermaid rendering…" entity so the user knows the diagram is coming.
        // Once the async render finishes, cacheUpdateListeners rebuild markdown
        // and the cached SVGEntity replaces this placeholder.
        const placeholder = createMermaidPlaceholder(opts);
        if (placeholder) return placeholder;
        return null;
      };
    },
  });
}

// Also export helpers for testing / inspection.
export function __clearMermaidCacheForTest(): void {
  svgCache.clear();
  pendingRenders.clear();
  mermaidChunkLoading = false;
  mermaidLoadPromise = null;
  lastLoadingNotified = null;
  notifyLoadingChange();
}

export function __getMermaidCacheSizeForTest(): number {
  return svgCache.size;
}
