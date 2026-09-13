/**
 * The reference plugin: `@[label](id)` mentions.
 *
 * The platform-neutral half — syntax and serializer — lives here so every
 * renderer and the editor agree on the node; renderers register a `mention`
 * component per platform (`components.mention`), and `@sigx/markdown/editor`
 * adds the `@` trigger and chip behaviour.
 */

import type { Position } from '../ast/index.js';
import type { InlineSyntaxExtension, MarkdownPluginSlice, RichTextPlugin } from '../plugin/index.js';
import type { NodeSpec } from '../schema/index.js';

/**
 * The mention node. Register it in your app to type it as phrasing content and
 * to type its component slot:
 *
 * ```ts
 * declare module '@sigx/markdown' {
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

const MENTION_RE = /^@\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/;

/** Inline syntax for `@[label](id)`. Streaming-safe: a partial tail is no match. */
export const mentionSyntax: InlineSyntaxExtension<Mention> = {
    name: 'mention',
    triggerChars: ['@'],
    match(text, pos, ctx) {
        const m = MENTION_RE.exec(text.slice(pos));
        if (!m) return null;
        const node: Mention = { type: 'mention', label: m[1], id: m[2] };
        const position = ctx.position(pos, pos + m[0].length);
        if (position) node.position = position;
        return { node, end: pos + m[0].length };
    },
};

/** Serialize a mention back to `@[label](id)`. */
export function serializeMention(node: Mention): string {
    return `@[${node.label.replace(/[\]\r\n]/g, '')}](${node.id.replace(/[)\r\n]/g, '')})`;
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

/** The markdown slice of the mention plugin: `@[label](id)` in and out. */
export const mentionMarkdown: MarkdownPluginSlice = {
    inline: [mentionSyntax],
    serialize: { mention: (node: Mention) => serializeMention(node) },
};

/** The mention plugin: node spec plus its markdown syntax. Pair it with a `mention` component per platform. */
export const mentionPlugin: RichTextPlugin = {
    name: 'mention',
    nodes: [mentionNode],
    formats: { markdown: mentionMarkdown },
};
