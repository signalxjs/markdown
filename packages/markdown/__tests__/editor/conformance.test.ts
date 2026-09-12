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
