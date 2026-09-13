import { describe, expect, it } from 'vitest';
import { mentionNode, type RichTextPlugin } from '@sigx/richtext';
import { strip } from '@sigx/richtext/testing';
import { mentionMarkdown, markdownFormat } from '@sigx/richtext-markdown';
import { htmlFormat } from '../src/format.js';
import { mentionHtml } from '../src/mention.js';

const mention: RichTextPlugin = { name: 'mention', nodes: [mentionNode], formats: { markdown: mentionMarkdown, html: mentionHtml } };

describe('mentionHtml', () => {
    it('reads <span data-mention> and writes it back; other spans stay transparent', () => {
        const root = htmlFormat.parse('<p>hi <span data-mention="u1">@Andy</span> and <span class="x">you</span></p>', { plugins: [mention] });
        expect(strip(root).children).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'hi ' }, { type: 'mention', id: 'u1', label: 'Andy' }, { type: 'text', value: ' and you' }] }]);
        expect(htmlFormat.serialize(root, { plugins: [mention] })).toBe('<p>hi <span data-mention="u1">@Andy</span> and you</p>\n');
    });

    it('escapes the id and label on the way out', () => {
        const root = markdownFormat.parse('@[a<b](x"y)', { plugins: [mention] });
        expect(htmlFormat.serialize(root, { plugins: [mention] })).toBe('<p><span data-mention="x&quot;y">@a&lt;b</span></p>\n');
    });

    it('renders as the text projection without the slice', () => {
        const root = markdownFormat.parse('hi @[Andy](u1)', { plugins: [mention] });
        expect(htmlFormat.serialize(root, { plugins: [{ name: 'mention', nodes: [mentionNode] }] })).toBe('<p>hi @Andy</p>\n');
    });
});
