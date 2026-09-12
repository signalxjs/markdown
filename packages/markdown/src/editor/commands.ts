/**
 * Commands — every user-level edit, written once against the state and
 * expressed as a transaction. A command returns `false` when it does not
 * apply (so a keymap can fall through) and, when given `dispatch`, submits
 * its transaction. Commands are pure: they read the state and produce steps;
 * surfaces and views never edit the tree themselves.
 */

import type { BlockContent, List, ListItem, PhrasingContent, Root, Table, TableCell, TableRow } from '../ast/index.js';
import type { InlineFlat, InlineFlatOptions } from './inline-flat.js';
import { ATOM_CHAR, addMark, concatFlat, marksAt, removeMark, sliceFlat, toFlat, toInline, toggleMark as toggleFlatMark } from './inline-flat.js';
import type { Schema } from './schema.js';
import type { BlockEntry, EditorBlock, EditorSelection, EditorState, TextSelection } from './state.js';
import { blockSelection, isContainerType, normalizeDoc, selectionRange, textSelection } from './state.js';
import type { Step } from './steps.js';
import { flatOf } from './steps.js';
import type { Transaction, TransactionMeta } from './transaction.js';

export interface CommandContext {
    schema: Schema;
    inline?: InlineFlatOptions;
    /** Parse markdown into blocks (for paste and `setMarkdown`). Provided by the editor instance. */
    parse?: (markdown: string) => Root;
}

export type Dispatch = (tr: Transaction) => void;

/** A command: inspect `state`, optionally dispatch, report applicability. */
export type Command = (state: EditorState, dispatch: Dispatch | undefined, ctx: CommandContext) => boolean;

const meta = (extra: Partial<TransactionMeta> = {}): TransactionMeta => ({ origin: 'command', ...extra });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textSel(state: EditorState): TextSelection | null {
    return state.selection && state.selection.mode === 'text' ? state.selection : null;
}

function entryOf(state: EditorState, key: string): BlockEntry | undefined {
    return state.index().get(key);
}

function inlineFlat(state: EditorState, key: string, ctx: CommandContext): InlineFlat | null {
    const entry = entryOf(state, key);
    if (!entry || ctx.schema.kind(entry.node.type) !== 'inline') return null;
    return flatOf(entry.node, { inline: ctx.inline });
}

function isInline(state: EditorState, key: string, ctx: CommandContext): boolean {
    const entry = entryOf(state, key);
    return !!entry && ctx.schema.kind(entry.node.type) === 'inline';
}

/** First editable descendant of a block (or itself). */
function firstEditable(node: EditorBlock, ctx: CommandContext): EditorBlock | undefined {
    const kind = ctx.schema.kind(node.type);
    if (kind === 'inline' || kind === 'code') return node;
    const spec = ctx.schema.get(node.type);
    if (spec?.entry) {
        const e = spec.entry(node);
        if (e) return firstEditable(e, ctx);
    }
    for (const child of ((node as { children?: EditorBlock[] }).children ?? [])) {
        const found = firstEditable(child, ctx);
        if (found) return found;
    }
    return undefined;
}

function lastEditable(node: EditorBlock, ctx: CommandContext): EditorBlock | undefined {
    const kind = ctx.schema.kind(node.type);
    if (kind === 'inline' || kind === 'code') return node;
    const children = (node as { children?: EditorBlock[] }).children ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
        const found = lastEditable(children[i], ctx);
        if (found) return found;
    }
    return undefined;
}

function lengthOf(node: EditorBlock, ctx: CommandContext): number {
    const kind = ctx.schema.kind(node.type);
    if (kind === 'code') return (node as { value: string }).value.length;
    if (kind === 'inline') return toFlat((node as { children: PhrasingContent[] }).children, ctx.inline).text.length;
    return 0;
}

function paragraph(children: PhrasingContent[] = []): BlockContent {
    return { type: 'paragraph', children };
}

function listItem(children: BlockContent[], checked?: boolean | null): ListItem {
    const item: ListItem = { type: 'listItem', spread: false, children };
    if (checked !== undefined && checked !== null) item.checked = checked;
    return item;
}

/** The key a node will have after `insertBlock` under `parentKey` at `index`. */
function keyAt(parentKey: string | null, index: number): string {
    return parentKey === null ? `b-${index}` : `${parentKey}.${index}`;
}

/** The nearest ancestor (or self) entry of a given type. */
function ancestor(state: EditorState, key: string, type: string): BlockEntry | undefined {
    let cur = entryOf(state, key);
    while (cur) {
        if (cur.node.type === type) return cur;
        if (cur.parentKey === null) return undefined;
        cur = entryOf(state, cur.parentKey);
    }
    return undefined;
}

/** The list item and list around a block, when it lives directly in a list item's first paragraph. */
function listContext(state: EditorState, key: string): { item: BlockEntry; list: BlockEntry; itemIndex: number } | null {
    const entry = entryOf(state, key);
    if (!entry || entry.parent.type !== 'listItem' || entry.index !== 0) return null;
    const item = entryOf(state, entry.parentKey!)!;
    if (item.parent.type !== 'list') return null;
    const list = entryOf(state, item.parentKey!)!;
    return { item, list, itemIndex: item.index };
}

// ---------------------------------------------------------------------------
// Inline commands
// ---------------------------------------------------------------------------

/** Replace the selection (or insert at the caret) with text that inherits the marks at the selection. */
export const insertText =
    (text: string, opts: { group?: string; origin?: TransactionMeta['origin'] } = {}): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const key = sel.anchor.key;
        const entry = entryOf(state, key);
        if (!entry) return false;
        const { from, to } = selectionRange(sel);
        if (ctx.schema.kind(entry.node.type) === 'code') {
            const value = (entry.node as { value: string }).value;
            dispatch?.({
                steps: [{ type: 'setValue', key, value: value.slice(0, from) + text + value.slice(to) }],
                selection: textSelection(key, from + text.length),
                meta: meta({ group: opts.group ?? 'typing', origin: opts.origin ?? 'command' }),
            });
            return true;
        }
        const flat = inlineFlat(state, key, ctx);
        if (!flat) return false;
        const marks = marksAt(flat, from, to);
        const slice: InlineFlat = { text, spans: text ? marks.filter((m) => m !== 'link' || from < to).map((type) => ({ start: 0, end: text.length, type, attrs: flat.spans.find((s) => s.type === type)?.attrs })) : [] };
        for (const s of slice.spans) if (!s.attrs) delete s.attrs;
        dispatch?.({
            steps: [{ type: 'replaceInline', key, from, to, slice }],
            selection: textSelection(key, from + text.length),
            meta: meta({ group: opts.group ?? 'typing', origin: opts.origin ?? 'command' }),
        });
        return true;
    };

