/**
 * Editor state: an immutable mdast `Root` with structural sharing, a
 * key-addressed selection, and a lazily built index.
 *
 * Why immutable rather than a deep reactive proxy of the tree: every
 * transaction copies only the spine down to the changed block, so an untouched
 * block keeps its object identity, a `BlockView` bound to it never re-renders,
 * and its surface is never touched — that IS the echo-suppression story.
 * Inverse steps for undo simply hold the previous node by reference.
 * Reactivity is exposed through one `rev` signal (bumped per transaction) on
 * the editor instance, not through the tree.
 */

import type { BlockContent, ListItem, Root, TableCell, TableRow } from '../ast/index.js';
import { assignKeys } from '../ast/index.js';

/** A block-level node the editor addresses: mdast block content plus list items, table rows and cells. */
export type EditorBlock = BlockContent | ListItem | TableRow | TableCell;

/** Nodes that contain other editor blocks. */
export type EditorParent = Root | EditorBlock;

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** A position inside an inline container or a code block: the block's key and a UTF-16 offset into its `InlineFlat.text` / `value`. */
export interface Point {
    key: string;
    offset: number;
}

/** A text selection within ONE block (v1: `anchor.key === head.key`). */
export interface TextSelection {
    mode: 'text';
    anchor: Point;
    head: Point;
}

/** A selection of contiguous sibling blocks, from `anchorKey` to `headKey` (either order). */
export interface BlockSelection {
    mode: 'block';
    anchorKey: string;
    headKey: string;
}

export type EditorSelection = TextSelection | BlockSelection | null;

export function textSelection(key: string, from: number, to = from): TextSelection {
    return { mode: 'text', anchor: { key, offset: from }, head: { key, offset: to } };
}

export function blockSelection(anchorKey: string, headKey = anchorKey): BlockSelection {
    return { mode: 'block', anchorKey, headKey };
}

/** The ordered `[from, to]` offsets of a text selection. */
export function selectionRange(sel: TextSelection): { from: number; to: number } {
    const a = sel.anchor.offset;
    const h = sel.head.offset;
    return a <= h ? { from: a, to: h } : { from: h, to: a };
}

export function selectionEquals(a: EditorSelection, b: EditorSelection): boolean {
    if (a === b) return true;
    if (!a || !b || a.mode !== b.mode) return false;
    if (a.mode === 'text' && b.mode === 'text') {
        return a.anchor.key === b.anchor.key && a.anchor.offset === b.anchor.offset && a.head.key === b.head.key && a.head.offset === b.head.offset;
    }
    if (a.mode === 'block' && b.mode === 'block') return a.anchorKey === b.anchorKey && a.headKey === b.headKey;
    return false;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export interface BlockEntry {
    node: EditorBlock;
    parent: EditorParent;
    parentKey: string | null;
    index: number;
    depth: number;
}

export interface BlockIndex {
    get(key: string): BlockEntry | undefined;
    /** Every keyed block in document order. */
    keys(): readonly string[];
    /** Keys of the blocks that hold editable text (inline containers and code blocks), in document order. */
    editable(): readonly string[];
    prevEditable(key: string): string | null;
    nextEditable(key: string): string | null;
}

/** Which block types hold editable text. Containers (list, listItem, blockquote, table, tableRow) do not. */
export const EDITABLE_TYPES: ReadonlySet<string> = new Set(['paragraph', 'heading', 'tableCell', 'code', 'html']);

export function buildIndex(doc: Root, editableTypes: ReadonlySet<string> = EDITABLE_TYPES): BlockIndex {
    const map = new Map<string, BlockEntry>();
    const keys: string[] = [];
    const editable: string[] = [];
    /** Position of each editable key in `editable`, so neighbour lookups are O(1). */
    const editableAt = new Map<string, number>();

    const walk = (parent: EditorParent, parentKey: string | null, depth: number): void => {
        const children = (parent as { children?: unknown[] }).children as EditorBlock[] | undefined;
        if (!children) return;
        children.forEach((node, index) => {
            const key = node.key;
            if (!key) return;
            map.set(key, { node, parent, parentKey, index, depth });
            keys.push(key);
            if (editableTypes.has(node.type)) {
                editableAt.set(key, editable.length);
                editable.push(key);
            }
            if (isContainerType(node.type)) walk(node, key, depth + 1);
        });
    };
    walk(doc, null, 0);

    return {
        get: (key) => map.get(key),
        keys: () => keys,
        editable: () => editable,
        prevEditable: (key) => {
            const i = editableAt.get(key) ?? -1;
            return i > 0 ? editable[i - 1] : null;
        },
        nextEditable: (key) => {
            const i = editableAt.get(key) ?? -1;
            return i >= 0 && i < editable.length - 1 ? editable[i + 1] : null;
        },
    };
}

/** Block types whose children are keyed editor blocks (not phrasing content). */
export function isContainerType(type: string): boolean {
    return type === 'blockquote' || type === 'list' || type === 'listItem' || type === 'table' || type === 'tableRow';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface EditorState {
    readonly doc: Root;
    readonly selection: EditorSelection;
    /** Bumped per applied transaction. */
    readonly rev: number;
    /** An inline surface has an open IME composition. */
    readonly composing: boolean;
    /** The block index, built on first use and memoised on this state. */
    index(): BlockIndex;
}

export interface CreateStateOptions {
    editableTypes?: ReadonlySet<string>;
}

/** Build a state around a document. The document is normalised in place (see `normalizeDoc`). */
export function createState(doc: Root, selection: EditorSelection = null, options?: CreateStateOptions): EditorState {
    return makeState(normalizeDoc(doc), selection, 0, false, options?.editableTypes);
}

/**
 * Make a document editable, in place: an empty root gets one paragraph, an
 * empty list item or blockquote gets one empty paragraph (markdown cannot
 * express these, but a caret needs somewhere to live), and every block-level
 * node gets a key when any is missing. Returns the same object.
 *
 * Only *empty* containers are filled. A list item or blockquote that has
 * content but no paragraph of its own (`- - a`, a quote holding one code
 * block) is left as it is — the caret enters its first editable descendant
 * (see `BlockEditorSpec.entry`), and inserting a paragraph there would
 * rewrite the user's document on load.
 */
export function normalizeDoc(doc: Root): Root {
    if (doc.children.length === 0) doc.children.push({ type: 'paragraph', children: [] });
    const fill = (node: EditorBlock): void => {
        if (!isContainerType(node.type)) return;
        const container = node as { children: EditorBlock[] };
        if (!container.children) container.children = [];
        if ((node.type === 'listItem' || node.type === 'blockquote') && container.children.length === 0) {
            container.children.push({ type: 'paragraph', children: [] });
        }
        for (const child of container.children) fill(child);
    };
    for (const child of doc.children) fill(child);
    if (!doc.children.every(hasKeys)) assignKeys(doc);
    return doc;
}

function hasKeys(node: EditorBlock): boolean {
    if (!node.key) return false;
    if (!isContainerType(node.type)) return true;
    return ((node as { children: EditorBlock[] }).children ?? []).every(hasKeys);
}

export function makeState(
    doc: Root,
    selection: EditorSelection,
    rev: number,
    composing: boolean,
    editableTypes?: ReadonlySet<string>,
): EditorState {
    let index: BlockIndex | null = null;
    return {
        doc,
        selection,
        rev,
        composing,
        index: () => (index ??= buildIndex(doc, editableTypes)),
    };
}

/** An empty document: one empty paragraph, caret at its start. */
export function emptyDoc(): Root {
    return { type: 'root', children: [{ type: 'paragraph', key: 'b-0', children: [] }] };
}
