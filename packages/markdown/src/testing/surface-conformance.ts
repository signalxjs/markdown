/**
 * The surface conformance suite — the contract every `InlineSurface`
 * implementation (DOM, Lynx, the fake) must satisfy, expressed as plain
 * assertions so it runs under vitest, `@sigx/lynx-testing` or Playwright.
 *
 * Usage (vitest):
 * ```ts
 * describe('DomInlineSurface', () => runInlineSurfaceConformance({ create, driver, it, expect }));
 * ```
 */

import type { InlineFlat } from '../editor/inline-flat.js';
import { flatEquals } from '../editor/inline-flat.js';
import type { BoundaryKey, InlineSurface, InlineSurfaceEvents, InlineSurfaceInit, Range, SurfaceBoundaryEvent, SurfaceChangeEvent } from '../editor/surface.js';

export interface SurfaceDriver {
    /** Type text at the current selection, as a user would. */
    type(surface: InlineSurface, text: string): void | Promise<void>;
    /** Press a boundary key. */
    press(surface: InlineSurface, key: BoundaryKey): void | Promise<void>;
    /** Place the caret. */
    setCaret(surface: InlineSurface, offset: number): void | Promise<void>;
    /** Run an IME composition (may be a no-op on platforms without one — return `false` to skip those checks). */
    compose?(surface: InlineSurface, updates: string[], committed: string): boolean | Promise<boolean>;
    /** Wait for the surface to settle (a frame, a flush). */
    settle?(): void | Promise<void>;
}

export interface ConformanceHarness {
    create(init: InlineSurfaceInit): InlineSurface;
    driver: SurfaceDriver;
    it(name: string, fn: () => void | Promise<void>): void;
    expect: (value: unknown) => { toBe(expected: unknown): void; toEqual(expected: unknown): void; toBeGreaterThan(n: number): void };
    /** Tear down surfaces created by a test. */
    cleanup?(surface: InlineSurface): void;
}

interface Recorded {
    changes: SurfaceChangeEvent[];
    boundaries: SurfaceBoundaryEvent[];
    selections: Range[];
    focus: number;
    blur: number;
    compositions: { start: number; end: InlineFlat[] };
}

function recorder(consume = true): { events: InlineSurfaceEvents; log: Recorded } {
    const log: Recorded = { changes: [], boundaries: [], selections: [], focus: 0, blur: 0, compositions: { start: 0, end: [] } };
    return {
        log,
        events: {
            change: (e) => {
                log.changes.push(e);
            },
            selection: (e) => {
                log.selections.push(e.range);
            },
            boundary: (e) => {
                log.boundaries.push(e);
                return consume;
            },
            paste: () => true,
            focus: () => {
                log.focus++;
            },
            blur: () => {
                log.blur++;
            },
            compositionStart: () => {
                log.compositions.start++;
            },
            compositionEnd: (flat) => {
                log.compositions.end.push(flat);
            },
        },
    };
}