/** Replace `[from, to)` of a block with a flat slice (paste, chips, plugin insertions). */
export const replaceRange =
    (key: string, from: number, to: number, slice: InlineFlat, opts: { group?: string } = {}): Command =>
    (state, dispatch, ctx) => {
        if (!isInline(state, key, ctx)) return false;
        dispatch?.({
            steps: [{ type: 'replaceInline', key, from, to, slice }],
            selection: textSelection(key, from + slice.text.length),
            meta: meta({ group: opts.group }),
        });
        return true;
    };

/** Toggle a mark over the selection. Collapsed selections are a surface concern (typing attributes) and return false. */
export const toggleMark =
    (type: string, attrs?: Record<string, string>): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const { from, to } = selectionRange(sel);
        if (from === to) return false;
        const flat = inlineFlat(state, sel.anchor.key, ctx);
        if (!flat) return false;
        const next = toggleFlatMark(flat, type, from, to, attrs);
        dispatch?.({ steps: [{ type: 'setInline', key: sel.anchor.key, flat: next }], selection: sel, meta: meta() });
        return true;
    };

export const setLink =
    (url: string, title?: string): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const { from, to } = selectionRange(sel);
        const flat = inlineFlat(state, sel.anchor.key, ctx);
        if (!flat) return false;
        const attrs: Record<string, string> = { url };
        if (title) attrs.title = title;
        if (from === to) {
            // No selection: insert the url as its own linked text, as an autolink (`<url>`).
            const slice: InlineFlat = { text: url, spans: [{ start: 0, end: url.length, type: 'link', attrs: { ...attrs, autolink: 'true' } }] };
            dispatch?.({ steps: [{ type: 'replaceInline', key: sel.anchor.key, from, to, slice }], selection: textSelection(sel.anchor.key, from + url.length), meta: meta() });
            return true;
        }
        const next = addMark(removeMark(flat, 'link', from, to), 'link', from, to, attrs);
        dispatch?.({ steps: [{ type: 'setInline', key: sel.anchor.key, flat: next }], selection: sel, meta: meta() });
        return true;
    };

export const unsetLink: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const flat = inlineFlat(state, sel.anchor.key, ctx);
    if (!flat) return false;
    let { from, to } = selectionRange(sel);
    if (from === to) {
        const span = flat.spans.find((s) => s.type === 'link' && s.start <= from && s.end >= from);
        if (!span) return false;
        from = span.start;
        to = span.end;
    }
    dispatch?.({ steps: [{ type: 'setInline', key: sel.anchor.key, flat: removeMark(flat, 'link', from, to) }], selection: sel, meta: meta() });
    return true;
};

/** Insert an atom (image, mention, …) at the selection, replacing it. */
export const insertAtom =
    (type: string, attrs: Record<string, string>, replace?: { from: number; to: number }): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const key = sel.anchor.key;
        if (!isInline(state, key, ctx)) return false;
        const { from, to } = replace ?? selectionRange(sel);
        const slice: InlineFlat = { text: ATOM_CHAR, spans: [{ start: 0, end: 1, type, attrs }] };
        dispatch?.({ steps: [{ type: 'replaceInline', key, from, to, slice }], selection: textSelection(key, from + 1), meta: meta() });
        return true;
    };

export const insertHardBreak: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry || !ctx.schema.get(entry.node.type)?.allowsHardBreak) return false;
    return insertText('\n', { group: undefined })(state, dispatch, ctx);
};

// ---------------------------------------------------------------------------
// Block commands
// ---------------------------------------------------------------------------

/**
 * Enter: split the block at the caret. An empty list item outdents (or becomes
 * a paragraph at the top level); an empty trailing paragraph in a blockquote
 * lifts out; a heading splits into a paragraph; a code block inserts a newline
 * (leave it with `exitCode`).
 */
export const splitBlock: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const key = sel.anchor.key;
    const entry = entryOf(state, key);
    if (!entry) return false;
    const kind = ctx.schema.kind(entry.node.type);
    if (kind === 'code') return insertText('\n')(state, dispatch, ctx);
    if (kind !== 'inline') return false;
    const flat = inlineFlat(state, key, ctx)!;
    const { from, to } = selectionRange(sel);

    // Empty list item: outdent / lift to a paragraph.
    const lc = listContext(state, key);
    if (lc && flat.text.length === 0 && (lc.item.node as ListItem).children.length === 1) {
        return outdentListItem(state, dispatch, ctx) || liftEmptyItem(state, dispatch, ctx, lc);
    }
    // Empty last paragraph in a blockquote: lift out.
    if (flat.text.length === 0 && entry.parent.type === 'blockquote' && entry.index === (entry.parent as { children: unknown[] }).children.length - 1) {
        return liftOutOfBlockquote(state, dispatch, ctx);
    }
    // Table cells never split.
    if (entry.node.type === 'tableCell') return false;

    const head = sliceFlat(flat, 0, from);
    const tail = sliceFlat(flat, to, flat.text.length);
    const spec = ctx.schema.get(entry.node.type)!;
    const atEnd = to === flat.text.length;
    const nextType = atEnd && spec.splitsTo ? spec.splitsTo : entry.node.type;
    const nextSpec = ctx.schema.get(nextType)!;
    const attrs = nextType === entry.node.type ? ownAttrs(entry.node) : {};
    const nextNode = nextSpec.fromInline!(toInline(tail, ctx.inline), attrs);

    const steps: Step[] = [];
    let newKey: string;
    if (lc) {
        // Split the list item: the new paragraph starts a new item carrying the rest of the old item's blocks.
        const item = lc.item.node as ListItem;
        const rest = item.children.slice(1);
        const checked = item.checked;
        steps.push({ type: 'setInline', key, flat: head });
        if (rest.length) {
            steps.push({ type: 'replaceBlock', key: item.key!, node: listItem([item.children[0]], checked) });
        }
        steps.push({ type: 'insertBlock', parentKey: lc.list.node.key!, index: lc.itemIndex + 1, node: listItem([nextNode as BlockContent, ...rest], checked === undefined ? undefined : false) });
        newKey = `${keyAt(lc.list.node.key!, lc.itemIndex + 1)}.0`;
    } else {
        steps.push({ type: 'setInline', key, flat: head });
        steps.push({ type: 'insertBlock', parentKey: entry.parentKey, index: entry.index + 1, node: nextNode as EditorBlock });
        newKey = keyAt(entry.parentKey, entry.index + 1);
    }
    dispatch?.({ steps, selection: textSelection(newKey, 0), meta: meta() });
    return true;
};

function ownAttrs(node: EditorBlock): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && k !== 'key' && k !== 'children' && k !== 'position' && k !== 'value') out[k] = v;
    return out;
}

