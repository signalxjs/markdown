/**
 * Steps — the primitive, invertible edits every command is built from.
 *
 * A step addresses blocks by key, never by path, so it survives structural
 * edits around it. `applyStep` returns a new `Root` sharing every untouched
 * node with the old one; `invertStep` is computed against the state BEFORE
 * the step so undo has the old node by reference. Compound operations
 * (split, merge, indent) are commands that emit sequences of these — there
 * are no compound step types, so undo is just the inverse list reversed.
 *
 * Which blocks are containers is the schema's call, so every step runs with
 * a `StepContext` carrying the schema the document is edited with.
 */

import type { BlockContent, PhrasingContent, Root } from '../ast/index.js';
import { childKey } from '../ast/index.js';
import type { Schema } from '../schema/index.js';
import type { InlineFlat } from './inline-flat.js';
import { spliceFlat, toFlat, toInline } from './inline-flat.js';
import type { EditorBlock, EditorParent } from './state.js';
import { buildIndex } from './state.js';

export type Step =
    /** Replace `[from, to)` of a text block's flat text with `slice`. */
    | { type: 'replaceInline'; key: string; from: number; to: number; slice: InlineFlat }
    /** Replace a text block's whole content (IME commit, surface read-back). */
    | { type: 'setInline'; key: string; flat: InlineFlat }
    /** Replace a code/html block's literal value. */
    | { type: 'setValue'; key: string; value: string }
    /** Merge attributes into a block (`depth`, `checked`, `lang`, `url`, `align`, `ordered`, `start`, `spread`, …). */
    | { type: 'setAttrs'; key: string; attrs: Record<string, unknown> }
    /** Replace a block by another node that keeps the same key. */
    | { type: 'replaceBlock'; key: string; node: EditorBlock }
    /** Insert a block at `index` under `parentKey` (`null` = root). */
    | { type: 'insertBlock'; parentKey: string | null; index: number; node: EditorBlock }
    /** Remove the block at `index` under `parentKey`. */
    | { type: 'removeBlock'; parentKey: string | null; index: number }
    /** Move a block to another position (possibly another parent). */
    | { type: 'moveBlock'; key: string; to: { parentKey: string | null; index: number } }
    /** Replace the whole document. */
    | { type: 'replaceDoc'; doc: Root };

export interface StepContext {
    schema: Schema;
}

export class StepError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StepError';
    }
}

// ---------------------------------------------------------------------------
// Structural sharing helpers
// ---------------------------------------------------------------------------

/** Return a copy of `root` where the block with `key` is replaced by `fn(old)`; every other node is shared. */
export function updateBlock(root: Root, key: string, fn: (node: EditorBlock) => EditorBlock, schema: Schema): Root {
    const index = buildIndex(root, schema);
    const entry = index.get(key);
    if (!entry) throw new StepError(`Unknown block key "${key}".`);
    // Path of parent keys from the root down to the block.
    const path: string[] = [];
    let cur = entry.parentKey;
    while (cur !== null) {
        path.unshift(cur);
        cur = index.get(cur)!.parentKey;
    }
    const rebuild = (parent: EditorParent, depth: number): EditorParent => {
        const children = (parent as { children: EditorBlock[] }).children;
        const targetKey = depth < path.length ? path[depth] : key;
        const i = children.findIndex((c) => c.key === targetKey);
        const next = children.slice();
        next[i] = depth < path.length ? (rebuild(children[i], depth + 1) as EditorBlock) : fn(children[i]);
        return { ...parent, children: next } as EditorParent;
    };
    return rebuild(root, 0) as Root;
}

/** Return a copy of `root` where the children array of `parentKey` (or the root) is replaced by `fn(old)`. */
export function updateChildren(root: Root, parentKey: string | null, fn: (children: EditorBlock[]) => EditorBlock[], schema: Schema): Root {
    if (parentKey === null) return { ...root, children: fn(root.children as EditorBlock[]) as BlockContent[] };
    return updateBlock(
        root,
        parentKey,
        (node) => {
            if (!schema.isContainer(node.type)) throw new StepError(`Block "${parentKey}" (${node.type}) cannot contain blocks.`);
            return { ...node, children: fn((node as { children: EditorBlock[] }).children) } as EditorBlock;
        },
        schema,
    );
}

/** Re-key a subtree so its nested keys hang off `key` (used when a node moves under a new parent/index). */
export function rekey(node: EditorBlock, key: string, schema: Schema): EditorBlock {
    if (!schema.isContainer(node.type)) return node.key === key ? node : { ...node, key };
    const children = ((node as { children: EditorBlock[] }).children ?? []).map((c, i) => rekey(c, childKey(key, i), schema));
    return { ...node, key, children } as EditorBlock;
}

/** Re-key the children of a container so they are `<parentKey>.<i>` (root children: `b-<i>`). */
export function rekeyChildren(children: EditorBlock[], parentKey: string | null, schema: Schema): EditorBlock[] {
    return children.map((c, i) => rekey(c, parentKey === null ? `b-${i}` : childKey(parentKey, i), schema));
}

