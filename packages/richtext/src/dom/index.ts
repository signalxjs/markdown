/**
 * `@sigx/richtext/dom` — the web renderer: `<RichTextView>`, the default DOM
 * component map, the code-block chrome and the highlighter contract
 * highlighters (`@sigx/richtext-shiki`) implement.
 */

export { RichTextView, pluginDomComponents } from './RichTextView.js';
export type { RichTextViewProps } from './RichTextView.js';
export { createDomComponents, defaultComponents } from './components.js';
export type { DomComponentsOptions, DomLinkHandler, DomComponents } from './components.js';
export { CodeBlock } from './code-block.js';
export type { CodeBlockProps } from './code-block.js';
export { plainTokens } from './highlighter.js';
export type { CodeHighlighter, HighlightedToken } from './highlighter.js';
export { highlightedCodeBlock, DEFAULT_DEBOUNCE_MS } from './highlighted-code.js';
export type { HighlightedCodeBlockOptions } from './highlighted-code.js';
export { partAttrs, SCOPE } from './parts.js';
export type { PartAttrs } from './parts.js';
