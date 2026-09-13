/**
 * The reference plugin node: a mention. The platform-neutral half — the node
 * type and its spec — lives here so every renderer, format and the editor
 * agree on the node; a format adds its syntax under `formats[<id>]`
 * (`mentionMarkdown` in `@sigx/richtext-markdown`), renderers register a
 * `mention` component per platform (`components.mention`), and the editor
 * (`createMentionPlugin`) adds the `@` trigger and chip behaviour.
 */

import type { Position } from '../ast/index.js';
import type { NodeSpec } from '../schema/index.js';

/**
 * The mention node. Register it in your app to type it as phrasing content and
 * to type its component slot:
 *
 * ```ts
 * declare module '@sigx/richtext' {
 *   interface PhrasingContentMap { mention: Mention }
 * }
 * ```
 * (The package does not do this itself so a plain tree stays exactly mdast.)
 */
export interface Mention {
    type: 'mention';
    /** The referenced entity (a user id, a page id, …). */
    id: string;
    /** The display label as written. */
    label: string;
    position?: Position;
}

/** The mention node spec: an atom whose attrs are `id` and `label`; renders as `@label` without a component. */
export const mentionNode: NodeSpec = {
    type: 'mention',
    role: 'atom',
    inline: {
        toFlat: (node) => {
            const m = node as unknown as Mention;
            return { id: m.id, label: m.label };
        },
        fromFlat: (span) => ({ type: 'mention', id: span.attrs?.id ?? '', label: span.attrs?.label ?? '' }) as unknown as Mention as never,
    },
    text: (node) => `@${(node as unknown as Mention).label}`,
};
