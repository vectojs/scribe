# Scribe — Markdown Kitchen Sink

Hello Scribe — welcome to the kitchen sink. This sample demonstrates VectoJS Markdown completeness.

> **Scribe** is a StackEdit-inspired, hybrid HTML + VectoJS canvas editor.
> This document exercises **every** syntax that `@vectojs/markdown` supports.
> If it renders cleanly here, it renders everywhere.

---

## 1. Headings

# Heading 1 — The largest

## Heading 2 — Section

### Heading 3 — Subsection

#### Heading 4 — Detail

##### Heading 5 — Fine print

###### Heading 6 — Smallest

---

## 2. Inline text decorations

**Bold** with `**bold**`, _italic_ with `*italic*` or `_italic_`, _**bold + italic**_.

~~Strikethrough~~ with `~~text~~`, ++Inserted++ with `++inserted++`, ==Marked== with `==marked==`.

Superscript: 19^th^, x^2^ + y^2^ = z^2^. Subscript via del trick: H~~2~~O (rendered as `H<sub>2</sub>O` when subscript extension is enabled; fallback is ~~del~~).

Inline code: `const x = 42`, `Array<T>`, `` `backtick inside` ``.

Abbreviation: The HTML specification relies on CSS.

*[HTML]: HyperText Markup Language
*[CSS]: Cascading Style Sheets

Emoji shortcodes: :smile: :rocket: :tada: :fire: (requires `:smile:` pass).

---

## 3. Links and autolinks

