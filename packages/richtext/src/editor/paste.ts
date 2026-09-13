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
 * The format that reads a flavour present in `data`, with that flavour's
 * source. Specific flavours win over plain text across every format — a
 * markdown editor that also reads HTML parses a browser's `text/html` rather
 * than its `text/plain` — and among formats the first in order wins, so the
 * primary format takes `text/plain` when it claims it.
 */
export function pickPasteFormat(data: PasteData, formats: readonly DocumentFormat[]): { format: DocumentFormat; source: string } | null {
    for (const plain of [false, true]) {
        for (const format of formats) {
            for (const mime of format.mime) {
                if ((mime === 'text/plain') !== plain) continue;
                const source = plain ? data.text : data[mime];
                if (typeof source === 'string' && source.length > 0) return { format, source };
            }
        }
    }
    return null;
}
