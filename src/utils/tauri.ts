/**
 * Tauri desktop helpers — filesystem open/save via `@tauri-apps/plugin-fs`
 * and `@tauri-apps/plugin-dialog`. All functions are no-ops in the browser
 * (return null/false) so the web build (`vite build`) stays clean.
 *
 * Rust side: `src-tauri/src/lib.rs` exposes `read_markdown_file` /
 * `write_markdown_file` as fallbacks and enables the `fs` + `dialog` plugins.
 * Frontend prefers the JS plugin APIs (scoped `fs:scope` in
 * `src-tauri/capabilities/default.json`) which are already permission-gated.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export async function openMarkdownFile(): Promise<{
  path: string;
  content: string;
} | null> {
  if (!isTauri()) return null;
  const [{ open }, { readTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
  });
  if (!selected || typeof selected !== 'string') return null;
  const content = await readTextFile(selected);
  return { path: selected, content };
}

export async function saveMarkdownFile(
  defaultPath: string,
  content: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  const [{ save }, { writeTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const target = await save({
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!target) return null;
  await writeTextFile(target, content);
  return target;
}

export async function writeMarkdownFileDirect(path: string, content: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
    return;
  } catch {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke<void>('write_markdown_file', { path, content });
  }
}

/**
 * Fallback via Rust commands (`read_markdown_file` / `write_markdown_file`)
 * when the JS plugin scope is too narrow. Uses `invoke` directly.
 */
export async function readMarkdownViaCommand(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_markdown_file', { path });
}

export async function writeMarkdownViaCommand(path: string, content: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<void>('write_markdown_file', { path, content });
}

export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return '0.1.0';
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<string>('app_version');
  } catch {
    return '0.1.0';
  }
}
