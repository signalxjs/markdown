/**
 * The editor instance — the platform-neutral heart a view (DOM, Lynx) wraps.
 *
 * It owns the state, the history and the dispatch pipeline:
 *
 *   dispatch(tr) → plugin `onTransaction` → apply → input rules (a follow-up
 *   transaction) → history → `rev` / `selRev` signals → listeners
 *
 * Reactivity is deliberately coarse: `rev` bumps on document changes,
 * `selRev` on selection-only changes. A view reads `editor.state` inside its
 * render and touches one of the two signals to subscribe; the tree itself is
 * never proxied, so untouched blocks keep identity and their surfaces are
 * never re-rendered.
 *
 * Model write-back (`onChange`) is suppressed while an IME composition is open
 * and flushed on its end; external document writes arriving mid-composition
 * wait in `pendingExternal`.
 */

import { signal, type PrimitiveSignal } from '@sigx/reactivity';
import type { BlockContent, Root } from '../ast/index.js';
import type { MarkdownPlugin } from '../plugin/index.js';
import type { Command, CommandContext, Dispatch } from './commands.js';
import { commands as builtinCommands, pasteText, setDocument as setDocumentCommand } from './commands.js';
import { createHistory, type History, type HistoryOptions } from './history.js';
import type { InlineFlat, InlineKindSpec } from './inline-flat.js';
import { applyEnterRules, applyInputRules, baseInputRules, type InputRule } from './input-rules.js';
import { baseKeymap, resolveKeymap, runKeymap, type Keymap, type KeyName } from './keymap.js';
import { editorSlice } from './plugin.js';
import { createSchema, type BlockEditorSpec, type Schema } from './schema.js';
import { createState, selectionEquals, type EditorSelection, type EditorState } from './state.js';
import { flatOf } from './steps.js';
import { applyTransaction, type Transaction } from './transaction.js';
import type { ToolbarItem } from './toolbar.js';
import type { TriggerSpec } from './trigger/index.js';
import type { PlatformInfo } from './surface.js';

export interface EditorOptions {
    doc?: Root;
    plugins?: readonly MarkdownPlugin[];
    /** Extra keymap layered over the base and plugin keymaps (wins). */
    keymap?: Keymap;
    /** `false` disables input rules; an array replaces the base set. */
    inputRules?: readonly InputRule[] | false;
    history?: HistoryOptions;
    platform?: Partial<PlatformInfo>;
    /** Parse markdown (for `setMarkdown` and markdown paste). */
    parse?: (markdown: string) => Root;
    readOnly?: boolean;
    /** Called after every committed transaction (never mid-composition). */
    onChange?: (e: { state: EditorState; transaction: Transaction }) => void;
    onSelectionChange?: (selection: EditorSelection) => void;
}

export interface EditorListener {
    (tr: Transaction, state: EditorState, prev: EditorState): void;
}

export interface Editor {
    readonly state: EditorState;
    /** Bumps on every document change. */
    readonly rev: PrimitiveSignal<number>;
    /** Bumps on every selection change (document changes bump it too). */
    readonly selRev: PrimitiveSignal<number>;
    readonly schema: Schema;
    readonly history: History;
    readonly commands: Readonly<Record<string, Command>>;
    readonly keymap: ReadonlyMap<KeyName, Command | 'undo' | 'redo'>;
    readonly inputRules: readonly InputRule[];
    readonly toolbarItems: readonly ToolbarItem[];
    readonly triggers: readonly { plugin: string; spec: TriggerSpec }[];
    readonly ctx: CommandContext;
    readonly platform: PlatformInfo;
    readOnly: boolean;
    dispatch: Dispatch;
    /** Run a command (or a named one) against the current state. */
    run(command: Command | string): boolean;
    /** Run the keymap binding for a key name; returns whether something handled it. */
    runKey(name: KeyName): boolean;
    /** Enter handling: enter input rules first (fence, hr), then the keymap's Enter binding. */
    enter(): boolean;
    /** Backspace right after an input rule fired undoes only that rule. */
    undoInputRule(): boolean;
    undo(): boolean;
    redo(): boolean;
    setSelection(selection: EditorSelection): void;
    setDocument(doc: Root): void;
    setMarkdown(markdown: string): boolean;
    paste(text: string, markdown?: string): boolean;
    /** The flat content of an inline container, or `null`. */
    flatOf(key: string): InlineFlat | null;
    /** The value of a code block, or `null`. */
    valueOf(key: string): string | null;
    /** Subscribe to committed transactions. */
    listen(listener: EditorListener): () => void;
    /** Where keyboard focus is (the focused surface's block key). */
    readonly focusedKey: string | null;
    focused(key: string | null): void;
    destroy(): void;
}