function liftEmptyItem(state: EditorState, dispatch: Dispatch | undefined, ctx: CommandContext, lc: NonNullable<ReturnType<typeof listContext>>): boolean {
    // Top-level list: turn the item into a paragraph after the list (splitting the list when the item is in the middle).
    const list = lc.list.node as List;
    const before = list.children.slice(0, lc.itemIndex);
    const after = list.children.slice(lc.itemIndex + 1);
    const steps: Step[] = [];
    const listEntry = lc.list;
    const at = listEntry.index;
    if (before.length === 0 && after.length === 0) {
        steps.push({ type: 'replaceBlock', key: list.key!, node: paragraph() });
        dispatch?.({ steps, selection: textSelection(list.key!, 0), meta: meta() });
        return true;
    }
    if (before.length) steps.push({ type: 'replaceBlock', key: list.key!, node: { ...list, children: before } });
    else steps.push({ type: 'removeBlock', parentKey: listEntry.parentKey, index: at });
    const insertAt = before.length ? at + 1 : at;
    steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt, node: paragraph() });
    if (after.length) steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt + 1, node: { ...list, children: after } });
    void ctx;
    void state;
    dispatch?.({ steps, selection: textSelection(keyAt(listEntry.parentKey, insertAt), 0), meta: meta() });
    return true;
}

/** Backspace at offset 0: join with the previous editable block, or lift a list item / quote paragraph. */
export const joinBackward: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const { from, to } = selectionRange(sel);
    if (from !== 0 || to !== 0) return false;
    const key = sel.anchor.key;
    const entry = entryOf(state, key);
    if (!entry) return false;
    const kind = ctx.schema.kind(entry.node.type);
    if (kind !== 'inline' && kind !== 'code') return false;

    // A non-paragraph inline block first becomes a paragraph.
    if (entry.node.type !== 'paragraph' && entry.node.type !== 'tableCell') {
        return setBlockType('paragraph')(state, dispatch, ctx);
    }
    if (entry.node.type === 'tableCell') return false;
    const lc = listContext(state, key);
    if (lc) return outdentListItem(state, dispatch, ctx) || liftEmptyItemWithContent(state, dispatch, ctx, lc);
    if (entry.parent.type === 'blockquote' && entry.index === 0) return liftOutOfBlockquote(state, dispatch, ctx);

    // A void block right before this one is selected instead of merged into.
    const prevTop = prevBlockOf(state, entry);
    if (prevTop && ctx.schema.kind(prevTop.node.type) === 'void') {
        dispatch?.({ steps: [], selection: blockSelection(prevTop.node.key!), meta: meta() });
        return true;
    }
    const prevKey = state.index().prevEditable(key);
    if (!prevKey) return false;
    const prev = entryOf(state, prevKey)!;
    // A code block before: move the caret to its end instead of merging.
    if (ctx.schema.kind(prev.node.type) !== 'inline') {
        dispatch?.({ steps: [], selection: textSelection(prevKey, lengthOf(prev.node, ctx)), meta: meta() });
        return true;
    }
    const prevFlat = flatOf(prev.node, { inline: ctx.inline });
    const flat = inlineFlat(state, key, ctx)!;
    const merged = concatFlat(prevFlat, flat);
    const steps: Step[] = [{ type: 'setInline', key: prevKey, flat: merged }, ...removeSteps(state, entry)];
    dispatch?.({ steps, selection: textSelection(prevKey, prevFlat.text.length), meta: meta() });
    return true;
};

function prevBlockOf(state: EditorState, entry: BlockEntry): BlockEntry | undefined {
    if (entry.index > 0) {
        const siblings = (entry.parent as { children: EditorBlock[] }).children;
        return entryOf(state, siblings[entry.index - 1].key!);
    }
    return entry.parentKey === null ? undefined : prevBlockOf(state, entryOf(state, entry.parentKey)!);
}

/** Steps that remove a block, and its parent when that becomes empty (list items, lists, quotes). */
function removeSteps(state: EditorState, entry: BlockEntry): Step[] {
    const siblings = (entry.parent as { children: EditorBlock[] }).children;
    if (siblings.length === 1 && entry.parentKey !== null) {
        const parent = entryOf(state, entry.parentKey)!;
        if (parent.node.type === 'listItem' || parent.node.type === 'list' || parent.node.type === 'blockquote') return removeSteps(state, parent);
    }
    return [{ type: 'removeBlock', parentKey: entry.parentKey, index: entry.index }];
}

function liftEmptyItemWithContent(state: EditorState, dispatch: Dispatch | undefined, ctx: CommandContext, lc: NonNullable<ReturnType<typeof listContext>>): boolean {
    // Top-level item with content: the item becomes a paragraph (+ its other blocks) after the preceding items.
    const list = lc.list.node as List;
    const item = lc.item.node as ListItem;
    const before = list.children.slice(0, lc.itemIndex);
    const after = list.children.slice(lc.itemIndex + 1);
    const listEntry = lc.list;
    const at = listEntry.index;
    const steps: Step[] = [];
    if (before.length) steps.push({ type: 'replaceBlock', key: list.key!, node: { ...list, children: before } });
    else steps.push({ type: 'removeBlock', parentKey: listEntry.parentKey, index: at });
    let insertAt = before.length ? at + 1 : at;
    const firstKey = keyAt(listEntry.parentKey, insertAt);
    for (const child of item.children) steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt++, node: child });
    if (after.length) steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt, node: { ...list, children: after } });
    void state;
    void ctx;
    dispatch?.({ steps, selection: textSelection(firstKey, 0), meta: meta() });
    return true;
}

/** Delete at the end: join the next editable block into this one. */
export const joinForward: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const key = sel.anchor.key;
    const entry = entryOf(state, key);
    if (!entry || ctx.schema.kind(entry.node.type) !== 'inline') return false;
    const flat = inlineFlat(state, key, ctx)!;
    const { from, to } = selectionRange(sel);
    if (from !== flat.text.length || to !== from) return false;
    const nextKey = state.index().nextEditable(key);
    if (!nextKey) return false;
    const next = entryOf(state, nextKey)!;
    if (ctx.schema.kind(next.node.type) !== 'inline' || next.node.type === 'tableCell') {
        dispatch?.({ steps: [], selection: textSelection(nextKey, 0), meta: meta() });
        return true;
    }
    const merged = concatFlat(flat, flatOf(next.node, { inline: ctx.inline }));
    const steps: Step[] = [{ type: 'setInline', key, flat: merged }, ...removeSteps(state, next)];
    dispatch?.({ steps, selection: textSelection(key, flat.text.length), meta: meta() });
    return true;
};

/** Convert the current block (or every block in a block selection) to another inline/code type. */
export const setBlockType =
    (type: string, attrs?: Record<string, unknown>): Command =>
    (state, dispatch, ctx) => {
        const target = ctx.schema.get(type);
        if (!target || !target.fromInline) return false;
        const keys = selectedBlockKeys(state);
        if (!keys.length) return false;
        const steps: Step[] = [];
        for (const key of keys) {
            const entry = entryOf(state, key);
            if (!entry) continue;
            const source = ctx.schema.get(entry.node.type);
            if (!source?.toInline) continue;
            if (entry.node.type === 'tableCell') continue;
            if (entry.node.type === type) {
                if (attrs) steps.push({ type: 'setAttrs', key, attrs });
                continue;
            }
            const children = source.toInline(entry.node);
            steps.push({ type: 'replaceBlock', key, node: target.fromInline(children, attrs) });
        }
        if (!steps.length) return false;
        const sel = state.selection;
        dispatch?.({ steps, selection: sel && sel.mode === 'text' ? clampSelection(sel, state, ctx, type) : sel, meta: meta() });
        return true;
    };

