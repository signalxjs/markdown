/**
 * Tree traversal without `unist-util-visit`: a depth-first `visit` with the
 * usual `SKIP` / `EXIT` controls, and a structural `map`.
 */

import type { Node, Parent } from './nodes.js';

export const SKIP: unique symbol = Symbol('skip');
export const EXIT: unique symbol = Symbol('exit');

export type VisitAction = typeof SKIP | typeof EXIT | undefined | void;

export type VisitTest = string | ((node: Node) => boolean) | null | undefined;

export type Visitor<N extends Node = Node> = (
    node: N,
    index: number | null,
    parent: Parent | null,
) => VisitAction;

function matches(test: VisitTest, node: Node): boolean {
    if (test == null) return true;
    if (typeof test === 'string') return node.type === test;
    return test(node);
}

/**
 * Walk `tree` depth-first, pre-order. The visitor may return `SKIP` (do not
 * descend into this node) or `EXIT` (stop the whole walk).
 */
export function visit<N extends Node = Node>(tree: Node, visitor: Visitor<N>): void;
export function visit<N extends Node = Node>(tree: Node, test: VisitTest, visitor: Visitor<N>): void;
export function visit(tree: Node, testOrVisitor: VisitTest | Visitor, maybeVisitor?: Visitor): void {
    const test: VisitTest = maybeVisitor ? (testOrVisitor as VisitTest) : null;
    const visitor: Visitor = maybeVisitor ?? (testOrVisitor as Visitor);

    const walk = (node: Node, index: number | null, parent: Parent | null): boolean => {
        let action: VisitAction;
        if (matches(test, node)) action = visitor(node, index, parent);
        if (action === EXIT) return false;
        if (action === SKIP) return true;
        const children = (node as Parent).children;
        if (Array.isArray(children)) {
            for (let i = 0; i < children.length; i++) {
                if (!walk(children[i], i, node as Parent)) return false;
            }
        }
        return true;
    };

    walk(tree, null, null);
}

/**
 * Build a new tree by mapping every node (children first, so `fn` receives a
 * node whose children are already mapped). `fn` returning the same node keeps
 * it; the parent is still copied.
 */
export function map<T extends Node>(tree: T, fn: (node: Node, index: number | null, parent: Parent | null) => Node): T {
    const walk = (node: Node, index: number | null, parent: Parent | null): Node => {
        const children = (node as Parent).children;
        const next = { ...node } as Parent;
        if (Array.isArray(children)) next.children = children.map((c, i) => walk(c, i, node as Parent));
        return fn(next, index, parent);
    };
    return walk(tree, null, null) as T;
}
