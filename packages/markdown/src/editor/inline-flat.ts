/**
 * `InlineFlat` — the flat inline model the editor core and its surfaces speak.
 *
 * An inline container (paragraph, heading, table cell) is edited as a run of
 * text plus a set of ranged marks and atoms, because that is what every real
 * text surface is: a DOM `contenteditable`, a native attributed string, a
 * terminal buffer. The tree form (`PhrasingContent[]`) is the document's
 * truth; this module converts losslessly in both directions:
 *
 *  - marks (`strong`, `emphasis`, `delete`, `inlineCode`, `link`, plugin
 *    marks) are `{ start, end }` ranges in UTF-16 code units, and may overlap
 *    freely — `toInline()` re-nests them by extent (the ProseMirror
 *    serializer trick) so the tree is always properly nested;
 *  - atoms (`image`, plugin atoms such as `mention`) occupy exactly one
 *    U+FFFC (object replacement character) and carry their node in `attrs`;
 *  - a hard break is a `\n` in the text (paragraphs only; `toInline` turns it
 *    into a `break` node).
 *
 * `flatEquals()` is the echo guard: a surface pushing back exactly what it
 * was given is a no-op transaction.
 */

import type { Node, PhrasingContent } from '../ast/index.js';

export const ATOM_CHAR = '￼';

export interface InlineSpan {
    /** Inclusive start, UTF-16 code units. */
    start: number;
    /** Exclusive end. */
    end: number;
    /** Mark or atom type: an mdast phrasing type or a plugin node type. */
    type: string;
    /** Type-specific payload: `url`/`title` for links, `url`/`alt`/`title` for images, plugin fields. */
    attrs?: Record<string, string>;
}

export interface InlineFlat {
    text: string;
    spans: InlineSpan[];
}

/** How a plugin inline node type maps onto the flat model. */
export interface InlineKindSpec {
    type: string;
    kind: 'mark' | 'atom';
    /** Atom: build the node back from its attrs. Mark: build the wrapper (children filled by the converter). */
    fromFlat?: (span: InlineSpan, children: PhrasingContent[]) => PhrasingContent;
    /** Extract the attrs a node carries (default: every string-valued own property except `type`, `children`, `position`). */
    toFlat?: (node: PhrasingContent) => Record<string, string>;
}

export interface InlineFlatOptions {
    /** Plugin inline node kinds. Unknown node types with `children` are treated as marks, leaf types as atoms. */
    kinds?: ReadonlyMap<string, InlineKindSpec>;
}

const BUILTIN_MARKS = new Set(['strong', 'emphasis', 'delete', 'inlineCode', 'link']);
const BUILTIN_ATOMS = new Set(['image', 'imageReference', 'linkReference']);

/** Outer-to-inner nesting priority when extents tie (lower sits outermost). */
const PRIORITY: Record<string, number> = { link: 0, inlineCode: 1, strong: 2, emphasis: 3, delete: 4 };
function priority(type: string): number {
    return PRIORITY[type] ?? 99;
}

function kindOf(node: PhrasingContent, opts?: InlineFlatOptions): 'mark' | 'atom' | 'text' | 'break' | 'code' {
    if (node.type === 'text') return 'text';
    if (node.type === 'break') return 'break';
    if (node.type === 'inlineCode') return 'code';
    if (BUILTIN_MARKS.has(node.type)) return 'mark';
    if (BUILTIN_ATOMS.has(node.type)) return 'atom';
    const spec = opts?.kinds?.get(node.type);
    if (spec) return spec.kind;
    return Array.isArray((node as { children?: unknown }).children) ? 'mark' : 'atom';
}

function defaultAttrs(node: PhrasingContent): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(node as unknown as Record<string, unknown>)) {
        if (k === 'type' || k === 'children' || k === 'position' || k === 'data' || k === 'key') continue;
        if (typeof v === 'string') attrs[k] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') attrs[k] = String(v);
    }
    return attrs;
}

