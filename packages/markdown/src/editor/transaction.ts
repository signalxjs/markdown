/**
 * Transactions — a list of steps applied atomically to a state, with the
 * metadata the history, the surfaces and the plugins need to interpret it.
 */

import type { Root } from '../ast/index.js';
import type { EditorSelection, EditorState } from './state.js';
import { makeState } from './state.js';
import type { Step, StepContext } from './steps.js';
import { applyStep, invertStep } from './steps.js';

export type TransactionOrigin = 'surface' | 'command' | 'history' | 'external' | 'paste' | 'inputRule';

export interface TransactionMeta {
    /** Who produced it. `surface` transactions are never pushed back to their source surface. */
    origin: TransactionOrigin;
    /** The block key of the surface that produced a `surface` transaction. */
    sourceKey?: string;
    /** Record in history (default `true`; `false` for `history` and `external`). */
    addToHistory?: boolean;
    /** History grouping key: consecutive entries with the same group merge (`'typing'`, `'ime'`, …). */
    group?: string;
    /** An IME composition is in progress (the entry joins the open `ime` group and is never pushed to surfaces). */
    composing?: boolean;
    /** The input rule that fired, so Backspace right after can undo just that. */
    inputRule?: string;
    /** Free-form plugin data. */
    [key: string]: unknown;
}

export interface Transaction {
    steps: Step[];
    /** Selection after the transaction; `undefined` keeps the current one (mapped through the steps where possible). */
    selection?: EditorSelection;
    /** Set `composing` on the resulting state. */
    composing?: boolean;
    meta: TransactionMeta;
}

export interface AppliedTransaction {
    state: EditorState;
    /** The steps that undo this transaction, in the order to apply them. */
    inverse: Step[];
}

export function transaction(steps: Step[], meta: TransactionMeta, extra?: Omit<Transaction, 'steps' | 'meta'>): Transaction {
    return { steps, meta, ...extra };
}

/** Apply a transaction, producing the next state and its inverse steps. Steps are applied in order; the inverse list is reversed. */
export function applyTransaction(state: EditorState, tr: Transaction, ctx: StepContext = {}, editableTypes?: ReadonlySet<string>): AppliedTransaction {
    let doc: Root = state.doc;
    const inverse: Step[] = [];
    for (const step of tr.steps) {
        inverse.push(invertStep(doc, step, ctx));
        doc = applyStep(doc, step, ctx);
    }
    inverse.reverse();
    const selection = tr.selection !== undefined ? tr.selection : mapSelection(state.selection, tr.steps, doc);
    const composing = tr.composing ?? (tr.meta.composing ?? state.composing);
    const next = makeState(doc, selection, state.rev + (tr.steps.length || tr.selection !== undefined ? 1 : 0), composing, editableTypes);
    return { state: next, inverse };
}

/**
 * Keep a selection meaningful across steps that did not set one: a text
 * selection follows inline edits in its own block; it is dropped when its
 * block disappears; block selections are dropped on structural change.
 */
export function mapSelection(sel: EditorSelection, steps: Step[], doc: Root): EditorSelection {
    if (!sel) return null;
    let cur: EditorSelection = sel;
    for (const step of steps) {
        if (!cur) return null;
        if (cur.mode === 'text') {
            const key: string = cur.anchor.key;
            switch (step.type) {
                case 'replaceInline':
                    if (step.key === key) {
                        const map = (o: number) => (o <= step.from ? o : o >= step.to ? o + (step.slice.text.length - (step.to - step.from)) : step.from + step.slice.text.length);
                        cur = { mode: 'text', anchor: { key, offset: map(cur.anchor.offset) }, head: { key, offset: map(cur.head.offset) } };
                    }
                    break;
                case 'setInline':
                    if (step.key === key) {
                        const len = step.flat.text.length;
                        cur = { mode: 'text', anchor: { key, offset: Math.min(cur.anchor.offset, len) }, head: { key, offset: Math.min(cur.head.offset, len) } };
                    }
                    break;
                case 'setValue':
                    if (step.key === key) {
                        const len = step.value.length;
                        cur = { mode: 'text', anchor: { key, offset: Math.min(cur.anchor.offset, len) }, head: { key, offset: Math.min(cur.head.offset, len) } };
                    }
                    break;
                case 'replaceBlock':
                case 'insertBlock':
                case 'removeBlock':
                case 'moveBlock':
                case 'replaceDoc':
                    // Structural: keep only if the block still exists (keys may have shifted, so verify).
                    cur = existsIn(doc, key) ? cur : null;
                    break;
                default:
                    break;
            }
        } else if (step.type !== 'replaceInline' && step.type !== 'setInline' && step.type !== 'setValue' && step.type !== 'setAttrs') {
            cur = existsIn(doc, cur.anchorKey) && existsIn(doc, cur.headKey) ? cur : null;
        }
    }
    return cur;
}

function existsIn(doc: Root, key: string): boolean {
    const walk = (children: unknown[]): boolean => {
        for (const c of children) {
            const n = c as { key?: string; type: string; children?: unknown[] };
            if (n.key === key) return true;
            if (n.children && n.type !== 'paragraph' && n.type !== 'heading' && n.type !== 'tableCell' && walk(n.children)) return true;
        }
        return false;
    };
    return walk(doc.children);
}
