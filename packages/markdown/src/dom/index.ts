/**
 * `@sigx/markdown/dom` — the web renderer: `<MarkdownView>`, the default DOM
 * component map and the code-block chrome highlighters build on.
 */

export { MarkdownView } from './MarkdownView.js';
export type { MarkdownViewProps } from './MarkdownView.js';
export { createDomComponents, defaultComponents } from './components.js';
export type { DomComponentsOptions, DomLinkHandler, DomMarkdownComponents } from './components.js';
export { CodeBlock } from './code-block.js';
export type { CodeBlockProps } from './code-block.js';
export { partAttrs, SCOPE } from './parts.js';
export type { PartAttrs } from './parts.js';
