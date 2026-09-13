/**
 * The render engine: walks an mdast tree and dispatches every node to a
 * {@link MarkdownComponents} renderer. Platform-free — generic over the
 * element type `E` and free of any runtime import, so the same engine drives
 * the DOM view, Lynx and a terminal renderer.
 *
 * What the engine keeps for itself (so components stay simple and a design
 * system cannot break streaming by accident):
 *  - AST recursion — children are fully rendered before a component is called.
 *  - Reconciliation keys — stamped on the element *after* the component
 *    returns: `node.key`, or a positional path key (`b-<i>` / `<parent>.<i>`,
 *    see `ast/keys.ts`) for a keyless tree, so a finalized block never
 *    remounts whatever element the component chose. Inline children get
 *    their index as key; strings are never touched.
 *  - Reference resolution, URL sanitisation and the plugin fallbacks.
 */

import { childKey, topKey } from '../ast/index.js';
import { collectDefinitions } from '../document/index.js';
import type {
    AlignType,
    BlockContent,
    Definition,
    ImageReference,
    Keyed,
    LinkReference,
    List,
    Literal,
    Node,
    Parent,
    PhrasingContent,
    Root,
    RootContent,
    Table,
    Text,
} from '../ast/index.js';
import type { ResolvedPlugins, SerializeContext } from '../plugin/index.js';
import type { LinkHandler, MarkdownChild, MarkdownComponents } from './components.js';
import { sanitizeUrl as defaultSanitizeUrl, type UrlKind } from './sanitize.js';

export interface RenderContext<E> {
    components: MarkdownComponents<E>;
    /** Reference definitions to resolve against. Default: `collectDefinitions(root)` per call. */
    definitions?: ReadonlyMap<string, Definition>;
    /** Resolved plugins — their `serialize` rules are the fallback for a plugin node without a component. */
    plugins?: ResolvedPlugins;
    /** Passed to `link` components as `onLink`. */
    onLink?: LinkHandler;
    /** URL sanitiser for links and images. Default: `sanitizeUrl` from `./sanitize.js`. */
    sanitizeUrl?: (url: string, kind: UrlKind) => string;
    /**
     * How to stamp a reconciliation key on a rendered element. Default:
     * `(el, key) => { el.key = key }` (a sigx VNode on DOM and Lynx). Never
     * called for strings. A renderer whose elements are strings can pass a
     * no-op; that also silences the dev warning about string blocks.
     */
    stampKey?: (el: E, key: string) => void;
}

/** Render a whole document: every top-level block, wrapped in `components.root`. */
export function renderDocument<E>(root: Root, ctx: RenderContext<E>): E {
    const eng = createEngine(ctx, ctx.definitions ?? collectDefinitions(root));
    const children: MarkdownChild<E>[] = [];
    root.children.forEach((child, i) => renderBlockNode(child, eng, topKey(i), children));
    return eng.C.root({ node: root, children });
}

/**
 * Render one block — for consumers rendering a subset (a per-block memoised
 * view). `key` is the positional key used when the node carries none, and the
 * parent key of its descendants. `null` when the block renders to nothing (a
 * `definition` without a component). Definitions default to those found
 * inside the block itself; pass `ctx.definitions` to resolve document-wide.
 */
export function renderBlock<E>(node: BlockContent, ctx: RenderContext<E>, key: string): E | null {
    const eng = createEngine(ctx, ctx.definitions ?? collectDefinitions({ type: 'root', children: [node] }));
    const out: MarkdownChild<E>[] = [];
    renderBlockNode(node, eng, key, out);
    if (__DEV__ && out.length > 1) {
        console.warn(
            `[@sigx/markdown] renderBlock: a "${node.type}" node without a component expanded to ${out.length} elements; only the first is returned. Use renderDocument() or register a component.`,
        );
    }
    return out.length > 0 ? (out[0] as E) : null;
}

/** Render a run of phrasing content (index-keyed). Definitions default to none unless `ctx.definitions` is set. */
export function renderInline<E>(nodes: PhrasingContent[], ctx: RenderContext<E>): MarkdownChild<E>[] {
    return renderInlineNodes(nodes, createEngine(ctx, ctx.definitions ?? EMPTY_DEFINITIONS));
}

// ---------------------------------------------------------------------------
// Engine state (resolved once per call)
// ---------------------------------------------------------------------------

