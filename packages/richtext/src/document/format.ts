/**
 * The document-format contract: a codec between source text and the one
 * tree. Markdown is a format; HTML is a format; plain text is the smallest
 * one. Renderers and the editor never see a format — they render and edit
 * the tree — a format only turns text into it and back, and may offer
 * streaming-stable incremental parsing.
 */

import type { Root, RootContent } from '../ast/index.js';
import type { RichTextPlugin } from '../plugin/index.js';
import type { NodeSpec } from '../schema/index.js';
import type { IncrementalEngine } from './incremental.js';

export interface FormatParseOptions {
    /** Plugins whose `formats[id]` slice extends this format's syntax. */
    plugins?: readonly RichTextPlugin[];
}

export interface FormatSerializeOptions {
    plugins?: readonly RichTextPlugin[];
}

export interface DocumentFormat<O = {}> {
    /** The format's id — the key of its slot in `RichTextPlugin.formats` (`'markdown'`, `'html'`, `'text'`). */
    readonly id: string;
    /** Clipboard / transfer MIME types this format reads, most specific first (the first is what it writes). A format that lists `text/plain` claims plain-text pastes. */
    readonly mime: readonly string[];
    /** Node specs the format needs beyond the standard vocabulary (markdown's `html`, `definition`, references). */
    readonly nodes?: readonly NodeSpec[];
    parse(source: string, options?: FormatParseOptions & O): Root;
    serialize(node: Root | RootContent, options?: FormatSerializeOptions & O): string;
    /** Streaming capability: an engine that keeps finalized blocks stable as the source grows. Absent → `createReparseEngine`. */
    createIncrementalEngine?(options?: FormatParseOptions & O): IncrementalEngine;
}
