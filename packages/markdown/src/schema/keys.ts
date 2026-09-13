/**
 * Key assignment. A top-level block is `b-<absolute index>`; every keyed
 * descendant is `<parent key>.<index in parent>` (see `ast/keys.ts`). Which
 * types carry a key is the schema's call.
 */

import type { MarkdownNode, Node, Root } from '../ast/index.js';
import { childKey, topKey } from '../ast/index.js';
import type { Schema } from './spec.js';
import { standardSchema } from './standard.js';

/**
 * (Re)assign keys to every keyed node of a tree in place. Used by
 * `fromJSON()` and by the editor when it meets a tree that carries no keys
 * (a remark tree, a hand-built one).
 */
export function assignKeys(root: Root, schema: Schema = standardSchema): Root {
    root.children.forEach((child, i) => assignBlockKeys(child, topKey(i), schema));
    return root;
}

function assignBlockKeys(node: MarkdownNode, key: string, schema: Schema): void {
    if (!schema.isKeyed(node.type)) return;
    (node as { key?: string }).key = key;
    const children = (node as { children?: Node[] }).children;
    if (!children) return;
    children.forEach((child, i) => assignBlockKeys(child as MarkdownNode, childKey(key, i), schema));
}
