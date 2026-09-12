/**
 * `toHtml()` against hand-built trees: every output shape the spec's
 * reference HTML uses, so the conformance suites can trust the renderer and
 * blame the parser.
 */

import { describe, expect, it } from 'vitest';
import type {
    AlignType,
    BlockContent,
    Blockquote,
    Code,
    Definition,
    Heading,
    HeadingDepth,
    Html,
    Image,
    ImageReference,
    InlineCode,
    Link,
    LinkReference,
    List,
    ListItem,
    Paragraph,
    PhrasingContent,
    ReferenceType,
    Root,
    Table,
    TableCell,
    TableRow,
    Text,
    ThematicBreak,
} from '../../src/ast/index.js';
import { toHtml } from '../../src/testing/index.js';

// -- builders ---------------------------------------------------------------

const doc = (...children: BlockContent[]): Root => ({ type: 'root', children });
const t = (value: string): Text => ({ type: 'text', value });
const p = (...children: PhrasingContent[]): Paragraph => ({ type: 'paragraph', children });
const h = (depth: HeadingDepth, ...children: PhrasingContent[]): Heading => ({ type: 'heading', depth, children });
const hr = (): ThematicBreak => ({ type: 'thematicBreak' });
const bq = (...children: BlockContent[]): Blockquote => ({ type: 'blockquote', children });
const em = (...children: PhrasingContent[]): PhrasingContent => ({ type: 'emphasis', children });
const strong = (...children: PhrasingContent[]): PhrasingContent => ({ type: 'strong', children });
const del = (...children: PhrasingContent[]): PhrasingContent => ({ type: 'delete', children });
const code = (value: string): InlineCode => ({ type: 'inlineCode', value });
const br = (): PhrasingContent => ({ type: 'break' });
const html = (value: string): Html => ({ type: 'html', value });
const fence = (value: string, lang?: string | null, meta?: string | null): Code => ({ type: 'code', value, lang, meta });
const link = (url: string, children: PhrasingContent[], title?: string | null): Link => ({
    type: 'link',
    url,
    title,
    children,
});
const img = (url: string, alt: string | null, title?: string | null): Image => ({ type: 'image', url, alt, title });
const def = (identifier: string, url: string, title?: string | null): Definition => ({
    type: 'definition',
    identifier,
    label: identifier,
    url,
    title,
});
const linkRef = (
    identifier: string,
    referenceType: ReferenceType,
    children: PhrasingContent[],
    label: string = identifier,
): LinkReference => ({ type: 'linkReference', identifier, label, referenceType, children });
const imgRef = (identifier: string, referenceType: ReferenceType, alt: string, label: string = identifier): ImageReference => ({
    type: 'imageReference',
    identifier,
    label,
    referenceType,
    alt,
});
const li = (children: BlockContent[], extra: Partial<ListItem> = {}): ListItem => ({
    type: 'listItem',
    spread: false,
    checked: null,
    children,
    ...extra,
});
const ul = (items: ListItem[], spread: boolean | null = false): List => ({
    type: 'list',
    ordered: false,
    start: null,
    spread,
    children: items,
});
const ol = (start: number, items: ListItem[], spread: boolean | null = false): List => ({
    type: 'list',
    ordered: true,
    start,
    spread,
    children: items,
});
const cell = (...children: PhrasingContent[]): TableCell => ({ type: 'tableCell', children });
const row = (...cells: TableCell[]): TableRow => ({ type: 'tableRow', children: cells });
const table = (align: AlignType[] | null, ...rows: TableRow[]): Table => ({ type: 'table', align, children: rows });

// -- blocks -----------------------------------------------------------------

