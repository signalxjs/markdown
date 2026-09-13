/**
 * The editor slice of `RichTextPlugin` — what a plugin contributes to the
 * editing experience on top of its node specs, syntax, serializer and
 * component halves. Typed here (the core `plugin/types.ts` leaves `editor`
 * open) so the root entry never depends on editor code.
 */

import type { Root } from '../ast/index.js';
import type { RichTextPlugin } from '../plugin/index.js';
import type { Command, CommandContext } from './commands.js';
import type { EnterRule, InputRule } from './input-rules.js';
import type { Keymap } from './keymap.js';
import type { PasteData } from './paste.js';
import type { EditorState } from './state.js';
import type { ToolbarItem } from './toolbar.js';
import type { Transaction } from './transaction.js';
import type { TriggerSpec } from './trigger/index.js';

/** What a plugin puts on the clipboard when the editor copies blocks: flavours keyed by MIME type (`text` is `text/plain`). */
export interface ClipboardWriter {
    write(root: Root, ctx: CommandContext): Partial<PasteData>;
}

export interface EditorPluginSlice {
    /** Named commands, callable from keymaps and toolbars. */
    commands?: Readonly<Record<string, Command>>;
    keymap?: Keymap;
    /** Rules that fire as you type (a format's syntax shortcuts). */
    inputRules?: readonly InputRule[];
    /** Rules the editor consults on Enter before splitting the block. */
    enterRules?: readonly EnterRule[];
    toolbar?: readonly ToolbarItem[];
    triggers?: readonly TriggerSpec[];
    /** Flavours to write on copy (a format's serialization). */
    clipboard?: ClipboardWriter;
    /** Inspect or rewrite a transaction before it is applied (return `null` to drop it). */
    onTransaction?(tr: Transaction, state: EditorState): Transaction | null;
}

/** A `RichTextPlugin` whose `editor` slot is typed. Node types come through `RichTextPlugin.nodes`. */
export interface EditorPlugin extends RichTextPlugin {
    editor?: EditorPluginSlice;
}

/** Read the editor slice of a plugin (plugins without one contribute nothing). */
export function editorSlice(plugin: RichTextPlugin): EditorPluginSlice {
    const slice = (plugin as EditorPlugin).editor;
    return slice && typeof slice === 'object' ? slice : {};
}