// ---------------------------------------------------------------------------
// tree → flat
// ---------------------------------------------------------------------------

/** Flatten phrasing content into text + spans. */
export function toFlat(nodes: readonly PhrasingContent[], opts?: InlineFlatOptions): InlineFlat {
    let text = '';
    const spans: InlineSpan[] = [];

    const walk = (list: readonly PhrasingContent[]): void => {
        for (const node of list) {
            switch (kindOf(node, opts)) {
                case 'text':
                    text += (node as { value: string }).value;
                    break;
                case 'break':
                    text += '\n';
                    break;
                case 'code': {
                    const start = text.length;
                    text += (node as { value: string }).value;
                    spans.push({ start, end: text.length, type: 'inlineCode' });
                    break;
                }
                case 'mark': {
                    // Pushed BEFORE the children so insertion order records the
                    // nesting (outer first); `toInline` uses it to break extent ties.
                    const span: InlineSpan = { start: text.length, end: text.length, type: node.type };
                    const attrs = (opts?.kinds?.get(node.type)?.toFlat ?? defaultAttrs)(node);
                    if (Object.keys(attrs).length) span.attrs = attrs;
                    spans.push(span);
                    walk((node as { children: PhrasingContent[] }).children);
                    span.end = text.length;
                    break;
                }
                case 'atom': {
                    const start = text.length;
                    text += ATOM_CHAR;
                    const attrs = (opts?.kinds?.get(node.type)?.toFlat ?? defaultAttrs)(node);
                    // Reference-style nodes keep their label text as `alt`/`label` attrs already.
                    if (node.type === 'linkReference') attrs.text = plainText((node as { children: PhrasingContent[] }).children);
                    spans.push({ start, end: start + 1, type: node.type, attrs });
                    break;
                }
            }
        }
    };
    walk(nodes);
    return { text, spans: mergeAdjacent(normalizeSpans(spans), text) };
}

/**
 * Merge touching or overlapping marks of the same type and attrs — the
 * canonical form, so `strong(a) emphasis(strong(bc) d)` and
 * `strong(a b c) emphasis(b c d)` compare equal. Atoms never merge.
 */
export function mergeAdjacent(spans: readonly InlineSpan[], text: string): InlineSpan[] {
    const out: InlineSpan[] = [];
    for (const s of normalizeSpans(spans)) {
        const isAtom = s.end - s.start === 1 && text[s.start] === ATOM_CHAR;
        const prev = isAtom ? undefined : out.find((p) => p.type === s.type && p.end >= s.start && sameAttrs(p.attrs, s.attrs) && !(p.end - p.start === 1 && text[p.start] === ATOM_CHAR));
        if (prev) {
            prev.end = Math.max(prev.end, s.end);
            continue;
        }
        out.push({ ...s });
    }
    return normalizeSpans(out);
}

function plainText(nodes: readonly PhrasingContent[]): string {
    let out = '';
    for (const n of nodes) {
        if ('value' in n && typeof (n as { value: unknown }).value === 'string') out += (n as { value: string }).value;
        else if (Array.isArray((n as { children?: unknown }).children)) out += plainText((n as { children: PhrasingContent[] }).children);
    }
    return out;
}

/**
 * Sort spans by start, then longer first; equal extents keep their insertion
 * order (outer before inner), which is how nesting survives a round trip.
 */
export function normalizeSpans(spans: readonly InlineSpan[]): InlineSpan[] {
    return spans
        .filter((s) => s.end > s.start)
        .map((s) => ({ ...s }))
        .sort((a, b) => a.start - b.start || b.end - a.end);
}

// ---------------------------------------------------------------------------
// flat → tree
// ---------------------------------------------------------------------------

