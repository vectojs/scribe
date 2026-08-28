import { marked } from 'marked';

// ── Mermaid export handling ───────────────────────────────────────────────
// For HTML/PDF export we must not lose diagrams. The canvas preview uses a
// lazy SVGEntity (see src/mermaid.ts), but exported HTML is static client code
// that runs without VectoJS. We emit `<pre class="mermaid">` and include the
// CDN mermaid script so the browser renders the diagram on load. If the viewer
// has no JS, the source remains readable as pre text — same fallback as the
// canvas preview's CodeBlock.

const MERMAID_SCRIPT_TAG =
  '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>';
const MERMAID_INIT_SCRIPT =
  '<script>mermaid.initialize({startOnLoad:true, theme: document.documentElement && document.documentElement.dataset && document.documentElement.dataset.theme==="dark" ? "dark" : "default", securityLevel:"strict"});</script>';

function containsMermaid(markdown: string): boolean {
  return /```\s*mermaid/i.test(markdown);
}

function mermaidMarkedExtensionRegistered(): boolean {
  // marked.use is idempotent but we guard to avoid double registration in tests
  // where the module may be re-imported.
  try {
    // No public API to inspect registered extensions; use a flag on marked.
    const anyMarked = marked as unknown as {
      __scribeMermaidRegistered?: boolean;
    };
    if (anyMarked.__scribeMermaidRegistered) return true;
    anyMarked.__scribeMermaidRegistered = true;
    return false;
  } catch {
    return false;
  }
}

function ensureMermaidMarkedExtension(): void {
  if (mermaidMarkedExtensionRegistered()) return;
  // Try to register a renderer extension for `mermaid` fences.
  // marked 18 renderer.code receives a Tokens.Code object; returning false
  // falls back to default. We use a permissive signature and cast.
  try {
    (marked as unknown as { use: (opts: unknown) => void }).use({
      renderer: {
        code(token: unknown): string | false {
          const t = token as { text?: string; lang?: string; raw?: string };
          const lang = (t.lang ?? '').toLowerCase().trim();
          if (lang === 'mermaid') {
            const text = t.text ?? '';
            return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
          }
          return false;
        },
      },
    });
    (marked as unknown as Record<string, unknown>).__scribeMermaidRegistered = true;
  } catch {
    // If marked version differs, fallback to post-processing in renderMarkdownToHtml.
  }
}

function renderMarkdownToHtml(markdown: string): string {
  ensureMermaidMarkedExtension();
  try {
    const html = marked.parse(markdown) as string;
    // Fallback post-process: if extension didn't trigger (e.g., different marked
    // version), replace the default mermaid code block with <pre class="mermaid">.
    // Default is `<pre><code class="language-mermaid">...</code></pre>`
    if (html.includes('language-mermaid')) {
      return html.replace(
        /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
        (_match: string, code: string) => `<pre class="mermaid">${code}</pre>`,
      );
    }
    return html;
  } catch {
    return `<pre>${escapeHtml(markdown)}</pre>`;
  }
}

function wrapHtmlDocument(
  htmlBody: string,
  docTitle: string,
  options: { includeMermaid?: boolean } = {},
): string {
  const mermaidHead = options.includeMermaid
    ? `\n${MERMAID_SCRIPT_TAG}\n${MERMAID_INIT_SCRIPT}\n<style>pre.mermaid{background:#f5f0e8; padding:16px; border-radius:8px; overflow:auto; display:flex; justify-content:center} pre.mermaid svg{max-width:100%; height:auto}</style>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(docTitle)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width:800px; margin:40px auto; padding:0 20px; line-height:1.6; color:#1a1a1a}
h1,h2,h3{line-height:1.2}
code{background:#f5f0e8; padding:2px 6px; border-radius:4px; font-size:0.9em}
pre{background:#f5f0e8; padding:16px; border-radius:8px; overflow:auto}
pre code{background:none; padding:0}
blockquote{border-left:3px solid #d97757; margin:16px 0; padding:8px 16px; background:#fffaf5}
table{border-collapse:collapse; width:100%}
th,td{border:1px solid #e5ddd3; padding:8px}
</style>${mermaidHead}
</head>
<body>
${htmlBody}
</body>
</html>`;
}

function downloadBlob(filename: string, content: string | Blob, mimeType: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Delay revoke to allow download to start
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

export function exportMarkdown(filename: string, markdown: string): void {
  const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
  downloadBlob(safeName, markdown, 'text/markdown;charset=utf-8');
}

export function exportHtml(filename: string, markdown: string, title?: string): void {
  const htmlBody = renderMarkdownToHtml(markdown);
  const docTitle = title ?? filename.replace(/\.md$/i, '');
  const fullHtml = wrapHtmlDocument(htmlBody, docTitle, {
    includeMermaid: containsMermaid(markdown),
  });
  // Use outerHTML-style Blob download via FileSaver pattern
  const safeName = filename.replace(/\.md$/i, '') + '.html';
  downloadBlob(safeName, fullHtml, 'text/html;charset=utf-8');
}

export function exportPdf(filename: string, markdown: string, title?: string): void {
  // Primary: leverage browser print to PDF. Fallback: download HTML as .pdf if print blocked.
  // Create hidden iframe with rendered HTML then print.
  const htmlBody = renderMarkdownToHtml(markdown);
  const docTitle = title ?? filename.replace(/\.md$/i, '');
  const fullHtml = wrapHtmlDocument(htmlBody, docTitle, {
    includeMermaid: containsMermaid(markdown),
  }).replace('<style>', '<style>\n@media print{body{margin:20mm}}\n');
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(fullHtml);
      doc.close();
      const cleanup = (): void => {
        setTimeout(() => iframe.remove(), 1000);
      };
      // try print; if fails, fallback to download
      const win = iframe.contentWindow;
      if (win) {
        win.focus();
        // Some browsers block print in headless; ignore errors
        try {
          win.print();
          cleanup();
          return;
        } catch {
          // fallback
        }
      }
      cleanup();
    } else {
      iframe.remove();
    }
  } catch {
    // fallback
  }
  // Fallback: download HTML with .pdf extension (user can open/print)
  const safeName = filename.replace(/\.md$/i, '') + '.pdf';
  downloadBlob(safeName, fullHtml, 'application/pdf');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildExportHtmlViaOuterHTML(markdown: string, title?: string): string {
  const container = document.createElement('div');
  const htmlBody = renderMarkdownToHtml(markdown);
  container.innerHTML = htmlBody;
  // Demonstrates outerHTML usage: wrap container's outerHTML into document
  const docTitle = title ?? 'Document';
  const includeMermaid = containsMermaid(markdown);
  const mermaidHead = includeMermaid ? `${MERMAID_SCRIPT_TAG}\n${MERMAID_INIT_SCRIPT}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title>${mermaidHead}</head><body>${container.outerHTML}</body></html>`;
}
