import { describe, expect, it } from 'vitest';
import { createEditor, pickPasteFormat } from '@sigx/richtext/editor';
import { strip } from '@sigx/richtext/testing';
import { markdownFormat } from '@sigx/richtext-markdown';
import { htmlFormat } from '../src/format.js';

describe('htmlFormat', () => {
    it('is the html format over text/html with no extra nodes and no engine of its own', () => {
        expect(htmlFormat.id).toBe('html');
        expect(htmlFormat.mime).toEqual(['text/html']);
        expect(htmlFormat.nodes).toBeUndefined();
        expect(htmlFormat.createIncrementalEngine).toBeUndefined();
    });

    it('converts markdown to html and back through the one tree', () => {
        const md = '# Hi\n\nSome **html**.\n';
        const html = htmlFormat.serialize(markdownFormat.parse(md));
        expect(html).toBe('<h1>Hi</h1>\n<p>Some <strong>html</strong>.</p>\n');
        expect(markdownFormat.serialize(htmlFormat.parse(html))).toBe(md);
        expect(strip(htmlFormat.parse(html))).toEqual(strip(markdownFormat.parse(md)));
    });

    it('passes the unknown and sanitize options through', () => {
        expect(strip(htmlFormat.parse('<p><x-y>a</x-y>b</p>', { unknown: 'drop' })).children).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'b' }] }]);
        expect(htmlFormat.serialize(markdownFormat.parse('[j](javascript:x)'), { sanitize: false })).toBe('<p><a href="javascript:x">j</a></p>\n');
    });

    it('wins the paste of a browser clipboard in a markdown editor that reads html', () => {
        const data = { text: 'plain that must not win', 'text/html': '<h2>Pasted</h2><ul><li>a</li><li>b</li></ul>' };
        expect(pickPasteFormat(data, [markdownFormat, htmlFormat])?.format.id).toBe('html');
        expect(pickPasteFormat({ text: '## md' }, [markdownFormat, htmlFormat])?.format.id).toBe('markdown');
        const editor = createEditor({ format: markdownFormat, formats: [htmlFormat] });
        expect(editor.paste(data)).toBe(true);
        expect(editor.state.doc.children.map((b) => b.type)).toEqual(['heading', 'list']);
    });

    it('is the primary format of an html editor: source in and out is html', () => {
        const editor = createEditor({ format: htmlFormat });
        editor.setSource('<p>a <em>b</em></p>');
        expect(editor.state.doc.children[0].type).toBe('paragraph');
        expect(htmlFormat.serialize(editor.state.doc)).toBe('<p>a <em>b</em></p>\n');
    });
});
