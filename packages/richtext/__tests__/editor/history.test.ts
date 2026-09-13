import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { toMarkdown } from '@sigx/richtext-markdown';
import { createState, textSelection } from '../../src/editor/state.js';
import { applyTransaction, mapSelection, transaction } from '../../src/editor/transaction.js';
import { createHistory } from '../../src/editor/history.js';
import type { EditorState } from '../../src/editor/state.js';
import type { Transaction } from '../../src/editor/transaction.js';
import { markdownSchema } from '@sigx/richtext-markdown';

const ctx = { schema: markdownSchema };
const applyTr = (state: EditorState, tr: Transaction) => applyTransaction(state, tr, ctx);

const insert = (key: string, at: number, text: string, extra: Partial<Transaction['meta']> = {}): Transaction =>
    transaction([{ type: 'replaceInline', key, from: at, to: at, slice: { text, spans: [] } }], { origin: 'surface', sourceKey: key, group: 'typing', ...extra }, {
        selection: textSelection(key, at + text.length),
    });

describe('applyTransaction', () => {
    it('applies steps, bumps rev and maps the selection through inline edits', () => {
        const state = createState(parseMarkdown('ab\n\ncd'), textSelection('b-0', 2), markdownSchema);
        const { state: next, inverse } = applyTr(state, transaction([{ type: 'replaceInline', key: 'b-0', from: 1, to: 1, slice: { text: 'X', spans: [] } }], { origin: 'command' }));
        expect(toMarkdown(next.doc)).toBe('aXb\n\ncd\n');
        expect(next.rev).toBe(1);
        expect(next.selection).toEqual(textSelection('b-0', 3));
        expect(inverse).toEqual([{ type: 'replaceInline', key: 'b-0', from: 1, to: 2, slice: { text: '', spans: [] } }]);
        expect(next.doc.children[1]).toBe(state.doc.children[1]);
    });

    it('reverses the inverse of a multi-step transaction', () => {
        const state = createState(parseMarkdown('ab'), null, markdownSchema);
        const tr = transaction([
            { type: 'replaceInline', key: 'b-0', from: 2, to: 2, slice: { text: 'c', spans: [] } },
            { type: 'insertBlock', parentKey: null, index: 1, node: { type: 'thematicBreak' } },
        ], { origin: 'command' });
        const { state: next, inverse } = applyTr(state, tr);
        expect(inverse.map((s) => s.type)).toEqual(['removeBlock', 'replaceInline']);
        let back = next;
        for (const s of inverse) back = applyTr(back, transaction([s], { origin: 'history' })).state;
        expect(toMarkdown(back.doc)).toBe('ab\n');
    });

    it('drops a text selection whose block vanished and keeps one that survived', () => {
        const doc = parseMarkdown('a\n\nb');
        expect(mapSelection(textSelection('b-1', 1), [{ type: 'removeBlock', parentKey: null, index: 1 }], parseMarkdown('a'), markdownSchema)).toBeNull();
        expect(mapSelection(textSelection('b-0', 1), [{ type: 'removeBlock', parentKey: null, index: 1 }], parseMarkdown('a'), markdownSchema)).toEqual(textSelection('b-0', 1));
        expect(mapSelection(textSelection('b-0', 1), [{ type: 'setInline', key: 'b-0', flat: { text: '', spans: [] } }], doc, markdownSchema)).toEqual(textSelection('b-0', 0));
        expect(mapSelection({ mode: 'block', anchorKey: 'b-0', headKey: 'b-1' }, [{ type: 'setAttrs', key: 'b-0', attrs: {} }], doc, markdownSchema)).toEqual({ mode: 'block', anchorKey: 'b-0', headKey: 'b-1' });
    });
});