export function createEditor(options: EditorOptions = {}): Editor {
    const plugins = options.plugins ?? [];
    const slices = plugins.map((p) => ({ name: p.name, slice: editorSlice(p) }));

    const blockEditors: BlockEditorSpec[] = [];
    const kinds = new Map<string, InlineKindSpec>();
    const pluginCommands: Record<string, Command> = {};
    const keymaps: Keymap[] = [baseKeymap];
    const rules: InputRule[] = options.inputRules === false ? [] : [...(options.inputRules ?? baseInputRules)];
    const toolbarItems: ToolbarItem[] = [];
    const triggers: { plugin: string; spec: TriggerSpec }[] = [];
    const transactionHooks: NonNullable<ReturnType<typeof editorSlice>['onTransaction']>[] = [];
    const seenCommands = new Set<string>();
    for (const { name, slice } of slices) {
        blockEditors.push(...(slice.blockEditors ?? []));
        for (const k of slice.inline ?? []) kinds.set(k.type, k);
        for (const [cmd, fn] of Object.entries(slice.commands ?? {})) {
            if (__DEV__ && (seenCommands.has(cmd) || cmd in builtinCommands)) console.warn(`[@sigx/markdown] Plugin "${name}" redefines command "${cmd}".`);
            seenCommands.add(cmd);
            pluginCommands[cmd] = fn;
        }
        if (slice.keymap) keymaps.push(slice.keymap);
        if (slice.inputRules && options.inputRules !== false) rules.push(...slice.inputRules);
        toolbarItems.push(...(slice.toolbar ?? []));
        for (const spec of slice.triggers ?? []) triggers.push({ plugin: name, spec });
        if (slice.onTransaction) transactionHooks.push(slice.onTransaction);
    }
    if (options.keymap) keymaps.push(options.keymap);

    const schema = createSchema(blockEditors);
    const allCommands: Record<string, Command> = { ...builtinCommands, ...pluginCommands };
    const keymap = resolveKeymap(keymaps, allCommands);
    const ctx: CommandContext = { schema, inline: kinds.size ? { kinds } : undefined, parse: options.parse };
    const platform: PlatformInfo = { isMac: false, hasHardwareKeyboard: true, caretRectSpace: 'editor', ...options.platform };
    const history = createHistory(options.history);

    let state = createState(options.doc ?? { type: 'root', children: [] }, null, { editableTypes: schema.editableTypes });
    const rev = signal(0);
    const selRev = signal(0);
    const listeners = new Set<EditorListener>();
    let pendingExternal: Transaction | null = null;
    let focusedKey: string | null = null;
    let readOnly = options.readOnly ?? false;

    const commit = (tr: Transaction, next: EditorState, inverse: ReturnType<typeof applyTransaction>['inverse']): void => {
        const prev = state;
        state = next;
        const docChanged = tr.steps.length > 0;
        if (tr.meta.clearHistory) history.clear();
        else if (docChanged && tr.meta.addToHistory !== false) history.record(tr, inverse, prev.selection, next.selection);
        if (tr.meta.origin === 'history' || tr.meta.origin === 'external') history.closeGroup();
        if (docChanged) rev.value++;
        if (docChanged || !selectionEquals(prev.selection, next.selection) || prev.composing !== next.composing) selRev.value++;
        for (const l of listeners) l(tr, next, prev);
        if (!selectionEquals(prev.selection, next.selection)) options.onSelectionChange?.(next.selection);
        if (docChanged && !next.composing) options.onChange?.({ state: next, transaction: tr });
    };

    const dispatch: Dispatch = (input) => {
        let tr: Transaction | null = input;
        for (const hook of transactionHooks) {
            tr = hook(tr, state);
            if (!tr) return;
        }
        // External writes wait for an open composition to end.
        if (tr.meta.origin === 'external' && state.composing) {
            pendingExternal = tr;
            return;
        }
        if (readOnly && tr.steps.length && tr.meta.origin !== 'external') return;
        const applied = applyTransaction(state, tr, { inline: ctx.inline }, schema.editableTypes);
        commit(tr, applied.state, applied.inverse);
        // Input rules run on typing transactions and may produce a follow-up.
        if (tr.steps.length && tr.meta.origin !== 'inputRule' && tr.meta.origin !== 'history' && rules.length) {
            const follow = applyInputRules(rules, tr, state, ctx);
            if (follow) {
                const a2 = applyTransaction(state, follow, { inline: ctx.inline }, schema.editableTypes);
                commit(follow, a2.state, a2.inverse);
            }
        }
        if (pendingExternal && !state.composing) {
            const p = pendingExternal;
            pendingExternal = null;
            dispatch(p);
        }
    };

    const run = (command: Command | string): boolean => {
        if (typeof command === 'string') {
            if (command === 'undo') return editor.undo();
            if (command === 'redo') return editor.redo();
            const fn = allCommands[command];
            if (!fn) return false;
            return fn(state, dispatch, ctx);
        }
        return command(state, dispatch, ctx);
    };

    const runKey = (name: KeyName): boolean => {
        if (name === 'Enter') return editor.enter();
        if (name === 'Backspace' && editor.undoInputRule()) return true;
        const result = runKeymap(keymap, name, state, dispatch, ctx);
        if (result === 'undo') return editor.undo();
        if (result === 'redo') return editor.redo();
        return result;
    };

    const applyHistory = (entry: { inverse: unknown; forward: unknown; selectionBefore: EditorSelection; selectionAfter: EditorSelection } | null, dir: 'undo' | 'redo'): boolean => {
        if (!entry) return false;
        const steps = (dir === 'undo' ? entry.inverse : entry.forward) as Transaction['steps'];
        dispatch({ steps, selection: dir === 'undo' ? entry.selectionBefore : entry.selectionAfter, meta: { origin: 'history', addToHistory: false } });
        return true;
    };

    const editor: Editor = {
        get state() {
            return state;
        },
        rev,
        selRev,
        schema,
        history,
        commands: allCommands,
        keymap,
        inputRules: rules,
        toolbarItems,
        triggers,
        ctx,
        platform,
        get readOnly() {
            return readOnly;
        },
        set readOnly(v: boolean) {
            readOnly = v;
            selRev.value++;
        },
        dispatch,
        run,
        runKey,
        enter: () => {
            if (state.composing) return false;
            const follow = applyEnterRules(state, ctx);
            if (follow) {
                dispatch(follow);
                return true;
            }
            const result = runKeymap(keymap, 'Enter', state, dispatch, ctx);
            return result === true;
        },
        undoInputRule: () => {
            const entry = history.peekInputRule();
            if (!entry) return false;
            const sel = state.selection;
            // Only right after the rule, with the caret still in the block it changed.
            if (!sel || sel.mode !== 'text' || !selectionEquals(sel, entry.selectionAfter)) return false;
            history.popUndo();
            dispatch({ steps: entry.inverse, selection: entry.selectionBefore, meta: { origin: 'history', addToHistory: false } });
            return true;
        },
        undo: () => (state.composing ? false : applyHistory(history.popUndo(), 'undo')),
        redo: () => (state.composing ? false : applyHistory(history.popRedo(), 'redo')),
        setSelection: (selection) => {
            if (selectionEquals(state.selection, selection)) return;
            dispatch({ steps: [], selection, meta: { origin: 'command', addToHistory: false } });
        },
        setDocument: (doc) => {
            // The history is cleared when the write lands (it may be deferred past a composition).
            setDocumentCommand(doc)(state, (tr) => dispatch({ ...tr, meta: { ...tr.meta, clearHistory: true } }), ctx);
        },
        setMarkdown: (markdown) => {
            if (!ctx.parse) return false;
            editor.setDocument(ctx.parse(markdown));
            return true;
        },
        paste: (text, markdown) => pasteText(markdown ?? text)(state, dispatch, ctx),
        flatOf: (key) => {
            const entry = state.index().get(key);
            if (!entry || schema.kind(entry.node.type) !== 'inline') return null;
            return flatOf(entry.node, { inline: ctx.inline });
        },
        valueOf: (key) => {
            const entry = state.index().get(key);
            if (!entry || schema.kind(entry.node.type) !== 'code') return null;
            return (entry.node as { value: string }).value;
        },
        listen: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        get focusedKey() {
            return focusedKey;
        },
        focused: (key) => {
            focusedKey = key;
            if (key === null) history.closeGroup();
        },
        destroy: () => {
            listeners.clear();
            history.clear();
        },
    };

    // A fresh editor starts with the caret in the first editable block.
    const first = state.index().editable()[0];
    if (first) state = { ...state, selection: { mode: 'text', anchor: { key: first, offset: 0 }, head: { key: first, offset: 0 } } };

    return editor;
}

/** Convenience: the blocks a markdown string parses to, for `insertBlocks` / tests. */
export function blocksOf(parse: (md: string) => Root, markdown: string): BlockContent[] {
    return parse(markdown).children;
}
