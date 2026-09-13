/**
 * `@sigx/richtext-html` — HTML as a `DocumentFormat` for `@sigx/richtext`:
 * a platform-free parser (no `DOMParser`; runs on Lynx), a serializer with
 * the CommonMark reference layout, `htmlFormat`, and the HTML slice plugins
 * fill under `formats.html`. Platform-free; the editor preset (the
 * `text/html` clipboard flavour) is `./editor`.
 */

export { parseHtml } from './parse.js';
export type { ParseHtmlOptions } from './parse.js';
export { toHtml, escapeHtml, normalizeUri } from './serialize.js';
export type { ToHtmlOptions } from './serialize.js';
export { htmlFormat } from './format.js';
export type { HtmlFormatOptions } from './format.js';
export { resolveHtmlPlugins } from './resolve.js';
export type { ResolvedHtmlPlugins } from './resolve.js';
export type { HtmlPluginSlice, HtmlElementRule, HtmlElementContext, HtmlSerializeRule, HtmlSerializeContext } from './plugin.js';
export { tokenize } from './tokenizer.js';
export type { HtmlToken } from './tokenizer.js';
export { buildTree, textOf } from './tree.js';
export type { HtmlNode, HtmlElement, HtmlText } from './tree.js';
export { mentionHtml } from './mention.js';
