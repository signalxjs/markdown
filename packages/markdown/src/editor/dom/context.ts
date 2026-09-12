/**
 * The view context every block component reads: the editor instance, the
 * surface registry, focus tracking, the last arrow goal-x, and the options
 * that reach the surfaces (atom renderers, placeholder, read-only).
 *
 * Provided by `<MarkdownEditor>` through an injectable so nested blocks
 * (list items in quotes in lists) need no prop drilling.
 */

import { computed, signal, type Computed, type PrimitiveSignal } from '@sigx/reactivity';
import { defineInjectable } from '@sigx/runtime-core';
import type { Editor } from '../editor.js';
import { selectedBlockKeys } from '../commands.js';
import type { AnySurface } from '../surface.js';
import type { AtomRenderer } from './inline-dom.js';
import type { DomMarkdownComponents } from '../../dom/index.js';

/** Read signals for dependency tracking only (a render that depends on `rev` without using its value). */
export function track(..._values: unknown[]): void {}

export interface BlockMenuRequest {
    key: string;
    anchor: HTMLElement;
}

export interface EditorView {
    readonly editor: Editor;
    /** The editor root element once mounted. */
    root(): HTMLElement | null;
    /** Mounted surfaces by block key. */
    readonly surfaces: Map<string, AnySurface>;
    register(key: string, surface: AnySurface): () => void;
    /** Whether keyboard focus is inside the editor (a surface, the root, a void block). Stays true across a synchronous DOM swap. */
    hasFocus(): boolean;
    /** The x-goal of the last ArrowUp/Down boundary, for the neighbour to land under. */
    goalX: number | undefined;
    readonly atoms: ReadonlyMap<string, AtomRenderer>;
    /** Keys of the blocks in the current block selection (empty for a text selection). */
    readonly selectedKeys: Computed<ReadonlySet<string>>;
    readOnly(): boolean;
    /** The placeholder for the single empty first block. */
    placeholder(): string | undefined;
    /** Whether block handles render. */
    handles(): boolean;
    /** The read-only component map void blocks render with. */
    components(): DomMarkdownComponents;
    /** Focus the surface of a block (a no-op when it is not mounted). */
    focusBlock(key: string, target?: { edge: 'start' | 'end' } | { offset: number }): boolean;
    /** Move keyboard focus to the editor root (block selections live there). */
    focusRoot(): void;
    /** The open block menu (key + anchor element), or null. Reactive through `blockMenuRev`. */
    blockMenu(): BlockMenuRequest | null;
    readonly blockMenuRev: PrimitiveSignal<number>;
    openBlockMenu(key: string, anchor: HTMLElement): void;
    closeBlockMenu(): void;
    /** Wired to the root's `focusin` / `focusout` by the editor component. */
    focusIn(): void;
    focusOut(): void;
}

export const useEditorView = defineInjectable<EditorView>('MarkdownEditorView', {
    hint: 'Editor block components render inside <MarkdownEditor>.',
});

export interface CreateViewOptions {
    editor: Editor;
    atoms: ReadonlyMap<string, AtomRenderer>;
    root(): HTMLElement | null;
    readOnly(): boolean;
    placeholder(): string | undefined;
    handles(): boolean;
    components(): DomMarkdownComponents;
}

export function createEditorView(opts: CreateViewOptions): EditorView {
    const { editor } = opts;
    const surfaces = new Map<string, AnySurface>();
    let focusWithin = false;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const selectedKeys = computed<ReadonlySet<string>>(() => {
        track(editor.selRev.value);
        const sel = editor.state.selection;
        if (!sel || sel.mode !== 'block') return new Set();
        return new Set(selectedBlockKeys(editor.state));
    });

    let blockMenu: BlockMenuRequest | null = null;
    const blockMenuRev = signal(0);

    const view: EditorView = {
        editor,
        blockMenu: () => {
            track(blockMenuRev.value);
            return blockMenu;
        },
        blockMenuRev,
        openBlockMenu(key, anchor) {
            blockMenu = { key, anchor };
            blockMenuRev.value++;
        },
        closeBlockMenu() {
            if (!blockMenu) return;
            blockMenu = null;
            blockMenuRev.value++;
        },
        root: opts.root,
        surfaces,
        register(key, surface) {
            surfaces.set(key, surface);
            return () => {
                if (surfaces.get(key) === surface) surfaces.delete(key);
            };
        },
        hasFocus: () => focusWithin,
        goalX: undefined,
        atoms: opts.atoms,
        selectedKeys,
        readOnly: opts.readOnly,
        placeholder: opts.placeholder,
        handles: opts.handles,
        components: opts.components,
        focusBlock(key, target) {
            const s = surfaces.get(key);
            if (!s) return false;
            s.focus(target);
            return true;
        },
        focusRoot() {
            const el = opts.root();
            if (el && el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
        },
        // Focus tracking: `focusout` fires before the next `focusin` (and before a
        // replaced element's successor mounts), so clearing is deferred a task.
        focusIn() {
            if (blurTimer !== null) {
                clearTimeout(blurTimer);
                blurTimer = null;
            }
            focusWithin = true;
        },
        focusOut() {
            if (blurTimer !== null) clearTimeout(blurTimer);
            blurTimer = setTimeout(() => {
                blurTimer = null;
                const root = opts.root();
                focusWithin = !!root && root.contains(root.ownerDocument.activeElement);
            }, 0);
        },
    };

    return view;
}
