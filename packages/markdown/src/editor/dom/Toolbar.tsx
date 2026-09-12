/**
 * `<EditorToolbar>` — `role="toolbar"` over the editor's toolbar items.
 * Buttons carry `data-state="on|off"` from `isActive` and `disabled` from
 * `isEnabled`; `pointerdown` is cancelled so the caret stays in the surface
 * while a button runs its command. Items with the same `group` sit in one
 * `data-part="group"`. Pass `renderItem` to draw items your way (icons).
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { defaultToolbarItems, toolbarState, type ToolbarContext, type ToolbarItem, type ToolbarState } from '../toolbar.js';
import { toolbarPart } from './anatomy.js';
import { useEditorView } from './context.js';
import { track } from './context.js';

export type ToolbarRenderItem = (item: ToolbarItem, tb: ToolbarState, run: () => void) => JSXElement;

export type EditorToolbarProps = Define.WithAttrs<
    & Define.Prop<'items', readonly ToolbarItem[]>
    & Define.Prop<'renderItem', ToolbarRenderItem>
    & Define.Prop<'label', string>
>;

export const EditorToolbar = component<EditorToolbarProps>(({ props }) => {
    const view = useEditorView();
    const { editor } = view;

    const context = (): ToolbarContext => ({
        state: editor.state,
        dispatch: editor.dispatch,
        ctx: editor.ctx,
        run: (command) => editor.run(command),
    });

    const onPointerDown = (e: PointerEvent): void => {
        e.preventDefault();
    };

    const onKeydown = (e: KeyboardEvent): void => {
        // Roving focus across the toolbar with the arrow keys.
        const bar = e.currentTarget as HTMLElement;
        const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
        const i = buttons.indexOf(bar.ownerDocument.activeElement as HTMLButtonElement);
        if (i < 0 || !buttons.length) return;
        if (e.key === 'ArrowRight') buttons[(i + 1) % buttons.length].focus();
        else if (e.key === 'ArrowLeft') buttons[(i - 1 + buttons.length) % buttons.length].focus();
        else return;
        e.preventDefault();
    };

    return () => {
        track(editor.selRev.value, editor.rev.value);
        const tb = toolbarState(editor.state, editor.ctx, editor.history);
        // The default set, then what plugins contribute; `items` replaces both.
        const items = props.items ?? [...defaultToolbarItems, ...editor.toolbarItems];
        const readOnly = view.readOnly();
        const groups: { name: string | undefined; items: ToolbarItem[] }[] = [];
        for (const item of items) {
            const last = groups[groups.length - 1];
            if (last && last.name === item.group) last.items.push(item);
            else groups.push({ name: item.group, items: [item] });
        }
        const renderItem = (item: ToolbarItem): JSXElement => {
            const enabled = !readOnly && (item.isEnabled ? item.isEnabled(tb) : tb.mode !== 'none');
            const active = item.isActive?.(tb) ?? false;
            const run = (): void => {
                if (!enabled) return;
                item.run(context());
            };
            if (props.renderItem) return props.renderItem(item, tb, run);
            return (
                <button
                    key={item.id}
                    {...toolbarPart('item')}
                    type="button"
                    data-item={item.id}
                    data-state={active ? 'on' : 'off'}
                    data-icon={item.icon}
                    aria-pressed={item.isActive ? (active ? 'true' : 'false') : undefined}
                    aria-label={item.label ?? item.id}
                    title={item.label ?? item.id}
                    disabled={!enabled}
                    tabIndex={-1}
                    onPointerDown={onPointerDown}
                    onClick={run}
                >
                    {item.label ?? item.id}
                </button>
            );
        };
        return (
            <div {...toolbarPart('root')} role="toolbar" aria-label={props.label ?? 'Formatting'} aria-orientation="horizontal" onKeyDown={onKeydown}>
                {groups.map((g, i) => (
                    <div key={g.name ?? String(i)} {...toolbarPart('group')} data-group={g.name}>
                        {g.items.map(renderItem)}
                    </div>
                ))}
            </div>
        );
    };
});