/** Rebuild properly nested phrasing content from a flat model. */
export function toInline(flat: InlineFlat, opts?: InlineFlatOptions): PhrasingContent[] {
    const { text } = flat;
    const spans = normalizeSpans(flat.spans);
    const atoms = spans.filter((s) => isAtomSpan(s, opts));
    const marks = spans.filter((s) => !isAtomSpan(s, opts));

    // Boundaries: every span edge, every atom, every hard break.
    const points = new Set<number>([0, text.length]);
    for (const s of spans) {
        points.add(s.start);
        points.add(s.end);
    }
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') points.add(i), points.add(i + 1);
    const sorted = [...points].sort((a, b) => a - b);

    interface Run {
        start: number;
        end: number;
        active: InlineSpan[];
    }
    const runs: Run[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (b <= a) continue;
        let active = marks.filter((s) => s.start <= a && s.end >= b);
        // Inside code, nothing else applies except an enclosing link.
        if (active.some((s) => s.type === 'inlineCode')) active = active.filter((s) => s.type === 'inlineCode' || s.type === 'link');
        runs.push({ start: a, end: b, active });
    }

    // Extent-aware ordering: for each run, the mark that stays active longest
    // (through following contiguous runs) sits outermost.
    const contEnd: Map<InlineSpan, number>[] = [];
    for (let i = runs.length - 1; i >= 0; i--) {
        const map = new Map<InlineSpan, number>();
        for (const m of runs[i].active) {
            const next = i + 1 < runs.length ? contEnd[i + 1].get(m) : undefined;
            map.set(m, next !== undefined ? next : runs[i].end);
        }
        contEnd[i] = map;
    }

    const root: PhrasingContent[] = [];
    const stack: { span: InlineSpan; children: PhrasingContent[] }[] = [];
    const top = (): PhrasingContent[] => (stack.length ? stack[stack.length - 1].children : root);
    const build = (span: InlineSpan, children: PhrasingContent[]): PhrasingContent => {
        const spec = opts?.kinds?.get(span.type);
        if (spec?.fromFlat) return spec.fromFlat(span, children);
        if (span.type === 'inlineCode') return { type: 'inlineCode', value: plainText(children) };
        if (span.type === 'link') {
            const node: PhrasingContent = { type: 'link', url: span.attrs?.url ?? '', children };
            if (span.attrs?.title !== undefined) (node as { title?: string }).title = span.attrs.title;
            return node;
        }
        return { type: span.type, ...span.attrs, children } as unknown as PhrasingContent;
    };
    const closeTo = (keep: number): void => {
        while (stack.length > keep) {
            const { span, children } = stack.pop()!;
            top().push(build(span, children));
        }
    };

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const desired = [...run.active].sort((x, y) => {
            const ex = contEnd[i].get(x) ?? run.end;
            const ey = contEnd[i].get(y) ?? run.end;
            if (ey !== ex) return ey - ex;
            // Code is terminal: it always sits innermost, whatever the recorded nesting.
            const xCode = x.type === 'inlineCode';
            const yCode = y.type === 'inlineCode';
            if (xCode !== yCode) return xCode ? 1 : -1;
            return marks.indexOf(x) - marks.indexOf(y) || priority(x.type) - priority(y.type);
        });
        let keep = 0;
        while (keep < stack.length && keep < desired.length && stack[keep].span === desired[keep]) keep++;
        closeTo(keep);
        for (let j = keep; j < desired.length; j++) stack.push({ span: desired[j], children: [] });

        const atom = atoms.find((s) => s.start === run.start && s.end === run.end);
        if (atom) {
            top().push(atomNode(atom, opts));
            continue;
        }
        const slice = text.slice(run.start, run.end);
        if (slice === '\n') {
            top().push({ type: 'break' });
            continue;
        }
        pushText(top(), slice);
    }
    closeTo(0);
    return root;
}

