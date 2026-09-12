/**
 * Position helpers. Positions are unist points into the line-ending-normalised
 * source (see `normalizeSource` in the parser).
 */

import type { Node, Point, Position } from './nodes.js';

export function point(line: number, column: number, offset: number): Point {
    return { line, column, offset };
}

export function position(start: Point, end: Point): Position {
    return { start, end };
}

/**
 * The exact source slice a node was parsed from — the replacement for the old
 * `raw` field. `undefined` when the node carries no position.
 */
export function sliceSource(source: string, node: Node): string | undefined {
    const p = node.position;
    if (!p) return undefined;
    return source.slice(p.start.offset, p.end.offset);
}

/**
 * A line index over a source string: 0-based line start offsets, so any
 * absolute offset converts to a unist point in O(log n).
 */
export class LineIndex {
    /** Absolute offset where each line starts (line 1 at index 0). */
    readonly starts: number[];

    constructor(source: string, baseOffset = 0) {
        const starts = [baseOffset];
        for (let i = 0; i < source.length; i++) {
            if (source.charCodeAt(i) === 10 /* \n */) starts.push(baseOffset + i + 1);
        }
        this.starts = starts;
    }

    /** Convert an absolute offset to a point. `baseLine` is the 1-based line of the first entry. */
    pointAt(offset: number, baseLine = 1): Point {
        const starts = this.starts;
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return { line: baseLine + lo, column: offset - starts[lo] + 1, offset };
    }
}
