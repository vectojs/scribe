import { marked } from 'marked';

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
  let htmlBody = '';
  try {
    htmlBody = marked.parse(markdown) as string;
  } catch {
    htmlBody = `<pre>${escapeHtml(markdown)}</pre>`;
  }
  const docTitle = title ?? filename.replace(/\.md$/i, '');
  const fullHtml = `<!doctype html>
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
</style>
</head>
<body>
${htmlBody}
</body>
</html>`;
  // Use outerHTML-style Blob download via FileSaver pattern
  const safeName = filename.replace(/\.md$/i, '') + '.html';
  downloadBlob(safeName, fullHtml, 'text/html;charset=utf-8');
}

export function exportPdf(filename: string, markdown: string, title?: string): void {
  // Primary: leverage browser print to PDF. Fallback: download HTML as .pdf if print blocked.
  // Create hidden iframe with rendered HTML then print.
  let htmlBody = '';
  try {
    htmlBody = marked.parse(markdown) as string;
  } catch {
    htmlBody = `<pre>${escapeHtml(markdown)}</pre>`;
  }
  const docTitle = title ?? filename.replace(/\.md$/i, '');
  const fullHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(docTitle)}</title>
<style>
@media print{body{margin:20mm}}
body{font-family:system-ui, sans-serif; line-height:1.6; color:#1a1a1a}
</style>
</head>
<body>
${htmlBody}
</body>
</html>`;
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
  let htmlBody = '';
  try {
    htmlBody = marked.parse(markdown) as string;
  } catch {
    htmlBody = `<pre>${escapeHtml(markdown)}</pre>`;
  }
  container.innerHTML = htmlBody;
  // Demonstrates outerHTML usage: wrap container's outerHTML into document
  const docTitle = title ?? 'Document';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title></head><body>${container.outerHTML}</body></html>`;
}
