/**
 * Inline tokenizer: a text run → `PhrasingContent[]`.
 *
 * Precedence (highest first): backslash escapes, entity references, plugin
 * inline extensions (trigger-char gated), code spans, images, links (inline,
 * then reference), angle and bare autolinks, then emphasis (`**`/`__`,
 * `*`/`_`, GFM `~~`) resolved with the CommonMark delimiter-stack algorithm
 * (including the "rule of 3"), then hard breaks, then text.
 *
 * Robustness for streaming: any unmatched construct at the tail (a lone `**`,
 * a half-open `[text](`, an unterminated code span) degrades to literal text.
 * The function never throws — a plugin `match` that throws, does not advance
 * or overruns is treated as no match.
 *
 * Reference links are emitted as `linkReference` / `imageReference` whether or
 * not a definition exists; resolution is a render / serialize concern (see
 * `ast/definitions.ts`). This is the one deliberate deviation from remark,
 * which turns undefined references back into text.
 */

import type {
    Image,
    ImageReference,
    Link,
    LinkReference,
    PhrasingContent,
    Point,
    Position,
    ReferenceType,
    Text,
} from '../ast/index.js';
import type { InlineMatchContext, InlineSyntaxExtension, ResolvedMarkdownPlugins } from '../plugin/index.js';
import { NO_MARKDOWN_PLUGINS } from '../plugin/index.js';
import {
    decodeEntity,
    isEscapable,
    isUnicodePunctuation,
    isUnicodeWhitespace,
    normalizeLabel,
} from '../utils/index.js';
import { scanDestination, scanLabel, scanTitle, trimAutolinkTail, unescapeString } from './scanner.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InlineOptions {
    /** Resolved plugins (inline extensions, entities). */
    plugins?: ResolvedMarkdownPlugins;
    /**
     * Map a content index to a source point, for positions. Absent → nodes
     * carry no `position`.
     */
    pointAt?: (contentIndex: number) => Point;
}

/** Parse a text run into phrasing content. */
export function parseInline(text: string, options?: InlineOptions): PhrasingContent[] {
    const plugins = options?.plugins ?? NO_MARKDOWN_PLUGINS;
    const pointAt = options?.pointAt;
    const state: State = { text, plugins, pointAt, entities: plugins.entities.size ? plugins.entities : undefined };
    const tokens = tokenize(state);
    processEmphasis(tokens, state);
    return finish(tokens, state);
}