function isAtomSpan(span: InlineSpan, opts?: InlineFlatOptions): boolean {
    if (BUILTIN_ATOMS.has(span.type)) return true;
    const spec = opts?.kinds?.get(span.type);
    if (spec) return spec.kind === 'atom';
    return span.end - span.start === 1 && !BUILTIN_MARKS.has(span.type);
}

function atomNode(span: InlineSpan, opts?: InlineFlatOptions): PhrasingContent {
    const spec = opts?.kinds?.get(span.type);
    if (spec?.fromFlat) return spec.fromFlat(span, []);
    const attrs = span.attrs ?? {};
    if (span.type === 'image') {
        const node: PhrasingContent = { type: 'image', url: attrs.url ?? '', alt: attrs.alt ?? '' };
        if (attrs.title !== undefined) (node as { title?: string }).title = attrs.title;
        return node;
    }
    if (span.type === 'linkReference') {
        return {
            type: 'linkReference',
            identifier: attrs.identifier ?? '',
            label: attrs.label ?? attrs.identifier ?? '',
            referenceType: (attrs.referenceType as 'shortcut' | 'collapsed' | 'full') ?? 'shortcut',
            children: [{ type: 'text', value: attrs.text ?? attrs.label ?? '' }],
        };
    }
    if (span.type === 'imageReference') {
        return {
            type: 'imageReference',
            identifier: attrs.identifier ?? '',
            label: attrs.label ?? attrs.identifier ?? '',
            referenceType: (attrs.referenceType as 'shortcut' | 'collapsed' | 'full') ?? 'shortcut',
            alt: attrs.alt ?? '',
        };
    }
    return { type: span.type, ...attrs } as unknown as PhrasingContent;
}

function pushText(list: PhrasingContent[], value: string): void {
    if (!value) return;
    const last = list[list.length - 1];
    if (last && last.type === 'text') {
        (last as { value: string }).value += value;
        return;
    }
    list.push({ type: 'text', value });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Structural equality of two flat models (text and normalised spans). */
export function flatEquals(a: InlineFlat, b: InlineFlat): boolean {
    if (a === b) return true;
    if (a.text !== b.text) return false;
    const byType = (x: InlineSpan, y: InlineSpan) => x.start - y.start || y.end - x.end || x.type.localeCompare(y.type);
    const sa = mergeAdjacent(a.spans, a.text).sort(byType);
    const sb = mergeAdjacent(b.spans, b.text).sort(byType);
    if (sa.length !== sb.length) return false;
    for (let i = 0; i < sa.length; i++) {
        const x = sa[i];
        const y = sb[i];
        if (x.start !== y.start || x.end !== y.end || x.type !== y.type) return false;
        const ax = x.attrs ?? {};
        const ay = y.attrs ?? {};
        const keys = Object.keys(ax);
        if (keys.length !== Object.keys(ay).length) return false;
        for (const k of keys) if (ax[k] !== ay[k]) return false;
    }
    return true;
}

/** Replace `[from, to)` with `slice`, shifting and splitting spans as a text editor would. */
export function spliceFlat(flat: InlineFlat, from: number, to: number, slice: InlineFlat): InlineFlat {
    const delta = slice.text.length - (to - from);
    const text = flat.text.slice(0, from) + slice.text + flat.text.slice(to);
    const spans: InlineSpan[] = [];
    for (const s of flat.spans) {
        if (s.end <= from) {
            spans.push({ ...s });
        } else if (s.start >= to) {
            spans.push({ ...s, start: s.start + delta, end: s.end + delta });
        } else {
            // Overlaps the replaced range. Marks shrink/grow around it; atoms inside it are removed.
            const isAtom = s.end - s.start === 1 && flat.text[s.start] === ATOM_CHAR;
            if (isAtom) continue;
            // A mark that started before the range keeps its head (and grows over
            // the inserted text); one that started inside it is cut to the tail.
            const ns = s.start < from ? s.start : from + slice.text.length;
            const ne = s.end > to ? s.end + delta : from + (s.start < from ? slice.text.length : 0);
            if (ne > ns) spans.push({ ...s, start: ns, end: ne });
        }
    }
    for (const s of slice.spans) spans.push({ ...s, start: s.start + from, end: s.end + from });
    return { text, spans: normalizeSpans(spans) };
}

/** Slice `[from, to)` out as its own flat model (spans clipped and re-based). */
export function sliceFlat(flat: InlineFlat, from: number, to: number): InlineFlat {
    const text = flat.text.slice(from, to);
    const spans: InlineSpan[] = [];
    for (const s of flat.spans) {
        const start = Math.max(s.start, from);
        const end = Math.min(s.end, to);
        if (end > start) spans.push({ ...s, start: start - from, end: end - from });
    }
    return { text, spans: normalizeSpans(spans) };
}

/** Concatenate two flat models. */
export function concatFlat(a: InlineFlat, b: InlineFlat): InlineFlat {
    const offset = a.text.length;
    return {
        text: a.text + b.text,
        spans: normalizeSpans([...a.spans, ...b.spans.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }))]),
    };
}

