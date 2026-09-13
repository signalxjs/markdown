/**
 * `parseMarkdown()` — one-shot parse of a whole document.
 *
 * Normalises line endings, runs the block parser, applies plugin block and
 * document transforms, and returns an mdast `Root` whose block-level nodes
 * carry reconciliation keys and every node carries a position.
 */

import type { BlockContent, PhrasingContent, Root } from '../ast/index.js';
import type { RichTextPlugin } from '../plugin/index.js';
import { resolveMarkdownPlugins } from '../plugin/index.js';
import { parseBlocks } from './blocks.js';
import { parseInline } from './inline.js';
import { normalizeSource } from './scanner.js';

export interface ParseOptions {
    plugins?: readonly RichTextPlugin[];
}

export function parseMarkdown(src: string, options?: ParseOptions): Root {
    const plugins = resolveMarkdownPlugins(options?.plugins);
    const norm = normalizeSource(src ?? '');
    const { children, end } = parseBlocks(norm, { plugins });

    let blocks: BlockContent[] = children;
    if (plugins.transformBlock.length) {
        const ctx = { parseInline: (text: string): PhrasingContent[] => parseInline(text, { plugins }) };
        blocks = children.map((block) => {
            let node = block;
            for (const t of plugins.transformBlock) {
                try {
                    const out = t(node, ctx);
                    if (out) node = out;
                } catch (err) {
                    if (__DEV__) console.warn('[@sigx/markdown] transformBlock threw; block left unchanged.', err);
                }
            }
            return node;
        });
    }

    const root: Root = {
        type: 'root',
        children: blocks,
        position: { start: { line: 1, column: 1, offset: 0 }, end },
    };
    for (const t of plugins.transformDocument) {
        try {
            t(root);
        } catch (err) {
            if (__DEV__) console.warn('[@sigx/markdown] transformDocument threw; ignored.', err);
        }
    }
    return root;
}
