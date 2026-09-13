import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlockContent, Blockquote, Code, Definition, Heading, Html, List, Node, Paragraph, Parent, PhrasingContent, Root, Table, ThematicBreak } from '../../src/ast/index.js';
import { createSchema, standardNodes, type NodeSpec } from '../../src/schema/index.js';
import { markdownNodes, markdownSchema } from '@sigx/richtext-markdown';
import { collectEnv, missingComponents, renderBlock, renderDocument, renderInline, type ComponentMap, type RenderChild, type RenderContext } from '../../src/render/index.js';

// ---------------------------------------------------------------------------
// A plain-object element type and a tiny component map
// ---------------------------------------------------------------------------

interface El {
    tag: string;
    props: Record<string, unknown>;
    children: RenderChild<El>[];
    key?: string;
}

function h(tag: string, props: Record<string, unknown> = {}, children: RenderChild<El>[] = []): El {
    return { tag, props, children };
}

const components: ComponentMap<El> = {
    root: ({ children }) => h('root', {}, children),
    paragraph: ({ children }) => h('p', {}, children),
    heading: ({ depth, children }) => h(`h${depth}`, {}, children),
    blockquote: ({ children }) => h('blockquote', {}, children),
    list: ({ ordered, start, spread, children }) => h(ordered ? 'ol' : 'ul', { start, spread }, children),
    listItem: ({ ordered, index, number, checked, spread, children }) =>
        h('li', { ordered, index, number, checked, spread }, children),
    code: ({ lang, meta, value, open }) => h('pre', { lang, meta, open }, [value]),
    thematicBreak: () => h('hr'),
    table: ({ align, children }) => h('table', { align }, children),
    tableRow: ({ header, index, children }) => h('tr', { header, index }, children),
    tableCell: ({ header, align, index, children }) => h(header ? 'th' : 'td', { align, index }, children),
    html: ({ value }) => value,
    text: ({ value }) => value,
    emphasis: ({ children }) => h('em', {}, children),
    strong: ({ children }) => h('strong', {}, children),
    delete: ({ children }) => h('del', {}, children),
    inlineCode: ({ value }) => h('code', {}, [value]),
    break: () => h('br'),
    link: ({ url, title, autolink, onLink, children }) => h('a', { url, title, autolink, onLink }, children),
    image: ({ url, alt, title }) => h('img', { url, alt, title }),
};

const ctx: RenderContext<El> = { components, schema: markdownSchema };
/** A context with extra node specs on top of the markdown schema. */
const withNodes = (nodes: NodeSpec[], extra: Partial<RenderContext<El>> = {}): RenderContext<El> => ({
    components,
    schema: createSchema([...standardNodes, ...markdownNodes, ...nodes]),
    ...extra,
});

const text = (value: string): PhrasingContent => ({ type: 'text', value });
const p = (children: PhrasingContent[], key?: string): Paragraph => ({ type: 'paragraph', children, ...(key ? { key } : {}) });
const root = (...children: Root['children']): Root => ({ type: 'root', children });

