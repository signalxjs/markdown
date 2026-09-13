/**
 * `strip()` / `stripPositions()` — normalise a tree for structural comparison.
 *
 * Two trees for the same markdown can differ in ways that do not matter to a
 * test: reconciliation keys, source positions, the streaming `open` flag on
 * an unterminated fence, the `data.autolink` marker, and how adjacent text
 * was split into nodes. `strip()` removes all of that (deep clone — the input
 * is never mutated) so `expect(strip(a)).toEqual(strip(b))` compares the
 * markdown structure and nothing else. `stripPositions()` drops positions
 * only.
 */

import type { Node, Parent, Text } from '../ast/index.js';

/** Deep clone without `key`, `position`, `open`, `data.autolink`; adjacent texts merged, empty texts dropped. */
export function strip<T extends Node>(node: T): T {
    return clone(node, true) as T;
}

/** Deep clone without `position` on any node. */
export function stripPositions<T extends Node>(node: T): T {
    return clone(node, false) as T;
}

function clone(node: Node, full: boolean): Node {
    const out: Record<string, unknown> = { ...node };
    delete out.position;
    for (const key of Object.keys(out)) {
        const value = out[key];
        if (key !== 'children' && Array.isArray(value)) out[key] = value.slice();
    }
    if (node.data) {
        const data = { ...node.data };
        if (full) delete data.autolink;
        if (Object.keys(data).length === 0) delete out.data;
        else out.data = data;
    }
    if (full) {
        delete out.key;
        delete out.open;
    }
    const children = (node as Parent).children;
    if (Array.isArray(children)) {
        const next: Node[] = [];
        for (const child of children) {
            const copy = clone(child, full);
            if (full && copy.type === 'text') {
                const value = (copy as Text).value;
                if (value === '') continue;
                const last = next[next.length - 1];
                if (last && last.type === 'text') {
                    (last as Text).value += value;
                    continue;
                }
            }
            next.push(copy);
        }
        out.children = next;
    }
    return out as unknown as Node;
}
