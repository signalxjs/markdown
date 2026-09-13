/**
 * Tokens → a lightweight element tree, with the structure repair browsers do
 * for the markup that reaches a clipboard or a CMS field: a block start tag
 * closes an open `p`, a new `li` closes the previous one (`dt` / `dd`, `td` /
 * `th`, `tr` and the table sections likewise), a heading closes an open
 * heading, void elements never open, an end tag without a matching open tag
 * is ignored and an end tag deeper than its element closes everything above
 * it. Text is kept verbatim here; whitespace is the parser's business
 * (it knows whether it is inside `pre`).
 */

import { tokenize, type HtmlToken } from './tokenizer.js';

export interface HtmlElement {
    type: 'element';
    tag: string;
    attrs: Record<string, string>;
    children: HtmlNode[];
}

export interface HtmlText {
    type: 'text';
    value: string;
}

export type HtmlNode = HtmlElement | HtmlText;

export const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'keygen']);

/** Start tags that implicitly close an open `p`. */
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot']);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** `name` → the open elements it closes first, searched from the top of the stack down to (not through) `boundary`. */
const IMPLIED_END: Record<string, { closes: Set<string>; boundary: Set<string> }> = {
    li: { closes: new Set(['li']), boundary: new Set(['ul', 'ol', 'menu']) },
    dt: { closes: new Set(['dt', 'dd']), boundary: new Set(['dl']) },
    dd: { closes: new Set(['dt', 'dd']), boundary: new Set(['dl']) },
    td: { closes: new Set(['td', 'th']), boundary: new Set(['tr', 'table']) },
    th: { closes: new Set(['td', 'th']), boundary: new Set(['tr', 'table']) },
    tr: { closes: new Set(['tr', 'td', 'th']), boundary: new Set(['table', 'thead', 'tbody', 'tfoot']) },
    thead: { closes: new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th']), boundary: new Set(['table']) },
    tbody: { closes: new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th']), boundary: new Set(['table']) },
    tfoot: { closes: new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th']), boundary: new Set(['table']) },
};

export function buildTree(source: string): HtmlNode[] {
    return fromTokens(tokenize(source));
}

export function fromTokens(tokens: readonly HtmlToken[]): HtmlNode[] {
    const root: HtmlNode[] = [];
    const stack: HtmlElement[] = [];
    const top = (): HtmlNode[] => (stack.length ? stack[stack.length - 1].children : root);

    /** Pop up to and including every open element in `closes` above the nearest element in `boundary` (a `tr` closes the open `td` and the open `tr` under it). */
    const impliedEnd = (closes: Set<string>, boundary: Set<string>): void => {
        for (;;) {
            let found = -1;
            for (let k = stack.length - 1; k >= 0; k--) {
                const tag = stack[k].tag;
                if (boundary.has(tag)) break;
                if (closes.has(tag)) {
                    found = k;
                    break;
                }
            }
            if (found === -1) return;
            stack.length = found;
        }
    };

    for (const t of tokens) {
        if (t.kind === 'text') {
            const siblings = top();
            const last = siblings[siblings.length - 1];
            if (last && last.type === 'text') last.value += t.value;
            else siblings.push({ type: 'text', value: t.value });
            continue;
        }
        if (t.kind === 'close') {
            for (let k = stack.length - 1; k >= 0; k--) {
                if (stack[k].tag === t.name) {
                    stack.length = k;
                    break;
                }
            }
            continue;
        }
        // Open.
        if (CLOSES_P.has(t.name)) impliedEnd(new Set(['p']), new Set(['blockquote', 'li', 'td', 'th', 'div', 'section', 'article', 'body']));
        if (HEADINGS.has(t.name)) impliedEnd(HEADINGS, new Set(['blockquote', 'li', 'td', 'th', 'div', 'section', 'article', 'body']));
        const implied = IMPLIED_END[t.name];
        if (implied) impliedEnd(implied.closes, implied.boundary);
        const el: HtmlElement = { type: 'element', tag: t.name, attrs: t.attrs, children: [] };
        top().push(el);
        if (!VOID_ELEMENTS.has(t.name) && !t.selfClosing) stack.push(el);
    }
    return root;
}

/** The concatenated text of a subtree. */
export function textOf(nodes: readonly HtmlNode[]): string {
    let out = '';
    for (const n of nodes) out += n.type === 'text' ? n.value : textOf(n.children);
    return out;
}
