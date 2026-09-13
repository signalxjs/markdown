# @sigx/markdown

Markdown for [SignalX](https://sigx.dev/) — an mdast-compatible AST, an
incremental parser that keeps finalized blocks stable while a source string
grows (built for token-by-token AI output), a serializer, a save-friendly JSON
document, `createTextStream()`, and a renderer-neutral render engine with a
plugin contract shared by the parser, the serializer, every renderer and the
block-tree editor. Zero dependencies, no `node:` imports.

| Entry | What |
|---|---|
| `@sigx/markdown` | the AST, `parseMarkdown`, `createIncrementalEngine`, `toMarkdown`, `toJSON` / `fromJSON`, `createTextStream`, `renderDocument`, the `RichTextPlugin` contract, `mentionPlugin` |
| `@sigx/markdown/testing` | `strip()`, `toHtml()`, `feed()` — helpers for tests that parse, stream or render |
| `@sigx/markdown/dom` | `RichTextView` for the web, the default DOM components (`data-scope` / `data-part` styling seam), the `CodeBlock` chrome, the `CodeHighlighter` contract and `highlightedCodeBlock()` |
| `@sigx/markdown/shiki` | `createShikiHighlighter()` + `shikiPlugin()` — Shiki behind the `CodeHighlighter` contract (`shiki` is an optional peer) |
| `@sigx/markdown/editor` | the block-tree editor core: `createEditor()`, state, steps, history, commands, keymap, input rules, triggers, toolbar items and the `InlineSurface` / `CodeSurface` contracts a platform implements |
| `@sigx/markdown/editor/dom` | `RichTextEditor` for the web: `contenteditable` block surfaces, toolbar, block menu, slash commands, mentions, two-way `source` / `document` models, `data-scope` / `data-part` styling |

## Install

```bash
npm install @sigx/markdown
```

Peers on `@sigx/reactivity` and `@sigx/runtime-core` at the same minor as
your app's `sigx` (`@sigx/runtime-dom` too for `./dom` and `./editor/dom`).

## Taste

```ts
import { createIncrementalEngine, parseMarkdown, toJSON, toMarkdown } from '@sigx/markdown';

const root = parseMarkdown('# Hi\n\nSome **markdown**.');   // an mdast Root, keyed and positioned
toMarkdown(root);                                            // '# Hi\n\nSome **markdown**.\n'
JSON.stringify(toJSON(root));                                // the save format, { data: { version: 1 } }

const engine = createIncrementalEngine();
const a = engine.parse('# Hi\n\nSome **mark');
const b = engine.parse('# Hi\n\nSome **markdown**.');
a.children[0] === b.children[0];                             // true: finalized blocks keep identity
```

Streaming: `createTextStream({ flushIntervalMs: 16 })` coalesces tokens
into one signal write per frame; pass `stream.value.value` to a view.

```tsx
import { markdownFormat } from '@sigx/markdown';
import { RichTextView } from '@sigx/markdown/dom';
import { shikiPlugin } from '@sigx/markdown/shiki';

const plugins = [shikiPlugin()];

<RichTextView value={stream.value.value} format={markdownFormat} plugins={plugins} onLink={(url) => router.push(url)} />
```

Every element carries `data-scope="richtext"` and `data-part="heading"`,
`"code"`, `"link"`, … — style them with attribute selectors (the playground's
`styles.css` is the reference stylesheet), or pass `classPrefix="md"` for
`md-heading`-style classes, or replace any slot through `components`.

Editing:

```tsx
import { signal } from 'sigx';
import { markdownFormat } from '@sigx/markdown';
import { createSlashPlugin, markdownPreset } from '@sigx/markdown/editor';
import { RichTextEditor, createDomMentionPlugin } from '@sigx/markdown/editor/dom';

const plugins = [markdownPreset, createDomMentionPlugin({ onQuery: (q) => people(q) }), createSlashPlugin()];
const note = signal({ md: '# Hi' });

<RichTextEditor format={markdownFormat} model:source={[note, 'md']} plugins={plugins} placeholder="Write…" />
```

A block-tree editor on the same mdast document: one `contenteditable` per
paragraph or heading, a `<textarea>` per code block, Enter / Backspace /
arrows / Tab handled by the core, undo grouped by typing, a toolbar, block
handles with a menu, `/` commands and `@` mentions. The editor knows no
syntax: `format` is what the `source` model and the controller read and
write with, and `markdownPreset` brings the input rules (`# `, `- `,
`**bold**`) and the `text/markdown` clipboard flavour. Elements carry
`data-scope="richtext-editor"` (and `richtext-toolbar`,
`richtext-block-menu`, `richtext-suggest`) with `data-part` — the
playground's `editor.css` is the reference stylesheet.

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/markdown/>**

Native rendering and editing on Lynx:
[`@sigx/lynx-markdown`](https://sigx.dev/lynx/modules/markdown/overview/).

## License

MIT © Andreas Ekdahl