describe('history', () => {
    function run(state: EditorState, history: ReturnType<typeof createHistory>, tr: Transaction): EditorState {
        const { state: next, inverse } = applyTr(state, tr);
        if (tr.meta.addToHistory !== false) history.record(tr, inverse, state.selection, next.selection);
        return next;
    }
    function undo(state: EditorState, history: ReturnType<typeof createHistory>): EditorState {
        const entry = history.popUndo();
        if (!entry) return state;
        return applyTr(state, transaction(entry.inverse, { origin: 'history', addToHistory: false }, { selection: entry.selectionBefore })).state;
    }
    function redo(state: EditorState, history: ReturnType<typeof createHistory>): EditorState {
        const entry = history.popRedo();
        if (!entry) return state;
        return applyTr(state, transaction(entry.forward, { origin: 'history', addToHistory: false }, { selection: entry.selectionAfter })).state;
    }

    it('merges consecutive typing in one block within the delay into one entry', () => {
        let t = 0;
        const history = createHistory({ now: () => t, groupDelayMs: 500 });
        let state = createState(parseMarkdown('x'), textSelection('b-0', 1), markdownSchema);
        for (const ch of 'abc') {
            const sel = state.selection;
            state = run(state, history, insert('b-0', sel && sel.mode === 'text' ? sel.head.offset : 0, ch));
            t += 100;
        }
        expect(toMarkdown(state.doc)).toBe('xabc\n');
        expect(history.done).toHaveLength(1);
        state = undo(state, history);
        expect(toMarkdown(state.doc)).toBe('x\n');
        expect(state.selection).toEqual(textSelection('b-0', 1));
        state = redo(state, history);
        expect(toMarkdown(state.doc)).toBe('xabc\n');
        expect(state.selection).toEqual(textSelection('b-0', 4));
    });

    it('starts a new entry after the delay, on a different block, on a structural step, or after closeGroup', () => {
        let t = 0;
        const history = createHistory({ now: () => t, groupDelayMs: 500 });
        let state = createState(parseMarkdown('x\n\ny'), textSelection('b-0', 1), markdownSchema);
        state = run(state, history, insert('b-0', 1, 'a'));
        t += 1000;
        state = run(state, history, insert('b-0', 2, 'b'));
        expect(history.done).toHaveLength(2);
        t += 10;
        state = run(state, history, insert('b-1', 1, 'c'));
        expect(history.done).toHaveLength(3);
        t += 10;
        history.closeGroup();
        state = run(state, history, insert('b-1', 2, 'd'));
        expect(history.done).toHaveLength(4);
        t += 10;
        state = run(state, history, transaction([{ type: 'insertBlock', parentKey: null, index: 2, node: { type: 'thematicBreak' } }], { origin: 'command', group: 'typing' }));
        expect(history.done).toHaveLength(5);
        expect(toMarkdown(state.doc)).toBe('xab\n\nycd\n\n---\n');
    });

    it('clears redo on a new entry and caps depth', () => {
        const history = createHistory({ depth: 2, now: () => 0 });
        let state = createState(parseMarkdown('x'), null, markdownSchema);
        state = run(state, history, insert('b-0', 1, 'a', { group: undefined }));
        state = run(state, history, insert('b-0', 2, 'b', { group: undefined }));
        state = run(state, history, insert('b-0', 3, 'c', { group: undefined }));
        expect(history.done).toHaveLength(2);
        state = undo(state, history);
        expect(history.canRedo()).toBe(true);
        state = run(state, history, insert('b-0', 3, 'z', { group: undefined }));
        expect(history.canRedo()).toBe(false);
        expect(toMarkdown(state.doc)).toBe('xabz\n');
    });

    it('keeps an IME composition as one open group regardless of time', () => {
        let t = 0;
        const history = createHistory({ now: () => t });
        let state = createState(parseMarkdown('x'), textSelection('b-0', 1), markdownSchema);
        state = run(state, history, insert('b-0', 1, 'ｋ', { group: 'ime', composing: true }));
        t += 5000;
        state = run(state, history, transaction([{ type: 'setInline', key: 'b-0', flat: { text: 'xか', spans: [] } }], { origin: 'surface', sourceKey: 'b-0', group: 'ime', composing: true }));
        t += 5000;
        state = run(state, history, transaction([{ type: 'setInline', key: 'b-0', flat: { text: 'x漢', spans: [] } }], { origin: 'surface', sourceKey: 'b-0', group: 'ime' }));
        expect(history.done).toHaveLength(1);
        expect(toMarkdown(state.doc)).toBe('x漢\n');
        state = undo(state, history);
        expect(toMarkdown(state.doc)).toBe('x\n');
    });

    it('exposes an input-rule entry for undoInputRule and never merges into it', () => {
        const history = createHistory({ now: () => 0 });
        let state = createState(parseMarkdown('# h'), textSelection('b-0', 1), markdownSchema);
        state = run(state, history, transaction([{ type: 'replaceBlock', key: 'b-0', node: { type: 'heading', depth: 1, children: [{ type: 'text', value: 'h' }] } }], { origin: 'inputRule', inputRule: 'heading', group: 'typing' }));
        expect(history.peekInputRule()?.inputRule).toBe('heading');
        state = run(state, history, insert('b-0', 1, 'i'));
        expect(history.done).toHaveLength(2);
        expect(history.peekInputRule()).toBeNull();
        expect(toMarkdown(state.doc)).toBe('# hi\n');
    });

    it('peekInputRule is null once the group is closed or the entry was undone and redone', () => {
        const rule = () => transaction([{ type: 'replaceBlock', key: 'b-0', node: { type: 'heading', depth: 1, children: [{ type: 'text', value: 'h' }] } }], { origin: 'inputRule', inputRule: 'heading', group: 'typing' });
        let history = createHistory({ now: () => 0 });
        let state = createState(parseMarkdown('# h'), textSelection('b-0', 1), markdownSchema);
        run(state, history, rule());
        expect(history.peekInputRule()?.inputRule).toBe('heading');
        history.closeGroup();
        expect(history.peekInputRule()).toBeNull();

        history = createHistory({ now: () => 0 });
        state = createState(parseMarkdown('# h'), textSelection('b-0', 1), markdownSchema);
        state = run(state, history, rule());
        state = undo(state, history);
        expect(history.peekInputRule()).toBeNull();
        redo(state, history);
        expect(history.done[0]?.inputRule).toBe('heading');
        expect(history.peekInputRule()).toBeNull();
    });
});
