/**
 * The DOM side of the flat inline model, for ONE block: render an `InlineFlat`
 * into a contenteditable host, read the host back into a flat (tolerant of
 * whatever the browser did), and map UTF-16 offsets to DOM points and back.
 *
 * Ported from `@sigx/lynx-richtext`'s web element and reduced to a single
 * line: no block segmentation, hard breaks are `<br data-break>`, atoms are
 * `contenteditable=false` spans rendered by an atom renderer. A mark renders
 * as the element its spec names (`spec.html.tag` — `strong`, `em`, `del`,
 * `code`, `a`) and any mark without one as `span[data-mark]`; read-back also
 * accepts the spec's `aliases` (the tags browsers insert on their own: `b`,
 * `i`, `s`, `strike`). Nesting order on ties follows `spec.inline.priority`.
 */

import type { Schema } from '../../schema/index.js';
import { ATOM_CHAR, mergeAdjacent, normalizeSpans } from '../inline-flat.js';
import type { InlineFlat, InlineSpan } from '../inline-flat.js';

export const ATOM_ATTR = 'data-atom';
export const MARK_ATTR = 'data-mark';
export const BREAK_ATTR = 'data-break';
export const ATTRS_ATTR = 'data-attrs';

/** Renders an atom span into an element (the chip). Must return a single element; it is made non-editable. */
export type AtomRenderer = (span: InlineSpan, doc: Document) => HTMLElement;

export interface RenderOptions {
    atoms?: ReadonlyMap<string, AtomRenderer>;
    /** Fallback for atom types without a renderer. Default: a span showing the type. */
    defaultAtom?: AtomRenderer;
    /** The schema the mark elements come from (`spec.html.tag`, nesting by `spec.inline.priority`). Without it every mark is a `span[data-mark]`. */
    schema?: Schema;
}

const DEFAULT_PRIORITY = 99;

function markTag(schema: Schema | undefined, type: string): string | undefined {
    return schema?.get(type)?.html?.tag;
}

function priority(schema: Schema | undefined, type: string): number {
    return schema?.get(type)?.inline?.priority ?? DEFAULT_PRIORITY;
}

/** Tag (and alias) → mark type, per schema. */
const tagMaps = new WeakMap<Schema, ReadonlyMap<string, string>>();

function tagMap(schema: Schema | undefined): ReadonlyMap<string, string> {
    if (!schema) return new Map();
    let map = tagMaps.get(schema);
    if (!map) {
        const m = new Map<string, string>();
        for (const spec of schema.specs.values()) {
            if (spec.role !== 'mark' || !spec.html) continue;
            m.set(spec.html.tag, spec.type);
            for (const alias of spec.html.aliases ?? []) m.set(alias, spec.type);
        }
        map = m;
        tagMaps.set(schema, map);
    }
    return map;
}

function isAtomSpan(flat: InlineFlat, s: InlineSpan): boolean {
    return s.end - s.start === 1 && flat.text[s.start] === ATOM_CHAR;
}