describe('toHtml: blocks', () => {
    it('renders an empty document as an empty string', () => {
        expect(toHtml(doc())).toBe('');
    });

    it('wraps paragraphs and escapes text', () => {
        expect(toHtml(doc(p(t('a & b < c > "d" \'e\''))))).toBe('<p>a &amp; b &lt; c &gt; &quot;d&quot; \'e\'</p>\n');
        expect(toHtml(doc(p(t('one')), p(t('two'))))).toBe('<p>one</p>\n<p>two</p>\n');
    });

    it('renders headings at every depth', () => {
        expect(toHtml(doc(h(1, t('foo')), h(6, t('bar'))))).toBe('<h1>foo</h1>\n<h6>bar</h6>\n');
    });

    it('renders thematic breaks', () => {
        expect(toHtml(doc(hr(), p(t('x')), hr()))).toBe('<hr />\n<p>x</p>\n<hr />\n');
    });

    it('renders blockquotes, including empty and nested ones', () => {
        expect(toHtml(doc(bq(p(t('foo')))))).toBe('<blockquote>\n<p>foo</p>\n</blockquote>\n');
        expect(toHtml(doc(bq()))).toBe('<blockquote>\n</blockquote>\n');
        expect(toHtml(doc(bq(bq(p(t('a'))), p(t('b')))))).toBe(
            '<blockquote>\n<blockquote>\n<p>a</p>\n</blockquote>\n<p>b</p>\n</blockquote>\n',
        );
    });

    it('renders fenced and indented code with the info first word as class', () => {
        expect(toHtml(doc(fence('const x = 1;\n\nx < 2 && y;', 'ts', 'title="a"')))).toBe(
            '<pre><code class="language-ts">const x = 1;\n\nx &lt; 2 &amp;&amp; y;\n</code></pre>\n',
        );
        expect(toHtml(doc(fence('foo', null, null)))).toBe('<pre><code>foo\n</code></pre>\n');
        expect(toHtml(doc(fence('', 'ts')))).toBe('<pre><code class="language-ts"></code></pre>\n');
        expect(toHtml(doc(fence('')))).toBe('<pre><code></code></pre>\n');
        expect(toHtml(doc(fence('\n  ')))).toBe('<pre><code>\n  \n</code></pre>\n');
        expect(toHtml(doc(fence('x', 'f<ö>')))).toBe('<pre><code class="language-f&lt;ö&gt;">x\n</code></pre>\n');
    });

    it('ignores the streaming open flag on a fence', () => {
        const open: Code = { type: 'code', value: 'x', open: true };
        expect(toHtml(doc(open))).toBe('<pre><code>x\n</code></pre>\n');
    });

    it('writes html blocks verbatim', () => {
        expect(toHtml(doc(html('<div>\n*x*\n</div>'), p(t('y'))))).toBe('<div>\n*x*\n</div>\n<p>y</p>\n');
    });

    it('renders nothing for definitions', () => {
        expect(toHtml(doc(def('foo', '/url')))).toBe('');
        expect(toHtml(doc(p(t('a')), def('foo', '/url'), p(t('b'))))).toBe('<p>a</p>\n<p>b</p>\n');
    });
});

