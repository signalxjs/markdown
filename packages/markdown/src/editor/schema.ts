/**
 * The editing schema: for every block type, which kind of surface edits it
 * and how it converts to and from other kinds. Plugins register their own
 * block types (`math` as a code surface, `callout` as a container, `embed`
 * as a void block) through `MarkdownPlugin.editor.blockEditors`.
 */

import type { BlockContent, HeadingDepth, PhrasingContent } from '../ast/index.js';
import type { EditorBlock } from './state.js';

export type SurfaceKind = 'inline' | 'code' | 'void' | 'container' | 'table';

export interface BlockMenuEntry {
    label: string;
    icon?: string;
    group?: string;
    keywords?: string[];
    /** Build a fresh block of this type (used by the slash menu / block menu). */
    create(): BlockContent;
}

export interface BlockEditorSpec {
    /** The mdast (or plugin) node type. */
    type: string;
    kind: SurfaceKind;
    /** Inline containers: may hold `break` nodes (paragraph yes, heading and tableCell no). */
    allowsHardBreak?: boolean;
    /** Enter at the end of this block creates a block of this type after it (heading → paragraph). */
    splitsTo?: string;
    /** Containers: the key path (relative index chain) to the block that receives the caret when entered. Default: first editable descendant. */
    entry?: (node: EditorBlock) => EditorBlock | undefined;
    /** Convert this block's content to phrasing content (code → paragraph turns `value` into text). */
    toInline?: (node: EditorBlock) => PhrasingContent[];
    /** Build this block from phrasing content plus attrs (paragraph → code joins the text). */
    fromInline?: (children: PhrasingContent[], attrs?: Record<string, unknown>) => BlockContent;
    /** Void blocks: can be selected as a block (default `true` for void). */
    isSelectable?: boolean;
    /** Slash / block menu entry. */
    menu?: BlockMenuEntry;
}

function textOf(children: PhrasingContent[]): string {
    let out = '';
    for (const c of children) {
        if (c.type === 'text' || c.type === 'inlineCode') out += c.value;
        else if (c.type === 'break') out += '\n';
        else if ('children' in c && Array.isArray(c.children)) out += textOf(c.children as PhrasingContent[]);
        else if (c.type === 'image' || c.type === 'imageReference') out += c.alt ?? '';
    }
    return out;
}

/** A heading depth from loose attrs: clamped to 1..6, integer, 1 when missing or not a number. */
function headingDepth(value: unknown): HeadingDepth {
    const n = Math.trunc(Number(value));
    return (Number.isFinite(n) && n >= 1 ? Math.min(n, 6) : 1) as HeadingDepth;
}

function paragraphOf(text: string): BlockContent {
    return { type: 'paragraph', children: text ? [{ type: 'text', value: text }] : [] };
}

/** The built-in specs, one per mdast block type. */
export const builtinBlockEditors: BlockEditorSpec[] = [
    {
        type: 'paragraph',
        kind: 'inline',
        allowsHardBreak: true,
        fromInline: (children) => ({ type: 'paragraph', children }),
        toInline: (node) => (node as { children: PhrasingContent[] }).children,
        menu: { label: 'Text', icon: 'pilcrow', group: 'basic', keywords: ['paragraph', 'text'], create: () => paragraphOf('') },
    },
    {
        type: 'heading',
        kind: 'inline',
        splitsTo: 'paragraph',
        fromInline: (children, attrs) => ({ type: 'heading', depth: headingDepth(attrs?.depth), children: children.filter((c) => c.type !== 'break') }),
        toInline: (node) => (node as { children: PhrasingContent[] }).children,
        menu: { label: 'Heading', icon: 'heading', group: 'basic', keywords: ['title', 'h1', 'h2', 'h3'], create: () => ({ type: 'heading', depth: 1, children: [] }) },
    },
    {
        // A cell is edited like a paragraph but is never a conversion target:
        // no `fromInline` (a cell is not `BlockContent`; cells come from the
        // table commands), so `setBlockType('tableCell')` is refused.
        type: 'tableCell',
        kind: 'inline',
        toInline: (node) => (node as { children: PhrasingContent[] }).children,
    },
    {
        type: 'code',
        kind: 'code',
        splitsTo: 'paragraph',
        toInline: (node) => {
            const value = (node as { value: string }).value;
            return value ? [{ type: 'text', value }] : [];
        },
        fromInline: (children, attrs) => ({ type: 'code', lang: (attrs?.lang as string | null) ?? null, meta: null, value: textOf(children) }),
        menu: { label: 'Code block', icon: 'code', group: 'basic', keywords: ['code', 'fence', 'snippet'], create: () => ({ type: 'code', lang: null, meta: null, value: '' }) },
    },
    {
        type: 'html',
        kind: 'code',
        splitsTo: 'paragraph',
        toInline: (node) => {
            const value = (node as { value: string }).value;
            return value ? [{ type: 'text', value }] : [];
        },
        fromInline: (children) => ({ type: 'html', value: textOf(children) }),
    },
    {
        type: 'thematicBreak',
        kind: 'void',
        menu: { label: 'Divider', icon: 'minus', group: 'basic', keywords: ['hr', 'rule', 'divider', 'separator'], create: () => ({ type: 'thematicBreak' }) },
    },
    {
        type: 'definition',
        kind: 'void',
    },
    {
        type: 'blockquote',
        kind: 'container',
        menu: { label: 'Quote', icon: 'quote', group: 'basic', keywords: ['blockquote', 'quote'], create: () => ({ type: 'blockquote', children: [paragraphOf('')] }) },
    },
    {
        type: 'list',
        kind: 'container',
        menu: { label: 'Bulleted list', icon: 'list', group: 'basic', keywords: ['bullet', 'list', 'ul'], create: () => ({ type: 'list', ordered: false, spread: false, children: [{ type: 'listItem', spread: false, children: [paragraphOf('')] }] }) },
    },
    {
        type: 'listItem',
        kind: 'container',
    },
    {
        type: 'table',
        kind: 'table',
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
    { type: 'tableRow', kind: 'container' },
];

export interface Schema {
    get(type: string): BlockEditorSpec | undefined;
    kind(type: string): SurfaceKind | undefined;
    /** Block types edited as inline containers or code surfaces (the ones a text selection can live in). */
    editableTypes: ReadonlySet<string>;
    /** Every spec with a menu entry. */
    menu(): readonly BlockEditorSpec[];
}

/** Build the schema from the built-ins plus plugin specs (a plugin spec with the same type wins, with a dev warning). */
export function createSchema(extra: readonly BlockEditorSpec[] = []): Schema {
    const map = new Map<string, BlockEditorSpec>();
    for (const spec of builtinBlockEditors) map.set(spec.type, spec);
    for (const spec of extra) {
        if (__DEV__ && map.has(spec.type) && builtinBlockEditors.some((b) => b.type === spec.type)) {
            console.warn(`[@sigx/markdown] Plugin block editor "${spec.type}" replaces the built-in one.`);
        }
        map.set(spec.type, spec);
    }
    const editableTypes = new Set<string>();
    for (const spec of map.values()) if (spec.kind === 'inline' || spec.kind === 'code') editableTypes.add(spec.type);
    return {
        get: (type) => map.get(type),
        kind: (type) => map.get(type)?.kind,
        editableTypes,
        menu: () => [...map.values()].filter((s) => s.menu),
    };
}