/** Render and return the root's children (the top-level elements). */
const render = (r: Root, c: RenderContext<El> = ctx): RenderChild<El>[] => renderDocument(r, c).children;
const el = (child: RenderChild<El> | undefined): El => child as El;

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('renderDocument — dispatch', () => {
    it('wraps top-level blocks in root', () => {
        const out = renderDocument(root(p([text('hi')])), ctx);
        expect(out.tag).toBe('root');
        expect(out.children).toHaveLength(1);
        expect(el(out.children[0]).tag).toBe('p');
        expect(out.key).toBeUndefined();
    });

    it('dispatches every standard block type with the props its spec declares', () => {
        const heading: Heading = { type: 'heading', depth: 2, children: [text('T')] };
        const quote: Blockquote = { type: 'blockquote', children: [p([text('q')])] };
        const code: Code = { type: 'code', lang: 'ts', meta: 'x=1', value: 'let a;' };
        const openCode: Code = { type: 'code', value: '...', open: true };
        const hr: ThematicBreak = { type: 'thematicBreak' };
        const html: Html = { type: 'html', value: '<b>raw</b>' };
        const out = render(root(heading, quote, code, openCode, hr, html));

        expect(el(out[0])).toMatchObject({ tag: 'h2', children: ['T'] });
        expect(el(out[1]).tag).toBe('blockquote');
        expect(el(el(out[1]).children[0])).toMatchObject({ tag: 'p', children: ['q'] });
        expect(el(out[2])).toMatchObject({ tag: 'pre', props: { lang: 'ts', meta: 'x=1', open: false }, children: ['let a;'] });
        expect(el(out[3])).toMatchObject({ tag: 'pre', props: { lang: null, meta: null, open: true } });
        expect(el(out[4]).tag).toBe('hr');
        expect(out[5]).toBe('<b>raw</b>');
    });

    it('dispatches every standard inline type', () => {
        const para = p([
            text('a'),
            { type: 'emphasis', children: [text('e')] },
            { type: 'strong', children: [text('s')] },
            { type: 'delete', children: [text('d')] },
            { type: 'inlineCode', value: 'c' },
            { type: 'break' },
            { type: 'link', url: 'https://x.y', title: 'ttl', children: [text('l')] },
            { type: 'image', url: 'https://x.y/i.png', alt: 'alt', title: 'it' },
        ]);
        const out = el(render(root(para))[0]).children;
        expect(out[0]).toBe('a');
        expect(el(out[1])).toMatchObject({ tag: 'em', children: ['e'] });
        expect(el(out[2])).toMatchObject({ tag: 'strong', children: ['s'] });
        expect(el(out[3])).toMatchObject({ tag: 'del', children: ['d'] });
        expect(el(out[4])).toMatchObject({ tag: 'code', children: ['c'] });
        expect(el(out[5]).tag).toBe('br');
        expect(el(out[6])).toMatchObject({
            tag: 'a',
            props: { url: 'https://x.y', title: 'ttl', autolink: false, onLink: undefined },
            children: ['l'],
        });
        expect(el(out[7])).toMatchObject({ tag: 'img', props: { url: 'https://x.y/i.png', alt: 'alt', title: 'it' } });
    });

    it('passes the AST node to every component', () => {
        const para = p([text('x')]);
        const paragraph = vi.fn(components.paragraph!);
        const textFn = vi.fn(components.text!);
        render(root(para), { components: { ...components, paragraph, text: textFn }, schema: markdownSchema });
        expect(paragraph.mock.calls[0][0].node).toBe(para);
        expect(textFn.mock.calls[0][0].node).toBe(para.children[0]);
    });

    it('defaults link title to null, image alt to "" and title to null, and flags autolinks', () => {
        const para = p([
            { type: 'link', url: 'https://x.y', children: [text('https://x.y')], data: { autolink: true } },
            { type: 'image', url: 'i.png' },
        ]);
        const out = el(render(root(para))[0]).children;
        expect(el(out[0]).props).toMatchObject({ title: null, autolink: true });
        expect(el(out[1]).props).toEqual({ url: 'i.png', alt: '', title: null });
    });

    it('passes onLink to link components', () => {
        const onLink = vi.fn();
        const para = p([{ type: 'link', url: 'https://x.y', children: [text('l')] }]);
        const out = el(render(root(para), { ...ctx, onLink })[0]).children;
        expect(el(out[0]).props.onLink).toBe(onLink);
    });
});