interface Engine<E> {
    C: MarkdownComponents<E>;
    definitions: ReadonlyMap<string, Definition>;
    plugins: ResolvedPlugins | undefined;
    onLink: LinkHandler | undefined;
    sanitize: (url: string, kind: UrlKind) => string;
    /** Stamps `key` on `el`; a no-op for strings and nothing. */
    stamp: (el: MarkdownChild<E> | null | undefined, key: string) => void;
    /** Whether the default (VNode `.key`) stamping is in use — gates the string-block dev warning. */
    defaultStamp: boolean;
}

const EMPTY_DEFINITIONS: ReadonlyMap<string, Definition> = new Map();

function defaultStampKey(el: unknown, key: string): void {
    (el as { key?: string }).key = key;
}

function createEngine<E>(ctx: RenderContext<E>, definitions: ReadonlyMap<string, Definition>): Engine<E> {
    const stampKey = ctx.stampKey ?? defaultStampKey;
    return {
        C: ctx.components,
        definitions,
        plugins: ctx.plugins,
        onLink: ctx.onLink,
        sanitize: ctx.sanitizeUrl ?? defaultSanitizeUrl,
        stamp: (el, key) => {
            if (el != null && typeof el !== 'string') stampKey(el as E, key);
        },
        defaultStamp: ctx.stampKey === undefined,
    };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Slots typed to return an element (not a string) — a string there cannot carry a key. */
const ELEMENT_SLOTS: ReadonlySet<string> = new Set([
    'paragraph',
    'heading',
    'thematicBreak',
    'blockquote',
    'list',
    'listItem',
    'code',
    'table',
    'tableRow',
    'tableCell',
]);

const INLINE_TYPES: ReadonlySet<string> = new Set([
    'text',
    'emphasis',
    'strong',
    'delete',
    'inlineCode',
    'break',
    'link',
    'image',
    'linkReference',
    'imageReference',
]);

/** Render a block container's children with `<parentKey>.<i>` path keys. */
function renderBlocks<E>(nodes: readonly Node[], eng: Engine<E>, parentKey: string): MarkdownChild<E>[] {
    const out: MarkdownChild<E>[] = [];
    nodes.forEach((child, i) => renderBlockNode(child, eng, childKey(parentKey, i), out));
    return out;
}

/**
 * Render one node in block position into `out`. Almost always exactly one
 * element; nothing for a skipped `definition`, and possibly several for a
 * plugin node that falls back to its children.
 */
function renderBlockNode<E>(node: Node, eng: Engine<E>, pathKey: string, out: MarkdownChild<E>[]): void {
    const key = (node as Keyed).key ?? pathKey;
    const C = eng.C;
    const n = node as RootContent;
    let el: MarkdownChild<E> | null;
    switch (n.type) {
        case 'paragraph':
            el = C.paragraph({ node: n, children: renderInlineNodes(n.children, eng) });
            break;
        case 'heading':
            el = C.heading({ node: n, depth: n.depth, children: renderInlineNodes(n.children, eng) });
            break;
        case 'thematicBreak':
            el = C.thematicBreak({ node: n });
            break;
        case 'blockquote':
            el = C.blockquote({ node: n, children: renderBlocks(n.children, eng, key) });
            break;
        case 'list':
            el = renderList(n, eng, key);
            break;
        case 'code':
            el = C.code({ node: n, lang: n.lang ?? null, meta: n.meta ?? null, value: n.value, open: n.open === true });
            break;
        case 'html':
            el = C.html({ node: n, value: n.value });
            break;
        case 'definition':
            el = C.definition ? C.definition({ node: n }) : null;
            break;
        case 'table':
            el = renderTable(n, eng, key);
            break;
        default:
            // Inline content in block position (a plugin block whose children
            // are phrasing content) keeps its index key; anything else is a
            // plugin node.
            if (INLINE_TYPES.has(n.type)) renderInlinePiece(n, eng, indexOf(pathKey), out);
            else renderPluginNode(n, eng, key, out);
            return;
    }
    if (el == null) return;
    if (__DEV__ && typeof el === 'string' && ELEMENT_SLOTS.has(n.type)) warnStringBlock(n.type, eng);
    eng.stamp(el, key);
    out.push(el);
}

/** The index a path key was built from (`b-3` → 3, `b-3.2` → 2). */
function indexOf(pathKey: string): number {
    const i = pathKey.lastIndexOf('.');
    return Number(i === -1 ? pathKey.slice(2) : pathKey.slice(i + 1)) || 0;
}

function renderList<E>(node: List, eng: Engine<E>, key: string): E {
    const C = eng.C;
    const ordered = !!node.ordered;
    const start = node.start ?? 1;
    const spread = !!node.spread;
    const children = node.children.map((item, i) => {
        const itemKey = item.key ?? childKey(key, i);
        const li = C.listItem({
            node: item,
            ordered,
            index: i,
            number: start + i,
            checked: item.checked ?? null,
            spread: !!item.spread,
            children: renderBlocks(item.children, eng, itemKey),
        });
        if (__DEV__ && typeof li === 'string') warnStringBlock('listItem', eng);
        eng.stamp(li, itemKey);
        return li;
    });
    return C.list({ node, ordered, start, spread, children });
}

function renderTable<E>(node: Table, eng: Engine<E>, key: string): E {
    const C = eng.C;
    const rows = node.children;
    let width = node.align?.length ?? 0;
    for (const row of rows) width = Math.max(width, row.children.length);
    const align: AlignType[] = [];
    for (let i = 0; i < width; i++) align.push(node.align?.[i] ?? null);

    const children = rows.map((row, ri) => {
        const rowKey = row.key ?? childKey(key, ri);
        const header = ri === 0;
        const cells = row.children.map((cell, ci) => {
            const cellKey = cell.key ?? childKey(rowKey, ci);
            const td = C.tableCell({
                node: cell,
                header,
                align: align[ci] ?? null,
                index: ci,
                children: renderInlineNodes(cell.children, eng),
            });
            if (__DEV__ && typeof td === 'string') warnStringBlock('tableCell', eng);
            eng.stamp(td, cellKey);
            return td;
        });
        const tr = C.tableRow({ node: row, header, index: ri, children: cells });
        if (__DEV__ && typeof tr === 'string') warnStringBlock('tableRow', eng);
        eng.stamp(tr, rowKey);
        return tr;
    });
    return C.table({ node, align, children });
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function renderInlineNodes<E>(nodes: readonly Node[], eng: Engine<E>): MarkdownChild<E>[] {
    const out: MarkdownChild<E>[] = [];
    for (let i = 0; i < nodes.length; i++) renderInlinePiece(nodes[i], eng, i, out);
    return out;
}

/**
 * Render one inline node into `out` and key what it produced by its index:
 * `"<i>"` for the usual single child, `"<i>.<j>"` per piece when a node
 * expands to several (an unresolved reference, a plugin fallback).
 */
function renderInlinePiece<E>(node: Node, eng: Engine<E>, index: number, out: MarkdownChild<E>[]): void {
    const before = out.length;
    renderInlineNode(node, eng, out);
    const added = out.length - before;
    if (added === 1) eng.stamp(out[before], String(index));
    else for (let j = 0; j < added; j++) eng.stamp(out[before + j], `${index}.${j}`);
}

function renderInlineNode<E>(node: Node, eng: Engine<E>, out: MarkdownChild<E>[]): void {
    const C = eng.C;
    const n = node as PhrasingContent;
    switch (n.type) {
        case 'text':
            out.push(C.text({ node: n, value: n.value }));
            return;
        case 'emphasis':
            out.push(C.emphasis({ node: n, children: renderInlineNodes(n.children, eng) }));
            return;
        case 'strong':
            out.push(C.strong({ node: n, children: renderInlineNodes(n.children, eng) }));
            return;
        case 'delete':
            out.push(C.delete({ node: n, children: renderInlineNodes(n.children, eng) }));
            return;
        case 'inlineCode':
            out.push(C.inlineCode({ node: n, value: n.value }));
            return;
        case 'break':
            out.push(C.break({ node: n }));
            return;
        case 'link':
            out.push(
                C.link({
                    node: n,
                    url: eng.sanitize(n.url, 'link'),
                    title: n.title ?? null,
                    autolink: n.data?.autolink === true,
                    children: renderInlineNodes(n.children, eng),
                    onLink: eng.onLink,
                }),
            );
            return;
        case 'image':
            out.push(C.image({ node: n, url: eng.sanitize(n.url, 'image'), alt: n.alt ?? '', title: n.title ?? null }));
            return;
        case 'linkReference':
            renderLinkReference(n, eng, out);
            return;
        case 'imageReference':
            renderImageReference(n, eng, out);
            return;
        default:
            renderPluginNode(n, eng, null, out);
    }
}

/** The bracket suffix that follows a reference's label in the source. */
function referenceSuffix(node: LinkReference | ImageReference): string {
    switch (node.referenceType) {
        case 'full':
            return `[${node.label ?? node.identifier}]`;
        case 'collapsed':
            return '[]';
        default:
            return '';
    }
}

function textNode(value: string): Text {
    return { type: 'text', value };
}

/**
 * A resolved reference renders through `components.link`; an unresolved one
 * renders as the literal source — `[`, the rendered children, `]…` — so the
 * visible text matches what was written (CommonMark).
 */
function renderLinkReference<E>(node: LinkReference, eng: Engine<E>, out: MarkdownChild<E>[]): void {
    const C = eng.C;
    const def = eng.definitions.get(node.identifier);
    const children = renderInlineNodes(node.children, eng);
    if (def) {
        out.push(
            C.link({
                node,
                url: eng.sanitize(def.url, 'link'),
                title: def.title ?? null,
                autolink: false,
                children,
                onLink: eng.onLink,
            }),
        );
        return;
    }
    out.push(C.text({ node: textNode('['), value: '[' }));
    for (const child of children) out.push(child);
    const tail = `]${referenceSuffix(node)}`;
    out.push(C.text({ node: textNode(tail), value: tail }));
}

function renderImageReference<E>(node: ImageReference, eng: Engine<E>, out: MarkdownChild<E>[]): void {
    const C = eng.C;
    const def = eng.definitions.get(node.identifier);
    const alt = node.alt ?? '';
    if (def) {
        out.push(C.image({ node, url: eng.sanitize(def.url, 'image'), alt, title: def.title ?? null }));
        return;
    }
    const value = `![${alt}]${referenceSuffix(node)}`;
    out.push(C.text({ node: textNode(value), value }));
}

// ---------------------------------------------------------------------------
// Plugin nodes
// ---------------------------------------------------------------------------

/**
 * A node of a type without a fixed slot. In order: `components[node.type]`
 * (called with `{ node, children }`; `null` renders nothing), then the
 * plugin's serialize rule rendered as text, then the rendered children alone
 * (dev-warned once per type). `key` is the block key, or `null` in inline
 * position (where the caller keys by index).
 */
function renderPluginNode<E>(node: Node, eng: Engine<E>, key: string | null, out: MarkdownChild<E>[]): void {
    const C = eng.C;
    const kids = (node as Partial<Parent>).children;
    const renderChildren = (): MarkdownChild<E>[] => {
        if (!Array.isArray(kids)) return [];
        return key === null ? renderInlineNodes(kids, eng) : renderBlocks(kids, eng, key);
    };

    const component = C[node.type];
    if (component) {
        const el = component({ node, children: renderChildren() });
        if (el == null) return;
        if (key !== null) eng.stamp(el, key);
        out.push(el);
        return;
    }

    const rule = eng.plugins?.serialize.get(node.type);
    if (rule) {
        const value = rule(node, createSerializeContext(eng));
        const el = C.text({ node: textNode(value), value });
        if (key !== null) eng.stamp(el, key);
        out.push(el);
        return;
    }

    if (__DEV__ && !warnedTypes.has(node.type)) {
        warnedTypes.add(node.type);
        console.warn(
            `[@sigx/markdown] No component or serialize rule for node type "${node.type}"; rendering its children only.`,
        );
    }
    for (const child of renderChildren()) out.push(child);
}

/**
 * A minimal `SerializeContext` for the serialize-rule fallback. The real
 * serializer is not pulled into every renderer just for this path: nested
 * nodes serialize through the plugin rules when one exists and otherwise
 * degrade to the plain text of their literals (no escaping, no indentation,
 * children joined without separators).
 */
function createSerializeContext<E>(eng: Engine<E>): SerializeContext {
    const ctx: SerializeContext = {
        indent: '',
        options: {},
        escapeText: (text) => text,
        serialize: (node) => {
            const rule = eng.plugins?.serialize.get(node.type);
            return rule ? rule(node, ctx) : plainText(node);
        },
        serializeChildren: (node) => node.children.map((child) => ctx.serialize(child)).join(''),
    };
    return ctx;
}

function plainText(node: Node): string {
    const value = (node as Partial<Literal>).value;
    if (typeof value === 'string') return value;
    const children = (node as Partial<Parent>).children;
    return Array.isArray(children) ? children.map(plainText).join('') : '';
}

// ---------------------------------------------------------------------------
// Dev warnings
// ---------------------------------------------------------------------------

const warnedTypes = new Set<string>();
const warnedStringSlots = new Set<string>();

function warnStringBlock<E>(slot: string, eng: Engine<E>): void {
    if (!eng.defaultStamp || warnedStringSlots.has(slot)) return;
    warnedStringSlots.add(slot);
    console.warn(
        `[@sigx/markdown] The "${slot}" component returned a string; a block must be an element so it can carry a reconciliation key (pass stampKey to opt out).`,
    );
}