function clampSelection(sel: TextSelection, state: EditorState, ctx: CommandContext, targetType: string): EditorSelection {
    // Keep the caret; the surface clamps on its side too. Hard breaks may vanish (heading), so clamp offsets.
    const entry = entryOf(state, sel.anchor.key);
    if (!entry) return sel;
    const kind = ctx.schema.kind(targetType);
    const len = kind === 'code' ? (ctx.schema.get(entry.node.type)?.toInline?.(entry.node) ?? []).reduce((n, c) => n + ((c as { value?: string }).value?.length ?? 1), 0) : Infinity;
    return { mode: 'text', anchor: { key: sel.anchor.key, offset: Math.min(sel.anchor.offset, len) }, head: { key: sel.head.key, offset: Math.min(sel.head.offset, len) } };
}

/** Keys the current selection covers: the text block, or the blocks of a block selection. */
export function selectedBlockKeys(state: EditorState): string[] {
    const sel = state.selection;
    if (!sel) return [];
    if (sel.mode === 'text') return [sel.anchor.key];
    const a = entryOf(state, sel.anchorKey);
    const h = entryOf(state, sel.headKey);
    if (!a || !h || a.parentKey !== h.parentKey) return [sel.anchorKey];
    const siblings = (a.parent as { children: EditorBlock[] }).children;
    const [from, to] = a.index <= h.index ? [a.index, h.index] : [h.index, a.index];
    return siblings.slice(from, to + 1).map((n) => n.key!);
}

export type ListKind = 'bullet' | 'ordered' | 'task';

function listKindOf(list: List, item: ListItem): ListKind {
    if (item.checked !== undefined && item.checked !== null) return 'task';
    return list.ordered ? 'ordered' : 'bullet';
}

/** Wrap the current paragraph(s) in a list of `kind`, change the kind, or unwrap when already that kind. */
export const toggleList =
    (kind: ListKind): Command =>
    (state, dispatch, ctx) => {
        const keys = selectedBlockKeys(state);
        if (!keys.length) return false;
        const first = entryOf(state, keys[0]);
        if (!first) return false;
        const lc = listContext(state, keys[0]);
        if (lc) {
            const list = lc.list.node as List;
            const current = listKindOf(list, lc.item.node as ListItem);
            if (current === kind) return liftEmptyItemWithContent(state, dispatch, ctx, lc);
            // Change the kind of the whole list.
            const steps: Step[] = [{ type: 'setAttrs', key: list.key!, attrs: { ordered: kind === 'ordered', start: kind === 'ordered' ? 1 : null } }];
            for (const item of list.children) {
                steps.push({ type: 'setAttrs', key: item.key!, attrs: { checked: kind === 'task' ? item.checked ?? false : undefined } });
            }
            dispatch?.({ steps, selection: state.selection, meta: meta() });
            return true;
        }
        // Wrap: consecutive selected siblings become one list.
        const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e && ctx.schema.kind(e.node.type) === 'inline' && e.node.type !== 'tableCell');
        if (!entries.length) return false;
        const parentKey = entries[0].parentKey;
        const startIndex = entries[0].index;
        const items = entries.map((e) => listItem([e.node as BlockContent], kind === 'task' ? false : undefined));
        const list: List = { type: 'list', ordered: kind === 'ordered', spread: false, children: items };
        if (kind === 'ordered') list.start = 1;
        const steps: Step[] = [];
        for (let i = entries.length - 1; i >= 0; i--) steps.push({ type: 'removeBlock', parentKey, index: entries[i].index });
        steps.push({ type: 'insertBlock', parentKey, index: startIndex, node: list });
        const sel = state.selection;
        const listKey = keyAt(parentKey, startIndex);
        const selection: EditorSelection =
            sel && sel.mode === 'text'
                ? { mode: 'text', anchor: { key: `${listKey}.0.0`, offset: sel.anchor.offset }, head: { key: `${listKey}.0.0`, offset: sel.head.offset } }
                : blockSelection(listKey);
        dispatch?.({ steps, selection, meta: meta() });
        return true;
    };

/** Tab in a list item: nest it under the previous item. */
export const indentListItem: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const lc = listContext(state, sel.anchor.key);
    if (!lc || lc.itemIndex === 0) return false;
    const list = lc.list.node as List;
    const prev = list.children[lc.itemIndex - 1];
    const item = lc.item.node as ListItem;
    const nested = prev.children[prev.children.length - 1];
    const steps: Step[] = [];
    let newKey: string;
    if (nested && nested.type === 'list') {
        // Append to the previous item's existing sub-list.
        steps.push({ type: 'removeBlock', parentKey: list.key!, index: lc.itemIndex });
        const prevKeyAfter = prev.key!;
        const subKey = nested.key!;
        steps.push({ type: 'insertBlock', parentKey: subKey, index: (nested as List).children.length, node: item });
        newKey = `${keyAt(subKey, (nested as List).children.length)}.0`;
        void prevKeyAfter;
    } else {
        steps.push({ type: 'removeBlock', parentKey: list.key!, index: lc.itemIndex });
        const sub: List = { type: 'list', ordered: list.ordered, spread: false, children: [item] };
        if (list.ordered) sub.start = 1;
        steps.push({ type: 'insertBlock', parentKey: prev.key!, index: prev.children.length, node: sub });
        newKey = `${keyAt(prev.key!, prev.children.length)}.0.0`;
    }
    void ctx;
    dispatch?.({ steps, selection: { mode: 'text', anchor: { key: newKey, offset: sel.anchor.offset }, head: { key: newKey, offset: sel.head.offset } }, meta: meta() });
    return true;
};

