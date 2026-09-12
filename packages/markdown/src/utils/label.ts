/**
 * Link label normalisation (CommonMark "matching of link labels"): strip the
 * brackets' inner whitespace, collapse internal whitespace runs to one space,
 * and case-fold.
 */
export function normalizeLabel(label: string): string {
    return label.trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}
