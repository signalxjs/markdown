/**
 * `createIncrementalEngine()` — markdown's streaming engine: the generic
 * line-oriented engine (`document/incremental.ts`) over the markdown block
 * parser, which reports how many trailing blocks are still open (a setext
 * underline, a table delimiter row, list tightness, lazy continuation, a
 * closing fence, a definition's continued title can all retroactively change
 * a block, so those stay open until they cannot).
 *
 * A definition arriving after the reference that uses it never changes the
 * finalized block object — references resolve at render/serialize time.
 */

import type { BlockContent } from '../ast/index.js';
import { createLineEngine, type IncrementalEngine } from '../document/index.js';
import type { ResolvedMarkdownPlugins, RichTextPlugin } from '../plugin/index.js';
import { resolveMarkdownPlugins } from '../plugin/index.js';
import { parseBlocks } from './blocks.js';
import { parseInline } from './inline.js';
import { normalizeSource } from './scanner.js';

export type { IncrementalEngine } from '../document/index.js';

export interface IncrementalEngineOptions {
    /**
     * Plugins threaded into every parse. Captured at construction — plugins
     * are configuration, not data: to change the set, create a new engine.
     * `transformDocument` is not honoured (it would break block reuse).
     */
    plugins?: readonly RichTextPlugin[];
}

export function createIncrementalEngine(options?: IncrementalEngineOptions): IncrementalEngine {
    const plugins: ResolvedMarkdownPlugins = resolveMarkdownPlugins(options?.plugins);
    if (__DEV__ && plugins.transformDocument.length) {
        console.warn('[@sigx/markdown] createIncrementalEngine ignores plugin transformDocument hooks; use parseMarkdown for those.');
    }

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

    return createLineEngine({
        normalize: normalizeSource,
        parseBlocks: (tail, base) => parseBlocks(tail, { plugins, baseOffset: base.offset, baseLine: base.line, baseIndex: base.index }),
        transform: plugins.transformBlock.length ? transform : undefined,
    });
}
