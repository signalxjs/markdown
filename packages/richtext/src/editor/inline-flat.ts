/**
 * `InlineFlat` — the flat inline model the editor core and its surfaces speak.
 *
 * A text block (paragraph, heading, table cell) is edited as a run of text
 * plus a set of ranged marks and atoms, because that is what every real text
 * surface is: a DOM `contenteditable`, a native attributed string, a terminal
 * buffer. The tree form (`PhrasingContent[]`) is the document's truth; this
 * module converts losslessly in both directions, driven by the schema's
 * inline specs:
 *
 *  - marks (role `mark`) are `{ start, end }` ranges in UTF-16 code units,
 *    and may overlap freely — `toInline()` re-nests them by extent (the
 *    ProseMirror serializer trick) so the tree is always properly nested;
 *  - a literal mark (`inline.literal`, e.g. inline code) carries its own
 *    `value`; nothing nests inside it except `wrapsLiteral` marks;
 *  - atoms (role `atom`) occupy exactly one U+FFFC (object replacement
 *    character) and carry their node in `attrs`;
 *  - a hard break (`inline.kind === 'break'`) is a `\n` in the text.
 *
 * A type the schema does not know is a mark when the node has children and
 * an atom otherwise, and a span of such a type is an atom only when it covers
 * exactly one U+FFFC — so an unregistered plugin node still round-trips.
 *
 * `flatEquals()` is the echo guard: a surface pushing back exactly what it
 * was given is a no-op transaction.
 */

import type { Node, PhrasingContent } from '../ast/index.js';
import type { InlineFlat, InlineSpan, Schema } from '../schema/index.js';
import { ATOM_CHAR, inlineAttrsOf, phrasingText } from '../schema/index.js';

export type { InlineFlat, InlineSpan } from '../schema/index.js';
export { ATOM_CHAR } from '../schema/index.js';

type Kind = 'text' | 'break' | 'mark' | 'literal' | 'atom';

function kindOf(node: PhrasingContent, schema: Schema): Kind {
    const spec = schema.get(node.type);
    if (spec) {
        if (spec.role === 'inline') return spec.inline?.kind === 'break' ? 'break' : 'text';
        if (spec.role === 'mark') return spec.inline?.literal ? 'literal' : 'mark';
        if (spec.role === 'atom') return 'atom';
    }
    return Array.isArray((node as { children?: unknown }).children) ? 'mark' : 'atom';
}

function isLiteral(type: string, schema: Schema): boolean {
    return schema.get(type)?.inline?.literal === true;
}

function wrapsLiteral(type: string, schema: Schema): boolean {
    return schema.get(type)?.inline?.wrapsLiteral === true;
}

function priority(type: string, schema: Schema): number {
    return schema.get(type)?.inline?.priority ?? 99;
}

function attrsOf(node: PhrasingContent, schema: Schema): Record<string, string> {
    return (schema.get(node.type)?.inline?.toFlat ?? inlineAttrsOf)(node);
}

// ---------------------------------------------------------------------------
// tree → flat
// ---------------------------------------------------------------------------

/** Flatten phrasing content into text + spans. */
export function toFlat(nodes: readonly PhrasingContent[], schema: Schema): InlineFlat {
    let text = '';
    const spans: InlineSpan[] = [];

    const walk = (list: readonly PhrasingContent[]): void => {
        for (const node of list) {
            switch (kindOf(node, schema)) {
                case 'text':
                    text += (node as { value: string }).value;
                    break;
                case 'break':
                    text += '\n';
                    break;
                case 'literal': {
                    const span: InlineSpan = { start: text.length, end: text.length, type: node.type };
                    text += (node as { value: string }).value;
                    span.end = text.length;
                    const attrs = attrsOf(node, schema);
                    if (Object.keys(attrs).length) span.attrs = attrs;
                    spans.push(span);
                    break;
                }
                case 'mark': {
                    // Pushed BEFORE the children so insertion order records the
                    // nesting (outer first); `toInline` uses it to break extent ties.
                    const span: InlineSpan = { start: text.length, end: text.length, type: node.type };
                    const attrs = attrsOf(node, schema);
                    if (Object.keys(attrs).length) span.attrs = attrs;
                    spans.push(span);
                    walk((node as { children: PhrasingContent[] }).children);
                    span.end = text.length;
                    break;
                }
                case 'atom': {
                    const start = text.length;
                    text += ATOM_CHAR;
                    spans.push({ start, end: start + 1, type: node.type, attrs: attrsOf(node, schema) });
                    break;
                }
            }
        }
    };
    walk(nodes);
    return { text, spans: mergeAdjacent(normalizeSpans(spans), text, schema) };
}

/**
 * Merge touching or overlapping marks of the same type and attrs — the
 * canonical form, so `strong(a) emphasis(strong(bc) d)` and
 * `strong(a b c) emphasis(b c d)` compare equal. Atoms never merge. Without
 * a schema, any one-character span over U+FFFC counts as an atom.
 */