/** Shift-Tab in a nested list item: move it after its parent item (taking following siblings along as a sub-list). */
export const outdentListItem: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const lc = listContext(state, sel.anchor.key);
    if (!lc) return false;
    const list = lc.list.node as List;
    const listEntry = lc.list;
    if (listEntry.parent.type !== 'listItem') return false;
    const parentItem = entryOf(state, listEntry.parentKey!)!;
    const grandList = entryOf(state, parentItem.parentKey!)!;
    const item = lc.item.node as ListItem;
    const after = list.children.slice(lc.itemIndex + 1);
    const before = list.children.slice(0, lc.itemIndex);
    const steps: Step[] = [];
    // Rebuild the parent item: keep its blocks, with the sub-list trimmed to `before` (or removed).
    const parentChildren = (parentItem.node as ListItem).children.slice();
    const subIndex = listEntry.index;
    if (before.length) parentChildren[subIndex] = { ...list, children: before };
    else parentChildren.splice(subIndex, 1);
    steps.push({ type: 'replaceBlock', key: parentItem.node.key!, node: { ...(parentItem.node as ListItem), children: parentChildren } });
    // The outdented item carries the following siblings as its own sub-list.
    const moved: ListItem = after.length ? { ...item, children: [...item.children, { ...list, children: after }] } : item;
    steps.push({ type: 'insertBlock', parentKey: grandList.node.key!, index: parentItem.index + 1, node: moved });
    const newKey = `${keyAt(grandList.node.key!, parentItem.index + 1)}.0`;
    void ctx;
    dispatch?.({ steps, selection: { mode: 'text', anchor: { key: newKey, offset: sel.anchor.offset }, head: { key: newKey, offset: sel.head.offset } }, meta: meta() });
    return true;
};

export const toggleTaskChecked =
    (key?: string): Command =>
    (state, dispatch) => {
        const target = key ?? (state.selection?.mode === 'text' ? state.selection.anchor.key : state.selection?.anchorKey);
        if (!target) return false;
        const item = ancestor(state, target, 'listItem');
        if (!item) return false;
        const node = item.node as ListItem;
        if (node.checked === undefined || node.checked === null) return false;
        dispatch?.({ steps: [{ type: 'setAttrs', key: node.key!, attrs: { checked: !node.checked } }], selection: state.selection, meta: meta() });
        return true;
    };

export const wrapInBlockquote: Command = (state, dispatch) => {
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e);
    if (!entries.length || entries[0].parent.type === 'blockquote') return false;
    const parentKey = entries[0].parentKey;
    const startIndex = entries[0].index;
    const steps: Step[] = [];
    for (let i = entries.length - 1; i >= 0; i--) steps.push({ type: 'removeBlock', parentKey, index: entries[i].index });
    steps.push({ type: 'insertBlock', parentKey, index: startIndex, node: { type: 'blockquote', children: entries.map((e) => e.node as BlockContent) } });
    const qKey = keyAt(parentKey, startIndex);
    const sel = state.selection;
    const selection: EditorSelection = sel && sel.mode === 'text' ? { mode: 'text', anchor: { key: `${qKey}.0`, offset: sel.anchor.offset }, head: { key: `${qKey}.0`, offset: sel.head.offset } } : blockSelection(qKey);
    dispatch?.({ steps, selection, meta: meta() });
    return true;
};

export const liftOutOfBlockquote: Command = (state, dispatch) => {
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const entry = entryOf(state, keys[0]);
    if (!entry || entry.parent.type !== 'blockquote') return false;
    const quote = entryOf(state, entry.parentKey!)!;
    const children = (quote.node as { children: BlockContent[] }).children;
    const before = children.slice(0, entry.index);
    const lifted = children.slice(entry.index, entry.index + keys.length);
    const after = children.slice(entry.index + keys.length);
    const steps: Step[] = [];
    const at = quote.index;
    if (before.length) steps.push({ type: 'replaceBlock', key: quote.node.key!, node: { type: 'blockquote', children: before } });
    else steps.push({ type: 'removeBlock', parentKey: quote.parentKey, index: at });
    let insertAt = before.length ? at + 1 : at;
    const firstKey = keyAt(quote.parentKey, insertAt);
    for (const node of lifted) steps.push({ type: 'insertBlock', parentKey: quote.parentKey, index: insertAt++, node });
    if (after.length) steps.push({ type: 'insertBlock', parentKey: quote.parentKey, index: insertAt, node: { type: 'blockquote', children: after } });
    const sel = state.selection;
    const selection: EditorSelection = sel && sel.mode === 'text' ? { mode: 'text', anchor: { key: firstKey, offset: sel.anchor.offset }, head: { key: firstKey, offset: sel.head.offset } } : blockSelection(firstKey);
    dispatch?.({ steps, selection, meta: meta() });
    return true;
};

/** Insert a block after the current one and move the caret into it (or select it when void). */
export const insertBlockAfter =
    (node: BlockContent, opts: { replaceEmpty?: boolean } = { replaceEmpty: true }): Command =>
    (state, dispatch, ctx) => {
        const keys = selectedBlockKeys(state);
        if (!keys.length) return false;
        const entry = entryOf(state, keys[keys.length - 1]);
        if (!entry) return false;
        // A top-level ancestor when inside a table cell / list item: insert after the enclosing block.
        let target = entry;
        while (target.parent.type === 'tableRow' || target.parent.type === 'table' || (target.node.type === 'tableCell')) target = entryOf(state, target.parentKey!)!;
        const steps: Step[] = [];
        let key: string;
        const empty = ctx.schema.kind(target.node.type) === 'inline' && lengthOf(target.node, ctx) === 0 && target.node.type === 'paragraph';
        if (opts.replaceEmpty && empty) {
            steps.push({ type: 'replaceBlock', key: target.node.key!, node });
            key = target.node.key!;
        } else {
            steps.push({ type: 'insertBlock', parentKey: target.parentKey, index: target.index + 1, node });
            key = keyAt(target.parentKey, target.index + 1);
        }
        const kind = ctx.schema.kind(node.type);
        let selection: EditorSelection;
        if (kind === 'void') selection = blockSelection(key);
        else {
            const keyed = { ...node, key } as EditorBlock;
            const first = firstEditable(keyed, ctx);
            selection = first ? textSelection(relKey(key, keyed, first), 0) : blockSelection(key);
        }
        dispatch?.({ steps, selection, meta: meta() });
        return true;
    };

/** The key `target` (a descendant of `node`, matched by identity) will have once `node` is keyed `key`. */
function relKey(key: string, node: EditorBlock | BlockContent, target: EditorBlock): string {
    if ((node as EditorBlock) === target) return key;
    const children = (node as { children?: EditorBlock[] }).children ?? [];
    for (let i = 0; i < children.length; i++) {
        if (!isContainerType(children[i].type) && children[i] !== target) continue;
        const found = relKey(`${key}.${i}`, children[i], target);
        if (found) return found;
    }
    return '';
}

export const insertThematicBreak: Command = insertBlockAfter({ type: 'thematicBreak' }, { replaceEmpty: true });

export const insertImage = (url: string, alt = '', title?: string): Command => {
    return (state, dispatch, ctx) => {
        const attrs: Record<string, string> = { url, alt };
        if (title) attrs.title = title;
        return insertAtom('image', attrs)(state, dispatch, ctx);
    };
};

export const insertTable =
    (rows = 2, cols = 2): Command =>
    (state, dispatch, ctx) => {
        const cell = (): TableCell => ({ type: 'tableCell', children: [] });
        const row = (): TableRow => ({ type: 'tableRow', children: Array.from({ length: cols }, cell) });
        const table: Table = { type: 'table', align: Array.from({ length: cols }, () => null), children: Array.from({ length: rows }, row) };
        return insertBlockAfter(table)(state, dispatch, ctx);
    };

