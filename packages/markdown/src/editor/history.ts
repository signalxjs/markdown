/**
 * Undo history.
 *
 * Every recorded transaction becomes an entry holding its inverse steps, the
 * forward steps (for redo) and the selections before and after. Consecutive
 * `typing` entries in the same block within `groupDelayMs` merge into one
 * entry, so a word is one undo, not a letter; an IME composition is a single
 * open group until `compositionEnd`; and an entry tagged with an input rule
 * can be undone alone (`undoInputRule`: Backspace right after `# ` reverts
 * the heading but keeps the characters).
 */

import type { EditorSelection } from './state.js';
import type { Step } from './steps.js';
import type { Transaction } from './transaction.js';

export interface HistoryEntry {
    inverse: Step[];
    forward: Step[];
    selectionBefore: EditorSelection;
    selectionAfter: EditorSelection;
    time: number;
    group?: string;
    /** Block key the group is bound to (typing groups never span blocks). */
    groupKey?: string;
    inputRule?: string;
}

export interface HistoryOptions {
    /** Consecutive same-group entries within this window merge. Default 500 ms. */
    groupDelayMs?: number;
    /** Maximum retained entries. Default 500. */
    depth?: number;
    now?: () => number;
}

export interface History {
    readonly done: readonly HistoryEntry[];
    readonly undone: readonly HistoryEntry[];
    canUndo(): boolean;
    canRedo(): boolean;
    /** Record an applied transaction. Clears the redo stack. */
    record(tr: Transaction, inverse: Step[], selectionBefore: EditorSelection, selectionAfter: EditorSelection): void;
    /** Pop the last entry for undo (caller applies `inverse`). */
    popUndo(): HistoryEntry | null;
    /** Pop the last undone entry for redo (caller applies `forward`). */
    popRedo(): HistoryEntry | null;
    /** The last entry, when it was produced by an input rule and nothing else happened since. */
    peekInputRule(): HistoryEntry | null;
    /** End the current group: the next entry starts a new one. */
    closeGroup(): void;
    clear(): void;
}

export function createHistory(options: HistoryOptions = {}): History {
    const groupDelayMs = options.groupDelayMs ?? 500;
    const depth = options.depth ?? 500;
    const now = options.now ?? (() => Date.now());
    const done: HistoryEntry[] = [];
    let undone: HistoryEntry[] = [];
    let groupOpen = false;

    const canMerge = (last: HistoryEntry | undefined, tr: Transaction, time: number): boolean => {
        if (!last || !groupOpen || !tr.meta.group || last.group !== tr.meta.group) return false;
        if (tr.meta.inputRule || last.inputRule) return false;
        const key = tr.meta.sourceKey ?? blockKeyOf(tr.steps);
        if (last.groupKey !== key) return false;
        if (tr.meta.group === 'ime') return true;
        return time - last.time <= groupDelayMs;
    };

    return {
        get done() {
            return done;
        },
        get undone() {
            return undone;
        },
        canUndo: () => done.length > 0,
        canRedo: () => undone.length > 0,
        record(tr, inverse, selectionBefore, selectionAfter) {
            if (!inverse.length && !tr.steps.length) return;
            undone = [];
            const time = now();
            const last = done[done.length - 1];
            if (canMerge(last, tr, time)) {
                // Merge: the inverse of the merged entry undoes the newer steps first.
                last.inverse = [...inverse, ...last.inverse];
                last.forward = [...last.forward, ...tr.steps];
                last.selectionAfter = selectionAfter;
                last.time = time;
                return;
            }
            done.push({
                inverse,
                forward: tr.steps.slice(),
                selectionBefore,
                selectionAfter,
                time,
                group: tr.meta.group,
                groupKey: tr.meta.sourceKey ?? blockKeyOf(tr.steps),
                inputRule: tr.meta.inputRule,
            });
            groupOpen = !!tr.meta.group;
            if (done.length > depth) done.splice(0, done.length - depth);
        },
        popUndo() {
            const entry = done.pop() ?? null;
            if (entry) undone.push(entry);
            groupOpen = false;
            return entry;
        },
        popRedo() {
            const entry = undone.pop() ?? null;
            if (entry) done.push(entry);
            groupOpen = false;
            return entry;
        },
        peekInputRule() {
            // The rule's entry is on top and its group is still open: no undo,
            // redo, history/external transaction or blur since it was recorded.
            const last = done[done.length - 1];
            return last?.inputRule && groupOpen ? last : null;
        },
        closeGroup() {
            groupOpen = false;
        },
        clear() {
            done.length = 0;
            undone = [];
            groupOpen = false;
        },
    };
}

/** The single block key a list of inline steps touches, or `undefined` when they span blocks / are structural. */
function blockKeyOf(steps: Step[]): string | undefined {
    let key: string | undefined;
    for (const s of steps) {
        if (s.type !== 'replaceInline' && s.type !== 'setInline' && s.type !== 'setValue') return undefined;
        if (key === undefined) key = s.key;
        else if (key !== s.key) return undefined;
    }
    return key;
}
