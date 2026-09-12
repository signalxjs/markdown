/**
 * The render-function component contract of the generic engine.
 *
 * `renderDocument()` is generic over the element type `E` — a sigx VNode on
 * the web and on Lynx, a string or a layout node in a terminal renderer. A
 * platform supplies one {@link MarkdownComponents} map; the engine owns AST
 * recursion and reconciliation keys, so a component only decides *what
 * element to wrap its already-rendered `children` in*.
 *
 * Block components (`paragraph`, `heading`, …, `tableCell`) must return an
 * element: the engine stamps the block's reconciliation key on it after it
 * returns, and a string cannot carry one. Inline components may return a
 * plain string.
 */

import type {
    AlignType,
    Blockquote,
    Break,
    Code,
    Definition,
    Delete,
    Emphasis,
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
    Root,
    Strong,
    Table,
    TableCell,
    TableRow,
    Text,
    ThematicBreak,
} from '../ast/index.js';

/** A renderable child: an element or a raw string (for text). */
export type MarkdownChild<E> = E | string;

/** The props every parent component receives: the node and its rendered children. */
export interface NodeProps<E, N> {
    node: N;
    children: MarkdownChild<E>[];
}

export interface HeadingProps<E> extends NodeProps<E, Heading> {
    depth: HeadingDepth;
}

export interface ListProps<E> extends NodeProps<E, List> {
    ordered: boolean;
    /** Starting number (`1` when the list carries none). */
    start: number;
    /** `true` when the list is loose. */
    spread: boolean;
}

export interface ListItemProps<E> extends NodeProps<E, ListItem> {
    ordered: boolean;
    /** Zero-based index within the list. */
    index: number;
    /** Display number for ordered lists (`start + index`). */
    number: number;
    /** GFM task state, or `null` when not a task item. */
    checked: boolean | null;
    spread: boolean;
}

export interface CodeProps {
    node: Code;
    lang: string | null;
    meta: string | null;
    value: string;
    /** `true` while the fence is still unterminated (streaming). */
    open: boolean;
}

export interface TableProps<E> extends NodeProps<E, Table> {
    /** One entry per column, padded with `null` to the widest row. `children[0]` is the header row. */
    align: AlignType[];
}

export interface TableRowProps<E> extends NodeProps<E, TableRow> {
    header: boolean;
    /** Zero-based row index (the header row is `0`). */
    index: number;
}

export interface TableCellProps<E> extends NodeProps<E, TableCell> {
    header: boolean;
    align: AlignType;
    /** Zero-based column index. */
    index: number;
}

export type LinkHandler = (url: string, node: Link | LinkReference) => void;

export interface LinkProps<E> extends NodeProps<E, Link | LinkReference> {
    /** The sanitised URL (a resolved reference carries its definition's URL). */
    url: string;
    title: string | null;
    /** Set for `<…>` and bare GFM autolinks. */
    autolink: boolean;
    onLink?: LinkHandler;
}

export interface ImageProps {
    node: Image | ImageReference;
    url: string;
    alt: string;
    title: string | null;
}

/** The fixed slots — one per built-in node type. */
export interface MarkdownComponentMap<E> {
    root(p: { node: Root; children: MarkdownChild<E>[] }): E;
    paragraph(p: NodeProps<E, Paragraph>): E;
    heading(p: HeadingProps<E>): E;
    blockquote(p: NodeProps<E, Blockquote>): E;
    list(p: ListProps<E>): E;
    listItem(p: ListItemProps<E>): E;
    code(p: CodeProps): E;
    thematicBreak(p: { node: ThematicBreak }): E;
    table(p: TableProps<E>): E;
    tableRow(p: TableRowProps<E>): E;
    tableCell(p: TableCellProps<E>): E;
    /** Raw HTML. The default DOM implementation renders it as literal text — no HTML sink. */
    html(p: { node: Html; value: string }): MarkdownChild<E>;
    /** A link reference definition. Default: renders nothing. */
    definition?(p: { node: Definition }): MarkdownChild<E> | null;
    text(p: { node: Text; value: string }): MarkdownChild<E>;
    emphasis(p: NodeProps<E, Emphasis>): MarkdownChild<E>;
    strong(p: NodeProps<E, Strong>): MarkdownChild<E>;
    delete(p: NodeProps<E, Delete>): MarkdownChild<E>;
    inlineCode(p: { node: InlineCode; value: string }): MarkdownChild<E>;
    break(p: { node: Break }): MarkdownChild<E>;
    link(p: LinkProps<E>): MarkdownChild<E>;
    image(p: ImageProps): MarkdownChild<E>;
}

/**
 * Typed slots for plugin node types. Empty here; a plugin merges its own in
 * (keyed by `node.type`, flat — `components.mention`):
 *
 * ```ts
 * declare module '@sigx/markdown' {
 *     interface MarkdownPluginComponents<E> {
 *         mention(p: NodeProps<E, Mention>): MarkdownChild<E>;
 *     }
 * }
 * ```
 */
// oxlint-disable-next-line no-empty-interface, no-unused-vars
export interface MarkdownPluginComponents<E> {}

/** A renderer for a plugin node type: called with the node and its rendered children. */
// oxlint-disable-next-line no-explicit-any
export type PluginComponent<E> = (p: any) => MarkdownChild<E> | null;

/**
 * Map of node type → render function. The fixed slots cover the built-in
 * node types; plugin node types are keyed by `node.type` (typed through
 * {@link MarkdownPluginComponents} when the plugin augments it).
 */
export type MarkdownComponents<E> = MarkdownComponentMap<E> &
    Partial<MarkdownPluginComponents<E>> & { [pluginType: string]: PluginComponent<E> | undefined };
