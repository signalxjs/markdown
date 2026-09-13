/**
 * `htmlFormat` — HTML as a `DocumentFormat`: `parseHtml` in, `toHtml` out.
 * No incremental engine of its own (the core falls back to reparsing), no
 * extra node specs — HTML maps onto the standard vocabulary.
 */

import type { DocumentFormat } from '@sigx/richtext';
import { parseHtml, type ParseHtmlOptions } from './parse.js';
import { toHtml, type ToHtmlOptions } from './serialize.js';

/** Options beyond `plugins`: `unknown` for parsing, `sanitize` / `definitions` for serializing. */
export type HtmlFormatOptions = Omit<ParseHtmlOptions, 'plugins'> & Omit<ToHtmlOptions, 'plugins'>;

export const htmlFormat: DocumentFormat<HtmlFormatOptions> = {
    id: 'html',
    mime: ['text/html'],
    parse: (source, options) => parseHtml(source, { plugins: options?.plugins, unknown: options?.unknown }),
    serialize: (node, options) => toHtml(node, { plugins: options?.plugins, sanitize: options?.sanitize, definitions: options?.definitions }),
};
