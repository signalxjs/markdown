/**
 * Character classes the inline tokenizer's flanking rules need. CommonMark
 * defines "Unicode whitespace" (Zs + tab, LF, FF, CR) and "Unicode punctuation"
 * (the P* and S* general categories) — the `\p{…}` classes below.
 */

const WHITESPACE = /^[\p{Zs}\t\n\f\r]$/u;
const PUNCTUATION = /^[\p{P}\p{S}]$/u;

/** Unicode whitespace per CommonMark (an undefined char counts as whitespace: line edge). */
export function isUnicodeWhitespace(ch: string | undefined): boolean {
    return ch === undefined || WHITESPACE.test(ch);
}

/** Unicode punctuation per CommonMark. */
export function isUnicodePunctuation(ch: string | undefined): boolean {
    return ch !== undefined && PUNCTUATION.test(ch);
}

/** ASCII whitespace as CommonMark uses it for link destinations and titles. */
export function isAsciiWhitespace(ch: string | undefined): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r' || ch === '\v';
}

/** ASCII control character (U+0000–U+001F, U+007F). */
export function isAsciiControl(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return c <= 0x1f || c === 0x7f;
}

/** Characters that may be backslash-escaped to their literal form (ASCII punctuation). */
const ESCAPABLE = /^[!-/:-@[-`{-~]$/;

export function isEscapable(ch: string | undefined): boolean {
    return ch !== undefined && ESCAPABLE.test(ch);
}
