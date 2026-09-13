import { describe, expect, it } from 'vitest';
import type { Root } from '@sigx/richtext';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { toHtml as conformanceToHtml } from '@sigx/richtext-markdown/testing';
import { toHtml } from '../src/serialize.js';

describe('toHtml', () => {
    it('writes the CommonMark reference layout for the standard vocabulary', () => {
        const md = '# Hi\n\nSome **bold** _em_ ~~del~~ `code` [l](/u "T") ![a](/i.png)\nline  \nbreak\n\n- a\n- [x] b\n\n1. one\n\n   two\n\n> q\n\n```ts\nlet x\n```\n\n---\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n';
        const root = parseMarkdown(md);
        expect(toHtml(root)).toBe(conformanceToHtml(root));
        expect(toHtml(root)).toBe(
            '<h1>Hi</h1>\n<p>Some <strong>bold</strong> <em>em</em> <del>del</del> <code>code</code> <a href="/u" title="T">l</a> <img src="/i.png" alt="a" />\nline<br />\nbreak</p>\n<ul>\n<li>a</li>\n<li><input checked="" disabled="" type="checkbox"> b</li>\n</ul>\n<ol>\n<li>\n<p>one</p>\n<p>two</p>\n</li>\n</ol>\n<blockquote>\n<p>q</p>\n</blockquote>\n<pre><code class="language-ts">let x\n</code></pre>\n<hr />\n<table>\n<thead>\n<tr>\n<th align="left">a</th>\n<th align="right">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="left">1</td>\n<td align="right">2</td>\n</tr>\n</tbody>\n</table>\n',
        );
    });

    it('resolves references against the document (or given) definitions', () => {
        const root = parseMarkdown('[a][x] ![b][x] [c][y]\n\n[x]: /u "T"');
        expect(toHtml(root)).toBe('<p><a href="/u" title="T">a</a> <img src="/u" alt="b" title="T" /> [c][y]</p>\n');
        expect(toHtml(root, { definitions: new Map() })).toBe('<p>[a][x] ![b][x] [c][y]</p>\n');
    });

    it('sanitises link and image URLs unless told not to', () => {
        const root = parseMarkdown('[j](javascript:alert(1)) ![d](data:text/html,x)');
        expect(toHtml(root)).toBe('<p><a href="#">j</a> <img src="#" alt="d" /></p>\n');
        expect(toHtml(root, { sanitize: false })).toBe('<p><a href="javascript:alert(1)">j</a> <img src="data:text/html,x" alt="d" /></p>\n');
    });

    it('serializes a single block or phrasing node', () => {
        const root = parseMarkdown('para **b**');
        expect(toHtml(root.children[0])).toBe('<p>para <strong>b</strong></p>\n');
        expect(toHtml((root.children[0] as { children: Root['children'] }).children[1])).toBe('<strong>b</strong>');
    });

    it('writes raw html nodes verbatim', () => {
        const root: Root = { type: 'root', children: [{ type: 'html', value: '<div>x</div>' }, { type: 'paragraph', children: [{ type: 'text', value: 'a ' }, { type: 'html', value: '<span>' } as never, { type: 'text', value: 'b' }] }] };
        expect(toHtml(root)).toBe('<div>x</div>\n<p>a <span>b</p>\n');
    });

    it('writes unknown nodes through the plugin rule, else the spec text, else children', () => {
        const root: Root = {
            type: 'root',
            children: [
                { type: 'callout', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }] } as never,
                { type: 'paragraph', children: [{ type: 'kbd', value: 'Ctrl' } as never, { type: 'text', value: ' ' }, { type: 'wrap', children: [{ type: 'text', value: '<w>' }] } as never] },
            ],
        };
        const plugin = {
            name: 'x',
            nodes: [{ type: 'callout', role: 'container' as const }, { type: 'kbd', role: 'inline' as const, text: (n: { value: string }) => n.value }],
            formats: { html: { serialize: { callout: (n: { children: Root['children'] }, ctx: { blocks(nodes: unknown[]): string }) => `<aside>\n${ctx.blocks(n.children)}</aside>` } } },
        };
        expect(toHtml(root, { plugins: [plugin as never] })).toBe('<aside>\n<p>a</p>\n</aside>\n<p>Ctrl &lt;w&gt;</p>\n');
    });
});
