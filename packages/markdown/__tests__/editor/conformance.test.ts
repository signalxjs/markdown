import { describe, expect, it } from 'vitest';
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
