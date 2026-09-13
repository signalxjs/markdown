/**
 * The standard vocabulary — one spec per mdast node type the core owns.
 * Formats are codecs into and out of this tree; a format that needs more
 * (CommonMark's reference definitions, raw HTML) registers its own specs.
 *
 * Each spec also says what its component receives beyond `node` and
 * `children` (`props`): a heading's `depth`, a list item's `number`, a
 * table cell's `align`, a link's sanitised `url` — so the render engine has
 * no per-type code.
 */

import type { AlignType, BlockContent, Code, Heading, HeadingDepth, Image, Link, List, ListItem, Literal, Parent, PhrasingContent, Table } from '../ast/index.js';
import { createSchema, inlineAttrsOf, type NodeSpec, type Schema } from './spec.js';

/** The text a block gets when phrasing content becomes a literal (code from a paragraph): values, alt text, newlines for breaks. */
export function phrasingToText(children: PhrasingContent[]): string {
    let out = '';
    for (const c of children) {
        if (c.type === 'text' || c.type === 'inlineCode') out += c.value;
        else if (c.type === 'break') out += '\n';
        else if ('children' in c && Array.isArray(c.children)) out += phrasingToText(c.children as PhrasingContent[]);
        else if ('alt' in c) out += (c as { alt?: string | null }).alt ?? '';
    }
    return out;
}

/** A heading depth from loose attrs: clamped to 1..6, integer, 1 when missing or not a number. */
function headingDepth(value: unknown): HeadingDepth {
    const n = Math.trunc(Number(value));
    return (Number.isFinite(n) && n >= 1 ? Math.min(n, 6) : 1) as HeadingDepth;
}

export function paragraphOf(text: string): BlockContent {
    return { type: 'paragraph', children: text ? [{ type: 'text', value: text }] : [] };
}

/** A table's `align`, one entry per column, padded with `null` to the widest row. */
export function tableAlign(table: Table): AlignType[] {
    let width = table.align?.length ?? 0;
    for (const row of table.children) width = Math.max(width, row.children.length);
    const align: AlignType[] = [];
    for (let i = 0; i < width; i++) align.push(table.align?.[i] ?? null);
    return align;
}