export function mergeAdjacent(spans: readonly InlineSpan[], text: string, schema?: Schema): InlineSpan[] {
    const out: InlineSpan[] = [];
    for (const s of normalizeSpans(spans)) {
        const prev = looksLikeAtom(s, text, schema) ? undefined : out.find((p) => p.type === s.type && p.end >= s.start && sameAttrs(p.attrs, s.attrs) && !looksLikeAtom(p, text, schema));
        if (prev) {
            prev.end = Math.max(prev.end, s.end);
            continue;
        }
        out.push({ ...s });
    }
    return normalizeSpans(out);
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
export function toInline(flat: InlineFlat, schema: Schema): PhrasingContent[] {
    const { text } = flat;
    const spans = normalizeSpans(flat.spans);
    const atoms = spans.filter((s) => isAtomSpan(s, text, schema));
    const marks = spans.filter((s) => !isAtomSpan(s, text, schema));

    // Boundaries: every span edge, every atom, every hard break.
    const points = new Set<number>([0, text.length]);
    for (const s of spans) {
        points.add(s.start);
        points.add(s.end);
    }
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            points.add(i);
            points.add(i + 1);
        }
    }
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
        // Inside a literal, nothing else applies except a mark that may wrap it.
        if (active.some((s) => isLiteral(s.type, schema))) active = active.filter((s) => isLiteral(s.type, schema) || wrapsLiteral(s.type, schema));
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
        const spec = schema.get(span.type);
        if (spec?.inline?.fromFlat) return spec.inline.fromFlat(span, children);
        if (spec?.inline?.literal) return { type: span.type, ...span.attrs, value: phrasingText(children) } as unknown as PhrasingContent;
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
            // A literal is terminal: it always sits innermost, whatever the recorded nesting.
            const xLit = isLiteral(x.type, schema);
            const yLit = isLiteral(y.type, schema);
            if (xLit !== yLit) return xLit ? 1 : -1;
            return marks.indexOf(x) - marks.indexOf(y) || priority(x.type, schema) - priority(y.type, schema);
        });
        let keep = 0;
        while (keep < stack.length && keep < desired.length && stack[keep].span === desired[keep]) keep++;
        closeTo(keep);
        for (let j = keep; j < desired.length; j++) stack.push({ span: desired[j], children: [] });

        const atom = atoms.find((s) => s.start === run.start && s.end === run.end);
        if (atom) {
            top().push(atomNode(atom, schema));
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

/** A one-char span over U+FFFC is an atom unless the schema says its type is a mark (a mark may cover exactly one atom). */
function looksLikeAtom(span: InlineSpan, text: string, schema?: Schema): boolean {
    return span.end - span.start === 1 && text[span.start] === ATOM_CHAR && schema?.role(span.type) !== 'mark';
}

/** Atom by role; for a type the schema does not know, only a one-character span over U+FFFC (an unknown mark over a single letter stays a mark). */
function isAtomSpan(span: InlineSpan, text: string, schema: Schema): boolean {
    const role = schema.role(span.type);
    if (role === 'atom') return true;
    if (role === 'mark') return false;
    return span.end - span.start === 1 && text[span.start] === ATOM_CHAR;
}

function atomNode(span: InlineSpan, schema: Schema): PhrasingContent {
    const fromFlat = schema.get(span.type)?.inline?.fromFlat;
    if (fromFlat) return fromFlat(span, []);
    return { type: span.type, ...span.attrs } as unknown as PhrasingContent;
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
export function flatEquals(a: InlineFlat, b: InlineFlat, schema?: Schema): boolean {
    if (a === b) return true;
    if (a.text !== b.text) return false;
    const byType = (x: InlineSpan, y: InlineSpan) => x.start - y.start || y.end - x.end || x.type.localeCompare(y.type);
    const sa = mergeAdjacent(a.spans, a.text, schema).sort(byType);
    const sb = mergeAdjacent(b.spans, b.text, schema).sort(byType);
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

/**
 * Replace `[from, to)` with `slice`. Exact and invertible: a mark strictly
 * inside the range is dropped, one that straddles both edges grows over the
 * inserted text, one that overlaps an edge is clipped to its outside part,
 * and the inserted text carries only the marks `slice.spans` give it (a
 * command that wants typed text to inherit marks passes them explicitly —
 * see `marksAt`). Atoms inside the range are removed. The inverse is the
 * same splice with the removed text and its clipped spans (`sliceFlat`).
 */
export function spliceFlat(flat: InlineFlat, from: number, to: number, slice: InlineFlat, schema?: Schema): InlineFlat {
    const delta = slice.text.length - (to - from);
    const text = flat.text.slice(0, from) + slice.text + flat.text.slice(to);
    const spans: InlineSpan[] = [];
    for (const s of flat.spans) {
        if (s.end <= from) {
            spans.push({ ...s });
        } else if (s.start >= to) {
            spans.push({ ...s, start: s.start + delta, end: s.end + delta });
        } else if (s.start < from && s.end > to) {
            spans.push({ ...s, end: s.end + delta });
        } else if (s.start < from) {
            spans.push({ ...s, end: from });
        } else if (s.end > to) {
            spans.push({ ...s, start: from + slice.text.length, end: s.end + delta });
        }
        // else: inside the range (incl. atoms) — dropped.
    }
    for (const s of slice.spans) spans.push({ ...s, start: s.start + from, end: s.end + from });
    return { text, spans: mergeAdjacent(spans, text, schema) };
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
export function marksAt(flat: InlineFlat, start: number, end = start, schema?: Schema): string[] {
    const types = new Set<string>();
    for (const s of flat.spans) {
        if (looksLikeAtom(s, flat.text, schema)) continue;
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

/** Whether a node is phrasing content the flat model can hold (an `inline`, `mark` or `atom` role). */
export function isPhrasingNode(node: Node, schema: Schema): boolean {
    const role = schema.role(node.type);
    return role === 'inline' || role === 'mark' || role === 'atom';
}