describe('toHtml: lists', () => {
    it('renders a tight list with unwrapped paragraphs', () => {
        expect(toHtml(doc(ul([li([p(t('foo'))]), li([p(t('bar'))])])))).toBe(
            '<ul>\n<li>foo</li>\n<li>bar</li>\n</ul>\n',
        );
    });

    it('renders a loose list with wrapped paragraphs', () => {
        expect(toHtml(doc(ul([li([p(t('foo'))]), li([p(t('bar'))])], true)))).toBe(
            '<ul>\n<li>\n<p>foo</p>\n</li>\n<li>\n<p>bar</p>\n</li>\n</ul>\n',
        );
    });

    it('treats a list as loose when any item is spread', () => {
        const tree = doc(ul([li([p(t('a')), p(t('b'))], { spread: true }), li([p(t('c'))])], null));
        expect(toHtml(tree)).toBe('<ul>\n<li>\n<p>a</p>\n<p>b</p>\n</li>\n<li>\n<p>c</p>\n</li>\n</ul>\n');
    });

    it('renders ordered lists with a start only when it is not 1', () => {
        expect(toHtml(doc(ol(1, [li([p(t('a'))])])))).toBe('<ol>\n<li>a</li>\n</ol>\n');
        expect(toHtml(doc(ol(3, [li([p(t('a'))])])))).toBe('<ol start="3">\n<li>a</li>\n</ol>\n');
        expect(toHtml(doc(ol(0, [li([p(t('a'))])])))).toBe('<ol start="0">\n<li>a</li>\n</ol>\n');
        expect(toHtml(doc(ol(123456789, [li([p(t('ok'))])])))).toBe('<ol start="123456789">\n<li>ok</li>\n</ol>\n');
    });

    it('renders a tight item with a nested list on the paragraph line', () => {
        const tree = doc(ul([li([p(t('foo')), ul([li([p(t('bar'))])])])]));
        expect(toHtml(tree)).toBe('<ul>\n<li>foo\n<ul>\n<li>bar</li>\n</ul>\n</li>\n</ul>\n');
    });

    it('renders a loose item with a nested list', () => {
        const tree = doc(ul([li([p(t('foo')), ul([li([p(t('bar'))])])]), li([p(t('baz'))])], true));
        expect(toHtml(tree)).toBe(
            '<ul>\n<li>\n<p>foo</p>\n<ul>\n<li>bar</li>\n</ul>\n</li>\n<li>\n<p>baz</p>\n</li>\n</ul>\n',
        );
    });

    it('renders empty items and items whose first child is not a paragraph', () => {
        expect(toHtml(doc(ul([li([]), li([p(t('a'))])])))).toBe('<ul>\n<li></li>\n<li>a</li>\n</ul>\n');
        expect(toHtml(doc(ul([li([h(1, t('Foo'))]), li([h(2, t('Bar')), p(t('baz'))])])))).toBe(
            '<ul>\n<li>\n<h1>Foo</h1>\n</li>\n<li>\n<h2>Bar</h2>\nbaz</li>\n</ul>\n',
        );
        expect(toHtml(doc(ul([li([fence('code')])])))).toBe('<ul>\n<li>\n<pre><code>code\n</code></pre>\n</li>\n</ul>\n');
    });

    it('renders a tight item with a paragraph after a code block', () => {
        const tree = doc(ol(10, [li([p(t('foo')), fence('bar')])]));
        expect(toHtml(tree)).toBe('<ol start="10">\n<li>foo\n<pre><code>bar\n</code></pre>\n</li>\n</ol>\n');
    });

    it('renders deeply nested single-item lists', () => {
        const tree = doc(ol(1, [li([ul([li([ol(2, [li([p(t('foo'))])])])])])]));
        expect(toHtml(tree)).toBe(
            '<ol>\n<li>\n<ul>\n<li>\n<ol start="2">\n<li>foo</li>\n</ol>\n</li>\n</ul>\n</li>\n</ol>\n',
        );
    });

    it('renders lists inside blockquotes', () => {
        expect(toHtml(doc(bq(ul([li([p(t('a'))])]))))).toBe('<blockquote>\n<ul>\n<li>a</li>\n</ul>\n</blockquote>\n');
    });

    it('renders GFM task items as checkboxes inside the first paragraph', () => {
        const tight = doc(ul([li([p(t('foo'))], { checked: false }), li([p(t('bar'))], { checked: true })]));
        expect(toHtml(tight)).toBe(
            '<ul>\n<li><input disabled="" type="checkbox"> foo</li>\n' +
                '<li><input checked="" disabled="" type="checkbox"> bar</li>\n</ul>\n',
        );
        const loose = doc(ol(1, [li([p(t('one'))], { checked: false }), li([p(t('two'))], { checked: true })], true));
        expect(toHtml(loose)).toBe(
            '<ol>\n<li>\n<p><input disabled="" type="checkbox"> one</p>\n</li>\n' +
                '<li>\n<p><input checked="" disabled="" type="checkbox"> two</p>\n</li>\n</ol>\n',
        );
        const nested = doc(
            ul([
                li([p(t('foo')), ul([li([p(t('bar'))], { checked: false }), li([p(t('baz'))], { checked: true })])], {
                    checked: true,
                }),
                li([p(t('bim'))], { checked: false }),
            ]),
        );
        expect(toHtml(nested)).toBe(
            '<ul>\n<li><input checked="" disabled="" type="checkbox"> foo\n<ul>\n' +
                '<li><input disabled="" type="checkbox"> bar</li>\n' +
                '<li><input checked="" disabled="" type="checkbox"> baz</li>\n</ul>\n</li>\n' +
                '<li><input disabled="" type="checkbox"> bim</li>\n</ul>\n',
        );
    });
});