export const standardNodes: readonly NodeSpec[] = [
    {
        type: 'paragraph',
        role: 'textblock',
        allowsHardBreak: true,
        fromInline: (children) => ({ type: 'paragraph', children }),
        toInline: (node) => (node as Parent).children as PhrasingContent[],
        menu: { label: 'Text', icon: 'pilcrow', group: 'basic', keywords: ['paragraph', 'text'], create: () => paragraphOf('') },
    },
    {
        type: 'heading',
        role: 'textblock',
        splitsTo: 'paragraph',
        fromInline: (children, attrs) => ({ type: 'heading', depth: headingDepth(attrs?.depth), children: children.filter((c) => c.type !== 'break') }),
        toInline: (node) => (node as Parent).children as PhrasingContent[],
        menu: { label: 'Heading', icon: 'heading', group: 'basic', keywords: ['title', 'h1', 'h2', 'h3'], create: () => ({ type: 'heading', depth: 1, children: [] }) },
        props: (node) => ({ depth: (node as Heading).depth }),
    },
    {
        // A cell is edited like a paragraph but is never a conversion target:
        // no `fromInline` (a cell is not `BlockContent`; cells come from the
        // table commands), so `setBlockType('tableCell')` is refused.
        type: 'tableCell',
        role: 'textblock',
        isolating: true,
        toInline: (node) => (node as Parent).children as PhrasingContent[],
        props: (_node, ctx) => {
            const row = ctx.ancestors[ctx.ancestors.length - 1];
            const table = ctx.ancestors[ctx.ancestors.length - 2]?.node as Table | undefined;
            return { header: row?.index === 0, align: table?.align?.[ctx.index] ?? null, index: ctx.index };
        },
    },
    {
        type: 'code',
        role: 'code',
        splitsTo: 'paragraph',
        toInline: (node) => {
            const value = (node as Literal).value;
            return value ? [{ type: 'text', value }] : [];
        },
        fromInline: (children, attrs) => ({ type: 'code', lang: (attrs?.lang as string | null) ?? null, meta: null, value: phrasingToText(children) }),
        menu: { label: 'Code block', icon: 'code', group: 'basic', keywords: ['code', 'fence', 'snippet'], create: () => ({ type: 'code', lang: null, meta: null, value: '' }) },
        props: (node) => {
            const n = node as Code;
            return { lang: n.lang ?? null, meta: n.meta ?? null, value: n.value, open: n.open === true };
        },
    },
    {
        type: 'thematicBreak',
        role: 'void',
        menu: { label: 'Divider', icon: 'minus', group: 'basic', keywords: ['hr', 'rule', 'divider', 'separator'], create: () => ({ type: 'thematicBreak' }) },
    },
    {
        type: 'blockquote',
        role: 'container',
        fillsWith: 'paragraph',
        collapsesWhenEmpty: true,
        menu: { label: 'Quote', icon: 'quote', group: 'basic', keywords: ['blockquote', 'quote'], create: () => ({ type: 'blockquote', children: [paragraphOf('')] }) },
    },
    {
        type: 'list',
        role: 'container',
        collapsesWhenEmpty: true,
        menu: { label: 'Bulleted list', icon: 'list', group: 'basic', keywords: ['bullet', 'list', 'ul'], create: () => ({ type: 'list', ordered: false, spread: false, children: [{ type: 'listItem', spread: false, children: [paragraphOf('')] }] }) },
        props: (node) => {
            const n = node as List;
            return { ordered: !!n.ordered, start: n.start ?? 1, spread: !!n.spread };
        },
    },
    {
        type: 'listItem',
        role: 'container',
        fillsWith: 'paragraph',
        collapsesWhenEmpty: true,
        moveAsUnit: true,
        props: (node, ctx) => {
            const list = ctx.parent as List | undefined;
            const item = node as ListItem;
            const ordered = !!list?.ordered;
            const start = list?.start ?? 1;
            return { ordered, index: ctx.index, number: start + ctx.index, checked: item.checked ?? null, spread: !!item.spread };
        },
    },
    {
        type: 'table',
        role: 'table',
        isolating: true,
        menu: {
            label: 'Table',
            icon: 'table',
            group: 'basic',
            keywords: ['table', 'grid'],
            create: () => ({
                type: 'table',
                align: [null, null],
                children: [
                    { type: 'tableRow', children: [{ type: 'tableCell', children: [] }, { type: 'tableCell', children: [] }] },
                    { type: 'tableRow', children: [{ type: 'tableCell', children: [] }, { type: 'tableCell', children: [] }] },
                ],
            }),
        },
        props: (node) => ({ align: tableAlign(node as Table) }),
    },
    { type: 'tableRow', role: 'container', isolating: true, props: (_node, ctx) => ({ header: ctx.index === 0, index: ctx.index }) },
    { type: 'text', role: 'inline', props: (node) => ({ value: (node as Literal).value }), text: (node) => (node as Literal).value },
    { type: 'break', role: 'inline', inline: { kind: 'break' }, text: () => '\n' },
    { type: 'strong', role: 'mark', inline: { priority: 2 } },
    { type: 'emphasis', role: 'mark', inline: { priority: 3 } },
    { type: 'delete', role: 'mark', inline: { priority: 4 } },
    { type: 'inlineCode', role: 'mark', inline: { literal: true, priority: 1 }, props: (node) => ({ value: (node as Literal).value }), text: (node) => (node as Literal).value },
    {
        type: 'link',
        role: 'mark',
        inline: {
            wrapsLiteral: true,
            priority: 0,
            toFlat: (node) => {
                const attrs = inlineAttrsOf(node);
                if ((node as Link).data?.autolink) attrs.autolink = 'true';
                return attrs;
            },
            fromFlat: (span, children) => {
                const node: Link = { type: 'link', url: span.attrs?.url ?? '', children };
                if (span.attrs?.title !== undefined) node.title = span.attrs.title;
                if (span.attrs?.autolink === 'true') node.data = { autolink: true };
                return node;
            },
        },
        props: (node, ctx) => {
            const n = node as Link;
            return { url: ctx.sanitizeUrl(n.url, 'link'), title: n.title ?? null, autolink: n.data?.autolink === true, onLink: ctx.onLink };
        },
    },
    {
        type: 'image',
        role: 'atom',
        inline: {
            fromFlat: (span) => {
                const attrs = span.attrs ?? {};
                const node: Image = { type: 'image', url: attrs.url ?? '', alt: attrs.alt ?? '' };
                if (attrs.title !== undefined) node.title = attrs.title;
                return node;
            },
        },
        props: (node, ctx) => {
            const n = node as Image;
            return { url: ctx.sanitizeUrl(n.url, 'image'), alt: n.alt ?? '', title: n.title ?? null };
        },
        text: (node) => (node as Image).alt ?? '',
    },
];

/** The schema of the standard vocabulary alone. */
export const standardSchema: Schema = createSchema(standardNodes);

