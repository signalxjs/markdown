/**
 * `FakeInlineSurface` / `FakeCodeSurface` — in-memory surfaces for tests of
 * the editor core and of views. They record every command the core sends,
 * hold a flat model + selection like a real surface would, and expose a
 * driver that simulates what a user does (type, press boundary keys,
 * compose) by raising the same events a platform surface would raise.
 */

import type { InlineFlat } from '../editor/inline-flat.js';
import { flatEquals, spliceFlat } from '../editor/inline-flat.js';
import type {
    BoundaryKey,
    CaretRect,
    CodeSurface,
    CodeSurfaceInit,
    InlineSurface,
    InlineSurfaceInit,
    Range,
} from '../editor/surface.js';

export interface SurfaceCall {
    method: string;
    args: unknown[];
}

export interface FakeInlineSurface extends InlineSurface {
    readonly key: string;
    readonly calls: SurfaceCall[];
    /** The events the core registered (drive them to simulate the user). */
    readonly events: InlineSurfaceInit['events'];
    readonly focusedFlag: boolean;
    /** Simulate typing `text` at the current selection (replacing it), reporting a minimal `replaced` diff. */
    type(text: string): void;
    /** Simulate a deletion of `[from, to)` (Backspace inside the block). */
    deleteRange(from: number, to: number): void;
    /** Simulate a boundary key at the current selection; returns whether the core consumed it. */
    press(key: BoundaryKey, goalX?: number): boolean;
    /** Simulate an IME session: start, provisional updates (whole-content), end with the committed text. */
    compose(updates: string[], committed: string): void;
    /** Simulate a paste. */
    paste(text: string, markdown?: string): boolean;
    /** Place the caret / selection (raising `selection`). */
    select(start: number, end?: number): void;
    /** Clear the recorded calls. */
    reset(): void;
}

export function createFakeInlineSurface(init: InlineSurfaceInit): FakeInlineSurface {
    let flat: InlineFlat = init.flat;
    let selection: Range | null = null;
    let composing = false;
    let readOnly = init.readOnly;
    let focused = false;
    const calls: SurfaceCall[] = [];
    const record = (method: string, ...args: unknown[]): void => {
        calls.push({ method, args });
    };
    const sel = (): Range => selection ?? { start: flat.text.length, end: flat.text.length };

    const surface: FakeInlineSurface = {
        key: init.key,
        calls,
        events: init.events,
        get focusedFlag() {
            return focused;
        },
        setInline(next, opts) {
            record('setInline', next, opts);
            if (flatEquals(flat, next)) return;
            flat = next;
            if (selection) selection = { start: Math.min(selection.start, flat.text.length), end: Math.min(selection.end, flat.text.length) };
        },
        setAttrs(blockType, attrs) {
            record('setAttrs', blockType, attrs);
        },
        setSelection(range) {
            record('setSelection', range);
            selection = { ...range };
        },
        focus(target) {
            record('focus', target);
            focused = true;
            if (target && 'offset' in target) selection = { start: target.offset, end: target.offset };
            else if (target && 'edge' in target) {
                const o = target.edge === 'start' ? 0 : flat.text.length;
                selection = { start: o, end: o };
            } else if (target && 'line' in target) {
                const o = target.line === 'first' ? Math.min(target.x, flat.text.length) : flat.text.length;
                selection = { start: o, end: o };
            }
            init.events.focus();
        },
        blur() {
            record('blur');
            focused = false;
            init.events.blur();
        },
        getFlat: () => flat,
        getSelection: () => selection,
        caretRect: (): CaretRect | null => (selection ? { x: selection.end * 8, y: 0, height: 16 } : null),
        offsetAtX: (line, x) => (line === 'first' ? Math.min(Math.round(x / 8), flat.text.length) : flat.text.length),
        isComposing: () => composing,
        setReadOnly(v) {
            record('setReadOnly', v);
            readOnly = v;
        },
        setPlaceholder(p) {
            record('setPlaceholder', p);
        },
        destroy() {
            record('destroy');
        },

        // -- driver ---------------------------------------------------------------
        type(text) {
            if (readOnly) return;
            const { start, end } = sel();
            flat = spliceFlat(flat, start, end, { text, spans: [] });
            selection = { start: start + text.length, end: start + text.length };
            init.events.change({ flat, selection, composing, replaced: { from: start, to: end, insert: { text, spans: [] } } });
        },
        deleteRange(from, to) {
            flat = spliceFlat(flat, from, to, { text: '', spans: [] });
            selection = { start: from, end: from };
            init.events.change({ flat, selection, composing, replaced: { from, to, insert: { text: '', spans: [] } } });
        },
        press(key, goalX) {
            return init.events.boundary({ key, range: sel(), goalX });
        },
        compose(updates, committed) {
            const { start, end } = sel();
            composing = true;
            init.events.compositionStart();
            let cur = flat;
            for (const u of updates) {
                cur = spliceFlat(flat, start, end, { text: u, spans: [] });
                init.events.change({ flat: cur, selection: { start: start + u.length, end: start + u.length }, composing: true });
            }
            flat = spliceFlat(flat, start, end, { text: committed, spans: [] });
            selection = { start: start + committed.length, end: start + committed.length };
            composing = false;
            init.events.compositionEnd(flat);
        },
        paste(text, markdown) {
            return init.events.paste({ text, markdown, range: sel() });
        },
        select(start, end = start) {
            selection = { start, end };
            init.events.selection({ range: selection, caret: surface.caretRect() });
        },
        reset() {
            calls.length = 0;
        },
    };
    return surface;
}

export interface FakeCodeSurface extends CodeSurface {
    readonly key: string;
    readonly calls: SurfaceCall[];
    readonly events: CodeSurfaceInit['events'];
    type(text: string): void;
    press(key: BoundaryKey): boolean;
    select(start: number, end?: number): void;
}

export function createFakeCodeSurface(init: CodeSurfaceInit): FakeCodeSurface {
    let value = init.value;
    let selection: Range | null = null;
    const calls: SurfaceCall[] = [];
    const record = (method: string, ...args: unknown[]): void => {
        calls.push({ method, args });
    };
    const sel = (): Range => selection ?? { start: value.length, end: value.length };
    return {
        key: init.key,
        calls,
        events: init.events,
        setValue(v) {
            record('setValue', v);
            value = v;
        },
        getValue: () => value,
        setLang(lang) {
            record('setLang', lang);
        },
        setSelection(range) {
            record('setSelection', range);
            selection = { ...range };
        },
        focus(target) {
            record('focus', target);
            if (target && 'offset' in target) selection = { start: target.offset, end: target.offset };
            init.events.focus();
        },
        blur() {
            record('blur');
            init.events.blur();
        },
        getSelection: () => selection,
        setReadOnly(v) {
            record('setReadOnly', v);
        },
        destroy() {
            record('destroy');
        },
        type(text) {
            const { start, end } = sel();
            value = value.slice(0, start) + text + value.slice(end);
            selection = { start: start + text.length, end: start + text.length };
            init.events.change({ value, selection, composing: false });
        },
        press(key) {
            return init.events.boundary({ key, range: sel() });
        },
        select(start, end = start) {
            selection = { start, end };
            init.events.selection({ range: selection, caret: null });
        },
    };
}
