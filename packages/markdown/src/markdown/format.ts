/**
 * `markdownFormat` — markdown as a `DocumentFormat`: CommonMark + GFM in
 * (`parseMarkdown`), back out (`toMarkdown`), with streaming-stable
 * incremental parsing, and the node specs markdown needs beyond the standard
 * vocabulary (`html`, `definition`, the references).
 */

import type { DocumentFormat } from '../document/index.js';
import { createIncrementalEngine, parseMarkdown } from '../parser/index.js';
import { markdownNodes } from '../schema/index.js';
import { toMarkdown, type ToMarkdownOptions } from '../serializer/index.js';

/** Serializer options beyond `plugins` (`bullet`, `emphasis`, `strong`, `fence`, `rule`, …). */
export type MarkdownFormatOptions = Omit<ToMarkdownOptions, 'plugins'>;

export const markdownFormat: DocumentFormat<MarkdownFormatOptions> = {
    id: 'markdown',
    // `text/plain` last: plain text pasted into a markdown editor is markdown.
    mime: ['text/markdown', 'text/x-markdown', 'text/plain'],
    nodes: markdownNodes,
    parse: (source, options) => parseMarkdown(source, { plugins: options?.plugins }),
    serialize: (node, options) => toMarkdown(node, options),
    createIncrementalEngine: (options) => createIncrementalEngine({ plugins: options?.plugins }),
};
