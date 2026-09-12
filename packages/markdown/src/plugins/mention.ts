/**
 * The reference plugin: `@[label](id)` mentions.
 *
 * The platform-neutral half — syntax and serializer — lives here so every
 * renderer and the editor agree on the node; renderers register a `mention`
 * component per platform (`components.mention`), and `@sigx/markdown/editor`
 * adds the `@` trigger and chip behaviour.
 */

import type { Position } from '../ast/index.js';
import type { InlineSyntaxExtension, MarkdownPlugin } from '../plugin/index.js';

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

/** The mention plugin: syntax + serializer. Pair it with a `mention` component per platform. */
export const mentionPlugin: MarkdownPlugin = {
    name: 'mention',
    inline: [mentionSyntax],
    serialize: { mention: (node: Mention) => serializeMention(node) },
};