describe('toHtml: tables', () => {
    it('renders head and body rows', () => {
        const tree = doc(table(null, row(cell(t('foo')), cell(t('bar'))), row(cell(t('baz')), cell(t('bim')))));
        expect(toHtml(tree)).toBe(
            '<table>\n<thead>\n<tr>\n<th>foo</th>\n<th>bar</th>\n</tr>\n</thead>\n' +
                '<tbody>\n<tr>\n<td>baz</td>\n<td>bim</td>\n</tr>\n</tbody>\n</table>\n',
        );
    });

    it('omits tbody when there are no body rows', () => {
        expect(toHtml(doc(table(null, row(cell(t('abc')), cell(t('def'))))))).toBe(
            '<table>\n<thead>\n<tr>\n<th>abc</th>\n<th>def</th>\n</tr>\n</thead>\n</table>\n',
        );
    });

    it('writes align attributes on both th and td', () => {
        const tree = doc(
            table(
                ['left', 'center', 'right', null],
                row(cell(t('a')), cell(t('b')), cell(t('c')), cell(t('d'))),
                row(cell(t('1')), cell(t('2')), cell(t('3')), cell(t('4'))),
            ),
        );
        expect(toHtml(tree)).toBe(
            '<table>\n<thead>\n<tr>\n<th align="left">a</th>\n<th align="center">b</th>\n<th align="right">c</th>\n<th>d</th>\n</tr>\n</thead>\n' +
                '<tbody>\n<tr>\n<td align="left">1</td>\n<td align="center">2</td>\n<td align="right">3</td>\n<td>4</td>\n</tr>\n</tbody>\n</table>\n',
        );
    });

    it('pads short rows and drops excess cells to the header width', () => {
        const tree = doc(
            table(null, row(cell(t('abc')), cell(t('def'))), row(cell(t('bar'))), row(cell(t('bar')), cell(t('baz')), cell(t('boo')))),
        );
        expect(toHtml(tree)).toBe(
            '<table>\n<thead>\n<tr>\n<th>abc</th>\n<th>def</th>\n</tr>\n</thead>\n' +
                '<tbody>\n<tr>\n<td>bar</td>\n<td></td>\n</tr>\n<tr>\n<td>bar</td>\n<td>baz</td>\n</tr>\n</tbody>\n</table>\n',
        );
    });

    it('renders inline content in cells', () => {
        const tree = doc(table(null, row(cell(t('f|oo'))), row(cell(t('b '), code('|'), t(' az')))));
        expect(toHtml(tree)).toBe(
            '<table>\n<thead>\n<tr>\n<th>f|oo</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>b <code>|</code> az</td>\n</tr>\n</tbody>\n</table>\n',
        );
    });
});

// -- inlines ----------------------------------------------------------------

