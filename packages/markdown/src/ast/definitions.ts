/**
 * Link reference definitions.
 *
 * The parser emits `linkReference` / `imageReference` nodes whether or not a
 * matching `definition` exists, and `definition` nodes wherever they appear.
 * Resolution happens at render / serialize time against this map, so a
 * definition that arrives after a reference (common in streamed text) never
 * mutates an already finalized block.
 */

import type { Definition, Node, Parent, Root } from './nodes.js';

/** Containers a definition can live in (the CommonMark block containers). */
const CONTAINERS = new Set(['root', 'blockquote', 'listItem', 'list']);

/**
 * Collect every definition in document order, keyed by `identifier`. The
 * first definition for a label wins (CommonMark). Only container blocks are
 * walked, so the cost is O(blocks), not O(inline nodes).
 */
export function collectDefinitions(root: Root): Map<string, Definition> {
    const out = new Map<string, Definition>();
    const walk = (node: Node): void => {
        if (node.type === 'definition') {
            const def = node as Definition;
            if (!out.has(def.identifier)) out.set(def.identifier, def);
            return;
        }
        if (!CONTAINERS.has(node.type)) return;
        const children = (node as Parent).children;
        if (!children) return;
        for (const child of children) walk(child);
    };
    walk(root);
    return out;
}
