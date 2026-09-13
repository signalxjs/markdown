import { describe, expect, it } from 'vitest';
import { createEditor } from '@sigx/richtext/editor';
import { markdownFormat } from '@sigx/richtext-markdown';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { htmlFormat } from '../../src/format.js';
import { htmlPreset } from '../../src/editor/preset.js';

describe('htmlPreset', () => {
    it('adds text/html to the clipboard flavours next to the primary format', () => {
        const editor = createEditor({ format: markdownFormat, formats: [htmlFormat], plugins: [markdownPreset, htmlPreset] });
        editor.setSource('# Hi\n\n**b**');
        expect(editor.clipboard(editor.state.doc)).toEqual({ text: '# Hi\n\n**b**\n', 'text/markdown': '# Hi\n\n**b**\n', 'text/html': '<h1>Hi</h1>\n<p><strong>b</strong></p>\n' });
    });

    it('writes nothing when the editor does not read html', () => {
        const editor = createEditor({ format: markdownFormat, plugins: [markdownPreset, htmlPreset] });
        editor.setSource('a');
        expect(editor.clipboard(editor.state.doc)).toEqual({ text: 'a\n', 'text/markdown': 'a\n' });
    });

    it('is the only writer an html editor needs', () => {
        const editor = createEditor({ format: htmlFormat, plugins: [htmlPreset] });
        editor.setSource('<p>a</p>');
        expect(editor.clipboard(editor.state.doc)).toEqual({ text: '', 'text/html': '<p>a</p>\n' });
    });
});
