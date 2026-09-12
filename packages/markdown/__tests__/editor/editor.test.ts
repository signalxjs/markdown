/**
 * The editor instance end to end: a fake surface types, presses keys and
 * composes; the core answers with transactions; the bridge decides what
 * flows back. No DOM.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '../../src/parser/index.js';
import { toMarkdown } from '../../src/serializer/index.js';
import { mentionPlugin } from '../../src/plugins/index.js';
import { createEditor, type Editor } from '../../src/editor/editor.js';
import { createInlineBridge, createCodeBridge, diffFlat, type BridgeHost } from '../../src/editor/bridge.js';
import { textSelection, blockSelection } from '../../src/editor/state.js';
import { createFakeInlineSurface, createFakeCodeSurface, type FakeInlineSurface } from '../../src/testing/fake-surface.js';
import type { Transaction } from '../../src/editor/transaction.js';
import type { EditorPlugin } from '../../src/editor/plugin.js';

const md = (e: Editor) => toMarkdown(e.state.doc);

function host(editor: Editor): BridgeHost {
    return {
        dispatch: editor.dispatch,
        runKey: editor.runKey,
        setSelection: editor.setSelection,
        paste: editor.paste,
        flatOf: editor.flatOf,
        valueOf: editor.valueOf,
        focused: editor.focused,
    };
}

/** Mount a fake surface on block `key`, wired through the bridge, and keep it in sync with the editor like a view would. */
function mount(editor: Editor, key: string): FakeInlineSurface {
    const bridge = createInlineBridge(key, host(editor));
    const surface = createFakeInlineSurface({ key, blockType: 'paragraph', attrs: {}, flat: editor.flatOf(key)!, readOnly: false, events: bridge.events });
    editor.listen((tr) => {
        if (!bridge.shouldPush(tr)) return;
        const flat = editor.flatOf(key);
        if (flat) surface.setInline(flat, { rev: editor.state.rev });
    });
    return surface;
}

function make(markdown: string, extra: Parameters<typeof createEditor>[0] = {}): Editor {
    return createEditor({ doc: parseMarkdown(markdown), parse: (s) => parseMarkdown(s), ...extra });
}