export function defaultAtomRenderer(span: InlineSpan, d: Document): HTMLElement {
    const el = d.createElement('span');
    el.textContent = span.attrs?.label ?? span.attrs?.alt ?? span.type;
    return el;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Replace the host's children with the rendering of `flat`.
 *
 * Marks are opened and closed like tags over the text: at every position the
 * set of active marks is compared with the stack of open elements, the stack is
 * unwound to the common prefix and the remaining marks are opened (outer to
 * inner by priority, then by start). Properly nested marks therefore render as
 * nested elements and overlapping marks close and reopen.
 */
export function renderInline(host: HTMLElement, flat: InlineFlat, opts: RenderOptions = {}): void {
    const d = host.ownerDocument;
    const { schema } = opts;
    const frag = d.createDocumentFragment();
    const { text } = flat;
    const spans = normalizeSpans(flat.spans);
    const atoms = spans.filter((s) => isAtomSpan(flat, s));
    const marks = spans.filter((s) => !isAtomSpan(flat, s));

    const stack: { span: InlineSpan; el: HTMLElement }[] = [];
    const parent = (): Node => (stack.length ? stack[stack.length - 1].el : frag);

    let i = 0;
    while (i < text.length) {
        // Reconcile the open stack with the marks active here.
        const active = marksAt(marks, i, schema);
        let keep = 0;
        while (keep < stack.length && keep < active.length && sameMark(stack[keep].span, active[keep])) keep++;
        // Anything open beyond the prefix closes; an open mark not in `active` also forces everything above it to close.
        stack.length = keep;
        for (let k = keep; k < active.length; k++) {
            const el = markElement(active[k], d, schema);
            parent().appendChild(el);
            stack.push({ span: active[k], el });
        }

        const atom = atoms.find((s) => s.start === i);
        if (atom) {
            parent().appendChild(makeAtom(atom, d, opts));
            i++;
            continue;
        }
        if (text[i] === '\n') {
            const br = d.createElement('br');
            br.setAttribute(BREAK_ATTR, '');
            parent().appendChild(br);
            i++;
            continue;
        }
        // The longest run with the same marks, stopping at atoms and breaks.
        let j = i + 1;
        while (j < text.length && text[j] !== '\n' && !atoms.some((s) => s.start === j) && sameMarks(marksAt(marks, j, schema), active)) j++;
        parent().appendChild(d.createTextNode(text.slice(i, j)));
        i = j;
    }
    // An empty host still needs a caret slot; browsers collapse an empty contenteditable.
    if (text.length === 0 || text.endsWith('\n')) {
        const br = d.createElement('br');
        br.setAttribute('data-filler', '');
        frag.appendChild(br);
    }
    host.replaceChildren(frag);
}

function marksAt(marks: readonly InlineSpan[], at: number, schema: Schema | undefined): InlineSpan[] {
    return marks.filter((s) => s.start <= at && s.end > at).sort((a, b) => priority(schema, a.type) - priority(schema, b.type) || a.start - b.start || b.end - a.end);
}

function sameMark(a: InlineSpan, b: InlineSpan): boolean {
    return a.start === b.start && a.end === b.end && a.type === b.type && JSON.stringify(a.attrs ?? null) === JSON.stringify(b.attrs ?? null);
}

function sameMarks(a: readonly InlineSpan[], b: readonly InlineSpan[]): boolean {
    return a.length === b.length && a.every((s, k) => sameMark(s, b[k]));
}

function markElement(s: InlineSpan, d: Document, schema: Schema | undefined): HTMLElement {
    const tag = markTag(schema, s.type);
    if (tag === 'a') {
        // A link's attrs are real anchor attributes (the browser follows `href`; `data-url` keeps the raw value).
        const el = d.createElement('a');
        el.setAttribute('href', s.attrs?.url ?? '');
        el.setAttribute('data-url', s.attrs?.url ?? '');
        if (s.attrs?.title) el.setAttribute('title', s.attrs.title);
        if (s.attrs?.autolink === 'true') el.setAttribute('data-autolink', '');
        return el;
    }
    const el = d.createElement(tag ?? 'span');
    if (!tag) el.setAttribute(MARK_ATTR, s.type);
    if (s.attrs && Object.keys(s.attrs).length) el.setAttribute(ATTRS_ATTR, JSON.stringify(s.attrs));
    return el;
}

function makeAtom(span: InlineSpan, d: Document, opts: RenderOptions): HTMLElement {
    const render = opts.atoms?.get(span.type) ?? opts.defaultAtom ?? defaultAtomRenderer;
    let el: HTMLElement;
    try {
        el = render(span, d);
    } catch {
        el = defaultAtomRenderer(span, d);
    }
    el.setAttribute(ATOM_ATTR, span.type);
    el.setAttribute('contenteditable', 'false');
    if (span.attrs && Object.keys(span.attrs).length) el.setAttribute(ATTRS_ATTR, JSON.stringify(span.attrs));
    return el;
}

// ---------------------------------------------------------------------------
// Read back
// ---------------------------------------------------------------------------

/** Read the host's content back into a flat model. Tolerant: unknown elements are transparent; the schema's mark tags and their aliases are marks. */
export function readInline(host: HTMLElement, schema?: Schema): InlineFlat {
    const tags = tagMap(schema);
    let text = '';
    const spans: InlineSpan[] = [];
    const walk = (node: Node, active: InlineSpan[]): void => {
        if (node.nodeType === 3) {
            const s = node.textContent ?? '';
            if (!s) return;
            const at = text.length;
            for (const m of active) spans.push({ ...m, start: at, end: at + s.length });
            text += s;
            return;
        }
        if (node.nodeType !== 1) return;
        const el = node as HTMLElement;
        const atomType = el.getAttribute(ATOM_ATTR);
        if (atomType !== null) {
            const at = text.length;
            spans.push({ start: at, end: at + 1, type: atomType, attrs: readAttrs(el) });
            for (const m of active) spans.push({ ...m, start: at, end: at + 1 });
            text += ATOM_CHAR;
            return;
        }
        const tag = el.tagName.toLowerCase();
        if (tag === 'br') {
            if (el.hasAttribute('data-filler')) return;
            // A trailing <br> in an otherwise-empty host is browser filler, not a hard break.
            if (!el.nextSibling && !el.hasAttribute(BREAK_ATTR)) return;
            text += '\n';
            return;
        }
        let next = active;
        const type = tags.get(tag);
        if (type !== undefined && tag === 'a') {
            const url = el.getAttribute('data-url') ?? el.getAttribute('href') ?? '';
            const attrs: Record<string, string> = { url };
            const title = el.getAttribute('title');
            if (title) attrs.title = title;
            if (el.hasAttribute('data-autolink')) attrs.autolink = 'true';
            next = [...active.filter((m) => m.type !== type), { start: 0, end: 0, type, attrs }];
        } else if (type !== undefined) {
            if (!active.some((m) => m.type === type)) {
                const attrs = readAttrs(el);
                next = [...active, { start: 0, end: 0, type, ...(Object.keys(attrs).length ? { attrs } : {}) }];
            }
        } else {
            const markType = el.getAttribute(MARK_ATTR);
            if (markType !== null) {
                const attrs = readAttrs(el);
                next = [...active, { start: 0, end: 0, type: markType, ...(Object.keys(attrs).length ? { attrs } : {}) }];
            }
        }
        for (const child of Array.from(el.childNodes)) walk(child, next);
    };
    for (const child of Array.from(host.childNodes)) walk(child, []);
    return { text, spans: mergeAdjacent(spans, text, schema) };
}

function readAttrs(el: HTMLElement): Record<string, string> {
    const raw = el.getAttribute(ATTRS_ATTR);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
        return out;
    } catch {
        return {};
    }
}