- Inline link: [VectoJS](https://vectojs.org)
- Autolink: <https://vectojs.org> and <hello@vectojs.org>
- Reference link: [StackEdit reference][stackedit]

[stackedit]: https://stackedit.io

Image (remote, served via R2 `cdn-vectojs`):

![VectoJS logo](https://cdn.vectojs.org/scribe/logo.svg)

Inline image paragraph: text before ![icon](https://cdn.vectojs.org/scribe/logo.svg) text after — should wrap, not break.

---

## 4. Blockquotes

> Simple blockquote — a single paragraph.
>
> > Nested blockquote — second level.
> > Still inside nested.
>
> Back to first level.

> Blockquote with **bold** and `code` and a list inside:
>
> - item one
> - item two

---

## 5. Lists

### 5.1 Unordered

- Apple
- Banana
  - Cherry (nested)
  - Date
- Elderberry

### 5.2 Ordered

1. First item
2. Second item
3. Third item
   1. Nested ordered
   2. Another nested
4. Fourth item

### 5.3 Task lists (GFM)

- [x] Write kitchen sink
- [x] Add math examples
- [ ] Ship to `scribe.vectojs.org`
- [ ] Fix TODO in `TODO.md`

### 5.4 Loose vs tight

Tight list:

- a
- b
- c

Loose list:

- paragraph one

  second paragraph of same item

- paragraph two

---

## 6. Code

Inline `code` already shown. Fenced blocks with language tags (highlighted via `syntaxKeywordColor` etc.):

```js
// JavaScript — keyword / string / comment / number highlights
import { Scene } from "@vectojs/core";
import { Markdown, PRESET_THEMES } from "@vectojs/markdown";

const md = new Markdown("# Hello\n\nWorld", {
  maxWidth: 640,
  theme: "githubLight",
});
scene.add(md);
// comment: numbers 42, 3.14, 0xFF
const answer = 42;
```

```python
# Python — def / string / comment
def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}!  # {42}"

print(greet("Scribe"))
```

```bash
# Bash
echo "scaffold family + hybrid shell"
bun install && bun run dev
```

```ts
// TypeScript with generics + decorators
type Foo<T extends string> = { key: T; value: number };
```

```plaintext
Plaintext block — no highlighting, just mono + block affordances.
```

---

## 7. Tables (GFM)

| Left                    |      Center       | Right | Code | Math     |
| :---------------------- | :---------------: | ----: | :--- | :------- |
| a                       |         b         |     c | `x`  | $a^2$    |
| long cell with **bold** | centered _italic_ |    42 | `42` | $E=mc^2$ |
| foo                     |        bar        |   baz | `hi` | $\sum$   |

Second table — alignment and inline decorations:

| Feature | Syntax        | Rendered                    |
| ------- | ------------- | --------------------------- |
| Bold    | `**bold**`    | **bold**                    |
| Italic  | `*italic*`    | _italic_                    |
| Strike  | `~~strike~~`  | ~~strike~~                  |
| Code    | `` `code` ``  | `code`                      |
| Link    | `[text](url)` | [text](https://example.com) |

---

## 8. Horizontal rules

---

---

---

---

---

## 9. Footnotes

Here is a paragraph with a footnote[^1] and another[^long].

[^1]: First footnote — single-line definitions only (multi-line is a future extension).

[^long]: A longer footnote with **bold** and `code` and a [link](https://example.com).

Later reference to the same footnote[^1] should reuse the marker.

---

## 10. Mathematics

Inline math (single dollar, pandoc-style guards against currency):

- Euler: $e^{i\pi} + 1 = 0$
- Quadratic: $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$
- Currency guard: $5 to $10 should NOT become math; \$5 and $5 stay literal.
- Inline display-style: $\sum_{i=1}^n i = \frac{n(n+1)}{2}$ stays inline.

Display math (opening `$$` at start of line, blank-line terminated):

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

$$
\sum_{k=1}^{\infty} \frac{1}{k^2} = \frac{\pi^2}{6}
$$

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0
\end{aligned}
$$

Inline `$$...$$` (if CTX-0538 lands, this should also render as math, not literal dollars):

$$E = mc^2$$ is the same as $E = mc^2$ when inline-$$ is enabled.

Escaped dollars: \$not math\$, but $a + b$ is math.

KaTeX coverage (666 glyphs): $\Alpha \Beta \Gamma \Delta \alpha \beta \gamma$, $\mathbb{R} \mathbb{Z}$, $\mathcal{L}$, $\mathfrak{g}$, $\sum \prod \int \bigcup \bigcap \setminus$, $\pm \times \div \cdot \leq \geq \neq \approx$, $\rightarrow \Rightarrow \leftrightarrow$, $\forall \exists \in \notin \subset \supset$, $\hat{a} \bar{b} \tilde{c} \vec{d}$, $\frac{a}{b} \sqrt{x} \sqrt[3]{y}$, $\begin{matrix} a & b \\ c & d \end{matrix}$.

---

## 11. Containers (directive-style)

::: info
Info container — general information.
:::

::: warning
Warning container — be careful.
:::

::: tip
Tip container — helpful hint with **bold** and `code`.
:::

---

## 12. Strikethrough inside other markup

- **bold with ~~strike~~ inside**
- _italic with `code` and $math$_
- Table cell with ~~strike~~ already tested; this is list context.

---

## 13. Mixed nesting stress test

1. Ordered item with **bold** and:

   - unordered nested with `code`
   - second with > blockquote
     > quoted inside list
   - third with math $a^2 + b^2 = c^2$

2. Second ordered item with table:

   | a   | b   |
   | --- | --- |
   | 1   | 2   |

> Blockquote containing list:
>
> - inside quote 1
> - inside quote 2 with **bold**
> - inside quote 3 with `code`

---

## 14. Front matter (stripped before render, visible via `frontMatter` getter)

The file is plain markdown today. When front matter is added, it will be:

```yaml
---
title: Scribe Kitchen Sink
tags: [markdown, vectojs, scribe]
draft: false
---
```

and will not render as a thematic break + heading.

---

## 15. Large-document virtualization sanity

Repetition below ensures the document is tall enough to virtualize if that mode is enabled. Each heading should appear in the outline (TOC) and scroll-sync should keep editor and preview in sync.

### Section A — repeated

Lorem ipsum dolor sit amet, consectetur adipiscing elit.

### Section B — repeated

Lorem ipsum dolor sit amet, consectetur adipiscing elit.

### Section C — repeated

Lorem ipsum dolor sit amet, consectetur adipiscing elit.

### Section D — repeated

Lorem ipsum dolor sit amet, consectetur adipiscing elit.

### Section E — repeated

Lorem ipsum dolor sit amet, consectetur adipiscing elit.

---

## 16. End

If every section above is readable, the `@vectojs/markdown` + `@vectojs/tex` pipeline is complete. Edit this file via the left **Explorer** → open `Kitchen Sink.md`, toggle themes via the **Theme** picker (githubLight / githubDark / dracula / solarizedLight / solarizedDark), collapse the file tree via the **◀/▶** button in the header, and check the **Outline** panel for headings 1–6.

*[W3C]: World Wide Web Consortium
