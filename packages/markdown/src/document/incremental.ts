/**
 * Incremental parsing for streaming sources — a capability a `DocumentFormat`
 * can offer (`createIncrementalEngine`), implemented here once for any
 * line-oriented block parser.
 *
 * The win for AI chat output: as the source string grows token by token, we
 * never re-parse or re-render finalized content, and completed blocks keep a
 * stable identity so the reconciler never remounts (no flicker, no reflow).
 *
 * Core invariant: for an append-only stream, only blocks that were still open
 * when the input ended can change — appended text always extends the tail.
 * Every construct that can retroactively change a block keeps that block open
 * until it can no longer change, and the block parser reports how many
 * trailing top-level blocks were still open at EOF (`openCount`). Everything
 * before them is finalized: cached by reference, never rebuilt, and the source
 * cursor moves to the start of the line the first open block begins on. Each
 * subsequent chunk re-parses only that trailing region.
 *
 * Keys are the absolute block index (`b-<i>`) and nested keys are path-based,
 * so a block keeps its key when it moves from open to finalized.
 */

import type { BlockContent, Point, Root } from '../ast/index.js';

export interface IncrementalEngine {
    /** Parse `src`, reusing finalized blocks from prior calls where possible. */
    parse(src: string): Root;
    /** Drop all cached state (e.g. when the source is replaced rather than appended). */
    reset(): void;
    /** Introspection for tests and devtools: the cut offset and the number of finalized blocks. */
    inspect(): { cut: number; finalized: number };
}

/** What `createLineEngine` needs from a format: a line-oriented block parser that reports its open tail. */
export interface LineBlockParser {
    /** Normalise line endings (the cut is measured in the normalised source). */
    normalize(src: string): string;
    /**
     * Parse `tail` (the normalised source from `base.offset`, a line start) as
     * top-level blocks. `base.line` is the 1-based line number of its first
     * line and `base.index` the index of its first block (for `b-<i>` keys).
     * `openCount` is how many trailing blocks may still change with more text.
     */
    parseBlocks(tail: string, base: { offset: number; line: number; index: number }): { children: BlockContent[]; end: Point; openCount: number };
    /** Applied once to every block, finalized or live (a plugin's `transformBlock`). */
    transform?(block: BlockContent): BlockContent;
}

/** The line-oriented incremental engine over `parser`. */
export function createLineEngine(parser: LineBlockParser): IncrementalEngine {
    /** Finalized top-level blocks, reused by reference across chunks. */
    let cached: BlockContent[] = [];
    /** Offset (in the normalised source) where the live region begins — always a line start. */
    let cut = 0;
    /** 1-based line number of the line starting at `cut`. */
    let cutLine = 1;
    /** The normalised prefix that `cached` was parsed from (`norm.slice(0, cut)`). */
    let stable = '';

    const reset = (): void => {
        cached = [];
        cut = 0;
        cutLine = 1;
        stable = '';
    };

    const transform = parser.transform ?? ((block: BlockContent): BlockContent => block);

    const parse = (src: string): Root => {
        const norm = parser.normalize(src ?? '');

        // Non-append edit (regenerate, replace): the cached prefix no longer matches → full re-parse.
        if (!norm.startsWith(stable)) reset();

        const tail = norm.slice(cut);
        const { children, end, openCount } = parser.parseBlocks(tail, { offset: cut, line: cutLine, index: cached.length });
        const position = { start: { line: 1, column: 1, offset: 0 }, end };

        if (children.length === 0) {
            return { type: 'root', children: cached.slice(), position };
        }

        const finalizedCount = children.length - openCount;

        if (finalizedCount > 0) {
            const finalized = children.slice(0, finalizedCount).map(transform);
            if (__DEV__) for (const b of finalized) deepFreeze(b);
            cached = cached.concat(finalized);

            // Cut at the START OF THE LINE the first open block begins on so its
            // indentation context re-parses identically; with nothing open, at
            // the line after the last finalized block.
            let lineStart: number;
            if (finalizedCount < children.length) {
                const startOffset = children[finalizedCount].position?.start.offset ?? cut;
                lineStart = norm.lastIndexOf('\n', startOffset - 1) + 1;
            } else {
                const endOffset = children[finalizedCount - 1].position?.end.offset ?? cut;
                const nl = norm.indexOf('\n', endOffset);
                lineStart = nl === -1 ? norm.length : nl + 1;
            }
            if (lineStart > cut) {
                cutLine += countNewlines(norm, cut, lineStart);
                cut = lineStart;
                stable = norm.slice(0, cut);
            }
        }

        const live = children.slice(finalizedCount).map(transform);
        return { type: 'root', children: cached.concat(live), position };
    };

    const inspect = () => ({ cut, finalized: cached.length });

    return { parse, reset, inspect };
}

/**
 * The fallback engine for a format without incremental parsing: every call
 * re-parses the whole source (`inspect()` reports nothing finalized). Keys
 * are positional, so a renderer still reconciles unchanged blocks by key.
 */
export function createReparseEngine(parse: (src: string) => Root): IncrementalEngine {
    return {
        parse: (src) => parse(src ?? ''),
        reset: () => undefined,
        inspect: () => ({ cut: 0, finalized: 0 }),
    };
}

function countNewlines(s: string, from: number, to: number): number {
    let n = 0;
    for (let i = from; i < to; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
}

function deepFreeze(value: unknown): void {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
}