// ---------------------------------------------------------------------------
// Offsets ↔ DOM points
// ---------------------------------------------------------------------------

export interface DomPoint {
    node: Node;
    offset: number;
}

function isAtom(el: HTMLElement): boolean {
    return el.hasAttribute(ATOM_ATTR);
}

function isBreak(el: HTMLElement): boolean {
    return el.tagName === 'BR' && !el.hasAttribute('data-filler') && (el.hasAttribute(BREAK_ATTR) || !!el.nextSibling);
}

/** Length in UTF-16 units of a node's contribution to the flat text. */
export function nodeLength(n: Node): number {
    if (n.nodeType === 3) return (n.textContent ?? '').length;
    if (n.nodeType !== 1) return 0;
    const el = n as HTMLElement;
    if (isAtom(el)) return 1;
    if (el.tagName === 'BR') return isBreak(el) ? 1 : 0;
    let len = 0;
    for (const c of Array.from(el.childNodes)) len += nodeLength(c);
    return len;
}

/** The DOM point for a flat offset. Atom boundaries resolve to the parent (before/after the chip). */
export function offsetToPoint(host: HTMLElement, target: number): DomPoint {
    let consumed = 0;
    let point: DomPoint | null = null;
    const visit = (node: Node): boolean => {
        if (node.nodeType === 3) {
            const len = (node.textContent ?? '').length;
            if (target <= consumed + len) {
                point = { node, offset: target - consumed };
                return true;
            }
            consumed += len;
            return false;
        }
        if (node.nodeType !== 1) return false;
        const el = node as HTMLElement;
        if (isAtom(el) || (el.tagName === 'BR' && isBreak(el))) {
            if (target <= consumed) {
                point = { node: el.parentNode ?? host, offset: indexOfChild(el) };
                return true;
            }
            consumed += 1;
            if (target === consumed) {
                point = { node: el.parentNode ?? host, offset: indexOfChild(el) + 1 };
                return true;
            }
            return false;
        }
        if (el.tagName === 'BR') return false;
        for (const c of Array.from(el.childNodes)) if (visit(c)) return true;
        return false;
    };
    for (const c of Array.from(host.childNodes)) if (visit(c)) break;
    if (!point) {
        // Past the end (or an empty host): after the last content node, before any filler <br>.
        const kids = Array.from(host.childNodes);
        let idx = kids.length;
        while (idx > 0 && kids[idx - 1].nodeType === 1 && (kids[idx - 1] as HTMLElement).hasAttribute('data-filler')) idx--;
        point = { node: host, offset: idx };
    }
    return point;
}

function indexOfChild(el: Node): number {
    let i = 0;
    let n = el.previousSibling;
    while (n) {
        i++;
        n = n.previousSibling;
    }
    return i;
}

/** The flat offset of a DOM point inside the host. Points outside the host clamp to 0 / length. */
export function pointToOffset(host: HTMLElement, node: Node, nodeOffset: number): number {
    if (node !== host && !host.contains(node)) return 0;
    if (node === host) {
        let len = 0;
        for (const k of Array.from(host.childNodes).slice(0, nodeOffset)) len += nodeLength(k);
        return len;
    }
    let len = 0;
    let done = false;
    const visit = (n: Node): void => {
        if (done) return;
        if (n === node) {
            if (n.nodeType === 3) len += Math.min(nodeOffset, (n.textContent ?? '').length);
            else for (const k of Array.from(n.childNodes).slice(0, nodeOffset)) len += nodeLength(k);
            done = true;
            return;
        }
        if (n.nodeType === 3) {
            len += (n.textContent ?? '').length;
            return;
        }
        if (n.nodeType !== 1) return;
        const el = n as HTMLElement;
        if (isAtom(el) || el.tagName === 'BR') {
            // A point inside an atom counts as after it.
            if (el.contains(node)) {
                len += nodeLength(el);
                done = true;
                return;
            }
            len += nodeLength(el);
            return;
        }
        for (const c of Array.from(el.childNodes)) visit(c);
    };
    for (const c of Array.from(host.childNodes)) visit(c);
    return len;
}

/** The flat text length of the host. */
export function hostLength(host: HTMLElement): number {
    let len = 0;
    for (const c of Array.from(host.childNodes)) len += nodeLength(c);
    return len;
}
