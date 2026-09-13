/**
 * Clipboard data as the editor sees it: the plain text plus every other
 * flavour keyed by MIME type (`text/markdown`, `text/html`, …). A surface
 * builds it from the platform's clipboard; the editor picks the first format
 * that reads one of the flavours present.
 */

import type { DocumentFormat } from '../document/index.js';

export interface PasteData {
    /** The plain-text flavour (always present, may be empty). */
    text: string;
    [mime: string]: string | undefined;
}

/**
 * The first format (in order) that reads a flavour present in `data`, with
 * that flavour's source. Formats list their MIME types most specific first,
 * so a markdown editor takes `text/markdown` over `text/plain`.
 */
export function pickPasteFormat(data: PasteData, formats: readonly DocumentFormat[]): { format: DocumentFormat; source: string } | null {
    for (const format of formats) {
        for (const mime of format.mime) {
            const source = mime === 'text/plain' ? data.text : data[mime];
            if (typeof source === 'string' && source.length > 0) return { format, source };
        }
    }
    return null;
}
