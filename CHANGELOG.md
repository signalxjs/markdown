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
- Repo scaffold: `packages/markdown` (`@sigx/markdown`) with the sigx standard
  build, test, catalog and release setup.
