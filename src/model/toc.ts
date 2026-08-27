import { marked } from 'marked';

export type TocEntry = {
  id: string;
  text: string;
  depth: number;
  raw: string;
};

export type TocNode = TocEntry & {
  children: TocNode[];
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export function parseToc(markdown: string): TocEntry[] {
  if (!markdown) return [];
  let tokens: ReturnType<typeof marked.lexer>;
  try {
    tokens = marked.lexer(markdown);
  } catch {
    return [];
  }
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  for (const token of tokens) {
    if (token.type === 'heading') {
      const depth = (token as unknown as { depth: number }).depth;
      const text = (token as unknown as { text: string }).text?.trim() ?? '';
      if (!text) continue;
      let base = slugify(text);
      if (!base) base = `heading-${entries.length + 1}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      entries.push({
        id,
        text,
        depth,
        raw: (token as unknown as { raw: string }).raw ?? '',
      });
    }
  }
  return entries;
}

export function buildTocTree(entries: TocEntry[]): TocNode[] {
  const root: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const entry of entries) {
    const node: TocNode = { ...entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return root;
}

export function flattenTocTree(tree: TocNode[]): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (nodes: TocNode[]): void => {
    for (const n of nodes) {
      out.push({ id: n.id, text: n.text, depth: n.depth, raw: n.raw });
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(tree);
  return out;
}