describe('renderDocument — lists and tables', () => {
    it('renders list and item props (the item reads its list through the props context)', () => {
        const list: List = {
            type: 'list',
            ordered: true,
            start: 3,
            spread: true,
            children: [
                { type: 'listItem', checked: true, children: [p([text('a')])] },
                { type: 'listItem', spread: true, children: [p([text('b')])] },
            ],
        };
        const ol = el(render(root(list))[0]);
        expect(ol).toMatchObject({ tag: 'ol', props: { start: 3, spread: true } });
        expect(el(ol.children[0]).props).toEqual({ ordered: true, index: 0, number: 3, checked: true, spread: false });
        expect(el(ol.children[1]).props).toEqual({ ordered: true, index: 1, number: 4, checked: null, spread: true });
    });

    it('defaults list props (unordered, start 1, tight)', () => {
        const list: List = { type: 'list', children: [{ type: 'listItem', children: [p([text('a')])] }] };
        const ul = el(render(root(list))[0]);
        expect(ul).toMatchObject({ tag: 'ul', props: { start: 1, spread: false } });
        expect(el(ul.children[0]).props).toMatchObject({ ordered: false, number: 1, checked: null });
    });

    it('renders a table with a header row and align padded to the widest row (cells read the table through their ancestors)', () => {
        const table: Table = {
            type: 'table',
            align: ['left'],
            children: [
                { type: 'tableRow', children: [{ type: 'tableCell', children: [text('A')] }, { type: 'tableCell', children: [text('B')] }] },
                {
                    type: 'tableRow',
                    children: [
                        { type: 'tableCell', children: [text('1')] },
                        { type: 'tableCell', children: [text('2')] },
                        { type: 'tableCell', children: [text('3')] },
                    ],
                },
            ],
        };
        const t = el(render(root(table))[0]);
        expect(t.tag).toBe('table');
        expect(t.props.align).toEqual(['left', null, null]);
        const [head, body] = t.children.map(el);
        expect(head.props).toEqual({ header: true, index: 0 });
        expect(body.props).toEqual({ header: false, index: 1 });
        expect(head.children.map(el).map((c) => c.tag)).toEqual(['th', 'th']);
        expect(body.children.map(el).map((c) => c.props)).toEqual([
            { align: 'left', index: 0 },
            { align: null, index: 1 },
            { align: null, index: 2 },
        ]);
        expect(el(body.children[2]).children).toEqual(['3']);
    });
});