export function runInlineSurfaceConformance(h: ConformanceHarness): void {
    const { it, expect, driver } = h;
    const settle = async (): Promise<void> => {
        await driver.settle?.();
    };
    const make = (flat: InlineFlat, consume = true) => {
        const r = recorder(consume);
        const surface = h.create({ key: 'b-0', blockType: 'paragraph', attrs: {}, flat, readOnly: false, events: r.events });
        return { surface, log: r.log };
    };
    const plain = (text: string): InlineFlat => ({ text, spans: [] });

    it('renders the initial flat and reads it back unchanged', async () => {
        const flat: InlineFlat = { text: 'a b c', spans: [{ start: 2, end: 3, type: 'strong' }, { start: 4, end: 5, type: 'link', attrs: { url: 'u' } }] };
        const { surface } = make(flat);
        await settle();
        expect(flatEquals(surface.getFlat(), flat)).toBe(true);
        h.cleanup?.(surface);
    });

    it('setInline with equal content is a no-op that emits no change', async () => {
        const flat = plain('same');
        const { surface, log } = make(flat);
        await settle();
        surface.setInline({ text: 'same', spans: [] });
        await settle();
        expect(log.changes.length).toBe(0);
        expect(surface.getFlat().text).toBe('same');
        h.cleanup?.(surface);
    });

    it('setInline with new content replaces it without emitting a change', async () => {
        const { surface, log } = make(plain('old'));
        await settle();
        const next: InlineFlat = { text: 'new *x*', spans: [{ start: 4, end: 7, type: 'emphasis' }] };
        surface.setInline(next);
        await settle();
        expect(flatEquals(surface.getFlat(), next)).toBe(true);
        expect(log.changes.length).toBe(0);
        h.cleanup?.(surface);
    });

    it('typing emits a change whose flat matches the read-back', async () => {
        const { surface, log } = make(plain('ab'));
        await settle();
        surface.focus({ offset: 1 });
        await driver.type(surface, 'X');
        await settle();
        expect(log.changes.length).toBeGreaterThan(0);
        const last = log.changes[log.changes.length - 1];
        expect(last.flat.text).toBe('aXb');
        expect(flatEquals(last.flat, surface.getFlat())).toBe(true);
        expect(last.composing).toBe(false);
        h.cleanup?.(surface);
    });

    it('focus({offset}) then getSelection() agree', async () => {
        const { surface } = make(plain('hello'));
        await settle();
        surface.focus({ offset: 3 });
        await settle();
        expect(surface.getSelection()).toEqual({ start: 3, end: 3 });
        surface.setSelection({ start: 1, end: 4 });
        await settle();
        expect(surface.getSelection()).toEqual({ start: 1, end: 4 });
        h.cleanup?.(surface);
    });

    it('reports Enter and Backspace/Delete at the edges as boundary events', async () => {
        const { surface, log } = make(plain('ab'));
        await settle();
        surface.focus({ offset: 0 });
        await driver.press(surface, 'Backspace');
        surface.focus({ offset: 2 });
        await driver.press(surface, 'Delete');
        await driver.press(surface, 'Enter');
        await settle();
        const keys = log.boundaries.map((b) => b.key);
        expect(keys.includes('Backspace')).toBe(true);
        expect(keys.includes('Delete')).toBe(true);
        expect(keys.includes('Enter')).toBe(true);
        // The text is untouched: the core consumed every boundary key.
        expect(surface.getFlat().text).toBe('ab');
        h.cleanup?.(surface);
    });

    it('does not report Backspace away from the start as a boundary', async () => {
        const { surface, log } = make(plain('ab'));
        await settle();
        surface.focus({ offset: 2 });
        await driver.press(surface, 'Backspace');
        await settle();
        expect(log.boundaries.some((b) => b.key === 'Backspace')).toBe(false);
        h.cleanup?.(surface);
    });

    it('never emits a non-composing change mid-composition', async () => {
        if (!driver.compose) return;
        const { surface, log } = make(plain('a'));
        await settle();
        surface.focus({ offset: 1 });
        const ran = await driver.compose(surface, ['k', 'ka'], 'か');
        await settle();
        if (!ran) return;
        expect(log.compositions.start).toBe(1);
        expect(log.compositions.end.length).toBe(1);
        expect(log.changes.every((c) => c.composing)).toBe(true);
        expect(surface.getFlat().text).toBe('aか');
        h.cleanup?.(surface);
    });

    it('setReadOnly blocks typing', async () => {
        const { surface, log } = make(plain('ab'));
        await settle();
        surface.setReadOnly(true);
        surface.focus({ offset: 1 });
        await driver.type(surface, 'X');
        await settle();
        expect(surface.getFlat().text).toBe('ab');
        expect(log.changes.length).toBe(0);
        h.cleanup?.(surface);
    });
}
