/**
 * Incremental parsing engine for streaming markdown.
 *
 * The win for AI chat output: as the source string grows token by token, we
 * never re-parse or re-render finalized content, and completed blocks keep a
 * stable identity so the reconciler never remounts (no flicker, no reflow).
 *
 * Core invariant: for an append-only stream, only blocks that were still open
 * when the input ended can change — appended text always extends the tail.
 * Every construct that can retroactively change a block (a setext underline,
 * a table delimiter row, list tightness, lazy continuation, a closing fence, a
 * definition's continued title) keeps that block open until it can no longer
 * change, and the block parser reports how many trailing top-level blocks
 * were still open at EOF (`openCount`). Everything before them is finalized:
 * cached by reference, never rebuilt, and the source cursor moves to the
 * start of the line the first open block begins on. Each subsequent chunk
 * re-parses only that trailing region.
 *
 * Keys are the absolute block index (`b-<i>`) and nested keys are path-based,
 * so a block keeps its key when it moves from open to finalized.
 *
 * A definition arriving after the reference that uses it never changes the
 * finalized block object — references resolve at render/serialize time.
 */

import type { BlockContent, Root } from '../ast/index.js';
import type { MarkdownPlugin, ResolvedPlugins } from '../plugin/index.js';
import { resolvePlugins } from '../plugin/index.js';
import { parseBlocks } from './blocks.js';
import { parseInline } from './inline.js';
import { normalizeSource } from './scanner.js';

export interface IncrementalEngine {
    /** Parse `src`, reusing finalized blocks from prior calls where possible. */
    parse(src: string): Root;
    /** Drop all cached state (e.g. when the source is replaced rather than appended). */
    reset(): void;
    /** Introspection for tests and devtools. */
    inspect(): { cut: number; finalized: number };
}

export interface IncrementalEngineOptions {
    /**
     * Plugins threaded into every parse. Captured at construction — plugins
     * are configuration, not data: to change the set, create a new engine.
     * `transformDocument` is not honoured (it would break block reuse).
     */
    plugins?: readonly MarkdownPlugin[];
}

export function createIncrementalEngine(options?: IncrementalEngineOptions): IncrementalEngine {
    const plugins: ResolvedPlugins = resolvePlugins(options?.plugins);
    if (__DEV__ && plugins.transformDocument.length) {
        console.warn('[@sigx/markdown] createIncrementalEngine ignores plugin transformDocument hooks; use parseMarkdown for those.');
    }

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

    const transformCtx = { parseInline: (text: string) => parseInline(text, { plugins }) };
    const transform = (block: BlockContent): BlockContent => {
        let node = block;
        for (const t of plugins.transformBlock) {
            try {
                const out = t(node, transformCtx);
                if (out) node = out;
            } catch (err) {
                if (__DEV__) console.warn('[@sigx/markdown] transformBlock threw; block left unchanged.', err);
            }
        }
        return node;
    };

    const parse = (src: string): Root => {
        const norm = normalizeSource(src ?? '');

        // Non-append edit (regenerate, replace): the cached prefix no longer matches → full re-parse.
        if (!norm.startsWith(stable)) reset();

        const tail = norm.slice(cut);
        const { children, end, openCount } = parseBlocks(tail, {
            plugins,
            baseOffset: cut,
            baseLine: cutLine,
            baseIndex: cached.length,
        });
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
