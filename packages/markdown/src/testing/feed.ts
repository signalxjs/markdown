/**
 * The streaming harness: feed a source string to an engine the way a token
 * stream would — as a growing prefix, one chunk at a time — and keep every
 * intermediate tree, so a test can assert that finalized blocks stay stable
 * from step to step. `seededChunks()` gives a reproducible irregular chunk
 * sequence for the same purpose.
 */

import type { Root } from '../ast/index.js';

/** Anything that turns the source-so-far into a tree: `parseMarkdown` or an incremental engine. */
export interface FeedEngine {
    parse(source: string): Root;
}

/**
 * Feed `source` to `engine` in chunks and return the tree after every step
 * (the last one is the tree for the whole source). `chunk` is a fixed size
 * or a function of the step index (see `seededChunks`); a size below 1 or
 * not a finite number counts as 1. An empty source yields a single parse of
 * `''`.
 */
export function feed(engine: FeedEngine, source: string, chunk: number | ((step: number) => number)): Root[] {
    const results: Root[] = [];
    if (source.length === 0) {
        results.push(engine.parse(''));
        return results;
    }
    let end = 0;
    for (let step = 0; end < source.length; step++) {
        const raw = typeof chunk === 'function' ? chunk(step) : chunk;
        const size = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
        end = Math.min(source.length, end + size);
        results.push(engine.parse(source.slice(0, end)));
    }
    return results;
}

/**
 * A deterministic chunk-size sequence in `[min, max]` from a small LCG
 * (Numerical Recipes constants, 32-bit). The result is a pure function of
 * the step index — the same `step` always gives the same size — so one
 * generator can drive several `feed()` runs and a failing case is
 * reproducible from its seed alone.
 */
export function seededChunks(seed: number, min: number, max: number): (step: number) => number {
    const lo = Math.max(1, Math.floor(Math.min(min, max)));
    const hi = Math.max(lo, Math.floor(Math.max(min, max)));
    const range = hi - lo + 1;
    const states: number[] = [];
    let state = seed >>> 0;
    return (step: number): number => {
        const index = Math.max(0, Math.floor(step));
        while (states.length <= index) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            states.push(state);
        }
        // High bits: the low bits of an LCG cycle with a short period.
        return lo + ((states[index] >>> 16) % range);
    };
}
