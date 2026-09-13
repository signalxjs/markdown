import { describe, expect, it } from 'vitest';
import type { Heading, Link, List, Paragraph, Root, Table } from '@sigx/richtext';
import { strip } from '@sigx/richtext/testing';
import { parseHtml } from '../src/parse.js';

const doc = (html: string, options?: Parameters<typeof parseHtml>[1]): Root => strip(parseHtml(html, options));
const p = (...children: unknown[]) => ({ type: 'paragraph', children });
const t = (value: string) => ({ type: 'text', value });

describe('parseHtml — blocks', () => {
    it('maps the element table onto the standard nodes', () => {
        expect(doc('<h2>Title</h2><p>Some <strong>bold</strong> text.</p><hr><blockquote><p>q</p></blockquote>').children).toEqual([
            { type: 'heading', depth: 2, children: [t('Title')] },
            p(t('Some '), { type: 'strong', children: [t('bold')] }, t(' text.')),
            { type: 'thematicBreak' },
            { type: 'blockquote', children: [p(t('q'))] },
        ]);
    });

    it('reads lists: ordered start, tight vs loose, task checkboxes and stray content', () => {
        const [ol, ul, tasks, stray] = doc('<ol start="3"><li>a</li><li>b</li></ol><ul><li><p>a</p></li><li>b</li></ul><ul><li><input type="checkbox" checked> done</li><li><p><input type="checkbox">todo</p></li></ul><ul>loose text<li>item</li></ul>').children as List[];
        expect(ol).toEqual({ type: 'list', ordered: true, start: 3, spread: false, children: [{ type: 'listItem', spread: false, children: [p(t('a'))] }, { type: 'listItem', spread: false, children: [p(t('b'))] }] });
        expect(ul.spread).toBe(true);
        expect(ul.children.map((i) => i.spread)).toEqual([true, false]);
        expect(tasks.children.map((i) => i.checked)).toEqual([true, false]);
        expect(tasks.children[0].children).toEqual([p(t('done'))]);
        expect(stray.children).toEqual([{ type: 'listItem', spread: false, children: [p(t('loose text'))] }, { type: 'listItem', spread: false, children: [p(t('item'))] }]);
    });

    it('reads code blocks with their language and verbatim whitespace', () => {
        expect(doc('<pre><code class="language-ts">let  x\n  = 1\n</code></pre><pre>\nplain &lt;\n</pre>').children).toEqual([
            { type: 'code', lang: 'ts', meta: null, value: 'let  x\n  = 1' },
            { type: 'code', lang: null, meta: null, value: 'plain <' },
        ]);
    });

    it('reads tables through thead/tbody with alignment from align or style', () => {
        const [table] = doc('<table><thead><tr><th align="left">a</th><th style="text-align: right">b</th><th>c</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>').children as Table[];
        expect(table.align).toEqual(['left', 'right', null]);
        expect(table.children).toHaveLength(2);
        expect(table.children[1].children.map((c) => c.children)).toEqual([[t('1')], [t('2')]]);
    });

    it('repairs unclosed paragraphs, items and cells the way a browser does', () => {
        expect(doc('<p>one<p>two<ul><li>a<li>b</ul><table><tr><td>1<td>2<tr><td>3</table>').children).toEqual([
            p(t('one')),
            p(t('two')),
            { type: 'list', ordered: false, start: null, spread: false, children: [{ type: 'listItem', spread: false, children: [p(t('a'))] }, { type: 'listItem', spread: false, children: [p(t('b'))] }] },
            { type: 'table', align: [null, null], children: [{ type: 'tableRow', children: [{ type: 'tableCell', children: [t('1')] }, { type: 'tableCell', children: [t('2')] }] }, { type: 'tableRow', children: [{ type: 'tableCell', children: [t('3')] }] }] },
        ]);
    });

    it('wraps stray phrasing in paragraphs, drops inter-block whitespace and sees through wrappers', () => {
        expect(doc('\n<div>\n  <section>text <b>b</b></section>\n  <article><p>p</p></article>\n</div>\n<span>tail</span>').children).toEqual([p(t('text '), { type: 'strong', children: [t('b')] }), p(t('p')), p(t('tail'))]);
    });

    it('drops empty paragraphs and whitespace-only runs, keeps an empty heading', () => {
        expect(doc('<p></p><p>   </p><h1> </h1><ul></ul>').children).toEqual([{ type: 'heading', depth: 1, children: [] }, { type: 'list', ordered: false, start: null, spread: false, children: [] }]);
    });

    it('parses a full document, skipping head, scripts and styles', () => {
        expect(doc('<!doctype html><html><head><title>T</title><style>p{color:red}</style></head><body><script>alert(1)</script><p>x</p></body></html>').children).toEqual([p(t('x'))]);
    });
});