/** Flatten phrasing content to its plain text (image alt, unresolved references). */
export function toPlainText(nodes: readonly PhrasingContent[]): string {
    let out = '';
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
            case 'inlineCode':
                out += node.value;
                break;
            case 'image':
            case 'imageReference':
                out += node.alt ?? '';
                break;
            case 'break':
                out += '\n';
                break;
            default: {
                const children = (node as { children?: PhrasingContent[] }).children;
                if (children) out += toPlainText(children);
                else if ('value' in node && typeof (node as { value?: unknown }).value === 'string') {
                    out += (node as { value: string }).value;
                }
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Tokens (a doubly linked list so emphasis resolution can splice freely)
// ---------------------------------------------------------------------------

interface State {
    text: string;
    plugins: ResolvedMarkdownPlugins;
    pointAt?: (i: number) => Point;
    entities?: ReadonlyMap<string, string>;
}

interface NodeToken {
    kind: 'node';
    node: PhrasingContent;
    start: number;
    end: number;
    prev: Token | null;
    next: Token | null;
}

interface TextToken {
    kind: 'text';
    value: string;
    start: number;
    end: number;
    prev: Token | null;
    next: Token | null;
}

interface DelimToken {
    kind: 'delim';
    ch: '*' | '_' | '~';
    /** Remaining delimiter count. */
    count: number;
    /** Original run length (rule of 3). */
    orig: number;
    canOpen: boolean;
    canClose: boolean;
    start: number;
    end: number;
    prev: Token | null;
    next: Token | null;
}

type Token = NodeToken | TextToken | DelimToken;

interface TokenList {
    head: Token | null;
    tail: Token | null;
}

function append(list: TokenList, token: Token): void {
    token.prev = list.tail;
    token.next = null;
    if (list.tail) list.tail.next = token;
    else list.head = token;
    list.tail = token;
}

function remove(list: TokenList, token: Token): void {
    if (token.prev) token.prev.next = token.next;
    else list.head = token.next;
    if (token.next) token.next.prev = token.prev;
    else list.tail = token.prev;
}

function positionOf(state: State, start: number, end: number): Position | undefined {
    if (!state.pointAt) return undefined;
    return { start: state.pointAt(start), end: state.pointAt(end) };
}

function withPosition<N extends PhrasingContent>(state: State, node: N, start: number, end: number): N {
    const pos = positionOf(state, start, end);
    if (pos) node.position = pos;
    return node;
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

const ENTITY_RE = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/;

function tokenize(state: State): TokenList {
    const { text, plugins } = state;
    const triggers = plugins.inlineTriggers.size ? plugins.inlineTriggers : null;
    const list: TokenList = { head: null, tail: null };
    const n = text.length;

    let buf = '';
    let bufStart = 0;
    const flush = (end: number): void => {
        if (buf) {
            append(list, { kind: 'text', value: buf, start: bufStart, end, prev: null, next: null });
            buf = '';
        }
    };
    const pushNode = (node: PhrasingContent, start: number, end: number): void => {
        flush(start);
        withPosition(state, node, start, end);
        append(list, { kind: 'node', node, start, end, prev: null, next: null });
        bufStart = end;
    };
    const pushText = (ch: string, at: number): void => {
        if (!buf) bufStart = at;
        buf += ch;
    };

    const matchCtx: InlineMatchContext = {
        parseInline: (t) => parseInline(t, { plugins: state.plugins }),
        position: (s, e) => positionOf(state, s, e),
    };

    let i = 0;
    while (i < n) {
        const ch = text[i];

        // Backslash escape / hard break.
        if (ch === '\\') {
            const next = text[i + 1];
            if (next === '\n') {
                pushNode({ type: 'break' }, i, i + 2);
                i += 2;
                i = skipLeadingSpaces(text, i);
                continue;
            }
            if (next !== undefined && (isEscapable(next) || (triggers !== null && triggers.has(next)))) {
                pushText(next, i);
                i += 2;
                continue;
            }
            pushText('\\', i);
            i++;
            continue;
        }

        // Entity / numeric character reference.
        if (ch === '&') {
            const m = ENTITY_RE.exec(text.slice(i, i + 40));
            if (m) {
                const decoded = decodeEntity(m[0], state.entities);
                if (decoded !== null) {
                    pushText(decoded, i);
                    i += m[0].length;
                    continue;
                }
            }
            pushText('&', i);
            i++;
            continue;
        }

        // Plugin inline extension (opaque to the emphasis stack).
        if (triggers !== null && triggers.has(ch)) {
            const m = matchExtension(plugins.inline, text, i, matchCtx);
            if (m) {
                pushNode(m.node, i, m.end);
                i = m.end;
                continue;
            }
        }

        // Code span.
        if (ch === '`') {
            const span = scanCodeSpan(text, i);
            if (span) {
                pushNode({ type: 'inlineCode', value: span.value }, i, span.end);
                i = span.end;
                continue;
            }
            // A backtick run that never closes is literal.
            let j = i;
            while (text[j] === '`') j++;
            pushText(text.slice(i, j), i);
            i = j;
            continue;
        }

        // Image.
        if (ch === '!' && text[i + 1] === '[') {
            const img = scanBracketed(state, text, i + 1, true);
            if (img) {
                pushNode(img.node, i, img.end);
                i = img.end;
                continue;
            }
            pushText('!', i);
            i++;
            continue;
        }

        // Link (inline or reference).
        if (ch === '[') {
            const link = scanBracketed(state, text, i, false);
            if (link) {
                pushNode(link.node, i, link.end);
                i = link.end;
                continue;
            }
            pushText('[', i);
            i++;
            continue;
        }

        // Angle autolink.
        if (ch === '<') {
            const auto = scanAngleAutolink(text, i);
            if (auto) {
                pushNode(autolinkNode(state, auto.url, auto.value, i, auto.end), i, auto.end);
                i = auto.end;
                continue;
            }
            pushText('<', i);
            i++;
            continue;
        }

        // Bare GFM autolink at a boundary.
        if ((ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') && isAutolinkBoundary(text[i - 1])) {
            const auto = scanBareAutolink(text, i);
            if (auto) {
                pushNode(autolinkNode(state, auto.url, auto.value, i, auto.end), i, auto.end);
                i = auto.end;
                continue;
            }
        }

        // Bare GFM email autolink: the local part is already in the buffer.
        if (ch === '@') {
            const email = scanBareEmail(text, i, buf);
            if (email) {
                const start = i - email.local.length;
                buf = buf.slice(0, -email.local.length);
                flush(start);
                const value = email.local + text.slice(i, email.end);
                const node = autolinkNode(state, `mailto:${value}`, value, start, email.end);
                withPosition(state, node, start, email.end);
                append(list, { kind: 'node', node, start, end: email.end, prev: null, next: null });
                bufStart = email.end;
                i = email.end;
                continue;
            }
        }

        // Line ending: hard break (two+ trailing spaces) or soft break.
        if (ch === '\n') {
            const trailing = /( +)$/.exec(buf);
            if (trailing && trailing[1].length >= 2) {
                buf = buf.slice(0, -trailing[1].length);
                const brStart = i - trailing[1].length;
                flush(brStart);
                append(list, {
                    kind: 'node',
                    node: withPosition(state, { type: 'break' }, brStart, i + 1),
                    start: brStart,
                    end: i + 1,
                    prev: null,
                    next: null,
                });
                bufStart = i + 1;
            } else {
                if (trailing) buf = buf.slice(0, -trailing[1].length);
                pushText('\n', i);
            }
            i++;
            i = skipLeadingSpaces(text, i);
            continue;
        }

        // Emphasis / strikethrough delimiter run.
        if (ch === '*' || ch === '_' || ch === '~') {
            let j = i;
            while (j < n && text[j] === ch) j++;
            const count = j - i;
            if (ch === '~' && count !== 2) {
                pushText(text.slice(i, j), i);
                i = j;
                continue;
            }
            const before = text[i - 1];
            const after = text[j];
            const { canOpen, canClose } = flanking(ch, before, after);
            if (!canOpen && !canClose) {
                pushText(text.slice(i, j), i);
            } else {
                flush(i);
                append(list, {
                    kind: 'delim',
                    ch,
                    count,
                    orig: count,
                    canOpen,
                    canClose,
                    start: i,
                    end: j,
                    prev: null,
                    next: null,
                });
                bufStart = j;
            }
            i = j;
            continue;
        }

        pushText(ch, i);
        i++;
    }
    flush(n);
    return list;
}

function skipLeadingSpaces(text: string, i: number): number {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
    return i;
}

function matchExtension(
    // oxlint-disable-next-line no-explicit-any
    extensions: readonly InlineSyntaxExtension<any>[],
    text: string,
    pos: number,
    ctx: InlineMatchContext,
): { node: PhrasingContent; end: number } | null {
    const ch = text[pos];
    for (const ext of extensions) {
        if (ext.triggerChars.indexOf(ch) === -1) continue;
        let m: { node: PhrasingContent; end: number } | null = null;
        try {
            m = ext.match(text, pos, ctx);
        } catch (err) {
            if (__DEV__) console.warn(`[@sigx/markdown] Inline extension "${ext.name}" threw; treated as no match.`, err);
            m = null;
        }
        if (m && m.node && typeof m.node === 'object' && m.end > pos && m.end <= text.length) return m;
        if (__DEV__ && m) {
            console.warn(`[@sigx/markdown] Inline extension "${ext.name}" returned an invalid end (${m.end}); ignored.`);
        }
    }
    return null;
}

/** Compute flanking rules for an emphasis delimiter run (CommonMark, with Unicode classes). */
function flanking(ch: string, before: string | undefined, after: string | undefined): { canOpen: boolean; canClose: boolean } {
    const beforeWs = isUnicodeWhitespace(before);
    const afterWs = isUnicodeWhitespace(after);
    const beforePunct = isUnicodePunctuation(before);
    const afterPunct = isUnicodePunctuation(after);

    const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
    const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);

    if (ch === '_') {
        return {
            canOpen: leftFlanking && (!rightFlanking || beforePunct),
            canClose: rightFlanking && (!leftFlanking || afterPunct),
        };
    }
    return { canOpen: leftFlanking, canClose: rightFlanking };
}

function isAutolinkBoundary(prev: string | undefined): boolean {
    return prev === undefined || /[\s(*_~]/.test(prev);
}

// ---------------------------------------------------------------------------
// Code spans
// ---------------------------------------------------------------------------

function scanCodeSpan(text: string, start: number): { value: string; end: number } | null {
    let open = start;
    while (text[open] === '`') open++;
    const ticks = open - start;
    let k = open;
    while (k < text.length) {
        const idx = text.indexOf('`', k);
        if (idx === -1) return null;
        let run = idx;
        while (text[run] === '`') run++;
        if (run - idx === ticks) return finishCodeSpan(text, open, idx, ticks);
        k = run;
    }
    return null;
}

function finishCodeSpan(text: string, open: number, close: number, ticks: number): { value: string; end: number } {
    let value = text.slice(open, close).replace(/\n/g, ' ');
    // Strip one leading and one trailing space when both are present and the content is not all spaces.
    if (value.length > 1 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
        value = value.slice(1, -1);
    }
    return { value, end: close + ticks };
}

// ---------------------------------------------------------------------------
// Links, images and references
// ---------------------------------------------------------------------------

/** Find the `]` matching the `[` at `start`, honouring nesting, escapes and code spans. */
function findClosingBracket(text: string, start: number): number {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '`') {
            const span = scanCodeSpan(text, i);
            if (span) {
                i = span.end - 1;
                continue;
            }
            continue;
        }
        if (ch === '<') {
            const auto = scanAngleAutolink(text, i);
            if (auto) {
                i = auto.end - 1;
                continue;
            }
        }
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Parse the `(dest "title")` part of an inline link starting just after `(`. Returns null when malformed. */
function scanInlineLinkTail(
    text: string,
    start: number,
    entities: ReadonlyMap<string, string> | undefined,
): { url: string; title: string | null; end: number } | null {
    let i = start;
    while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
    let url = '';
    let title: string | null = null;
    if (text[i] === ')') return { url: '', title: null, end: i + 1 };
    const dest = scanDestination(text, i);
    if (dest) {
        url = unescapeString(dest.raw, entities);
        i = dest.end;
    }
    let j = i;
    while (text[j] === ' ' || text[j] === '\t' || text[j] === '\n') j++;
    if (j > i || !dest) {
        const t = scanTitle(text, j);
        if (t) {
            title = unescapeString(t.raw, entities);
            j = t.end;
            while (text[j] === ' ' || text[j] === '\t' || text[j] === '\n') j++;
        }
    }
    if (text[j] !== ')') return null;
    return { url, title, end: j + 1 };
}

/**
 * Links may not contain links. Only inline links count: a reference may turn
 * out undefined (then it is just text per the spec), and definitions are only
 * known at render time.
 */
function containsLink(nodes: readonly PhrasingContent[]): boolean {
    for (const node of nodes) {
        if (node.type === 'link') return true;
        const children = (node as { children?: PhrasingContent[] }).children;
        if (children && containsLink(children)) return true;
    }
    return false;
}

/**
 * Scan a bracketed construct at `start` (the `[`): an inline link/image, or a
 * full / collapsed / shortcut reference. `isImage` when preceded by `!`.
 */
function scanBracketed(
    state: State,
    text: string,
    start: number,
    isImage: boolean,
): { node: PhrasingContent; end: number } | null {
    const labelEnd = findClosingBracket(text, start);
    if (labelEnd === -1) return null;
    const labelText = text.slice(start + 1, labelEnd);
    const contentPointAt = state.pointAt ? (i: number) => state.pointAt!(start + 1 + i) : undefined;
    const parseLabel = (): PhrasingContent[] =>
        parseInline(labelText, { plugins: state.plugins, pointAt: contentPointAt });

    // Inline link: `(dest "title")`.
    if (text[labelEnd + 1] === '(') {
        const tail = scanInlineLinkTail(text, labelEnd + 2, state.entities);
        if (tail) {
            const children = parseLabel();
            if (!isImage && containsLink(children)) return null;
            if (isImage) {
                const node: Image = { type: 'image', url: tail.url, title: tail.title, alt: toPlainText(children) };
                if (node.title === null) delete node.title;
                return { node, end: tail.end };
            }
            const node: Link = { type: 'link', url: tail.url, title: tail.title, children };
            if (node.title === null) delete node.title;
            return { node, end: tail.end };
        }
    }

    // Reference link: full `[text][label]`, collapsed `[text][]`, shortcut `[text]`.
    let referenceType: ReferenceType = 'shortcut';
    let refLabel: string | null = null;
    let end = labelEnd + 1;
    if (text[labelEnd + 1] === '[') {
        if (text[labelEnd + 2] === ']') {
            referenceType = 'collapsed';
            end = labelEnd + 3;
        } else {
            const ref = scanLabel(text, labelEnd + 1);
            if (ref) {
                referenceType = 'full';
                refLabel = ref.raw;
                end = ref.end;
            }
        }
    }
    if (referenceType !== 'full') {
        // The link text itself must be a valid label for collapsed/shortcut references.
        const own = scanLabel(text, start);
        if (!own || own.end !== labelEnd + 1) return null;
        refLabel = labelText;
    }
    const children = parseLabel();
    if (!isImage && containsLink(children)) return null;
    const identifier = normalizeLabel(refLabel!, state.entities);
    if (isImage) {
        const node: ImageReference = {
            type: 'imageReference',
            identifier,
            label: refLabel,
            referenceType,
            alt: toPlainText(children),
        };
        return { node, end };
    }
    const node: LinkReference = { type: 'linkReference', identifier, label: refLabel, referenceType, children };
    return { node, end };
}

// ---------------------------------------------------------------------------
// Autolinks
// ---------------------------------------------------------------------------

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*$/;
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function scanAngleAutolink(text: string, start: number): { url: string; value: string; end: number } | null {
    const close = text.indexOf('>', start);
    if (close === -1) return null;
    const inner = text.slice(start + 1, close);
    if (inner === '' || /[\s<]/.test(inner)) return null;
    if (SCHEME_RE.test(inner)) return { url: inner, value: inner, end: close + 1 };
    if (EMAIL_RE.test(inner)) return { url: `mailto:${inner}`, value: inner, end: close + 1 };
    return null;
}

function scanBareAutolink(text: string, start: number): { url: string; value: string; end: number } | null {
    const rest = text.slice(start);
    const m = /^(https?:\/\/|www\.)[^\s<]+/i.exec(rest);
    if (!m) return null;
    const { url } = trimAutolinkTail(m[0]);
    if (url.length <= m[1].length) return null;
    // The domain must look like one: at least one dot after the prefix, no underscores in the last two segments.
    const afterPrefix = url.slice(m[1].length);
    const domain = afterPrefix.split(/[/?#]/)[0];
    if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(domain)) return null;
    if (m[1].toLowerCase() === 'www.' && domain.indexOf('.') === -1) return null;
    const segments = domain.split('.');
    if (segments.slice(-2).some((s) => s.indexOf('_') !== -1)) return null;
    const href = url.toLowerCase().startsWith('www.') ? `http://${url}` : url;
    return { url: href, value: url, end: start + url.length };
}

const EMAIL_LOCAL_TAIL = /[a-zA-Z0-9.+_-]+$/;
const EMAIL_DOMAIN = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+/;

/**
 * GFM extended email autolink: `local@domain.tld` where the local part is the
 * tail of the pending text buffer (so it must not be glued to other word
 * characters) and the domain does not end in `-` or `_`; a trailing `.` is
 * not part of the address.
 */
function scanBareEmail(text: string, at: number, buf: string): { local: string; end: number } | null {
    const local = EMAIL_LOCAL_TAIL.exec(buf)?.[0];
    if (!local) return null;
    // The local part must be literal source text (no escapes or entities in it).
    if (text.slice(at - local.length, at) !== local) return null;
    const before = text[at - local.length - 1];
    if (before !== undefined && /[a-zA-Z0-9\\]/.test(before)) return null;
    const m = EMAIL_DOMAIN.exec(text.slice(at + 1));
    if (!m) return null;
    let domain = m[0];
    while (domain.endsWith('.')) domain = domain.slice(0, -1);
    if (domain.indexOf('.') === -1) return null;
    const last = domain[domain.length - 1];
    if (last === '-' || last === '_') return null;
    return { local, end: at + 1 + domain.length };
}

function autolinkNode(state: State, url: string, value: string, start: number, end: number): Link {
    const child: Text = { type: 'text', value };
    withPosition(state, child, start, end);
    return { type: 'link', url, children: [child], data: { autolink: true } };
}

// ---------------------------------------------------------------------------
// Emphasis (CommonMark "process emphasis")
// ---------------------------------------------------------------------------

function processEmphasis(list: TokenList, state: State): void {
    // openers_bottom keyed by delimiter char + closer.canOpen + closer.orig % 3.
    const bottoms = new Map<string, Token | null>();
    let current: Token | null = list.head;
    while (current) {
        if (current.kind !== 'delim' || !current.canClose || current.count === 0) {
            current = current.next;
            continue;
        }
        const closer: DelimToken = current;
        const key = `${closer.ch}${closer.canOpen ? 1 : 0}${closer.orig % 3}`;
        const bottom = bottoms.has(key) ? bottoms.get(key)! : null;

        let opener: Token | null = closer.prev;
        let found: DelimToken | null = null;
        while (opener && opener !== bottom) {
            if (opener.kind === 'delim' && opener.ch === closer.ch && opener.canOpen && opener.count > 0) {
                const oddMatch =
                    (closer.canOpen || opener.canClose) &&
                    closer.orig % 3 !== 0 &&
                    (opener.orig + closer.orig) % 3 === 0;
                if (!oddMatch) {
                    found = opener;
                    break;
                }
            }
            opener = opener.prev;
        }

        if (found) {
            const use = closer.ch === '~' ? 2 : closer.count >= 2 && found.count >= 2 ? 2 : 1;
            found.count -= use;
            closer.count -= use;
            const innerStart = found.end - use;
            const innerEnd = closer.start + use;
            found.end -= use;
            closer.start += use;

            // Collect the tokens between opener and closer into one node.
            const children: PhrasingContent[] = [];
            let t = found.next;
            while (t && t !== closer) {
                const next = t.next;
                children.push(...tokenToNodes(t, state));
                remove(list, t);
                t = next;
            }
            const node: PhrasingContent =
                closer.ch === '~'
                    ? { type: 'delete', children: coalesce(children) }
                    : use === 2
                        ? { type: 'strong', children: coalesce(children) }
                        : { type: 'emphasis', children: coalesce(children) };
            const nodeToken: NodeToken = {
                kind: 'node',
                node: withPosition(state, node, innerStart, innerEnd),
                start: innerStart,
                end: innerEnd,
                prev: null,
                next: null,
            };
            // Insert after the opener.
            nodeToken.prev = found;
            nodeToken.next = closer;
            found.next = nodeToken;
            closer.prev = nodeToken;

            if (found.count === 0) remove(list, found);
            if (closer.count === 0) {
                const next = closer.next;
                remove(list, closer);
                current = next;
            }
            // else: keep processing the same closer (it may close another opener).
        } else {
            bottoms.set(key, closer.prev);
            if (!closer.canOpen) {
                // Never an opener: it stays literal; nothing more to do with it as a delimiter.
                const asText: TextToken = {
                    kind: 'text',
                    value: closer.ch.repeat(closer.count),
                    start: closer.start,
                    end: closer.end,
                    prev: closer.prev,
                    next: closer.next,
                };
                replace(list, closer, asText);
            }
            current = closer.next;
        }
    }
}

function replace(list: TokenList, oldToken: Token, newToken: Token): void {
    newToken.prev = oldToken.prev;
    newToken.next = oldToken.next;
    if (oldToken.prev) oldToken.prev.next = newToken;
    else list.head = newToken;
    if (oldToken.next) oldToken.next.prev = newToken;
    else list.tail = newToken;
}

function tokenToNodes(t: Token, state: State): PhrasingContent[] {
    if (t.kind === 'node') return [t.node];
    if (t.kind === 'text') return [withPosition(state, { type: 'text', value: t.value }, t.start, t.end)];
    if (t.count <= 0) return [];
    return [withPosition(state, { type: 'text', value: t.ch.repeat(t.count) }, t.start, t.end)];
}

// ---------------------------------------------------------------------------
// Finalisation
// ---------------------------------------------------------------------------

function finish(list: TokenList, state: State): PhrasingContent[] {
    const out: PhrasingContent[] = [];
    for (let t = list.head; t; t = t.next) out.push(...tokenToNodes(t, state));
    return coalesce(out);
}

/** Merge adjacent text nodes (merging positions); drop empty ones. */
function coalesce(nodes: PhrasingContent[]): PhrasingContent[] {
    const out: PhrasingContent[] = [];
    for (const node of nodes) {
        if (node.type === 'text') {
            if (node.value === '') continue;
            const last = out[out.length - 1];
            if (last && last.type === 'text') {
                last.value += node.value;
                if (last.position && node.position) last.position.end = node.position.end;
                continue;
            }
        }
        out.push(node);
    }
    return out;
}
