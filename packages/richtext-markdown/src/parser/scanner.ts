/**
 * Low-level scanning helpers shared by the block and inline parsers: source
 * normalisation, link destination / title / label scanning and the GFM table
 * row splitter. Pure functions; no AST construction.
 */

import { decodeEntities, isAsciiControl, isEscapable, normalizeLabel } from '@sigx/richtext';
import type { AlignType } from '@sigx/richtext';

/**
 * Normalise a source string for parsing: CRLF / CR → LF, and U+0000 → U+FFFD
 * (the CommonMark "insecure character" rule). Length-preserving except for
 * CRLF, so every offset the parser records points into THIS string; keep it
 * when you need `sliceSource()`.
 */
export function normalizeSource(src: string): string {
    let out = src.indexOf('\r') === -1 ? src : src.replace(/\r\n?/g, '\n');
    if (out.indexOf('\0') !== -1) out = out.replace(/\0/g, '\uFFFD');
    return out;
}

export function isSpaceOrTab(ch: string | undefined): boolean {
    return ch === ' ' || ch === '\t';
}

/** Resolve backslash escapes and entity references in a destination / title / label. */
export function unescapeString(text: string, entities?: ReadonlyMap<string, string>): string {
    if (text.indexOf('\\') === -1 && text.indexOf('&') === -1) return text;
    const unescaped = text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
    return decodeEntities(unescaped, entities);
}

// ---------------------------------------------------------------------------
// Link destination / title / label
// ---------------------------------------------------------------------------

export interface DestinationScan {
    /** The raw (still escaped) destination. */
    raw: string;
    /** Exclusive end index. */
    end: number;
}

/**
 * Scan a link destination at `pos`: either `<…>` (no newlines, no unescaped
 * `<`/`>`) or a bare run with balanced parentheses and no ASCII control
 * characters or spaces. Returns `null` when nothing valid starts here.
 */
export function scanDestination(text: string, pos: number): DestinationScan | null {
    if (text[pos] === '<') {
        let i = pos + 1;
        let raw = '';
        while (i < text.length) {
            const ch = text[i];
            if (ch === '\\' && i + 1 < text.length && isEscapable(text[i + 1])) {
                raw += ch + text[i + 1];
                i += 2;
                continue;
            }
            if (ch === '\n' || ch === '<') return null;
            if (ch === '>') return { raw, end: i + 1 };
            raw += ch;
            i++;
        }
        return null;
    }
    let i = pos;
    let depth = 0;
    let raw = '';
    while (i < text.length) {
        const ch = text[i];
        if (ch === '\\' && i + 1 < text.length && isEscapable(text[i + 1])) {
            raw += ch + text[i + 1];
            i += 2;
            continue;
        }
        if (ch === ' ' || ch === '\n' || isAsciiControl(ch)) break;
        if (ch === '(') {
            depth++;
            if (depth > 32) return null;
        } else if (ch === ')') {
            if (depth === 0) break;
            depth--;
        }
        raw += ch;
        i++;
    }
    if (depth !== 0) return null;
    if (i === pos) return null;
    return { raw, end: i };
}

export interface TitleScan {
    raw: string;
    end: number;
}

/** Scan a link title at `pos`: `"…"`, `'…'` or `(…)`, possibly spanning lines but never a blank line. */
export function scanTitle(text: string, pos: number): TitleScan | null {
    const q = text[pos];
    if (q !== '"' && q !== "'" && q !== '(') return null;
    const close = q === '(' ? ')' : q;
    let i = pos + 1;
    let raw = '';
    while (i < text.length) {
        const ch = text[i];
        if (ch === '\\' && i + 1 < text.length && isEscapable(text[i + 1])) {
            raw += ch + text[i + 1];
            i += 2;
            continue;
        }
        if (ch === close) return { raw, end: i + 1 };
        if (q === '(' && ch === '(') return null;
        if (ch === '\n' && text[i + 1] === '\n') return null;
        raw += ch;
        i++;
    }
    return null;
}

/**
 * Scan a link label `[…]` at `pos` for reference purposes: at most 999
 * characters between the brackets, no unescaped brackets inside, at least one
 * non-whitespace character. Returns the raw inner text and the end index.
 */
export function scanLabel(text: string, pos: number): { raw: string; end: number } | null {
    if (text[pos] !== '[') return null;
    let i = pos + 1;
    let raw = '';
    while (i < text.length) {
        const ch = text[i];
        if (ch === '\\' && i + 1 < text.length) {
            raw += ch + text[i + 1];
            i += 2;
            continue;
        }
        if (ch === '[') return null;
        if (ch === ']') {
            if (raw.length > 999) return null;
            if (!/[^ \t\r\n]/.test(raw)) return null;
            return { raw, end: i + 1 };
        }
        raw += ch;
        i++;
        if (raw.length > 999) return null;
    }
    return null;
}

/** Whitespace (spaces, tabs) with at most one line ending. */
export function skipSpaceAndOneNewline(text: string, pos: number): number {
    let i = pos;
    while (isSpaceOrTab(text[i])) i++;
    if (text[i] === '\n') {
        i++;
        while (isSpaceOrTab(text[i])) i++;
    }
    return i;
}

export interface DefinitionScan {
    identifier: string;
    label: string;
    url: string;
    title: string | null;
    /** Exclusive end index (just past the line ending that ends the definition, or the end of text). */
    end: number;
}