// ---------------------------------------------------------------------------
// Inline access
// ---------------------------------------------------------------------------

function inlineChildren(node: EditorBlock, schema: Schema): PhrasingContent[] {
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children) || schema.isContainer(node.type)) {
        throw new StepError(`Block "${node.key}" (${node.type}) has no inline content.`);
    }
    return children as PhrasingContent[];
}

/** The flat model of a text block. */
export function flatOf(node: EditorBlock, ctx: StepContext): InlineFlat {
    return toFlat(inlineChildren(node, ctx.schema), ctx.schema);
}

// ---------------------------------------------------------------------------
// apply / invert
// ---------------------------------------------------------------------------

export function applyStep(root: Root, step: Step, ctx: StepContext): Root {
    const { schema } = ctx;
    switch (step.type) {
        case 'replaceInline':
            return updateBlock(
                root,
                step.key,
                (node) => {
                    const flat = flatOf(node, ctx);
                    if (step.from < 0 || step.to > flat.text.length || step.from > step.to) {
                        throw new StepError(`replaceInline range [${step.from}, ${step.to}) is outside "${step.key}" (length ${flat.text.length}).`);
                    }
                    const next = spliceFlat(flat, step.from, step.to, step.slice, schema);
                    return { ...node, children: toInline(next, schema) } as EditorBlock;
                },
                schema,
            );
        case 'setInline':
            return updateBlock(
                root,
                step.key,
                (node) => {
                    inlineChildren(node, schema);
                    return { ...node, children: toInline(step.flat, schema) } as EditorBlock;
                },
                schema,
            );
        case 'setValue':
            return updateBlock(
                root,
                step.key,
                (node) => {
                    if (typeof (node as { value?: unknown }).value !== 'string') throw new StepError(`Block "${step.key}" (${node.type}) has no value.`);
                    return { ...node, value: step.value } as EditorBlock;
                },
                schema,
            );
        case 'setAttrs':
            return updateBlock(
                root,
                step.key,
                (node) => {
                    const next = { ...node } as Record<string, unknown>;
                    for (const [k, v] of Object.entries(step.attrs)) {
                        if (k === 'type' || k === 'key' || k === 'children') continue;
                        if (v === undefined) delete next[k];
                        else next[k] = v;
                    }
                    return next as unknown as EditorBlock;
                },
                schema,
            );
        case 'replaceBlock':
            return updateBlock(root, step.key, () => rekey(step.node, step.key, schema), schema);
        case 'insertBlock':
            return updateChildren(
                root,
                step.parentKey,
                (children) => {
                    if (step.index < 0 || step.index > children.length) throw new StepError(`insertBlock index ${step.index} out of range.`);
                    const next = children.slice();
                    next.splice(step.index, 0, step.node);
                    return rekeyChildren(next, step.parentKey, schema);
                },
                schema,
            );
        case 'removeBlock':
            return updateChildren(
                root,
                step.parentKey,
                (children) => {
                    if (step.index < 0 || step.index >= children.length) throw new StepError(`removeBlock index ${step.index} out of range.`);
                    const next = children.slice();
                    next.splice(step.index, 1);
                    return rekeyChildren(next, step.parentKey, schema);
                },
                schema,
            );
        case 'moveBlock':
            return applyMove(root, step, schema).root;
        case 'replaceDoc':
            return step.doc;
    }
}

/**
 * Move a block in one rebuild pass: the moved node and the destination
 * parent are located by object identity in the ORIGINAL tree, so keys never
 * go stale mid-step. `to.index` is the FINAL index in the destination
 * (after the node has left its old position). Returns the node's final key.
 */
export function applyMove(root: Root, step: Extract<Step, { type: 'moveBlock' }>, schema: Schema): { root: Root; movedKey: string } {
    const index = buildIndex(root, schema);
    const entry = index.get(step.key);
    if (!entry) throw new StepError(`Unknown block key "${step.key}".`);
    const dest: EditorParent | undefined = step.to.parentKey === null ? root : (index.get(step.to.parentKey)?.node as EditorParent | undefined);
    if (!dest) throw new StepError(`Unknown parent key "${step.to.parentKey}".`);
    if (step.to.parentKey !== null && (step.to.parentKey === step.key || step.to.parentKey.startsWith(step.key + '.'))) {
        throw new StepError('Cannot move a block into itself.');
    }
    if (step.to.parentKey !== null && !schema.isContainer(dest.type)) {
        throw new StepError(`Block "${step.to.parentKey}" (${dest.type}) cannot contain blocks.`);
    }
    const moved = entry.node;
    let movedKey = '';

    const keyFor = (parentKey: string | null, i: number): string => (parentKey === null ? `b-${i}` : childKey(parentKey, i));
    const rebuild = (parent: EditorParent, parentKey: string | null): EditorParent => {
        const children = (parent as { children?: EditorBlock[] }).children;
        if (!children) return parent;
        const isSource = parent === entry.parent;
        const isDest = parent === dest;
        if (!isSource && !isDest && !containsAny(parent, [entry.parent, dest], schema)) {
            return parentKey === null || (parent as EditorBlock).key === parentKey ? parent : rekey(parent as EditorBlock, parentKey, schema);
        }
        let next = isSource ? children.filter((c) => c !== moved) : children.slice();
        if (isDest) next.splice(Math.max(0, Math.min(step.to.index, next.length)), 0, moved);
        next = next.map((c, i) => {
            const k = keyFor(parentKey, i);
            if (c === moved) {
                movedKey = k;
                return rekey(c, k, schema);
            }
            return schema.isContainer(c.type) ? (rebuild(c, k) as EditorBlock) : rekey(c, k, schema);
        });
        return (parentKey === null ? { ...parent, children: next } : { ...parent, key: parentKey, children: next }) as EditorParent;
    };
    const next = rebuild(root, null) as Root;
    return { root: next, movedKey };
}

