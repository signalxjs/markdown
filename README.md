<div align="center">

# SignalX Markdown

**Markdown for [SignalX](https://sigx.dev/) — one incremental parser for web, Lynx and terminal, a save-friendly mdast document, and a block-tree editor.**

[![npm](https://img.shields.io/npm/v/@sigx/markdown.svg?label=@sigx/markdown&color=blue)](https://www.npmjs.com/package/@sigx/markdown)
[![license](https://img.shields.io/npm/l/@sigx/markdown.svg)](./LICENSE)
[![ci](https://github.com/signalxjs/markdown/actions/workflows/ci.yml/badge.svg)](https://github.com/signalxjs/markdown/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/@sigx/markdown.svg)](https://www.typescriptlang.org/)

</div>

> 🚧 Early release. The API surface is stabilising — feedback is very welcome.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/markdown/>**

## Packages

| Entry | What |
|---|---|
| [`@sigx/markdown`](./packages/markdown) | An mdast-compatible AST, `parseMarkdown`, an incremental engine that keeps finalized blocks stable while a source string grows (built for token-by-token AI output), `toMarkdown`, `toJSON` / `fromJSON`, `createTextStream`, and a renderer-neutral render engine with a plugin contract shared by parser, serializer, renderers and editor |
| `@sigx/markdown/testing` | `strip()`, `toHtml()`, `feed()` — helpers for tests that parse, stream or render |
| `@sigx/markdown/dom` | `RichTextView` for the web — default components styled through `data-scope` / `data-part` attributes, a `CodeBlock` chrome with copy button, the `CodeHighlighter` contract |
| `@sigx/markdown/shiki` | Shiki highlighting as a plugin: `shikiPlugin()` / `createShikiHighlighter()` (`shiki` is an optional peer) |
| `@sigx/markdown/editor` | The block-tree editor core: state, commands, history, keymap, input rules, triggers and the surface contract a platform implements |
| `@sigx/markdown/editor/dom` | `MarkdownEditor` for the web — a Notion-class block editor: contenteditable surfaces per block, toolbar, block handles and menu, slash commands, mentions, two-way `markdown` / `document` models |

Examples: [`examples/playground`](./examples/playground) — the view, streaming, plugins, Shiki, the serializer and the editor side by side, with a Playwright suite.

Consumers: [`@sigx/lynx-markdown`](https://sigx.dev/lynx/modules/markdown/overview/) renders and edits the same trees natively on Lynx; [`@sigx/ai`](https://sigx.dev/ai/) chat UI streams assistant messages through it.

## Install

```bash
npm install @sigx/markdown
```

Peers on `@sigx/reactivity` and `@sigx/runtime-core` (and `@sigx/runtime-dom` for the web entries) at the same minor as your app's `sigx`.

## Quick start

```tsx
import { component } from 'sigx';
import { createTextStream } from '@sigx/markdown';
import { RichTextView } from '@sigx/markdown/dom';

const stream = createTextStream({ flushIntervalMs: 16 });
for await (const token of tokens) stream.append(token);
stream.done();

export const Answer = component(() => () => <RichTextView value={stream.value.value} format={markdownFormat} />);
```

Every finalized block keeps its identity as tokens arrive, so only the block still being written re-renders.

## Why this exists

- **One parser, every surface** — the same AST renders on the web, on Lynx and in the terminal; plugins add syntax, nodes, components, commands and toolbar items once.
- **Streaming-stable** — finalized blocks are the same objects between parses; keys never change, so UI never remounts.
- **mdast native** — the document is a standard mdast `Root`, so it round-trips through `remark` tooling and saves as plain JSON.
- **A real editor** — a block-tree editor core with platform surfaces, not a textarea with a preview.

## Part of SignalX

- [`core`](https://sigx.dev/core/) — `reactivity`, `runtime-core`, `runtime-dom`, `server-renderer`, `server`, `vite`, `sigx`
- [`lynx`](https://sigx.dev/lynx/) · [`ai`](https://sigx.dev/ai/) · [`daisyui`](https://sigx.dev/daisyui/) · [`terminal`](https://sigx.dev/terminal/)
- [Docs site](https://sigx.dev/) — main SignalX documentation

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome.

## License

MIT © Andreas Ekdahl