function tableContext(state: EditorState, key: string): { table: BlockEntry; row: BlockEntry; cell: BlockEntry } | null {
    const cell = entryOf(state, key);
    if (!cell || cell.node.type !== 'tableCell') return null;
    const row = entryOf(state, cell.parentKey!)!;
    const table = entryOf(state, row.parentKey!)!;
    return { table, row, cell };
}

const tableOp =
    (fn: (table: Table, row: number, col: number) => Table | null, selectCell?: (row: number, col: number) => [number, number]): Command =>
    (state, dispatch) => {
        const sel = state.selection;
        const key = sel?.mode === 'text' ? sel.anchor.key : null;
        if (!key) return false;
        const tc = tableContext(state, key);
        if (!tc) return false;
        const next = fn(tc.table.node as Table, tc.row.index, tc.cell.index);
        if (!next) return false;
        const [r, c] = selectCell ? selectCell(tc.row.index, tc.cell.index) : [tc.row.index, tc.cell.index];
        const tableKey = tc.table.node.key!;
        const cr = Math.min(r, next.children.length - 1);
        const cc = Math.min(c, next.children[cr].children.length - 1);
        dispatch?.({ steps: [{ type: 'replaceBlock', key: tableKey, node: next }], selection: textSelection(`${tableKey}.${cr}.${cc}`, 0), meta: meta() });
        return true;
    };

const emptyRow = (cols: number): TableRow => ({ type: 'tableRow', children: Array.from({ length: cols }, () => ({ type: 'tableCell', children: [] })) });

export const addRowAfter: Command = tableOp((t, r) => ({ ...t, children: [...t.children.slice(0, r + 1), emptyRow(t.children[0].children.length), ...t.children.slice(r + 1)] }), (r, c) => [r + 1, c]);
export const addRowBefore: Command = tableOp((t, r) => (r === 0 ? null : { ...t, children: [...t.children.slice(0, r), emptyRow(t.children[0].children.length), ...t.children.slice(r)] }));
export const deleteRow: Command = tableOp((t, r) => (r === 0 || t.children.length <= 2 ? null : { ...t, children: t.children.filter((_, i) => i !== r) }), (r, c) => [Math.max(1, r - 1), c]);
export const addColumnAfter: Command = tableOp((t, _r, c) => ({
    ...t,
    align: [...(t.align ?? []).slice(0, c + 1), null, ...(t.align ?? []).slice(c + 1)],
    children: t.children.map((row) => ({ ...row, children: [...row.children.slice(0, c + 1), { type: 'tableCell', children: [] }, ...row.children.slice(c + 1)] })),
}), (r, c) => [r, c + 1]);
export const addColumnBefore: Command = tableOp((t, _r, c) => ({
    ...t,
    align: [...(t.align ?? []).slice(0, c), null, ...(t.align ?? []).slice(c)],
    children: t.children.map((row) => ({ ...row, children: [...row.children.slice(0, c), { type: 'tableCell', children: [] }, ...row.children.slice(c)] })),
}));
export const deleteColumn: Command = tableOp((t, _r, c) =>
    t.children[0].children.length <= 1
        ? null
        : { ...t, align: (t.align ?? []).filter((_, i) => i !== c), children: t.children.map((row) => ({ ...row, children: row.children.filter((_, i) => i !== c) })) }, (r, c) => [r, Math.max(0, c - 1)]);
export const setColumnAlign = (align: 'left' | 'center' | 'right' | null): Command =>
    tableOp((t, _r, c) => {
        const next = [...(t.align ?? t.children[0].children.map(() => null))];
        next[c] = align;
        return { ...t, align: next };
    });

/** Delete the selected block(s) (block selection) or the current block when it is void/code. */
export const deleteBlock: Command = (state, dispatch, ctx) => {
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e);
    if (!entries.length) return false;
    const steps: Step[] = [];
    for (let i = entries.length - 1; i >= 0; i--) steps.push(...removeSteps(state, entries[i]));
    // Focus: the previous editable block, else the next, else a fresh paragraph.
    const first = entries[0];
    const prevKey = state.index().prevEditable(firstEditable(first.node, ctx)?.key ?? first.node.key!);
    let selection: EditorSelection = null;
    if (prevKey && !keys.some((k) => prevKey.startsWith(k))) selection = textSelection(prevKey, lengthOf(entryOf(state, prevKey)!.node, ctx));
    const rootRemovals = steps.filter((s) => s.type === 'removeBlock' && s.parentKey === null).length;
    if (rootRemovals >= state.doc.children.length) {
        steps.push({ type: 'insertBlock', parentKey: null, index: 0, node: paragraph() });
        selection = textSelection('b-0', 0);
    }
    dispatch?.({ steps, selection, meta: meta() });
    return true;
};

export const duplicateBlock: Command = (state, dispatch) => {
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const last = entryOf(state, keys[keys.length - 1]);
    if (!last) return false;
    const steps: Step[] = keys.map((k, i) => ({ type: 'insertBlock', parentKey: last.parentKey, index: last.index + 1 + i, node: structuredClone(stripKeys(entryOf(state, k)!.node)) }));
    dispatch?.({ steps, selection: blockSelection(keyAt(last.parentKey, last.index + 1), keyAt(last.parentKey, last.index + keys.length)), meta: meta() });
    return true;
};

function stripKeys<T>(node: T): T {
    return JSON.parse(JSON.stringify(node, (k, v) => (k === 'key' || k === 'position' ? undefined : v)));
}

const moveBy =
    (delta: -1 | 1): Command =>
    (state, dispatch) => {
        const keys = selectedBlockKeys(state);
        if (keys.length !== 1) return false;
        const entry = entryOf(state, keys[0]);
        if (!entry) return false;
        // Move the top-most block that is a direct child of a container the user sees (not a tableCell/listItem paragraph).
        let target = entry;
        while (target.parent.type === 'listItem' && target.index === 0 && (target.parent as ListItem).children.length === 1) target = entryOf(state, target.parentKey!)!;
        const siblings = (target.parent as { children: EditorBlock[] }).children;
        const to = target.index + delta;
        if (to < 0 || to >= siblings.length) return false;
        const newKey = keyAt(target.parentKey, to);
        const sel = state.selection;
        const selection: EditorSelection = sel && sel.mode === 'text' ? { mode: 'text', anchor: { key: sel.anchor.key.replace(target.node.key!, newKey), offset: sel.anchor.offset }, head: { key: sel.head.key.replace(target.node.key!, newKey), offset: sel.head.offset } } : blockSelection(newKey);
        dispatch?.({ steps: [{ type: 'moveBlock', key: target.node.key!, to: { parentKey: target.parentKey, index: to } }], selection, meta: meta() });
        return true;
    };

export const moveBlockUp: Command = moveBy(-1);
export const moveBlockDown: Command = moveBy(1);