/** Whether `parent` has any of `targets` in its subtree (by identity). */
function containsAny(parent: EditorParent, targets: EditorParent[], schema: Schema): boolean {
    const children = (parent as { children?: EditorBlock[] }).children;
    if (!children) return false;
    for (const c of children) {
        if (targets.includes(c)) return true;
        if (schema.isContainer(c.type) && containsAny(c, targets, schema)) return true;
    }
    return false;
}

/** The step that undoes `step`, computed against the document BEFORE it is applied. */
export function invertStep(root: Root, step: Step, ctx: StepContext): Step {
    const { schema } = ctx;
    switch (step.type) {
        case 'replaceInline': {
            const node = getBlock(root, step.key, schema);
            const flat = flatOf(node, ctx);
            const removed = { text: flat.text.slice(step.from, step.to), spans: sliceSpans(flat, step.from, step.to) };
            return { type: 'replaceInline', key: step.key, from: step.from, to: step.from + step.slice.text.length, slice: removed };
        }
        case 'setInline':
            return { type: 'setInline', key: step.key, flat: flatOf(getBlock(root, step.key, schema), ctx) };
        case 'setValue':
            return { type: 'setValue', key: step.key, value: (getBlock(root, step.key, schema) as { value: string }).value };
        case 'setAttrs': {
            const node = getBlock(root, step.key, schema) as unknown as Record<string, unknown>;
            const attrs: Record<string, unknown> = {};
            for (const k of Object.keys(step.attrs)) attrs[k] = node[k];
            return { type: 'setAttrs', key: step.key, attrs };
        }
        case 'replaceBlock':
            return { type: 'replaceBlock', key: step.key, node: getBlock(root, step.key, schema) };
        case 'insertBlock':
            return { type: 'removeBlock', parentKey: step.parentKey, index: step.index };
        case 'removeBlock': {
            const children = childrenOf(root, step.parentKey, schema);
            return { type: 'insertBlock', parentKey: step.parentKey, index: step.index, node: children[step.index] };
        }
        case 'moveBlock': {
            const entry = buildIndex(root, schema).get(step.key);
            if (!entry) throw new StepError(`Unknown block key "${step.key}".`);
            // The inverse addresses the node by the key it has AFTER the move and
            // sends it back to its original parent, by that parent's post-move key.
            const { root: after, movedKey } = applyMove(root, step, schema);
            const originalParentKey = entry.parentKey === null ? null : (findKey(after, entry.parent as EditorBlock, schema) ?? entry.parentKey);
            return { type: 'moveBlock', key: movedKey, to: { parentKey: originalParentKey, index: entry.index } };
        }
        case 'replaceDoc':
            return { type: 'replaceDoc', doc: root };
    }
}

function sliceSpans(flat: InlineFlat, from: number, to: number) {
    const out = [];
    for (const s of flat.spans) {
        const start = Math.max(s.start, from);
        const end = Math.min(s.end, to);
        if (end > start) out.push({ ...s, start: start - from, end: end - from });
    }
    return out;
}

/**
 * Find the post-step key of a container that existed before the step. A
 * container is re-keyed by copying, so it is matched by the identity of the
 * children it still shares with its old self.
 */
function findKey(root: Root, node: EditorBlock, schema: Schema): string | undefined {
    const oldChildren = (node as { children?: EditorBlock[] }).children ?? [];
    const index = buildIndex(root, schema);
    for (const k of index.keys()) {
        const n = index.get(k)!.node;
        if (n === node) return k;
        if (n.type !== node.type || !schema.isContainer(n.type)) continue;
        const children = (n as { children?: EditorBlock[] }).children ?? [];
        if (children.some((c) => oldChildren.includes(c)) || (children.length === 0 && oldChildren.length === 0)) return k;
    }
    return undefined;
}

export function getBlock(root: Root, key: string, schema: Schema): EditorBlock {
    const entry = buildIndex(root, schema).get(key);
    if (!entry) throw new StepError(`Unknown block key "${key}".`);
    return entry.node;
}

function childrenOf(root: Root, parentKey: string | null, schema: Schema): EditorBlock[] {
    if (parentKey === null) return root.children as EditorBlock[];
    const node = getBlock(root, parentKey, schema);
    return (node as { children: EditorBlock[] }).children;
}
