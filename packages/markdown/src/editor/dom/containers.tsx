/**
 * Container views — how `<BlockView>` wraps the children of a container
 * block. The standard vocabulary's containers (list, list item, blockquote)
 * are here; a plugin adds its own through `editor.dom.containers`, and
 * anything without a view renders as a plain `data-part="container"` div.
 * `<BlockView>` still owns the `data-part="block"` wrapper, the key, the
 * selection flag and the handle; a view only decides the element around the
 * children (a list item is its own wrapper, so lists stay real lists).
 */

import { component, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import type { List, ListItem } from '../../ast/index.js';
import { toggleTaskChecked } from '../commands-standard.js';
import type { EditorBlock } from '../state.js';
import { editorPart, flag } from './anatomy.js';
import { useEditorView, type EditorView } from './context.js';

export interface ContainerViewProps {
    node: EditorBlock;
    /** The rendered child `<BlockView>`s. */
    children: JSXElement[];
    /** The `data-part="block"` wrapper attributes (key, type, selection flag). */
    wrapperAttrs: Record<string, unknown>;
    /** The block handle, or `null` when handles are off. */
    handle: JSXElement | null;
    view: EditorView;
}

/** Renders a container block: the wrapper element plus its children. */
export type ContainerView = (props: ContainerViewProps) => JSXElement;

const TaskCheck = component<{ item: ListItem }>(({ props }) => {
    const view = useEditorView();
    const onChange = (): void => {
        if (view.readOnly()) return;
        view.editor.run(toggleTaskChecked(props.item.key!));
    };
    return () => (
        <input {...editorPart('task-check')} type="checkbox" checked={!!props.item.checked} disabled={view.readOnly()} aria-label="Task" onChange={onChange} />
    );
});

const listView: ContainerView = ({ node, children, wrapperAttrs, handle }) => {
    const list = node as List;
    return (
        <div {...wrapperAttrs}>
            {handle}
            {list.ordered ? (
                <ol {...editorPart('list')} data-key={list.key} data-ordered="" data-spread={flag(!!list.spread)} start={list.start ?? undefined}>
                    {children}
                </ol>
            ) : (
                <ul {...editorPart('list')} data-key={list.key} data-spread={flag(!!list.spread)}>
                    {children}
                </ul>
            )}
        </div>
    );
};

const listItemView: ContainerView = ({ node, children, wrapperAttrs }) => {
    const item = node as ListItem;
    const task = item.checked !== null && item.checked !== undefined;
    return (
        <li {...wrapperAttrs} {...editorPart('list-item')} data-task={flag(task)} data-checked={task ? String(item.checked) : undefined}>
            {task ? <TaskCheck item={item} /> : null}
            {children}
        </li>
    );
};

const blockquoteView: ContainerView = ({ node, children, wrapperAttrs, handle }) => (
    <div {...wrapperAttrs}>
        {handle}
        <blockquote {...editorPart('blockquote')} data-key={node.key}>
            {children}
        </blockquote>
    </div>
);

/** Any other container: a plain div carrying the type. */
export const defaultContainerView: ContainerView = ({ node, children, wrapperAttrs, handle }) => (
    <div {...wrapperAttrs}>
        {handle}
        <div {...editorPart('container')} data-type={node.type} data-key={node.key}>
            {children}
        </div>
    </div>
);

/** The standard vocabulary's container views, by node type. */
export const standardContainerViews: ReadonlyMap<string, ContainerView> = new Map([
    ['list', listView],
    ['listItem', listItemView],
    ['blockquote', blockquoteView],
]);
