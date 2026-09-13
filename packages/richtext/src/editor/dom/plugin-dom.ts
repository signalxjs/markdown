/**
 * The DOM slice of a plugin's editor contribution, under `editor.dom` — the
 * editor-side counterpart of the `components.dom` slot: atom (chip)
 * renderers for the plugin's inline atoms and container views for its
 * container blocks, so a plugin ships its DOM pieces once.
 */

import type { RichTextPlugin } from '../../plugin/index.js';
import { editorSlice } from '../plugin.js';
import type { ContainerView } from './containers.js';
import type { AtomRenderer } from './inline-dom.js';

export interface DomEditorSlice {
    /** Atom (chip) renderers by inline node type. */
    atoms?: Record<string, AtomRenderer>;
    /** Container views by block type (the element around a container's children). */
    containers?: Record<string, ContainerView>;
}

/** Read the DOM slice of a plugin's editor contribution (`plugin.editor.dom`). */
export function domEditorSlice(plugin: RichTextPlugin): DomEditorSlice {
    const slice = editorSlice(plugin) as { dom?: DomEditorSlice };
    return slice.dom && typeof slice.dom === 'object' ? slice.dom : {};
}

export function pluginAtomRenderers(plugins: readonly RichTextPlugin[]): [string, AtomRenderer][] {
    const out: [string, AtomRenderer][] = [];
    for (const p of plugins) for (const [type, render] of Object.entries(domEditorSlice(p).atoms ?? {})) out.push([type, render]);
    return out;
}

export function pluginContainerViews(plugins: readonly RichTextPlugin[]): [string, ContainerView][] {
    const out: [string, ContainerView][] = [];
    for (const p of plugins) for (const [type, render] of Object.entries(domEditorSlice(p).containers ?? {})) out.push([type, render]);
    return out;
}