describe('toHtml: inlines', () => {
    it('renders emphasis, strong, strikethrough and code', () => {
        expect(toHtml(doc(p(em(t('a')), strong(t('b')), del(t('c')), code('d<e>'))))).toBe(
            '<p><em>a</em><strong>b</strong><del>c</del><code>d&lt;e&gt;</code></p>\n',
        );
        expect(toHtml(doc(p(strong(em(t('x'))))))).toBe('<p><strong><em>x</em></strong></p>\n');
    });

    it('renders hard breaks and keeps soft breaks as newlines', () => {
        expect(toHtml(doc(p(t('a'), br(), t('b'))))).toBe('<p>a<br />\nb</p>\n');
        expect(toHtml(doc(p(t('a\nb'))))).toBe('<p>a\nb</p>\n');
    });

    it('renders links with an optional title', () => {
        expect(toHtml(doc(p(link('/url', [t('x')]))))).toBe('<p><a href="/url">x</a></p>\n');
        expect(toHtml(doc(p(link('/url', [t('x')], 'title'))))).toBe('<p><a href="/url" title="title">x</a></p>\n');
        expect(toHtml(doc(p(link('/url', [t('x')], ''))))).toBe('<p><a href="/url">x</a></p>\n');
        expect(toHtml(doc(p(link('/url', [t('x')], null))))).toBe('<p><a href="/url">x</a></p>\n');
        expect(toHtml(doc(p(link('/u', [em(t('x'))], 'a "b" & c'))))).toBe(
            '<p><a href="/u" title="a &quot;b&quot; &amp; c"><em>x</em></a></p>\n',
        );
    });

    it('renders images with alt and optional title', () => {
        expect(toHtml(doc(p(img('/i.png', 'alt', 'title'))))).toBe('<p><img src="/i.png" alt="alt" title="title" /></p>\n');
        expect(toHtml(doc(p(img('/i.png', null))))).toBe('<p><img src="/i.png" alt="" /></p>\n');
        expect(toHtml(doc(p(img('/i.png', 'a "b"'))))).toBe('<p><img src="/i.png" alt="a &quot;b&quot;" /></p>\n');
    });

    it('normalises URLs the way the spec does', () => {
        const href = (url: string): string => toHtml(doc(p(link(url, [t('x')]))));
        expect(href('/my uri')).toBe('<p><a href="/my%20uri">x</a></p>\n');
        expect(href('foo%20bä')).toBe('<p><a href="foo%20b%C3%A4">x</a></p>\n');
        expect(href('/föö')).toBe('<p><a href="/f%C3%B6%C3%B6">x</a></p>\n');
        expect(href('/φου')).toBe('<p><a href="/%CF%86%CE%BF%CF%85">x</a></p>\n');
        expect(href('foo\\bar')).toBe('<p><a href="foo%5Cbar">x</a></p>\n');
        expect(href('"title"')).toBe('<p><a href="%22title%22">x</a></p>\n');
        expect(href('foo(and(bar))')).toBe('<p><a href="foo(and(bar))">x</a></p>\n');
        expect(href('https://foo.bar.baz/test?q=hello&id=22&boolean')).toBe(
            '<p><a href="https://foo.bar.baz/test?q=hello&amp;id=22&amp;boolean">x</a></p>\n',
        );
        expect(href('https://example.com/?search=](uri)')).toBe(
            '<p><a href="https://example.com/?search=%5D(uri)">x</a></p>\n',
        );
        expect(href('https://foo.bar.`baz')).toBe('<p><a href="https://foo.bar.%60baz">x</a></p>\n');
        expect(href('/url\u00A0"title"')).toBe('<p><a href="/url%C2%A0%22title%22">x</a></p>\n');
        expect(href('')).toBe('<p><a href="">x</a></p>\n');
        expect(href('#frag?a=1;b=2,c+d*e!f~g\'h')).toBe('<p><a href="#frag?a=1;b=2,c+d*e!f~g\'h">x</a></p>\n');
        expect(href('/a%2Fb')).toBe('<p><a href="/a%2Fb">x</a></p>\n');
        expect(href('/😀')).toBe('<p><a href="/%F0%9F%98%80">x</a></p>\n');
        expect(href('/\uD83D')).toBe('<p><a href="/%EF%BF%BD">x</a></p>\n');
        // A truncated UTF-8 sequence: one U+FFFD per undecodable byte, as mdurl does.
        expect(href('/%E2%82')).toBe('<p><a href="/%EF%BF%BD%EF%BF%BD">x</a></p>\n');
        expect(href('/%C3%A4%41')).toBe('<p><a href="/%C3%A4A">x</a></p>\n');
    });

    it('writes inline html verbatim', () => {
        // `html` is not in PhrasingContentMap (mdast keeps it in flow); the renderer still takes it inline.
        const raw = (value: string): PhrasingContent => html(value) as unknown as PhrasingContent;
        expect(toHtml(doc(p(t('a '), raw('<b>'), t('b'), raw('</b>'))))).toBe('<p>a <b>b</b></p>\n');
    });
});