describe('createEditor', () => {
    it('starts with the caret in the first editable block and exposes rev/selRev', () => {
        const e = make('# T\n\ntext');
        expect(e.state.selection).toEqual(textSelection('b-0', 0));
        expect(e.rev.value).toBe(0);
        e.run('setHeading2');
        expect(md(e)).toBe('## T\n\ntext\n');
        expect(e.rev.value).toBe(1);
        e.setSelection(textSelection('b-1', 2));
        expect(e.rev.value).toBe(1);
        expect(e.selRev.value).toBe(2);
    });

    it('typing through a surface produces grouped history and never echoes back', () => {
        const e = make('ab');
        const s = mount(e, 'b-0');
        s.focus({ offset: 2 });
        s.type('c');
        s.type('d');
        expect(md(e)).toBe('abcd\n');
        expect(e.history.done).toHaveLength(1);
        expect(s.calls.filter((c) => c.method === 'setInline')).toHaveLength(0);
        expect(e.state.selection).toEqual(textSelection('b-0', 4));
        e.undo();
        expect(md(e)).toBe('ab\n');
        // The undo IS pushed to the surface (origin history).
        expect(s.calls.filter((c) => c.method === 'setInline')).toHaveLength(1);
        expect(s.getFlat().text).toBe('ab');
    });

    it('Enter splits and Backspace at the edge joins, through boundary events', () => {
        const e = make('hello');
        const s = mount(e, 'b-0');
        s.focus({ offset: 2 });
        expect(s.press('Enter')).toBe(true);
        expect(md(e)).toBe('he\n\nllo\n');
        expect(e.state.selection).toEqual(textSelection('b-1', 0));
        const s2 = mount(e, 'b-1');
        s2.focus({ offset: 0 });
        expect(s2.press('Backspace')).toBe(true);
        expect(md(e)).toBe('hello\n');
        expect(e.state.selection).toEqual(textSelection('b-0', 2));
    });

    it('runs input rules on typing and lets Backspace undo just the rule', () => {
        const e = make('');
        const s = mount(e, 'b-0');
        s.focus({ offset: 0 });
        s.type('#');
        s.type(' ');
        expect(e.state.doc.children[0].type).toBe('heading');
        expect(md(e)).toBe('#\n');
        // The heading has an empty surface now; typing continues in it.
        expect(s.getFlat().text).toBe('');
        expect(e.undoInputRule()).toBe(true);
        expect(e.state.doc.children[0].type).toBe('paragraph');
        expect(e.flatOf('b-0')!.text).toBe('# ');
        expect(e.undoInputRule()).toBe(false);
    });

    it('inline input rules convert **bold** as it is typed', () => {
        const e = make('');
        const s = mount(e, 'b-0');
        s.focus({ offset: 0 });
        for (const ch of 'say **hi**') s.type(ch);
        expect(md(e)).toBe('say **hi**\n');
        expect(e.state.doc.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: 'say ' }, { type: 'strong' }] });
        expect(s.getFlat().spans).toEqual([{ start: 4, end: 6, type: 'strong' }]);
    });

    it('Enter rules turn ``` into a code block and --- into a divider', () => {
        const e = make('');
        const s = mount(e, 'b-0');
        s.focus({ offset: 0 });
        for (const ch of '```ts') s.type(ch);
        expect(s.press('Enter')).toBe(true);
        expect(e.state.doc.children[0]).toMatchObject({ type: 'code', lang: 'ts', value: '' });
        expect(e.state.selection).toEqual(textSelection('b-0', 0));
        const e2 = make('');
        const s2 = mount(e2, 'b-0');
        s2.focus({ offset: 0 });
        for (const ch of '---') s2.type(ch);
        expect(s2.press('Enter')).toBe(true);
        expect(e2.state.doc.children.map((c) => c.type)).toEqual(['thematicBreak', 'paragraph']);
        expect(e2.state.selection).toEqual(textSelection('b-1', 0));
    });

    it('keeps an IME composition out of history until it ends and defers external writes', () => {
        const onChange = vi.fn();
        const e = make('a', { onChange });
        const s = mount(e, 'b-0');
        s.focus({ offset: 1 });
        s.compose(['k', 'ka'], 'か');
        expect(md(e)).toBe('aか\n');
        expect(e.history.done).toHaveLength(1);
        expect(onChange).toHaveBeenCalledTimes(1);
        // An external document write during composition waits for compositionEnd.
        const e2 = make('a');
        const s2 = mount(e2, 'b-0');
        s2.focus({ offset: 1 });
        s2.events.compositionStart();
        e2.setDocument(parseMarkdown('replaced'));
        expect(md(e2)).toBe('a\n');
        s2.events.compositionEnd({ text: 'ab', spans: [] });
        expect(md(e2)).toBe('replaced\n');
        expect(e2.undo()).toBe(false); // history cleared by setDocument
    });

    it('refuses undo and structural commands while composing', () => {
        const e = make('a');
        const s = mount(e, 'b-0');
        s.focus({ offset: 1 });
        s.type('b');
        s.events.compositionStart();
        expect(e.undo()).toBe(false);
        expect(e.enter()).toBe(false);
        s.events.compositionEnd({ text: 'ab', spans: [] });
        expect(e.undo()).toBe(true);
    });

    it('undo restores across surfaces after a split', () => {
        const e = make('hello');
        const s = mount(e, 'b-0');
        s.focus({ offset: 2 });
        s.press('Enter');
        const s2 = mount(e, 'b-1');
        s2.focus({ offset: 0 });
        s2.type('X');
        expect(md(e)).toBe('he\n\nXllo\n');
        e.undo();
        expect(md(e)).toBe('he\n\nllo\n');
        e.undo();
        expect(md(e)).toBe('hello\n');
        expect(s.getFlat().text).toBe('hello');
        expect(e.state.selection).toEqual(textSelection('b-0', 2));
        e.redo();
        expect(md(e)).toBe('he\n\nllo\n');
    });

    it('paste routes through the bridge to the markdown-aware paste', () => {
        const e = make('ab');
        const s = mount(e, 'b-0');
        s.focus({ offset: 1 });
        expect(s.paste('one\n\n- two')).toBe(true);
        expect(md(e)).toBe('aone\n\n- two\n\nb\n');
    });

    it('arrow keys move between blocks and honour the x goal', () => {
        const e = make('abcd\n\nef');
        const s = mount(e, 'b-0');
        s.focus({ offset: 3 });
        expect(s.press('ArrowDown', 3 * 8)).toBe(true);
        expect(e.state.selection).toEqual(textSelection('b-1', 0));
        const s2 = mount(e, 'b-1');
        s2.focus({ offset: 1 });
        expect(s2.press('ArrowUp')).toBe(true);
        expect(e.state.selection).toEqual(textSelection('b-0', 4));
        expect(s.press('ArrowUp')).toBe(false);
    });

    it('Escape selects the block and typing is blocked when readOnly', () => {
        const e = make('- a');
        const s = mount(e, 'b-0.0.0');
        s.focus({ offset: 1 });
        expect(s.press('Escape')).toBe(true);
        expect(e.state.selection).toEqual(blockSelection('b-0'));
        e.readOnly = true;
        e.run('deleteBlock');
        expect(md(e)).toBe('- a\n');
    });

    it('code surfaces edit the value and report lang changes', () => {
        const e = make('```js\nx\n```');
        const bridge = createCodeBridge('b-0', host(e));
        const c = createFakeCodeSurface({ key: 'b-0', value: 'x', lang: 'js', readOnly: false, events: bridge.events });
        c.focus({ offset: 1 });
        c.type('y');
        expect(md(e)).toBe('```js\nxy\n```\n');
        bridge.events.langChange!('ts');
        expect(md(e)).toBe('```ts\nxy\n```\n');
        expect(c.press('Enter')).toBe(true); // newline inside the block
        expect(md(e)).toBe('```ts\nxy\n\n```\n');
        expect(e.runKey('Mod-Enter')).toBe(true); // exitCode
        expect(e.state.doc.children[1].type).toBe('paragraph');
    });

    it('plugin slices contribute commands, keymaps, input rules, inline kinds and transaction hooks', () => {
        const hook = vi.fn<(tr: Transaction) => Transaction | null>((tr) => tr);
        const plugin: EditorPlugin = {
            ...mentionPlugin,
            editor: {
                inline: [{ type: 'mention', kind: 'atom', fromFlat: (s) => ({ type: 'mention', id: s.attrs!.id, label: s.attrs!.label }) as never }],
                commands: { shout: (state, dispatch) => (dispatch?.({ steps: [{ type: 'replaceInline', key: 'b-0', from: 0, to: 0, slice: { text: '!', spans: [] } }], meta: { origin: 'command' } }), true) },
                keymap: { 'Mod-Shift-1': 'shout' as never },
                onTransaction: hook,
            },
        };
        const parse = (s: string) => parseMarkdown(s, { plugins: [plugin] });
        const e = createEditor({ doc: parse('hi @[Andy](u1)'), parse, plugins: [plugin] });
        expect(e.flatOf('b-0')!.spans).toEqual([{ start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy' } }]);
        expect(e.runKey('Mod-Shift-1')).toBe(true);
        expect(toMarkdown(e.state.doc, { plugins: [plugin] })).toBe('!hi @[Andy](u1)\n');
        expect(hook).toHaveBeenCalled();
        // A dropped transaction changes nothing.
        hook.mockImplementationOnce(() => null);
        e.run('shout');
        expect(toMarkdown(e.state.doc, { plugins: [plugin] })).toBe('!hi @[Andy](u1)\n');
    });

    it('onChange fires per committed transaction with the new state', () => {
        const onChange = vi.fn();
        const onSelectionChange = vi.fn();
        const e = make('a', { onChange, onSelectionChange });
        e.run('setHeading1');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(toMarkdown(onChange.mock.calls[0][0].state.doc)).toBe('# a\n');
        e.setSelection(textSelection('b-0', 1));
        expect(onSelectionChange).toHaveBeenCalledWith(textSelection('b-0', 1));
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('diffFlat', () => {
    it('finds the minimal replaced range with the new spans', () => {
        expect(diffFlat({ text: 'abc', spans: [] }, { text: 'abXc', spans: [] })).toEqual({ from: 2, to: 2, insert: { text: 'X', spans: [] } });
        expect(diffFlat({ text: 'abc', spans: [] }, { text: 'ac', spans: [] })).toEqual({ from: 1, to: 2, insert: { text: '', spans: [] } });
        expect(diffFlat({ text: 'abc', spans: [] }, { text: 'abc', spans: [] })).toBeNull();
        expect(diffFlat({ text: 'abc', spans: [] }, { text: 'abc', spans: [{ start: 0, end: 3, type: 'strong' }] })).toEqual({ from: 0, to: 3, insert: { text: 'abc', spans: [{ start: 0, end: 3, type: 'strong' }] } });
        expect(diffFlat({ text: 'aa', spans: [] }, { text: 'aXa', spans: [{ start: 1, end: 2, type: 'emphasis' }] })).toEqual({ from: 1, to: 1, insert: { text: 'X', spans: [{ start: 0, end: 1, type: 'emphasis' }] } });
    });
});
