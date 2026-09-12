import { decodeEntities } from './entities.js';

/**
 * Link label normalisation (CommonMark "matching of link labels", as the
 * reference implementation does it): decode character references, strip
 * the brackets' inner whitespace, collapse internal whitespace runs to one
 * space, and case-fold. Backslash escapes are kept verbatim — `[foo\\]`
 * matches `[foo\\]`, not `[foo\]` (spec example 202).
 */
export function normalizeLabel(label: string, entities?: ReadonlyMap<string, string>): string {
    return decodeEntities(label, entities).trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}
