import { describe, expect, it } from 'vitest';
import { markdownSchema } from '@sigx/richtext-markdown';
import { createFakeInlineSurface } from '../../src/testing/fake-surface.js';
import { runInlineSurfaceConformance } from '../../src/testing/surface-conformance.js';
import type { FakeInlineSurface } from '../../src/testing/fake-surface.js';

describe('FakeInlineSurface passes the surface conformance suite', () => {
    runInlineSurfaceConformance({
        create: createFakeInlineSurface,
        it,
        expect,
        driver: {
            type: (s, text) => (s as FakeInlineSurface).type(text),
            press: (s, key) => {
                const fake = s as FakeInlineSurface;
                const sel = fake.getSelection();
                const len = fake.getFlat().text.length;
                // A real surface only reports Backspace/Delete at the edges; emulate that gate.
                if (key === 'Backspace' && sel && sel.start !== 0) {
                    fake.deleteRange(sel.start - 1, sel.start);
                    return;
                }
                if (key === 'Delete' && sel && sel.end !== len) return;
                fake.press(key);
            },
            setCaret: (s, offset) => s.focus({ offset }),
            compose: (s, updates, committed) => {
                (s as FakeInlineSurface).compose(updates, committed);
                return true;
            },
        },
    });
});

describe('FakeInlineSurface driver', () => {
    const make = (text: string, readOnly = false, change: (e: { flat: { text: string } }) => void = () => undefined) =>
        createFakeInlineSurface({
            key: 'b-0',
            blockType: 'paragraph',
            schema: markdownSchema,
            attrs: {},
            flat: { text, spans: [] },
            readOnly,
            events: { change, selection: () => undefined, boundary: () => true, paste: () => true, focus: () => undefined, blur: () => undefined, compositionStart: () => undefined, compositionEnd: () => undefined },
        });

    it('deleteRange respects readOnly like type does', () => {
        const changes: string[] = [];
        const s = make('abc', true, (e) => changes.push(e.flat.text));
        s.focus({ offset: 3 });
        s.deleteRange(2, 3);
        s.type('X');
        expect(s.getFlat().text).toBe('abc');
        expect(changes).toEqual([]);
        s.setReadOnly(false);
        s.deleteRange(2, 3);
        expect(s.getFlat().text).toBe('ab');
        expect(changes).toEqual(['ab']);
    });

    it('focus({ line, x }) takes x in the same pixel space as caretRect and offsetAtX', () => {
        const s = make('abcd');
        s.focus({ offset: 3 });
        const x = s.caretRect()!.x;
        s.focus({ line: 'first', x });
        expect(s.getSelection()).toEqual({ start: 3, end: 3 });
        expect(s.offsetAtX('first', x)).toBe(3);
        s.focus({ line: 'first', x: 10_000 });
        expect(s.getSelection()).toEqual({ start: 4, end: 4 });
        s.focus({ line: 'last', x: 0 });
        expect(s.getSelection()).toEqual({ start: 4, end: 4 });
    });

    it('compose shows each provisional update through getFlat/getSelection/isComposing while it is emitted', () => {
        const seen: Array<{ text: string; sel: { start: number; end: number } | null; composing: boolean }> = [];
        const s = make('a', false, () => seen.push({ text: s.getFlat().text, sel: s.getSelection(), composing: s.isComposing() }));
        s.focus({ offset: 1 });
        s.compose(['k', 'ka'], 'か');
        expect(seen).toEqual([
            { text: 'ak', sel: { start: 2, end: 2 }, composing: true },
            { text: 'aka', sel: { start: 3, end: 3 }, composing: true },
        ]);
        expect(s.getFlat().text).toBe('aか');
        expect(s.getSelection()).toEqual({ start: 2, end: 2 });
        expect(s.isComposing()).toBe(false);
    });
});

describe('runInlineSurfaceConformance tears down every surface it creates', () => {
    it('calls cleanup once per created surface, also when compose is unsupported or an assertion fails', async () => {
        let created = 0;
        let cleaned = 0;
        let assertions = 0;
        const tests: Array<() => void | Promise<void>> = [];
        runInlineSurfaceConformance({
            create: (init) => {
                created++;
                return createFakeInlineSurface(init);
            },
            cleanup: () => {
                cleaned++;
            },
            it: (_name, fn) => {
                tests.push(fn);
            },
            // Every assertion fails: cleanup must still run for the surface under test.
            expect: () => ({
                toBe: () => {
                    assertions++;
                    throw new Error('fail');
                },
                toEqual: () => {
                    assertions++;
                    throw new Error('fail');
                },
                toBeGreaterThan: () => {
                    assertions++;
                    throw new Error('fail');
                },
            }),
            driver: {
                type: (s, text) => (s as FakeInlineSurface).type(text),
                press: (s, key) => {
                    (s as FakeInlineSurface).press(key);
                },
                setCaret: (s, offset) => s.focus({ offset }),
                // Present but unsupported: the composition test must bail without leaking its surface.
                compose: () => false,
            },
        });
        for (const fn of tests) await expect(fn()).rejects.toThrow('fail').catch(() => undefined);
        expect(tests.length).toBeGreaterThan(0);
        expect(created).toBe(tests.length);
        expect(cleaned).toBe(created);
        expect(assertions).toBeGreaterThan(0);
    });
});