/** The marks active at a collapsed caret (a mark covering `[offset-1, offset]`, or wrapping the range). */
export function marksAt(flat: InlineFlat, start: number, end = start): string[] {
    const types = new Set<string>();
    for (const s of flat.spans) {
        if (s.end - s.start === 1 && flat.text[s.start] === ATOM_CHAR) continue;
        const covers = start === end ? s.start < start && s.end >= start : s.start <= start && s.end >= end;
        if (covers) types.add(s.type);
    }
    return [...types];
}

/** Toggle a mark over a range: on when not fully covered, off when it is. */
export function toggleMark(flat: InlineFlat, type: string, start: number, end: number, attrs?: Record<string, string>): InlineFlat {
    if (end <= start) return flat;
    const covered = flat.spans.some((s) => s.type === type && s.start <= start && s.end >= end);
    return covered ? removeMark(flat, type, start, end) : addMark(flat, type, start, end, attrs);
}

export function addMark(flat: InlineFlat, type: string, start: number, end: number, attrs?: Record<string, string>): InlineFlat {
    const rest = flat.spans.filter((s) => s.type !== type || s.end <= start || s.start >= end);
    // Merge with touching/overlapping spans of the same type and attrs.
    let ns = start;
    let ne = end;
    for (const s of flat.spans) {
        if (s.type !== type || s.end < start || s.start > end) continue;
        if (!sameAttrs(s.attrs, attrs)) continue;
        ns = Math.min(ns, s.start);
        ne = Math.max(ne, s.end);
    }
    const span: InlineSpan = { start: ns, end: ne, type };
    if (attrs && Object.keys(attrs).length) span.attrs = attrs;
    return { text: flat.text, spans: normalizeSpans([...rest.filter((s) => !(s.type === type && s.start >= ns && s.end <= ne)), span]) };
}

export function removeMark(flat: InlineFlat, type: string, start: number, end: number): InlineFlat {
    const spans: InlineSpan[] = [];
    for (const s of flat.spans) {
        if (s.type !== type || s.end <= start || s.start >= end) {
            spans.push(s);
            continue;
        }
        if (s.start < start) spans.push({ ...s, end: start });
        if (s.end > end) spans.push({ ...s, start: end });
    }
    return { text: flat.text, spans: normalizeSpans(spans) };
}

function sameAttrs(a?: Record<string, string>, b?: Record<string, string>): boolean {
    const ka = Object.keys(a ?? {});
    const kb = Object.keys(b ?? {});
    if (ka.length !== kb.length) return false;
    return ka.every((k) => a![k] === b![k]);
}

/** Whether a node type is inline content the flat model can hold. */
export function isPhrasingNode(node: Node): boolean {
    return node.type === 'text' || node.type === 'break' || BUILTIN_MARKS.has(node.type) || BUILTIN_ATOMS.has(node.type);
}
