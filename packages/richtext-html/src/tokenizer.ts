/**
 * A small, forgiving HTML tokenizer: start tags with their attributes, end
 * tags and text — nothing else survives. Comments, doctypes and processing
 * instructions are skipped; the content of elements that can never be
 * document text (`script`, `style`, `template`, `iframe`, `object`, `svg`,
 * `math`, `select`, `textarea`, `title`, `head`, …) is swallowed whole.
 * Character references are decoded in text and attribute values with the
 * core's `decodeEntities` (the HTML5 named set). Platform-free: no
 * `DOMParser`, so it runs on Lynx and in the terminal alike. Never throws and
 * never drops content: a malformed tag (an unclosed quote, no `>` before the
 * end) is text, like a bare `<`.
 */

import { decodeEntities } from '@sigx/richtext';

export type HtmlToken =
    | { kind: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
    | { kind: 'close'; name: string }
    | { kind: 'text'; value: string };

/** Elements whose content is never document text; the tokenizer drops everything up to their end tag. */
export const SWALLOWED = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'noframes', 'svg', 'math', 'select', 'textarea', 'title', 'head', 'canvas', 'video', 'audio', 'picture', 'map']);

const NAME_START = /[A-Za-z]/;
const NAME_CHAR = /[A-Za-z0-9:_.-]/;
const SPACE = /[ \t\r\n\f]/;

export function tokenize(source: string): HtmlToken[] {
    const out: HtmlToken[] = [];
    const n = source.length;
    let i = 0;
    let textStart = 0;

    const flushText = (end: number): void => {
        if (end > textStart) out.push({ kind: 'text', value: decodeEntities(source.slice(textStart, end)) });
    };

    while (i < n) {
        if (source[i] !== '<') {
            i++;
            continue;
        }
        const next = source[i + 1];
        // Comment / doctype / processing instruction: skipped.
        if (next === '!' || next === '?') {
            flushText(i);
            let end: number;
            if (source.startsWith('<!--', i)) {
                end = source.indexOf('-->', i + 4);
                end = end === -1 ? n : end + 3;
            } else {
                end = source.indexOf('>', i + 2);
                end = end === -1 ? n : end + 1;
            }
            i = end;
            textStart = i;
            continue;
        }
        // End tag.
        if (next === '/' && i + 2 < n && NAME_START.test(source[i + 2])) {
            let j = i + 2;
            while (j < n && NAME_CHAR.test(source[j])) j++;
            const name = source.slice(i + 2, j).toLowerCase();
            const gt = source.indexOf('>', j);
            if (gt === -1) {
                // No `>` before the end: text.
                i++;
                continue;
            }
            flushText(i);
            i = gt + 1;
            textStart = i;
            if (name === 'br') out.push({ kind: 'open', name: 'br', attrs: {}, selfClosing: true });
            else out.push({ kind: 'close', name });
            continue;
        }
        // Start tag.
        if (next !== undefined && NAME_START.test(next)) {
            const tag = readStartTag(source, i);
            if (!tag) {
                // Malformed (an unclosed quote, no `>` before the end): text.
                i++;
                continue;
            }
            flushText(i);
            out.push({ kind: 'open', name: tag.name, attrs: tag.attrs, selfClosing: tag.selfClosing });
            i = tag.end;
            textStart = i;
            if (SWALLOWED.has(tag.name) && !tag.selfClosing) {
                // Skip to the matching end tag (no nesting: the first one wins).
                const close = findCloseTag(source, i, tag.name);
                if (close === null) {
                    i = n;
                    textStart = n;
                    break;
                }
                out.push({ kind: 'close', name: tag.name });
                i = close;
                textStart = i;
            }
            continue;
        }
        // A bare `<`: text.
        i++;
    }
    flushText(n);
    return out;
}

interface StartTag {
    name: string;
    attrs: Record<string, string>;
    selfClosing: boolean;
    end: number;
}

function readStartTag(source: string, at: number): StartTag | null {
    const n = source.length;
    let i = at + 1;
    while (i < n && NAME_CHAR.test(source[i])) i++;
    const name = source.slice(at + 1, i).toLowerCase();
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
        while (i < n && SPACE.test(source[i])) i++;
        if (i >= n) return null;
        const ch = source[i];
        if (ch === '>') return { name, attrs, selfClosing, end: i + 1 };
        if (ch === '/') {
            selfClosing = true;
            i++;
            continue;
        }
        // Attribute name: up to whitespace, `=`, `>` or `/`.
        const nameStart = i;
        while (i < n && !SPACE.test(source[i]) && source[i] !== '=' && source[i] !== '>' && source[i] !== '/') i++;
        if (i === nameStart) {
            // A stray character (`<`, a quote): step over it.
            i++;
            continue;
        }
        const attrName = source.slice(nameStart, i).toLowerCase();
        let value = '';
        let j = i;
        while (j < n && SPACE.test(source[j])) j++;
        if (source[j] === '=') {
            j++;
            while (j < n && SPACE.test(source[j])) j++;
            const q = source[j];
            if (q === '"' || q === "'") {
                const close = source.indexOf(q, j + 1);
                if (close === -1) return null;
                value = source.slice(j + 1, close);
                j = close + 1;
            } else {
                const valueStart = j;
                while (j < n && !SPACE.test(source[j]) && source[j] !== '>') j++;
                value = source.slice(valueStart, j);
            }
            i = j;
        }
        if (!(attrName in attrs)) attrs[attrName] = decodeEntities(value);
        selfClosing = false;
    }
}

/** The index just past `</name ...>` (case-insensitive), or null when it never comes. */
function findCloseTag(source: string, from: number, name: string): number | null {
    const lower = source.toLowerCase();
    let i = from;
    for (;;) {
        const at = lower.indexOf('</' + name, i);
        if (at === -1) return null;
        const after = lower[at + 2 + name.length];
        if (after === undefined) return null;
        if (after === '>' || SPACE.test(after) || after === '/') {
            const gt = source.indexOf('>', at);
            return gt === -1 ? null : gt + 1;
        }
        i = at + 1;
    }
}
