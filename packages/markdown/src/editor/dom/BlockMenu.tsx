/**
 * `<BlockMenu>` — the menu a block handle opens: turn the block into
 * another type, move it, duplicate it, delete it. `role="menu"` with roving
 * focus; Escape or an outside pointer-down closes it and focus returns to
 * the editor.
 */

import { component, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { deleteBlock, duplicateBlock, moveBlockDown, moveBlockUp, selectBlock, type Command } from '../commands.js';
import { turnIntoCommand } from '../menu.js';
import { blockMenuPart } from './anatomy.js';
import { useEditorView } from './context.js';
import { track } from './context.js';
import { anchoredPosition, onDismiss, roveList } from './popup.js';

interface MenuAction {
    id: string;
    label: string;
    icon?: string;
    command: Command;
}

export const BlockMenu = component(({ onUnmounted }) => {
    const view = useEditorView();
    const { editor } = view;
    let el: HTMLElement | null = null;
    let dispose: (() => void) | null = null;

    const close = (): void => {
        const req = view.blockMenu();
        view.closeBlockMenu();
        if (req) view.focusRoot();
    };

    const attach = (node: HTMLElement | null): void => {
        dispose?.();
        dispose = null;
        el = node;
        if (!node) return;
        const req = view.blockMenu();
        dispose = onDismiss(node, close, req?.anchor);
        // The element is attached before it is inserted: focus once it is.
        queueMicrotask(() => node.isConnected && node.querySelector<HTMLElement>('[role=menuitem]')?.focus());
    };

    onUnmounted(() => dispose?.());

    const run = (command: Command): void => {
        const req = view.blockMenu();
        if (!req) return;
        view.closeBlockMenu();
        // Commands act on the selection: select the block first.
        editor.run(selectBlock(req.key));
        editor.run(command);
        if (editor.state.selection?.mode === 'block') view.focusRoot();
    };

    const onKeydown = (e: KeyboardEvent): void => {
        if (!el) return;
        if (roveList(el, e, '[role=menuitem]')) return;
        if (e.key === 'Tab') {
            e.preventDefault();
            close();
        }
    };

    return (): JSXElement | undefined => {
        const req = view.blockMenu();
        const root = view.root();
        if (!req || !root) return undefined;
        track(editor.rev.value);
        const entry = editor.state.index().get(req.key);
        if (!entry) return undefined;
        const kind = editor.schema.kind(entry.node.type);
        const turnInto: MenuAction[] = editor.schema
            .menu()
            .filter((spec) => spec.type !== entry.node.type && spec.type !== 'table' && spec.type !== 'thematicBreak')
            .filter((spec) => kind === 'inline' || kind === 'code' || spec.kind === 'inline')
            .map((spec) => ({ id: `turn:${spec.type}`, label: spec.menu!.label, icon: spec.menu!.icon, command: turnIntoCommand(spec) }));
        const actions: MenuAction[] = [
            { id: 'moveUp', label: 'Move up', icon: 'arrow-up', command: moveBlockUp },
            { id: 'moveDown', label: 'Move down', icon: 'arrow-down', command: moveBlockDown },
            { id: 'duplicate', label: 'Duplicate', icon: 'copy', command: duplicateBlock },
            { id: 'delete', label: 'Delete', icon: 'trash', command: deleteBlock },
        ];
        const pos = anchoredPosition(req.anchor, root, 280);
        const item = (a: MenuAction): JSXElement => (
            <button key={a.id} {...blockMenuPart('item')} type="button" role="menuitem" data-action={a.id} data-icon={a.icon} tabIndex={-1} onClick={() => run(a.command)}>
                {a.label}
            </button>
        );
        return (
            <div {...blockMenuPart('root')} role="menu" aria-label="Block options" data-state="open" style={`position:absolute;left:${pos.left}px;top:${pos.top}px`} ref={attach} onKeyDown={onKeydown}>
                {turnInto.length ? (
                    <>
                        <div {...blockMenuPart('label')} role="presentation">
                            Turn into
                        </div>
                        {turnInto.map(item)}
                        <div {...blockMenuPart('separator')} role="separator" />
                    </>
                ) : null}
                {actions.map(item)}
            </div>
        );
    };
});
