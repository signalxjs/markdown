/**
 * URL sanitisation for `link` and `image` nodes.
 *
 * Markdown from an AI or a user is untrusted: `[x](javascript:…)` must not
 * become a live `href`. The rule is deliberately small and decodes nothing —
 * a URL with a scheme passes only when the scheme is on the allow-list for
 * its kind; a URL without one (relative, anchor, query, protocol-relative
 * `//host`) passes through untouched. Anything else becomes `#`.
 */

export type UrlKind = 'link' | 'image';

/** Schemes allowed per kind. Images are kept to http(s) and relative URLs. */
export const DEFAULT_SAFE_SCHEMES: Readonly<Record<UrlKind, readonly string[]>> = Object.freeze({
    link: Object.freeze(['http', 'https', 'mailto', 'tel']),
    image: Object.freeze(['http', 'https']),
});

/** `scheme:` per RFC 3986 (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`). */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Browsers also strip ASCII tab and newlines *anywhere* in a URL before
 * parsing it, so a scheme split by a newline is still that scheme to them.
 */
const TAB_NEWLINE_RE = /[\t\n\r]/g;

/**
 * What a browser removes at both ends before parsing a URL (WHATWG URL):
 * C0 controls and space — a wider set than `String#trim` covers, and a
 * leading control character would otherwise hide a `javascript:` scheme.
 */
function trimControls(s: string): string {
    let start = 0;
    let end = s.length;
    while (start < end && s.charCodeAt(start) <= 0x20) start++;
    while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
    return start === 0 && end === s.length ? s : s.slice(start, end);
}

/**
 * Sanitise a URL for a `link` or an `image`: trimmed (C0 controls and space);
 * `''` stays `''`; an allowed scheme or no scheme passes through; any other
 * scheme yields `'#'`. The scheme check sees the URL as a browser would.
 */
export function sanitizeUrl(url: string, kind: UrlKind): string {
    const trimmed = trimControls(url);
    if (trimmed === '') return '';
    const match = SCHEME_RE.exec(trimmed.replace(TAB_NEWLINE_RE, ''));
    if (!match) return trimmed;
    return DEFAULT_SAFE_SCHEMES[kind].includes(match[1].toLowerCase()) ? trimmed : '#';
}
