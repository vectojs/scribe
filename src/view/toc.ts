import type { Markdown } from '@vectojs/markdown';
import { marked } from 'marked';

import { buildTocTree, parseToc, type TocEntry, type TocNode } from '../model/toc';

export type TocScrollHandler = (y: number, entry: TocEntry) => void;

function getHeadingChildMap(markdownText: string): Map<number, number> {
  let tokens: ReturnType<typeof marked.lexer>;
  try {
    tokens = marked.lexer(markdownText);
  } catch {
    return new Map();
  }
  const headingTokenIndices: number[] = [];
  const producesEntity = (token: { type: string; text?: string }): boolean => {
    switch (token.type) {
      case 'space':
        return false;
      case 'html': {
        const t = (token as unknown as { text: string }).text?.toLowerCase() ?? '';
        return t.includes('<svg') && t.includes('</svg>');
      }
      case 'heading':
      case 'paragraph':
      case 'code':
      case 'blockquote':
      case 'list':
      case 'table':
      case 'hr':
      case 'footnoteDef':
      case 'container':
        return true;
      default:
        return 'text' in token;
    }
  };
  // Map token index -> child index for entity-producing tokens
  let childIdx = 0;
  const tokenIdxToChild = new Map<number, number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as { type: string };
    if (producesEntity(t as { type: string; text?: string })) {
      tokenIdxToChild.set(i, childIdx);
      childIdx++;
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] as { type: string }).type === 'heading') headingTokenIndices.push(i);
  }
  const headingIdxToChild = new Map<number, number>();
  for (let hi = 0; hi < headingTokenIndices.length; hi++) {
    const tokenIdx = headingTokenIndices[hi];
    const child = tokenIdxToChild.get(tokenIdx);
    if (child !== undefined) headingIdxToChild.set(hi, child);
  }
  return headingIdxToChild;
}

export function getHeadingPositions(
  markdown: Markdown,
  markdownText: string,
  entries: TocEntry[],
): Map<string, number> {
  const map = new Map<string, number>();
  const childMap = getHeadingChildMap(markdownText);
  const children = (markdown as unknown as { content: { children: Array<{ y: number }> } }).content
    ?.children;
  if (!children) {
    // fallback: proportional
    for (let i = 0; i < entries.length; i++) {
      map.set(entries[i].id, i * 120);
    }
    return map;
  }
  for (let i = 0; i < entries.length; i++) {
    const childIdx = childMap.get(i);
    if (childIdx !== undefined && children[childIdx]) {
      const y = (children[childIdx] as { y: number }).y ?? i * 120;
      map.set(entries[i].id, y);
    } else {
      map.set(entries[i].id, i * 120);
    }
  }
  return map;
}

export function renderToc(
  container: HTMLElement,
  markdownText: string,
  onSelect: TocScrollHandler,
  getPositionMap?: () => Map<string, number>,
): void {
  const entries = parseToc(markdownText);
  const tree = buildTocTree(entries);
  container.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No headings';
    empty.style.fontSize = '12px';
    empty.style.color = '#8a8175';
    empty.style.padding = '8px 12px';
    empty.style.fontFamily = 'system-ui, sans-serif';
    container.appendChild(empty);
    return;
  }

  const positionMap =
    getPositionMap?.() ?? new Map(entries.map((e, idx) => [e.id, idx * 120] as const));

  const ul = document.createElement('ul');
  ul.setAttribute('role', 'tree');
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  ul.style.margin = '0';

  const build = (nodes: TocNode[], parentUl: HTMLElement): void => {
    for (const node of nodes) {
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.style.padding = '0';
      li.style.margin = '0';

      const a = document.createElement('a');
      a.href = `#${node.id}`;
      a.textContent = node.text;
      a.dataset.tocId = node.id;
      a.style.display = 'block';
      a.style.padding = '4px 12px';
      a.style.fontSize = '13px';
      a.style.fontFamily = 'system-ui, sans-serif';
      a.style.color = '#3d3529';
      a.style.textDecoration = 'none';
      a.style.cursor = 'pointer';
      a.style.borderLeft = '2px solid transparent';
      a.style.whiteSpace = 'nowrap';
      a.style.overflow = 'hidden';
      a.style.textOverflow = 'ellipsis';
      // indent by depth
      const indent = Math.max(0, node.depth - 1) * 12;
      a.style.paddingLeft = `${12 + indent}px`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const y = positionMap.get(node.id) ?? 0;
        onSelect(y, node);
      });
      a.addEventListener('mouseenter', () => {
        a.style.background = '#f7f4ee';
      });
      a.addEventListener('mouseleave', () => {
        a.style.background = 'transparent';
      });
      li.appendChild(a);

      if (node.children.length > 0) {
        const childUl = document.createElement('ul');
        childUl.style.listStyle = 'none';
        childUl.style.padding = '0';
        childUl.style.margin = '0';
        build(node.children, childUl);
        li.appendChild(childUl);
      }
      parentUl.appendChild(li);
    }
  };

  build(tree, ul);
  container.appendChild(ul);
}

export function mountTocView(
  tocNav: HTMLElement,
  getMarkdownText: () => string,
  onScrollTo: TocScrollHandler,
  getPositionMap?: () => Map<string, number>,
): { update: () => void } {
  const update = (): void => {
    const text = getMarkdownText();
    renderToc(tocNav, text, onScrollTo, getPositionMap);
  };
  update();
  return { update };
}
