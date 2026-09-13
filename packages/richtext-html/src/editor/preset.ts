/**
 * `htmlPreset` — the `text/html` clipboard flavour: copying blocks from any
 * `@sigx/richtext` editor that installs it puts HTML on the clipboard next
 * to the primary format's flavour, so the selection pastes into browsers,
 * mail clients and word processors as rich text. The editor must read the
 * HTML format too (`format: htmlFormat` or `formats: [htmlFormat]`) — the
 * writer serializes through the editor's own `html` format, so this preset
 * pulls no serializer in.
 */

import type { EditorPlugin } from '@sigx/richtext/editor';

export const htmlPreset: EditorPlugin = {
    name: 'html',
    editor: {
        clipboard: {
            write: (root, ctx) => {
                const format = ctx.formats.find((f) => f.id === 'html');
                if (!format) return {};
                return { 'text/html': format.serialize(root, { plugins: ctx.plugins }) };
            },
        },
    },
};
