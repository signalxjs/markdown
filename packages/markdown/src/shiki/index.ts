/**
 * `@sigx/markdown/shiki` — Shiki behind the `CodeHighlighter` contract of
 * `@sigx/markdown/dom`: a lazily-loaded, cached highlighter and a plugin that
 * contributes the highlighted `code` slot (`shiki` is an optional peer). The
 * only module in the package that imports `shiki`.
 */

export { createShikiHighlighter, DEFAULT_LANGS, DEFAULT_THEMES } from './highlighter.js';
export type { ShikiHighlighterLike, ShikiModule, ShikiOptions, ShikiThemes, ShikiTokenLike } from './highlighter.js';
export { shikiPlugin } from './plugin.js';
export type { ShikiPluginOptions } from './plugin.js';
