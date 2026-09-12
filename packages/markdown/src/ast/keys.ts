/**
 * Reconciliation keys.
 *
 * A top-level block is `b-<absolute index>`; every keyed descendant is
 * `<parent key>.<index in parent>` (a list `b-2` → item `b-2.1` → its
 * paragraph `b-2.1.0`; a table `b-4` → row `b-4.0` → cell `b-4.0.2`). Keys
 * are content- and offset-independent and unique per document, so a block
 * keeps its key when it moves from the live tail to the finalized prefix.
 */

import type { MarkdownNode, Node, Root } from './nodes.js';

export function topKey(index: number): string {
    return `b-${index}`;
}

export function childKey(parentKey: string, index: number): string {
    return `${parentKey}.${index}`;
}

/** Node types that carry a key (block-level, plus the structural children of lists and tables). */
const UNKEYED_TYPES = new Set([
    'root',
    'text',
    'emphasis',
    'strong',
    'delete',
    'inlineCode',
    'break',
    'link',
    'image',
    'linkReference',
    'imageReference',
]);

/** Whether a node of this type is expected to carry a `key`. */
export function isKeyedType(type: string): boolean {
    return !UNKEYED_TYPES.has(type);
}

/**
 * (Re)assign keys to every block-level node of a tree in place. Used by
 * `fromJSON()` and by the render engine when it meets a tree that carries no
 * keys (a remark tree, a hand-built one).
 */
export function assignKeys(root: Root): Root {
    root.children.forEach((child, i) => assignBlockKeys(child, topKey(i)));
    return root;
}

function assignBlockKeys(node: MarkdownNode, key: string): void {
    if (!isKeyedType(node.type)) return;
    (node as { key?: string }).key = key;
    const children = (node as { children?: Node[] }).children;
    if (!children) return;
    children.forEach((child, i) => assignBlockKeys(child as MarkdownNode, childKey(key, i)));
}
