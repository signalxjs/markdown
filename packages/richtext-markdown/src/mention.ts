/**
 * The markdown half of the reference mention plugin: `@[label](id)` in and
 * out. The node itself (`Mention`, `mentionNode`) is `@sigx/richtext`'s.
 */

import { mentionNode, type Mention, type RichTextPlugin } from '@sigx/richtext';
import type { InlineSyntaxExtension, MarkdownPluginSlice } from './plugin/markdown.js';

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

/** The markdown slice of the mention plugin. */
export const mentionMarkdown: MarkdownPluginSlice = {
    inline: [mentionSyntax],
    serialize: { mention: (node: Mention) => serializeMention(node) },
};

/** The mention plugin for markdown documents: the node spec plus its syntax. Pair it with a `mention` component per platform. */
export const mentionPlugin: RichTextPlugin = {
    name: 'mention',
    nodes: [mentionNode],
    formats: { markdown: mentionMarkdown },
};
