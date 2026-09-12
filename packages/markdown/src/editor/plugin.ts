/**
 * The editor slice of `MarkdownPlugin` — what a plugin contributes to the
 * editing experience on top of its syntax/serializer/component halves.
 * Typed here (the core `plugin/types.ts` leaves `editor` open) so the root
 * entry never depends on editor code.
 */

import type { MarkdownPlugin } from '../plugin/index.js';
import type { Command } from './commands.js';
import type { InlineKindSpec } from './inline-flat.js';
import type { InputRule } from './input-rules.js';
import type { Keymap } from './keymap.js';
import type { BlockEditorSpec } from './schema.js';
import type { EditorState } from './state.js';
import type { ToolbarItem } from './toolbar.js';
import type { Transaction } from './transaction.js';
import type { TriggerSpec } from './trigger/index.js';

export interface EditorPluginSlice {
    /** Block types this plugin edits, with their surface kind. */
    blockEditors?: readonly BlockEditorSpec[];
    /** How this plugin's inline node types map onto the flat model (mark or atom). */
    inline?: readonly InlineKindSpec[];
    /** Named commands, callable from keymaps and toolbars. */
    commands?: Readonly<Record<string, Command>>;
    keymap?: Keymap;
    inputRules?: readonly InputRule[];
    toolbar?: readonly ToolbarItem[];
    triggers?: readonly TriggerSpec[];
    /** Inspect or rewrite a transaction before it is applied (return `null` to drop it). */
    onTransaction?(tr: Transaction, state: EditorState): Transaction | null;
}

/** A `MarkdownPlugin` whose `editor` slot is typed. */
export interface EditorPlugin extends MarkdownPlugin {
    editor?: EditorPluginSlice;
}

/** Read the editor slice of a plugin (plugins without one contribute nothing). */
export function editorSlice(plugin: MarkdownPlugin): EditorPluginSlice {
    const slice = (plugin as EditorPlugin).editor;
    return slice && typeof slice === 'object' ? slice : {};
}