describe('toHtml: references', () => {
    it('resolves references against definitions found in the tree', () => {
        const tree = doc(p(linkRef('foo', 'shortcut', [t('foo')])), def('foo', '/url', 'title'));
        expect(toHtml(tree)).toBe('<p><a href="/url" title="title">foo</a></p>\n');
        const image = doc(p(imgRef('foo', 'collapsed', 'alt text')), def('foo', '/i.png'));
        expect(toHtml(image)).toBe('<p><img src="/i.png" alt="alt text" /></p>\n');
    });

    it('resolves references against an explicit definitions map', () => {
        const tree = doc(p(linkRef('foo', 'full', [t('bar')], 'FOO')));
        const definitions = new Map<string, Definition>([['foo', def('foo', '/x')]]);
        expect(toHtml(tree, { definitions })).toBe('<p><a href="/x">bar</a></p>\n');
        expect(toHtml(tree)).toBe('<p>[bar][FOO]</p>\n');
    });

    it('lets the first definition win', () => {
        const tree = doc(p(linkRef('foo', 'shortcut', [t('foo')])), def('foo', '/1'), def('foo', '/2'));
        expect(toHtml(tree)).toBe('<p><a href="/1">foo</a></p>\n');
    });

    it('renders unresolved references as their literal source', () => {
        expect(toHtml(doc(p(linkRef('foo', 'shortcut', [t('foo')]))))).toBe('<p>[foo]</p>\n');
        expect(toHtml(doc(p(linkRef('foo', 'collapsed', [t('foo')]))))).toBe('<p>[foo][]</p>\n');
        expect(toHtml(doc(p(linkRef('bar', 'full', [t('foo')], 'bar'))))).toBe('<p>[foo][bar]</p>\n');
        expect(toHtml(doc(p(linkRef('foo', 'shortcut', [em(t('foo')), t(' bar')]))))).toBe('<p>[<em>foo</em> bar]</p>\n');
        expect(toHtml(doc(p(imgRef('foo', 'shortcut', 'foo'))))).toBe('<p>![foo]</p>\n');
        expect(toHtml(doc(p(imgRef('foo', 'collapsed', 'foo'))))).toBe('<p>![foo][]</p>\n');
        expect(toHtml(doc(p(imgRef('bar', 'full', 'foo', 'bar'))))).toBe('<p>![foo][bar]</p>\n');
    });
});

describe('toHtml: unknown nodes', () => {
    it('renders the children of an unknown block or inline node without a wrapper', () => {
        const note = { type: 'note', children: [p(t('inside'))] } as unknown as BlockContent;
        expect(toHtml(doc(note))).toBe('<p>inside</p>\n');
        const mention = { type: 'mention', id: 'u1', children: [t('@Andy')] } as unknown as PhrasingContent;
        expect(toHtml(doc(p(t('hi '), mention)))).toBe('<p>hi @Andy</p>\n');
    });

    it('renders the escaped value of an unknown literal node', () => {
        const math = { type: 'inlineMath', value: 'a<b' } as unknown as PhrasingContent;
        expect(toHtml(doc(p(math)))).toBe('<p>a&lt;b</p>\n');
        const empty = { type: 'mystery' } as unknown as BlockContent;
        expect(toHtml(doc(empty, p(t('x'))))).toBe('<p>x</p>\n');
    });
});