describe('parseHtml — inlines', () => {
    it('reads marks, aliases, code, links, images and breaks', () => {
        const [para] = doc('<p><b>b</b> <i>i</i> <s>s</s> <strike>k</strike> <code>c  d</code> <a href="/u" title="T">l</a> <img src="/i.png" alt="A" title="I"> x<br>y</p>').children as Paragraph[];
        expect(para.children).toEqual([
            { type: 'strong', children: [t('b')] },
            t(' '),
            { type: 'emphasis', children: [t('i')] },
            t(' '),
            { type: 'delete', children: [t('s')] },
            t(' '),
            { type: 'delete', children: [t('k')] },
            t(' '),
            { type: 'inlineCode', value: 'c  d' },
            t(' '),
            { type: 'link', url: '/u', title: 'T', children: [t('l')] },
            t(' '),
            { type: 'image', url: '/i.png', alt: 'A', title: 'I' },
            t(' x'),
            { type: 'break' },
            t('y'),
        ]);
    });

    it('collapses whitespace, trims the run edges and drops the newline after a break', () => {
        const [para] = doc('<p>\n  a\n  b <b> c </b>\n  <br>\n  d  \n</p>').children as Paragraph[];
        expect(para.children).toEqual([t('a b '), { type: 'strong', children: [t('c')] }, { type: 'break' }, t('d')]);
    });

    it('merges adjacent and nested identical marks and drops empty ones', () => {
        const [para] = doc('<p><b>a</b><b>b</b><em><em>c</em></em><b></b><a href="u">x</a><a href="u">y</a><a href="v">z</a></p>').children as Paragraph[];
        expect(para.children).toEqual([
            { type: 'strong', children: [t('ab')] },
            { type: 'emphasis', children: [t('c')] },
            { type: 'link', url: 'u', children: [t('xy')] },
            { type: 'link', url: 'v', children: [t('z')] },
        ]);
    });

    it('keeps only href and src, sanitised; no other attribute survives', () => {
        const [para] = doc('<p><a href="javascript:alert(1)" onclick="x()" style="color:red">j</a> <img src="data:text/html,x" onerror="x()"> <span style="x" class="y" data-z="1">s</span></p>').children as Paragraph[];
        const [link, , image, text] = para.children as [Link, unknown, { url: string }, { value: string }];
        expect(link).toEqual({ type: 'link', url: '#', children: [t('j')] });
        expect(image.url).toBe('#');
        expect(text).toEqual(t(' s'));
        expect(JSON.stringify(para)).not.toMatch(/onclick|onerror|style|class|data-z/);
    });

    it('treats unknown elements as transparent, or drops them with unknown: "drop"', () => {
        expect(doc('<p><custom-x>keep</custom-x> <u>u</u></p>').children).toEqual([p(t('keep u'))]);
        expect(doc('<p><custom-x>gone</custom-x> <u>u</u></p>', { unknown: 'drop' }).children).toEqual([p(t('u'))]);
        expect(doc('<custom-block><p>inside</p></custom-block>').children).toEqual([p(t('inside'))]);
    });

    it('flattens block elements met in phrasing position', () => {
        const [heading] = doc('<h1><div>a</div> <p>b</p></h1>').children as Heading[];
        expect(heading).toEqual({ type: 'heading', depth: 1, children: [t('a b')] });
    });

    it('lets a plugin element rule claim an element first', () => {
        const plugin = {
            name: 'callout',
            nodes: [{ type: 'callout', role: 'container' as const, fillsWith: 'paragraph' }, { type: 'kbd', role: 'inline' as const, text: (n: { value: string }) => n.value }],
            formats: { html: { elements: { aside: (_el: unknown, ctx: { blocks(): unknown[] }) => ({ type: 'callout', children: ctx.blocks() }), kbd: (_el: unknown, ctx: { text(): string }) => ({ type: 'kbd', value: ctx.text() }) } } },
        };
        expect(doc('<aside><p>a</p></aside><p>press <kbd>Ctrl</kbd></p>', { plugins: [plugin as never] }).children).toEqual([
            { type: 'callout', children: [p(t('a'))] },
            p(t('press '), { type: 'kbd', value: 'Ctrl' }),
        ]);
    });

    it('assigns reconciliation keys to the blocks', () => {
        const root = parseHtml('<p>a</p><ul><li>b</li></ul>');
        expect(root.children.map((c) => c.key)).toEqual(['b-0', 'b-1']);
    });
});
