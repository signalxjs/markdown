/**
 * DOM atom renderers contributed by plugins. A plugin's editor slice may
 * carry `atoms: { [type]: AtomRenderer }` under `editor.dom` — the DOM
 * counterpart of the `components.dom` slot for the renderer — so a plugin
 * ships its chip once.
 */

import type { MarkdownPlugin } from '../../plugin/index.js';
import { editorSlice } from '../plugin.js';
import type { AtomRenderer } from './inline-dom.js';

export interface DomEditorSlice {
    /** Atom (chip) renderers by inline node type. */
    atoms?: Record<string, AtomRenderer>;
}

/** Read the DOM slice of a plugin's editor contribution (`plugin.editor.dom`). */
export function domEditorSlice(plugin: MarkdownPlugin): DomEditorSlice {
    const slice = editorSlice(plugin) as { dom?: DomEditorSlice };
    return slice.dom && typeof slice.dom === 'object' ? slice.dom : {};
}

export function pluginAtomRenderers(plugins: readonly MarkdownPlugin[]): [string, AtomRenderer][] {
    const out: [string, AtomRenderer][] = [];
    for (const p of plugins) for (const [type, render] of Object.entries(domEditorSlice(p).atoms ?? {})) out.push([type, render]);
    return out;
}
