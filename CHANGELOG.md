# Changelog

All notable changes to this repo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); every package in the
workspace shares one version line.

## [Unreleased]

### Added

- `@sigx/markdown` root entry (#7):
  - **AST** — mdast-compatible node types (`Root`, `Paragraph`, `Heading`,
    `Blockquote`, `List`/`ListItem`, `Code`, `Html`, `Definition`, `Table`,
    `Text`, `Emphasis`, `Strong`, `Delete`, `InlineCode`, `Break`, `Link`,
    `Image`, `LinkReference`, `ImageReference`), structurally assignable to
    `@types/mdast`. sigx extensions: `key` (stable reconciliation key on every
    block-level node) and `Code.open` (an unterminated fence while streaming).
    `visit`, `map`, `collectDefinitions`, `assignKeys`, `sliceSource`.
  - **JSON document format** — `toJSON()` / `fromJSON()` with
    `data.version` (`CURRENT_VERSION = 1`) and `MarkdownFormatError`.
  - **Parser** — `parseMarkdown()`: CommonMark block parsing on the
    open-container-stack algorithm (setext headings, indented and fenced code,
    link reference definitions, nested-blockquote laziness, list `spread`),
    the CommonMark emphasis algorithm (rule of 3, Unicode flanking), entity
    and numeric character references, reference links, GFM tables,
    strikethrough, task items and autolink literals (URL and email). Raw HTML
    renders as literal text. Never throws; positions on every node.
    Conformance: 562 of 586 vendored CommonMark 0.31.2 examples (in-scope
    sections) and every GFM fixture; the remaining 24 are enumerated in
    `__tests__/conformance/known-failures.json`.
  - **Incremental engine** — `createIncrementalEngine()`: finalized blocks
    are reused by reference across appends, keys never change, and the cut
    only moves past blocks that can no longer change (proved by a stability
    suite over the whole corpus, char by char and in random chunks).
  - **Serializer** — `toMarkdown()` with deterministic delimiters and
    escaping; `parse(toMarkdown(parse(md)))` is structurally equal to
    `parse(md)`.
  - **Render engine** — platform-generic `renderDocument()` over a
    `MarkdownComponents<E>` map: recursion and key stamping owned by the
    engine, references resolved at render time, URL sanitisation, plugin
    node slots and fallbacks.
  - **Stream** — `createMarkdownStream()` on `@sigx/reactivity`, plus
    `pipe()` for an `AsyncIterable<string>` with abort support.
  - **Plugin contract** — one `MarkdownPlugin` with block and inline syntax
    extensions (trigger-char gated, streaming-safe, hardened), serializer
    rules, transforms, entities and per-platform component slots;
    `mentionPlugin` (`@[label](id)`) as the reference plugin.
- `@sigx/markdown/testing` entry: `strip()`, `stripPositions()`, `toHtml()`
  (spec-conformance HTML), `feed()` and `seededChunks()` for streaming tests.
- `@sigx/markdown/dom` entry (#9): `MarkdownView` on `@sigx/runtime-core` +
  `@sigx/runtime-dom` — one incremental engine per instance so a growing
  `value` re-renders only the live block; props `value | root`, `plugins`,
  `components`, `onLink(url, node, event)`, `linkTarget`, `sanitizeUrl`,
  `classPrefix`, `copyButton`, plus host attributes on the root. Default DOM
  components styled through `data-scope="markdown"` / `data-part` attributes
  (no classes unless `classPrefix`), `CodeBlock` chrome with a language label
  and a clipboard copy button, `html` nodes rendered as text.
- `@sigx/markdown/shiki` entry (#9): `createShikiHighlighter()` (lazy
  `import('shiki')`, `shiki >=3.7.0` optional peer, LRU token cache, dual
  light/dark themes) and `shikiCodeBlock()` — a `code` component whose instance
  survives streaming, highlighting debounced while a fence is open.
- `@sigx/markdown/editor` entry (#11) — the platform-neutral block-tree editor
  core: an immutable `Root` with structural sharing and a key-addressed
  selection (`EditorState`), the `InlineFlat` model surfaces speak (marks as
  ranges, atoms as U+FFFC, lossless both ways), invertible steps and
  transactions with selection mapping, grouped undo history (typing groups,
  one entry per IME composition, `undoInputRule`), the editing schema
  (`BlockEditorSpec` with inline / code / void / container / table kinds),
  every command (split and join, block types, lists with indent and outdent,
  task toggles, blockquotes, tables, void blocks, move / duplicate / delete,
  selection and document commands, markdown-aware paste), a keymap with
  `baseKeymap`, markdown input rules (`# `, `- `, `1. `, `- [ ] `, `> `,
  `**x**`, `*x*`, `` `x` ``, `~~x~~`, `[t](u)`, a fence and `---` on Enter),
  the trigger session state machine and popup placement math, `ToolbarItem` +
  `defaultToolbarItems`, the `InlineSurface` / `CodeSurface` contracts a
  platform implements, the surface bridge with echo suppression and the IME
  contract, the `MarkdownPlugin.editor` slice, and `createEditor()`.
- `@sigx/markdown/testing`: `createFakeInlineSurface` / `createFakeCodeSurface`
  and `runInlineSurfaceConformance()` — the suite every surface implementation
  (DOM, Lynx, the fake) runs.
- Serializer: a bare autolink literal is emitted only at a word boundary
  (otherwise the angle form); a list item whose first paragraph is empty puts
  its marker alone on the line so nested content re-parses correctly.
- `examples/playground`: a Vite app exercising the view, streaming, plugins,
  Shiki and the serializer, with a Playwright e2e suite run in CI.
- Repo scaffold: `packages/markdown` (`@sigx/markdown`) with the sigx standard
  build, test, catalog and release setup.
