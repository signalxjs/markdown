# @sigx/markdown

Markdown for [SignalX](https://sigx.dev/) — an mdast-compatible AST, an
incremental parser that keeps finalized blocks stable while a source string
grows (built for token-by-token AI output), a serializer, a save-friendly JSON
document, `createMarkdownStream()`, and a renderer-neutral render engine with a
plugin contract shared by the parser, the serializer, every renderer and the
block-tree editor. Zero dependencies, no `node:` imports.

| Entry | What |
|---|---|
| `@sigx/markdown` | the AST, `parseMarkdown`, `createIncrementalEngine`, `toMarkdown`, `toJSON` / `fromJSON`, `createMarkdownStream`, `renderDocument`, the plugin contract |
| `@sigx/markdown/dom` | `MarkdownView` for the web, default DOM components, code-block chrome |
| `@sigx/markdown/shiki` | optional Shiki highlighting for code blocks (`shiki` is an optional peer) |
| `@sigx/markdown/editor` | the block-tree editor core and the surface contract a platform implements |
| `@sigx/markdown/editor/dom` | `MarkdownEditor` for the web |
| `@sigx/markdown/testing` | streaming harness, structural `strip()`, the surface conformance suite |

## Install

```bash
npm install @sigx/markdown
```

Peers on `@sigx/reactivity` and `@sigx/runtime-core` (plus `@sigx/runtime-dom`
for the web entries) at the same minor as your app's `sigx`.

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/markdown/>**

Native rendering and editing on Lynx:
[`@sigx/lynx-markdown`](https://sigx.dev/lynx/modules/markdown/overview/).

## License

MIT © Andreas Ekdahl
