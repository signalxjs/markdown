/**
 * The DOM side of mentions: the chip renderer and a plugin factory that
 * bundles the core mention editor plugin with it.
 */

import type { InlineSpan } from '../inline-flat.js';
import { createMentionPlugin, type MentionPluginOptions } from '../mention.js';
import type { EditorPlugin } from '../plugin.js';
import { EDITOR_SCOPE } from './anatomy.js';
import type { AtomRenderer } from './inline-dom.js';

export interface DomMentionOptions extends MentionPluginOptions {
    /** Render the chip. Default: `<span data-part="mention">@label</span>`. */
    renderChip?: AtomRenderer;
}

/** The default mention chip. */
export const mentionChip: AtomRenderer = (span: InlineSpan, d: Document): HTMLElement => {
    const el = d.createElement('span');
    el.setAttribute('data-scope', EDITOR_SCOPE);
    el.setAttribute('data-part', 'mention');
    el.setAttribute('data-id', span.attrs?.id ?? '');
    el.textContent = `@${span.attrs?.label ?? ''}`;
    return el;
};

/** The mention plugin for the DOM editor: syntax, serializer, atom kind, `@` trigger and the chip. */
export function createDomMentionPlugin(options: DomMentionOptions): EditorPlugin {
    const base = createMentionPlugin(options);
    return { ...base, editor: { ...base.editor, dom: { atoms: { mention: options.renderChip ?? mentionChip } } } as EditorPlugin['editor'] };
}