/** Leave a code block: insert a paragraph after it and move the caret there. */
export const exitCode: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry || ctx.schema.kind(entry.node.type) !== 'code') return false;
    return insertBlockAfter(paragraph(), { replaceEmpty: false })(state, dispatch, ctx);
};

// ---------------------------------------------------------------------------
// Selection commands
// ---------------------------------------------------------------------------

export const selectBlock =
    (key: string): Command =>
    (state, dispatch) => {
        if (!entryOf(state, key)) return false;
        dispatch?.({ steps: [], selection: blockSelection(key), meta: meta() });
        return true;
    };

/** Escape from a text selection to selecting the enclosing top-level block. */
export const escapeToBlockSelection: Command = (state, dispatch) => {
    const sel = textSel(state);
    if (!sel) return false;
    let entry = entryOf(state, sel.anchor.key);
    if (!entry) return false;
    while (entry.parentKey !== null) entry = entryOf(state, entry.parentKey)!;
    dispatch?.({ steps: [], selection: blockSelection(entry.node.key!), meta: meta() });
    return true;
};

/** Enter a block selection's first block as text. */
export const escapeToText: Command = (state, dispatch, ctx) => {
    const sel = state.selection;
    if (!sel || sel.mode !== 'block') return false;
    const entry = entryOf(state, sel.anchorKey);
    if (!entry) return false;
    const first = firstEditable(entry.node, ctx);
    if (!first) return false;
    dispatch?.({ steps: [], selection: textSelection(first.key!, 0), meta: meta() });
    return true;
};

export const extendBlockSelection =
    (dir: 'up' | 'down'): Command =>
    (state, dispatch) => {
        const sel = state.selection;
        if (!sel) return false;
        let anchorKey: string;
        let headKey: string;
        if (sel.mode === 'text') {
            let entry = entryOf(state, sel.anchor.key);
            if (!entry) return false;
            while (entry.parentKey !== null) entry = entryOf(state, entry.parentKey)!;
            anchorKey = headKey = entry.node.key!;
        } else {
            anchorKey = sel.anchorKey;
            headKey = sel.headKey;
        }
        const head = entryOf(state, headKey);
        if (!head) return false;
        const siblings = (head.parent as { children: EditorBlock[] }).children;
        const next = head.index + (dir === 'down' ? 1 : -1);
        if (sel.mode === 'text') {
            dispatch?.({ steps: [], selection: blockSelection(anchorKey, anchorKey), meta: meta() });
            return true;
        }
        if (next < 0 || next >= siblings.length) return false;
        dispatch?.({ steps: [], selection: blockSelection(anchorKey, siblings[next].key!), meta: meta() });
        return true;
    };

export const selectAll: Command = (state, dispatch) => {
    const children = state.doc.children;
    if (!children.length) return false;
    dispatch?.({ steps: [], selection: blockSelection(children[0].key!, children[children.length - 1].key!), meta: meta() });
    return true;
};

/** Move the caret to the previous/next editable block (the view supplies the x-goal offset through `offsetAt`). */
export const focusNeighbour =
    (dir: 'up' | 'down', offsetAt?: (key: string, edge: 'first' | 'last') => number): Command =>
    (state, dispatch, ctx) => {
        const sel = state.selection;
        let fromKey: string | null = null;
        if (sel?.mode === 'text') fromKey = sel.anchor.key;
        else if (sel?.mode === 'block') {
            const e = entryOf(state, dir === 'down' ? sel.headKey : sel.anchorKey);
            if (!e) return false;
            const edge = dir === 'down' ? lastEditable(e.node, ctx) : firstEditable(e.node, ctx);
            if (edge) {
                // A selected block with text: enter it at the edge facing the direction.
                dispatch?.({ steps: [], selection: textSelection(edge.key!, dir === 'down' ? lengthOf(edge, ctx) : 0), meta: meta() });
                return true;
            }
            // A void block: step to the neighbouring top-level block.
            const top = topLevelOf(state, e);
            const n = state.doc.children[top.index + (dir === 'down' ? 1 : -1)];
            if (!n) return false;
            if (ctx.schema.kind(n.type) === 'void') {
                dispatch?.({ steps: [], selection: blockSelection(n.key!), meta: meta() });
                return true;
            }
            const into = dir === 'down' ? firstEditable(n, ctx) : lastEditable(n, ctx);
            if (!into) return false;
            dispatch?.({ steps: [], selection: textSelection(into.key!, dir === 'down' ? 0 : lengthOf(into, ctx)), meta: meta() });
            return true;
        }
        if (!fromKey) return false;
        const index = state.index();
        const target = dir === 'up' ? index.prevEditable(fromKey) : index.nextEditable(fromKey);
        if (!target) {
            // No editable neighbour: maybe a void block sits there — select it.
            const entry = entryOf(state, fromKey)!;
            const top = topLevelOf(state, entry);
            const siblings = state.doc.children;
            const n = siblings[top.index + (dir === 'up' ? -1 : 1)];
            if (n && ctx.schema.kind(n.type) === 'void') {
                dispatch?.({ steps: [], selection: blockSelection(n.key!), meta: meta() });
                return true;
            }
            return false;
        }
        // A void block between the two? Select it instead.
        const between = voidBetween(state, fromKey, target, dir, ctx);
        if (between) {
            dispatch?.({ steps: [], selection: blockSelection(between), meta: meta() });
            return true;
        }
        const node = entryOf(state, target)!.node;
        const offset = offsetAt ? offsetAt(target, dir === 'up' ? 'last' : 'first') : dir === 'up' ? lengthOf(node, ctx) : 0;
        dispatch?.({ steps: [], selection: textSelection(target, Math.max(0, Math.min(offset, lengthOf(node, ctx)))), meta: meta() });
        return true;
    };

function topLevelOf(state: EditorState, entry: BlockEntry): BlockEntry {
    let cur = entry;
    while (cur.parentKey !== null) cur = entryOf(state, cur.parentKey)!;
    return cur;
}

function voidBetween(state: EditorState, fromKey: string, toKey: string, dir: 'up' | 'down', ctx: CommandContext): string | null {
    const a = topLevelOf(state, entryOf(state, fromKey)!);
    const b = topLevelOf(state, entryOf(state, toKey)!);
    const [lo, hi] = dir === 'down' ? [a.index, b.index] : [b.index, a.index];
    for (let i = lo + 1; i < hi; i++) {
        const n = state.doc.children[i];
        if (ctx.schema.kind(n.type) === 'void') return dir === 'down' ? n.key! : state.doc.children[hi - 1].key!;
    }
    return null;
}

export const focusStart: Command = (state, dispatch, ctx) => {
    const first = state.doc.children.length ? firstEditable(state.doc.children[0], ctx) : undefined;
    if (!first) return false;
    dispatch?.({ steps: [], selection: textSelection(first.key!, 0), meta: meta() });
    return true;
};

