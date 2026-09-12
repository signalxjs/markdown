/**
 * The styling seam of the default DOM components: every element carries
 * `data-scope="markdown"` and `data-part="<name>"` (the zero convention —
 * attributes, never classes), plus an optional class when a `classPrefix` is
 * given for stylesheets that prefer class selectors.
 */

export const SCOPE = 'markdown';

export interface PartAttrs {
    'data-scope': string;
    'data-part': string;
    class?: string;
}

export function partAttrs(part: string, classPrefix?: string): PartAttrs {
    const attrs: PartAttrs = { 'data-scope': SCOPE, 'data-part': part };
    if (classPrefix) attrs.class = `${classPrefix}-${part}`;
    return attrs;
}
