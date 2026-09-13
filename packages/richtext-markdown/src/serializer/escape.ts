/**
 * Escaping — the part of the serializer that makes literal text survive a
 * round trip: `parse(toMarkdown(tree))` must give `tree` back, so every
 * character sequence that could start a construct is neutralised. The policy
 * is "escape whenever it could matter": escaping too much still round-trips
 * (a backslash before ASCII punctuation is always its literal), escaping too
 * little changes the tree.
 */

const ALNUM = /[\p{L}\p{N}]/u;

function isAlnum(ch: string | undefined): boolean {
    return ch !== undefined && ALNUM.test(ch);
}

/** Longest run of `ch` in `text` (0 when absent). */
export function longestRun(text: string, ch: string): number {
    let max = 0;
    let run = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === ch) {
            if (++run > max) max = run;
        } else {
            run = 0;
        }
    }
    return max;
}

/**
 * Escape a text run so it re-parses as the same literal text.
 *
 * Inline rules (every line):
 *  - `\` `` ` `` `*` `_` `[` `]` are always escaped;
 *  - `<` when it could open a tag or autolink (followed by a letter, `/`,
 *    `!`, `?`) or when it ends the run (the next node may supply the rest);
 *  - `&` when it would form a character reference (`&name;`, `&#…`) or ends
 *    the run;
 *  - `~` in runs of two or more (strikethrough / tilde fence) and at the run's
 *    edges (a neighbouring node may complete the pair);
 *  - `!` before `[` or at the end of the run (an image opener);
 *  - a bare URL (`http://`, `https://`, `www.` at a non-alphanumeric boundary)
 *    has the `:` / `.` after the scheme replaced by `&#x3A;` / `&#x2E;`, and
 *    an email-shaped `@` becomes `&#x40;`, so GFM autolink literals do not
 *    fire; the parser decodes the entity back to the character.
 *
 * Line-start rules (the first line when `atLineStart`, and every line after a
 * newline — a soft break starts a new source line):
 *  - 4+ spaces or a tab of indentation (indented code) → the first
 *    whitespace char becomes `&#x20;` / `&#x9;`;
 *  - `#…#` followed by whitespace/end (ATX heading), `>` (blockquote), `|`
 *    (table row), `-` `+` `*` followed by whitespace/end (bullet), and a line
 *    made only of `-`/`=` (setext underline, thematic break) get a backslash;
 *  - `1.`/`1)` followed by whitespace/end (ordered item) gets the backslash
 *    before the delimiter.
 */
export function escapeText(text: string, atLineStart = false): string {
    if (text === '') return '';
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        let line = escapeInline(lines[i]);
        if (i > 0 || atLineStart) line = escapeLineStart(line);
        lines[i] = line;
    }
    return lines.join('\n');
}

const INLINE = /[\\`*_[\]]|<|&|~+|!|https?:\/\/|www\.|@/gi;
const ENTITY = /^&[a-zA-Z0-9]+;/;

function escapeInline(line: string): string {
    return line.replace(INLINE, (m: string, offset: number) => {
        const prev = line[offset - 1];
        const next = line[offset + m.length];
        switch (m[0].toLowerCase()) {
            case '<':
                return next === undefined || /[a-zA-Z/!?]/.test(next) ? '\\<' : '<';
            case '&':
                return next === undefined || next === '#' || ENTITY.test(line.slice(offset)) ? '\\&' : '&';
            case '~':
                return m.length > 1 || prev === undefined || next === undefined ? m.replace(/~/g, '\\~') : m;
            case '!':
                return next === undefined || next === '[' ? '\\!' : '!';
            case 'h':
                return isAlnum(prev) ? m : m.replace(':', '&#x3A;');
            case 'w':
                return isAlnum(prev) ? m : m.replace('.', '&#x2E;');
            case '@':
                return isAlnum(prev) && isAlnum(next) ? '&#x40;' : '@';
            default:
                return '\\' + m;
        }
    });
}

function escapeLineStart(line: string): string {
    const ws = /^[ \t]*/.exec(line)![0];
    if (ws.length >= 4 || ws.includes('\t')) {
        return (ws[0] === '\t' ? '&#x9;' : '&#x20;') + line.slice(1);
    }
    const rest = line.slice(ws.length);
    if (
        /^#{1,6}(?:[ \t]|$)/.test(rest) ||
        rest[0] === '>' ||
        rest[0] === '|' ||
        /^[-+*](?:[ \t]|$)/.test(rest) ||
        /^[-=][-= \t]*$/.test(rest)
    ) {
        return ws + '\\' + rest;
    }
    const num = /^\d{1,9}(?=[.)](?:[ \t]|$))/.exec(rest);
    if (num) return ws + num[0] + '\\' + rest.slice(num[0].length);
    return line;
}

/**
 * Escape a link / image / definition destination. Whitespace, control
 * characters, an empty destination or unbalanced parentheses force the
 * `<…>` form (where only `<`, `>` and line endings need care); otherwise the
 * bare form with `\`, `(`, `)`, `<`, `>` backslash-escaped.
 */
export function escapeLinkDest(url: string): string {
    // oxlint-disable-next-line no-control-regex -- control characters are not allowed in a bare destination
    if (url === '' || /[\s\x00-\x1f\x7f]/.test(url) || !balancedParens(url)) {
        return '<' + url.replace(/[<>\\]/g, '\\$&').replace(/\r?\n/g, '%0A') + '>';
    }
    return url.replace(/[\\()<>]/g, '\\$&');
}

function balancedParens(url: string): boolean {
    let depth = 0;
    for (let i = 0; i < url.length; i++) {
        const ch = url[i];
        if (ch === '(') depth++;
        else if (ch === ')' && --depth < 0) return false;
    }
    return depth === 0;
}

/** Quote a link title, picking `"…"`, `'…'` or `(…)` by which delimiter is absent. */
export function quoteTitle(title: string): string {
    const t = title.replace(/\\/g, '\\\\');
    if (!title.includes('"')) return `"${t}"`;
    if (!title.includes("'")) return `'${t}'`;
    if (!title.includes('(') && !title.includes(')')) return `(${t})`;
    return `"${t.replace(/"/g, '\\"')}"`;
}

/**
 * Escape a reference label (`label` is "as written", so existing backslash
 * escapes are kept; bare brackets and a dangling backslash are escaped).
 */
export function escapeLabel(label: string): string {
    return label.replace(/\\[\s\S]|\\$|[[\]]/g, (m) => (m === '\\' ? '\\\\' : m.length === 2 ? m : '\\' + m));
}
