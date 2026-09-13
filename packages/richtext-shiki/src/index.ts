/**
 * `@sigx/richtext-shiki` — Shiki behind the `CodeHighlighter` contract of
 * `@sigx/richtext/dom`: a lazily-loaded, cached highlighter and a plugin that
 * contributes the highlighted `code` slot. The only richtext package that
 * imports `shiki`.
 */

export { createShikiHighlighter, DEFAULT_LANGS, DEFAULT_THEMES } from './highlighter.js';
export type { ShikiHighlighterLike, ShikiModule, ShikiOptions, ShikiThemes, ShikiTokenLike } from './highlighter.js';
export { shikiPlugin } from './plugin.js';
export type { ShikiPluginOptions } from './plugin.js';
