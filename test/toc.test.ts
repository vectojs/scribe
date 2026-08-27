import { describe, expect, test } from 'bun:test';

import { buildTocTree, parseToc } from '../src/model/toc';

describe('parseToc', () => {
  test('empty markdown returns empty', () => {
    expect(parseToc('')).toEqual([]);
    expect(parseToc('# \n')).toEqual([]);
  });

  test('single heading', () => {
    const toc = parseToc('# Hello World');
    expect(toc).toHaveLength(1);
    expect(toc[0].text).toBe('Hello World');
    expect(toc[0].depth).toBe(1);
    expect(toc[0].id).toBe('hello-world');
  });

  test('multiple headings with hierarchy', () => {
    const md = '# H1\n## H2\n### H3\n## H2 again\n# H1 second';
    const toc = parseToc(md);
    expect(toc).toHaveLength(5);
    expect(toc.map((t) => t.depth)).toEqual([1, 2, 3, 2, 1]);
    expect(toc[1].text).toBe('H2');
    expect(toc[3].text).toBe('H2 again');
  });

  test('duplicate slugs get suffix', () => {
    const md = '# Hello\n# Hello\n# Hello';
    const toc = parseToc(md);
    expect(toc[0].id).toBe('hello');
    expect(toc[1].id).toBe('hello-1');
    expect(toc[2].id).toBe('hello-2');
  });

  test('ignores non-heading tokens', () => {
    const md = '# Title\nParagraph\n- list\n```\ncode\n```\n## Sub';
    const toc = parseToc(md);
    expect(toc).toHaveLength(2);
    expect(toc[0].text).toBe('Title');
    expect(toc[1].text).toBe('Sub');
  });

  test('slug edge cases', () => {
    const md = '#   Hello   World!  \n# 123 Numbers';
    const toc = parseToc(md);
    expect(toc[0].id).toBe('hello-world');
    expect(toc[1].id).toBe('123-numbers');
  });

  test('buildTocTree nests correctly', () => {
    const md = '# H1\n## H2\n### H3\n## H2b\n# H1b';
    const entries = parseToc(md);
    const tree = buildTocTree(entries);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].text).toBe('H3');
    expect(tree[1].text).toBe('H1b');
  });

  test('single level tree stays flat', () => {
    const md = '# A\n# B\n# C';
    const tree = buildTocTree(parseToc(md));
    expect(tree).toHaveLength(3);
    for (const n of tree) expect(n.children).toHaveLength(0);
  });
});