describe('renderDocument — keys', () => {
    it('stamps node keys when present', () => {
        const out = render(root(p([text('a')], 'b-7'), p([text('b')], 'b-9')));
        expect(el(out[0]).key).toBe('b-7');
        expect(el(out[1]).key).toBe('b-9');
    });

    it('stamps positional path keys on a keyless tree', () => {
        const list: List = {
            type: 'list',
            children: [
                { type: 'listItem', children: [p([text('a')])] },
                { type: 'listItem', children: [p([text('b')]), p([text('c')])] },
            ],
        };
        const quote: Blockquote = { type: 'blockquote', children: [p([text('q')])] };
        const table: Table = {
            type: 'table',
            children: [
                { type: 'tableRow', children: [{ type: 'tableCell', children: [] }, { type: 'tableCell', children: [] }] },
                { type: 'tableRow', children: [{ type: 'tableCell', children: [] }] },
            ],
        };
        const out = render(root(p([text('x')]), quote, list, table));
        expect(el(out[0]).key).toBe('b-0');
        expect(el(out[1]).key).toBe('b-1');
        expect(el(el(out[1]).children[0]).key).toBe('b-1.0');
        const ul = el(out[2]);
        expect(ul.key).toBe('b-2');
        expect(el(ul.children[0]).key).toBe('b-2.0');
        expect(el(ul.children[1]).key).toBe('b-2.1');
        expect(el(el(ul.children[1]).children[1]).key).toBe('b-2.1.1');
        const t = el(out[3]);
        expect(t.key).toBe('b-3');
        expect(el(t.children[0]).key).toBe('b-3.0');
        expect(el(el(t.children[0]).children[1]).key).toBe('b-3.0.1');
        expect(el(t.children[1]).key).toBe('b-3.1');
    });

    it('uses item, row and cell keys from the nodes and derives child paths from them', () => {
        const list: List = {
            type: 'list',
            key: 'L',
            children: [{ type: 'listItem', key: 'L.5', children: [p([text('a')])] }],
        };
        const table: Table = {
            type: 'table',
            key: 'T',
            children: [{ type: 'tableRow', key: 'T.2', children: [{ type: 'tableCell', key: 'T.2.4', children: [] }] }],
        };
        const out = render(root(list, table));
        const li = el(el(out[0]).children[0]);
        expect(li.key).toBe('L.5');
        expect(el(li.children[0]).key).toBe('L.5.0');
        const tr = el(el(out[1]).children[0]);
        expect(tr.key).toBe('T.2');
        expect(el(tr.children[0]).key).toBe('T.2.4');
    });

    it('keys inline children by index and never touches strings', () => {
        const para = p([text('a'), { type: 'emphasis', children: [text('e'), { type: 'strong', children: [] }] }, text('b')]);
        const out = el(render(root(para))[0]).children;
        expect(out[0]).toBe('a');
        expect(el(out[1]).key).toBe('1');
        expect(el(el(out[1]).children[1]).key).toBe('1');
        expect(out[2]).toBe('b');
    });

    it('honours a stampKey override', () => {
        const stampKey = vi.fn((e: El, key: string) => {
            e.props.k = key;
        });
        const out = render(root(p([text('a'), { type: 'break' }], 'b-1')), { ...ctx, stampKey });
        expect(el(out[0]).key).toBeUndefined();
        expect(el(out[0]).props.k).toBe('b-1');
        expect(el(el(out[0]).children[1]).props.k).toBe('1');
        // never called for strings
        expect(stampKey.mock.calls.every(([e]) => typeof e === 'object')).toBe(true);
        expect(stampKey).toHaveBeenCalledTimes(2);
    });

    it('warns in dev when a block component returns a string, but not for a textOutput spec (html)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const bad: ComponentMap<El> = { ...components, paragraph: () => 'plain' as unknown as El };
        const out = render(root(p([text('a')]), p([text('b')]), { type: 'html', value: '<i>' }), { components: bad, schema: markdownSchema });
        expect(out).toEqual(['plain', 'plain', '<i>']);
        expect(warn).toHaveBeenCalledTimes(1); // once per slot
        expect(warn.mock.calls[0][0]).toMatch(/"paragraph" component returned a string/);
    });

    it('does not warn about string blocks when stampKey is supplied', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const bad: ComponentMap<El> = { ...components, heading: () => 'plain' as unknown as El };
        render(root({ type: 'heading', depth: 1, children: [] }), { components: bad, schema: markdownSchema, stampKey: () => {} });
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('renderDocument — references and definitions (the markdown specs)', () => {
    const def: Definition = { type: 'definition', identifier: 'ex', label: 'Ex', url: 'https://ex.com', title: 'Example' };

    it('resolves a linkReference through components.link using the definition', () => {
        const para = p([{ type: 'linkReference', identifier: 'ex', label: 'Ex', referenceType: 'full', children: [text('see')] }]);
        const out = el(render(root(para, def))[0]).children;
        expect(out).toHaveLength(1);
        expect(el(out[0])).toMatchObject({
            tag: 'a',
            props: { url: 'https://ex.com', title: 'Example', autolink: false },
            children: ['see'],
            key: '0',
        });
    });

    it('collects definitions from the whole document by default (nested containers too)', () => {
        const quote: Blockquote = { type: 'blockquote', children: [def] };
        const para = p([{ type: 'linkReference', identifier: 'ex', referenceType: 'shortcut', children: [text('see')] }]);
        const out = el(render(root(para, quote))[0]).children;
        expect(el(out[0]).tag).toBe('a');
    });

    it('collectEnv gathers the first definition per identifier, walking the root and its containers only', () => {
        const dup: Definition = { type: 'definition', identifier: 'ex', url: 'https://second.com' };
        const env = collectEnv(root(def, { type: 'blockquote', children: [dup] }), markdownSchema) as { definitions?: Map<string, Definition> };
        expect(env.definitions?.get('ex')).toBe(def);
        expect(collectEnv(root(p([])), markdownSchema)).toEqual({});
    });

    it('uses ctx.env when given instead of collecting', () => {
        const para = p([{ type: 'linkReference', identifier: 'ex', referenceType: 'shortcut', children: [text('see')] }]);
        const out = el(render(root(para, def), { ...ctx, env: { definitions: new Map() } })[0]).children;
        expect(out).toEqual(['[', 'see', ']']);
    });

    it('renders an unresolved linkReference as its literal source', () => {
        const kids = [text('see '), { type: 'emphasis', children: [text('it')] } as PhrasingContent];
        const full = p([{ type: 'linkReference', identifier: 'nope', label: 'Nope', referenceType: 'full', children: kids }]);
        const collapsed = p([{ type: 'linkReference', identifier: 'nope', referenceType: 'collapsed', children: kids }]);
        const shortcut = p([{ type: 'linkReference', identifier: 'nope', referenceType: 'shortcut', children: kids }]);
        const out = render(root(full, collapsed, shortcut)).map(el);
        expect(out[0].children).toEqual(['[', 'see ', { tag: 'em', props: {}, children: ['it'], key: '0.2' }, '][Nope]']);
        expect(out[1].children).toEqual(['[', 'see ', { tag: 'em', props: {}, children: ['it'], key: '0.2' }, '][]']);
        expect(out[2].children).toEqual(['[', 'see ', { tag: 'em', props: {}, children: ['it'], key: '0.2' }, ']']);
    });

    it('resolves and falls back for imageReference', () => {
        const para = p([
            { type: 'imageReference', identifier: 'ex', referenceType: 'shortcut', alt: 'pic' },
            { type: 'imageReference', identifier: 'nope', label: 'Nope', referenceType: 'full', alt: 'pic' },
            { type: 'imageReference', identifier: 'nope', referenceType: 'collapsed' },
        ]);
        const out = el(render(root(para, def))[0]).children;
        expect(el(out[0])).toMatchObject({ tag: 'img', props: { url: 'https://ex.com', alt: 'pic', title: 'Example' } });
        expect(out[1]).toBe('![pic][Nope]');
        expect(out[2]).toBe('![][]');
    });

    it('skips definition nodes without a definition component', () => {
        const out = render(root(def, p([text('a')], 'k')));
        expect(out).toHaveLength(1);
        expect(el(out[0])).toMatchObject({ tag: 'p', key: 'k' });
    });

    it('renders definitions through components.definition when present', () => {
        const definition = vi.fn(({ node }: { node: Definition }) => h('def', { id: node.identifier }));
        const out = render(root(def), { components: { ...components, definition }, schema: markdownSchema });
        expect(el(out[0])).toMatchObject({ tag: 'def', props: { id: 'ex' }, key: 'b-0' });
    });

    it('renders references as their literal source in a schema without the markdown specs', () => {
        const para = p([{ type: 'linkReference', identifier: 'ex', referenceType: 'shortcut', children: [text('see')] }]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const out = el(render(root(para, def), { components, schema: createSchema(standardNodes) })[0]).children;
        // unknown types: the reference falls back to its children, the definition to nothing
        expect(out).toEqual(['see']);
        expect(warn).toHaveBeenCalled();
    });
});

describe('renderDocument — sanitisation', () => {
    it('sanitises link and image URLs (javascript: → #)', () => {
        const para = p([
            { type: 'link', url: 'javascript:alert(1)', children: [text('x')] },
            { type: 'image', url: 'javascript:alert(1)' },
            { type: 'link', url: 'https://ok', children: [] },
        ]);
        const out = el(render(root(para))[0]).children.map(el);
        expect(out[0].props.url).toBe('#');
        expect(out[1].props.url).toBe('#');
        expect(out[2].props.url).toBe('https://ok');
    });

    it('sanitises resolved reference URLs and honours a custom sanitizeUrl', () => {
        const bad: Definition = { type: 'definition', identifier: 'bad', url: 'javascript:x' };
        const para = p([
            { type: 'linkReference', identifier: 'bad', referenceType: 'shortcut', children: [] },
            { type: 'imageReference', identifier: 'bad', referenceType: 'shortcut' },
        ]);
        const out = el(render(root(para, bad))[0]).children.map(el);
        expect(out[0].props.url).toBe('#');
        expect(out[1].props.url).toBe('#');

        const sanitizeUrl = vi.fn((url: string, kind: string) => `${kind}:${url}`);
        const custom = el(render(root(para, bad), { ...ctx, sanitizeUrl })[0]).children.map(el);
        expect(custom[0].props.url).toBe('link:javascript:x');
        expect(custom[1].props.url).toBe('image:javascript:x');
    });
});

describe('renderDocument — plugin nodes', () => {
    const mention = (name: string): PhrasingContent => ({ type: 'mention', name }) as unknown as PhrasingContent;

    it('dispatches to components[node.type] with the node and rendered children', () => {
        const mentionFn = vi.fn(({ node }: { node: Node; children: RenderChild<El>[] }) =>
            h('mention', { name: (node as unknown as { name: string }).name }),
        );
        const para = p([text('hi '), mention('bob')]);
        const out = el(render(root(para), { components: { ...components, mention: mentionFn }, schema: markdownSchema })[0]).children;
        expect(out[0]).toBe('hi ');
        expect(el(out[1])).toMatchObject({ tag: 'mention', props: { name: 'bob' }, key: '1' });
        expect(mentionFn.mock.calls[0][0]).toEqual({ node: para.children[1], children: [] });
    });

    it('passes a plugin spec\'s props to its component', () => {
        const badge = vi.fn(({ level, children }: { level: string; children: RenderChild<El>[] }) => h('badge', { level }, children));
        const node = { type: 'badge', level: 'hot', children: [text('x')] } as unknown as PhrasingContent;
        const c = withNodes([{ type: 'badge', role: 'mark', props: (n) => ({ level: (n as unknown as { level: string }).level }) }], {
            components: { ...components, badge },
        });
        const out = el(render(root(p([node])), c)[0]).children;
        expect(el(out[0])).toMatchObject({ tag: 'badge', props: { level: 'hot' }, children: ['x'] });
    });

    it('renders a plugin block with its children rendered and its key stamped', () => {
        const callout = { type: 'callout', key: 'c1', kind: 'warn', children: [p([text('inner')])] } as unknown as BlockContent;
        const calloutFn = ({ node, children }: { node: Node; children: RenderChild<El>[] }) =>
            h('callout', { kind: (node as unknown as { kind: string }).kind }, children);
        const out = render(root(callout), { components: { ...components, callout: calloutFn }, schema: markdownSchema });
        const c = el(out[0]);
        expect(c).toMatchObject({ tag: 'callout', props: { kind: 'warn' }, key: 'c1' });
        expect(el(c.children[0])).toMatchObject({ tag: 'p', children: ['inner'], key: 'c1.0' });
    });

    it('renders a keyless plugin block with a path key and inline children by index', () => {
        const note = { type: 'note', children: [text('a'), { type: 'strong', children: [] }] } as unknown as BlockContent;
        const noteFn = ({ children }: { children: RenderChild<El>[] }) => h('note', {}, children);
        const out = render(root(p([]), note), { components: { ...components, note: noteFn }, schema: markdownSchema });
        const n = el(out[1]);
        expect(n.key).toBe('b-1');
        expect(n.children[0]).toBe('a');
        expect(el(n.children[1]).key).toBe('1');
    });

    it('renders nothing when a plugin component returns null', () => {
        const para = p([text('a'), mention('x'), text('b')]);
        const out = el(render(root(para), { components: { ...components, mention: () => null }, schema: markdownSchema })[0]).children;
        expect(out).toEqual(['a', 'b']);
    });

    it('falls back to the spec\'s text projection, through the text component', () => {
        const c = withNodes([{ type: 'mention', role: 'atom', text: (n) => `@${(n as unknown as { name: string }).name}` }]);
        const para = p([text('hi '), mention('bob')]);
        expect(el(render(root(para), c)[0]).children).toEqual(['hi ', '@bob']);
        const wrapped = el(render(root(para), { ...c, components: { ...components, text: ({ value }) => h('t', {}, [value]) } })[0]).children;
        expect(el(wrapped[1])).toMatchObject({ tag: 't', children: ['@bob'], key: '1' });
    });

    it('lets a spec render by hand (the escape hatch), keyed as one piece or several', () => {
        const c = withNodes([
            { type: 'twice', role: 'mark', render: (n, api) => [...api.renderInline((n as Parent).children), api.text('!')] },
            { type: 'skip', role: 'void', render: () => [] },
        ]);
        const twice = { type: 'twice', children: [text('a'), { type: 'emphasis', children: [] }] } as unknown as PhrasingContent;
        const out = render(root(p([twice]), { type: 'skip' } as unknown as BlockContent), c);
        expect(el(out[0]).children).toEqual(['a', { tag: 'em', props: {}, children: [], key: '0.1' }, '!']);
        expect(out).toHaveLength(1);
    });

    it('falls back to the rendered children (dev warning once per type) with no component or text projection', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wrap = (id: string): PhrasingContent =>
            ({ type: 'unknownWrap', children: [text(`[${id}]`), { type: 'emphasis', children: [] }] }) as unknown as PhrasingContent;
        const para = p([text('x'), wrap('1') as PhrasingContent, wrap('2') as PhrasingContent]);
        const out = el(render(root(para))[0]).children;
        expect(out).toEqual(['x', '[1]', { tag: 'em', props: {}, children: [], key: '1.1' }, '[2]', { tag: 'em', props: {}, children: [], key: '2.1' }]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/"unknownWrap"/);

        // a leaf without children renders nothing
        const leaf = { type: 'unknownLeaf' } as unknown as PhrasingContent;
        expect(el(render(root(p([text('a'), leaf, text('b')])))[0]).children).toEqual(['a', 'b']);
    });

    it('renders block children of a component-less plugin block with path keys', () => {
        const wrap = { type: 'unknownBlock', key: 'w', children: [p([text('a')]), p([text('b')])] } as unknown as BlockContent;
        const out = render(root(wrap));
        expect(out.map(el).map((e) => e.key)).toEqual(['w.0', 'w.1']);
    });

    it('missingComponents lists the schema types a map leaves unrendered', () => {
        expect(missingComponents(markdownSchema, components)).toEqual([]);
        const { link, ...rest } = components;
        void link;
        expect(missingComponents(withNodes([{ type: 'callout', role: 'container' }]).schema, rest as ComponentMap<El>)).toEqual(['link', 'callout']);
    });
});

describe('renderBlock / renderInline', () => {
    it('renderBlock renders one block with the given positional key', () => {
        const out = renderBlock(p([text('a')]), ctx, 'b-4');
        expect(out).toMatchObject({ tag: 'p', children: ['a'], key: 'b-4' });
        expect(renderBlock(p([], 'own'), ctx, 'b-4')?.key).toBe('own');
    });

    it('renderBlock returns null for a skipped definition and resolves definitions inside the block', () => {
        const def: Definition = { type: 'definition', identifier: 'ex', url: 'https://ex.com' };
        expect(renderBlock(def, ctx, 'b-0')).toBeNull();
        const quote: Blockquote = {
            type: 'blockquote',
            children: [p([{ type: 'linkReference', identifier: 'ex', referenceType: 'shortcut', children: [text('x')] }]), def],
        };
        const out = renderBlock(quote, ctx, 'b-0');
        expect(el(el(out?.children[0]).children[0]).props.url).toBe('https://ex.com');
    });

    it('renderInline renders phrasing content with index keys and an optional env', () => {
        const nodes: PhrasingContent[] = [
            text('a'),
            { type: 'strong', children: [] },
            { type: 'linkReference', identifier: 'ex', referenceType: 'shortcut', children: [text('r')] },
        ];
        const out = renderInline(nodes, ctx);
        expect(out[0]).toBe('a');
        expect(el(out[1]).key).toBe('1');
        expect(out.slice(2)).toEqual(['[', 'r', ']']);

        const definitions = new Map<string, Definition>([['ex', { type: 'definition', identifier: 'ex', url: 'https://ex.com' }]]);
        const resolved = renderInline(nodes, { ...ctx, env: { definitions } });
        expect(el(resolved[2])).toMatchObject({ tag: 'a', props: { url: 'https://ex.com' }, key: '2' });
    });
});
