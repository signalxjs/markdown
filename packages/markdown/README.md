# @sigx/markdown

Markdown for [SignalX](https://sigx.dev/) — an mdast-compatible AST, an
incremental parser that keeps finalized blocks stable while a source string
grows (built for token-by-token AI output), a serializer, a save-friendly JSON
document, `createMarkdownStream()`, and a renderer-neutral render engine with a
plugin contract shared by the parser, the serializer, every renderer and the
block-tree editor. Zero dependencies, no `node:` imports.

| Entry | What |
|---|---|
| `@sigx/markdown` | the AST, `parseMarkdown`, `createIncrementalEngine`, `toMarkdown`, `toJSON` / `fromJSON`, `createMarkdownStream`, `renderDocument`, the `MarkdownPlugin` contract, `mentionPlugin` |
| `@sigx/markdown/testing` | `strip()`, `toHtml()`, `feed()` — helpers for tests that parse, stream or render |
| `@sigx/markdown/dom` | `MarkdownView` for the web (next release) |
| `@sigx/markdown/shiki` | optional Shiki highlighting for code blocks (next release) |
| `@sigx/markdown/editor`, `./editor/dom` | the block-tree editor core and the web editor (planned) |

## Install

```bash
npm install @sigx/markdown
```

Peers on `@sigx/reactivity` and `@sigx/runtime-core` at the same minor as
your app's `sigx`.

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

Streaming: `createMarkdownStream({ flushIntervalMs: 16 })` coalesces tokens
into one signal write per frame; pass `stream.value.value` to a view.

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/markdown/>**

Native rendering and editing on Lynx:
[`@sigx/lynx-markdown`](https://sigx.dev/lynx/modules/markdown/overview/).

## License

MIT © Andreas Ekdahl
