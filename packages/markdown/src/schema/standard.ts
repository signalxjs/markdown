/**
 * The standard vocabulary — one spec per mdast node type the core owns.
 * Formats are codecs into and out of this tree; a format that needs more
 * (CommonMark's reference definitions, raw HTML) registers its own specs.
 */

import type { BlockContent, HeadingDepth, Image, Link, Literal, Parent, PhrasingContent } from '../ast/index.js';
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

export const standardNodes: readonly NodeSpec[] = [
    {
        type: 'paragraph',
        role: 'textblock',
        allowsHardBreak: true,
        fromInline: (children) => ({ type: 'paragraph', children }),
        toInline: (node) => ((node as Parent).children as PhrasingContent[]),
        menu: { label: 'Text', icon: 'pilcrow', group: 'basic', keywords: ['paragraph', 'text'], create: () => paragraphOf('') },
    },
    {
        type: 'heading',
        role: 'textblock',
        splitsTo: 'paragraph',
        fromInline: (children, attrs) => ({ type: 'heading', depth: headingDepth(attrs?.depth), children: children.filter((c) => c.type !== 'break') }),
        toInline: (node) => ((node as Parent).children as PhrasingContent[]),
        menu: { label: 'Heading', icon: 'heading', group: 'basic', keywords: ['title', 'h1', 'h2', 'h3'], create: () => ({ type: 'heading', depth: 1, children: [] }) },
    },
    {
        // A cell is edited like a paragraph but is never a conversion target:
        // no `fromInline` (a cell is not `BlockContent`; cells come from the
        // table commands), so `setBlockType('tableCell')` is refused.
        type: 'tableCell',
        role: 'textblock',
        toInline: (node) => ((node as Parent).children as PhrasingContent[]),
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
        menu: { label: 'Quote', icon: 'quote', group: 'basic', keywords: ['blockquote', 'quote'], create: () => ({ type: 'blockquote', children: [paragraphOf('')] }) },
    },
    {
        type: 'list',
        role: 'container',
        menu: { label: 'Bulleted list', icon: 'list', group: 'basic', keywords: ['bullet', 'list', 'ul'], create: () => ({ type: 'list', ordered: false, spread: false, children: [{ type: 'listItem', spread: false, children: [paragraphOf('')] }] }) },
    },
    { type: 'listItem', role: 'container', fillsWith: 'paragraph' },
    {
        type: 'table',
        role: 'table',
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
    },
    { type: 'tableRow', role: 'container' },
    { type: 'text', role: 'inline' },
    { type: 'break', role: 'inline', inline: { kind: 'break' } },
    { type: 'strong', role: 'mark', inline: { priority: 2 } },
    { type: 'emphasis', role: 'mark', inline: { priority: 3 } },
    { type: 'delete', role: 'mark', inline: { priority: 4 } },
    { type: 'inlineCode', role: 'mark', inline: { literal: true, priority: 1 } },
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
    },
];

/** The schema of the standard vocabulary alone. */
export const standardSchema: Schema = createSchema(standardNodes);