export const focusEnd: Command = (state, dispatch, ctx) => {
    const children = state.doc.children;
    const last = children.length ? lastEditable(children[children.length - 1], ctx) : undefined;
    if (!last) return false;
    dispatch?.({ steps: [], selection: textSelection(last.key!, lengthOf(last, ctx)), meta: meta() });
    return true;
};

// ---------------------------------------------------------------------------
// Document commands
// ---------------------------------------------------------------------------

export const setDocument =
    (doc: Root, opts: { origin?: TransactionMeta['origin']; addToHistory?: boolean } = {}): Command =>
    (_state, dispatch, ctx) => {
        normalizeDoc(doc);
        const first = doc.children.length ? firstEditable(doc.children[0] as EditorBlock, ctx) : undefined;
        dispatch?.({
            steps: [{ type: 'replaceDoc', doc }],
            selection: first?.key ? textSelection(first.key, 0) : null,
            meta: meta({ origin: opts.origin ?? 'external', addToHistory: opts.addToHistory ?? opts.origin !== undefined }),
        });
        return true;
    };

export const setMarkdown =
    (markdown: string, opts: { origin?: TransactionMeta['origin']; addToHistory?: boolean } = {}): Command =>
    (state, dispatch, ctx) => {
        if (!ctx.parse) return false;
        return setDocument(ctx.parse(markdown), opts)(state, dispatch, ctx);
    };

export const clear: Command = (state, dispatch, ctx) =>
    setDocument({ type: 'root', children: [paragraph()] }, { origin: 'command', addToHistory: true })(state, dispatch, ctx);

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

/** Insert parsed blocks at the selection: the first block merges into the current paragraph when both are inline. */
export const insertBlocks =
    (blocks: BlockContent[]): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel || !blocks.length) return false;
        const key = sel.anchor.key;
        const entry = entryOf(state, key);
        if (!entry) return false;
        const { from, to } = selectionRange(sel);
        const steps: Step[] = [];
        let selection: EditorSelection = sel;
        if (ctx.schema.kind(entry.node.type) === 'inline' && blocks.length === 1 && ctx.schema.kind(blocks[0].type) === 'inline') {
            const slice = toFlat((blocks[0] as { children: PhrasingContent[] }).children, ctx.inline);
            steps.push({ type: 'replaceInline', key, from, to, slice });
            selection = textSelection(key, from + slice.text.length);
        } else if (ctx.schema.kind(entry.node.type) === 'inline') {
            // Split the current block around the selection, merge the first/last pasted inline blocks into the halves.
            const flat = inlineFlat(state, key, ctx)!;
            const head = sliceFlat(flat, 0, from);
            const tail = sliceFlat(flat, to, flat.text.length);
            const list = blocks.slice();
            let headFlat = head;
            if (ctx.schema.kind(list[0].type) === 'inline') headFlat = concatFlat(head, toFlat((list.shift() as { children: PhrasingContent[] }).children, ctx.inline));
            let tailFlat = tail;
            let lastKey: string | null = null;
            let lastOffset = 0;
            if (list.length && ctx.schema.kind(list[list.length - 1].type) === 'inline') {
                const lastFlat = toFlat((list.pop() as { children: PhrasingContent[] }).children, ctx.inline);
                lastOffset = lastFlat.text.length;
                tailFlat = concatFlat(lastFlat, tail);
            }
            steps.push({ type: 'setInline', key, flat: headFlat });
            let at = entry.index + 1;
            for (const b of list) steps.push({ type: 'insertBlock', parentKey: entry.parentKey, index: at++, node: b });
            if (tailFlat.text.length || list.length === 0 || lastOffset) {
                steps.push({ type: 'insertBlock', parentKey: entry.parentKey, index: at, node: paragraph(toInline(tailFlat, ctx.inline)) });
                lastKey = keyAt(entry.parentKey, at);
                selection = textSelection(lastKey, lastOffset);
            } else {
                const lastInserted = keyAt(entry.parentKey, at - 1);
                const first = firstEditable({ ...list[list.length - 1], key: lastInserted } as EditorBlock, ctx);
                selection = first ? textSelection(relKey(lastInserted, list[list.length - 1], first), lengthOf(first, ctx)) : blockSelection(lastInserted);
            }
        } else {
            let at = entry.index + 1;
            for (const b of blocks) steps.push({ type: 'insertBlock', parentKey: entry.parentKey, index: at++, node: b });
            selection = blockSelection(keyAt(entry.parentKey, entry.index + 1), keyAt(entry.parentKey, at - 1));
        }
        dispatch?.({ steps, selection, meta: meta({ origin: 'paste' }) });
        return true;
    };

/** Paste text: markdown with block structure becomes blocks, a single line becomes inline content. */
export const pasteText =
    (text: string): Command =>
    (state, dispatch, ctx) => {
        if (!ctx.parse) return insertText(text, { group: undefined, origin: 'paste' })(state, dispatch, ctx);
        const root = ctx.parse(text);
        const blocks = root.children.map((b) => stripKeys(b));
        if (!blocks.length) return false;
        return insertBlocks(blocks)(state, dispatch, ctx);
    };

/** All commands by name, for keymaps and plugins. */
export const commands = {
    insertHardBreak,
    splitBlock,
    joinBackward,
    joinForward,
    indentListItem,
    outdentListItem,
    toggleStrong: toggleMark('strong'),
    toggleEmphasis: toggleMark('emphasis'),
    toggleDelete: toggleMark('delete'),
    toggleInlineCode: toggleMark('inlineCode'),
    unsetLink,
    setParagraph: setBlockType('paragraph'),
    setHeading1: setBlockType('heading', { depth: 1 }),
    setHeading2: setBlockType('heading', { depth: 2 }),
    setHeading3: setBlockType('heading', { depth: 3 }),
    setHeading4: setBlockType('heading', { depth: 4 }),
    setHeading5: setBlockType('heading', { depth: 5 }),
    setHeading6: setBlockType('heading', { depth: 6 }),
    setCodeBlock: setBlockType('code'),
    toggleBulletList: toggleList('bullet'),
    toggleOrderedList: toggleList('ordered'),
    toggleTaskList: toggleList('task'),
    toggleTaskChecked: toggleTaskChecked(),
    wrapInBlockquote,
    liftOutOfBlockquote,
    insertThematicBreak,
    addRowAfter,
    addRowBefore,
    deleteRow,
    addColumnAfter,
    addColumnBefore,
    deleteColumn,
    deleteBlock,
    duplicateBlock,
    moveBlockUp,
    moveBlockDown,
    exitCode,
    escapeToBlockSelection,
    escapeToText,
    extendBlockSelectionUp: extendBlockSelection('up'),
    extendBlockSelectionDown: extendBlockSelection('down'),
    selectAll,
    focusUp: focusNeighbour('up'),
    focusDown: focusNeighbour('down'),
    focusStart,
    focusEnd,
    clear,
} satisfies Record<string, Command>;

export type CommandName = keyof typeof commands;
