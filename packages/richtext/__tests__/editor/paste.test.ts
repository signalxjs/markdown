import { describe, expect, it } from 'vitest';
import type { DocumentFormat } from '../../src/document/index.js';
import { plainTextFormat } from '../../src/document/index.js';
import { pickPasteFormat } from '../../src/editor/paste.js';

const format = (id: string, mime: string[]): DocumentFormat => ({ id, mime, parse: () => ({ type: 'root', children: [] }), serialize: () => '' });
const markdown = format('markdown', ['text/markdown', 'text/plain']);
const html = format('html', ['text/html']);

describe('pickPasteFormat', () => {
    it('takes a specific flavour of any format before plain text', () => {
        expect(pickPasteFormat({ text: 'plain', 'text/html': '<p>x</p>' }, [markdown, html])).toEqual({ format: html, source: '<p>x</p>' });
        expect(pickPasteFormat({ text: 'plain', 'text/markdown': '# x', 'text/html': '<p>x</p>' }, [markdown, html])).toEqual({ format: markdown, source: '# x' });
    });

    it('falls back to plain text through the first format that claims it, else nothing', () => {
        expect(pickPasteFormat({ text: 'plain' }, [markdown, html])).toEqual({ format: markdown, source: 'plain' });
        expect(pickPasteFormat({ text: 'plain' }, [html, plainTextFormat])).toEqual({ format: plainTextFormat, source: 'plain' });
        expect(pickPasteFormat({ text: 'plain' }, [html])).toBeNull();
        expect(pickPasteFormat({ text: '', 'text/html': '' }, [markdown, html])).toBeNull();
    });
});
