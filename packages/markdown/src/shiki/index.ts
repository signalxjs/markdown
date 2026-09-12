/**
 * `@sigx/markdown/shiki` — optional syntax highlighting for the DOM view:
 * a lazily-loaded, cached `shiki` highlighter and a `code` slot that
 * renders through it (`shiki` is an optional peer dependency).
 */

export { createShikiHighlighter, plainTokens, DEFAULT_LANGS, DEFAULT_THEMES } from './highlighter.js';
export type {
    CodeHighlighter,
    HighlightedToken,
    ShikiHighlighterLike,
    ShikiModule,
    ShikiOptions,
    ShikiThemes,
    ShikiTokenLike,
} from './highlighter.js';
export { shikiCodeBlock, DEFAULT_DEBOUNCE_MS } from './code-block.js';
export type { ShikiCodeBlockOptions } from './code-block.js';
