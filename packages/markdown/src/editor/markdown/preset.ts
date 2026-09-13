/**
 * `markdownPreset` — what makes an editor a *markdown* editor: the input
 * rules and Enter rules that turn typed markdown syntax into structure, and
 * a clipboard writer that puts `text/markdown` (and the same text as
 * `text/plain`) on copy. The format itself (`markdownFormat`) is passed to
 * the editor separately — the writer serializes through the editor's own
 * `markdown` format, so this preset pulls no parser or serializer in.
 */

import type { EditorPlugin } from '../plugin.js';
import { markdownEnterRules, markdownInputRules } from './input-rules.js';

export const markdownPreset: EditorPlugin = {
    name: 'markdown',
    editor: {
        inputRules: markdownInputRules,
        enterRules: markdownEnterRules,
        clipboard: {
            write: (root, ctx) => {
                const format = ctx.formats.find((f) => f.id === 'markdown');
                if (!format) return {};
                const md = format.serialize(root, { plugins: ctx.plugins });
                return { text: md, 'text/markdown': md };
            },
        },
    },
};
