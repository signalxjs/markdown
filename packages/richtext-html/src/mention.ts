/**
 * The HTML half of the reference mention plugin:
 * `<span data-mention="id">@label</span>` both ways. Pair it with the core's
 * `mentionNode` (and `mentionMarkdown` from `@sigx/richtext-markdown`) in a
 * `RichTextPlugin`, or pass it as `formats.html` to `createMentionPlugin`.
 */

import type { Mention } from '@sigx/richtext';
import type { HtmlPluginSlice } from './plugin.js';

export const mentionHtml: HtmlPluginSlice = {
    elements: {
        span: (el, ctx) => {
            const id = el.attrs['data-mention'];
            if (id === undefined) return null;
            const node: Mention = { type: 'mention', id, label: ctx.text().trim().replace(/^@/, '') };
            return node as never;
        },
    },
    serialize: {
        mention: (node: Mention, ctx) => `<span data-mention="${ctx.attr(node.id)}">@${ctx.escape(node.label)}</span>`,
    },
};