/**
 * Scan a link reference definition anchored at `pos` (the start of a line in
 * paragraph content): `[label]:` whitespace destination [whitespace title]
 * followed by the end of the line. Returns `null` when the text does not
 * start with a complete definition.
 */
export function scanDefinition(text: string, pos: number, entities?: ReadonlyMap<string, string>): DefinitionScan | null {
    const label = scanLabel(text, pos);
    if (!label) return null;
    let i = label.end;
    if (text[i] !== ':') return null;
    i++;
    i = skipSpaceAndOneNewline(text, i);
    const dest = scanDestination(text, i);
    if (!dest) return null;
    // An empty bare destination is invalid; `<>` is a valid empty one.
    i = dest.end;
    const afterDest = i;

    // Optional title, separated by whitespace (at most one line ending).
    let title: string | null = null;
    let j = skipSpaceAndOneNewline(text, i);
    let titleEnd = -1;
    if (j > i) {
        const t = scanTitle(text, j);
        if (t) {
            // The title must be followed by the end of the line.
            let k = t.end;
            while (isSpaceOrTab(text[k])) k++;
            if (k >= text.length || text[k] === '\n') {
                title = unescapeString(t.raw, entities);
                titleEnd = k;
            }
        }
    }
    let end: number;
    if (titleEnd !== -1) {
        end = titleEnd;
    } else {
        // No (valid) title: the destination must be followed by the end of its line.
        let k = afterDest;
        while (isSpaceOrTab(text[k])) k++;
        if (k < text.length && text[k] !== '\n') return null;
        end = k;
    }
    if (text[end] === '\n') end++;
    return {
        identifier: normalizeLabel(label.raw, entities),
        label: label.raw,
        url: unescapeString(dest.raw, entities),
        title,
        end,
    };
}

// ---------------------------------------------------------------------------
// GFM tables
// ---------------------------------------------------------------------------

/**
 * Parse a GFM delimiter row (`| --- | :-: |`) into per-column alignment, or
 * `null` when the line is not a delimiter row.
 */
export function matchTableDelimiter(line: string): AlignType[] | null {
    const t = line.trim();
    if (t.indexOf('-') === -1) return null;
    if (!/^[|:\- \t]+$/.test(t)) return null;
    const cells = splitTableRow(t);
    if (cells.length === 0) return null;
    const align: AlignType[] = [];
    for (const cell of cells) {
        const c = cell.trim();
        if (!/^:?-+:?$/.test(c)) return null;
        const left = c.startsWith(':');
        const right = c.endsWith(':');
        align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
    }
    return align;
}

/** Whether a line (trimmed) has the shape of a table row: contains an unescaped `|`. */
export function hasTablePipe(line: string): boolean {
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') {
            i++;
            continue;
        }
        if (line[i] === '|') return true;
    }
    return false;
}

/**
 * Split a table row into cell strings. `\|` becomes `|` inside a cell (GFM:
 * the pipe escape applies even inside code spans), which shifts positions of
 * later content in that cell by one per escape. Leading and trailing pipes
 * are optional. Returns each cell's text and its start index in `line`.
 */
export function splitTableRow(line: string): string[] {
    return splitTableRowWithOffsets(line).map((c) => c.text);
}

export function splitTableRowWithOffsets(line: string): { text: string; start: number }[] {
    let start = 0;
    let end = line.length;
    while (start < end && isSpaceOrTab(line[start])) start++;
    while (end > start && isSpaceOrTab(line[end - 1])) end--;
    if (line[start] === '|') start++;
    if (end > start && line[end - 1] === '|' && line[end - 2] !== '\\') end--;
    const cells: { text: string; start: number }[] = [];
    let cellStart = start;
    let i = start;
    while (i < end) {
        const ch = line[i];
        if (ch === '\\' && i + 1 < end) {
            i += 2;
            continue;
        }
        if (ch === '|') {
            cells.push(trimCell(line, cellStart, i));
            cellStart = i + 1;
        }
        i++;
    }
    cells.push(trimCell(line, cellStart, end));
    return cells;
}

function trimCell(line: string, from: number, to: number): { text: string; start: number } {
    let s = from;
    let e = to;
    while (s < e && isSpaceOrTab(line[s])) s++;
    while (e > s && isSpaceOrTab(line[e - 1])) e--;
    return { text: line.slice(s, e).replace(/\\\|/g, '|'), start: s };
}

/** Trailing punctuation trimmed from bare-URL autolinks (GFM behaviour). */
export function trimAutolinkTail(url: string): { url: string; tail: string } {
    let end = url.length;
    while (end > 0) {
        const ch = url[end - 1];
        if ('?!.,:*_~\'"'.indexOf(ch) !== -1) {
            end--;
            continue;
        }
        if (ch === ')') {
            // A trailing ')' is only trimmed when unbalanced within the URL.
            let open = 0;
            let close = 0;
            for (let i = 0; i < end; i++) {
                if (url[i] === '(') open++;
                else if (url[i] === ')') close++;
            }
            if (close > open) {
                end--;
                continue;
            }
            break;
        }
        if (ch === ';') {
            // `&amp;`-style trailing entity: drop it whole.
            const m = /&[a-zA-Z0-9]+;$/.exec(url.slice(0, end));
            if (m) {
                end -= m[0].length;
                continue;
            }
            end--;
            continue;
        }
        break;
    }
    return { url: url.slice(0, end), tail: url.slice(end) };
}
