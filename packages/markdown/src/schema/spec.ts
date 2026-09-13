/**
 * The document schema: one table that says, for every node type, what kind
 * of thing it is. Every layer reads it instead of carrying its own list —
 * keying, the editor's index and steps, the flat inline model, the render
 * engine, the menus. A plugin extends the vocabulary by contributing
 * `NodeSpec`s; a format registers the specs its syntax needs beyond the
 * standard ones.
 */

import type { BlockContent, Node, PhrasingContent } from '../ast/index.js';

/**
 * What a node is:
 *  - `textblock`: a block edited as a run of text with marks (paragraph, heading, table cell);
 *  - `container`: a block whose children are keyed blocks (blockquote, list, list item, table row);
 *  - `table`: a container rendered and edited as a grid;
 *  - `code`: a literal block edited through a code surface (code, html);
 *  - `void`: a block with no editable content, selectable as a whole (thematic break, definition);
 *  - `inline`: leaf phrasing content without a span (text, break);
 *  - `mark`: a ranged span over text (strong, emphasis, link, inline code);
 *  - `atom`: phrasing content that occupies exactly one U+FFFC (image, mention).
 */
export type NodeRole = 'textblock' | 'container' | 'table' | 'code' | 'void' | 'inline' | 'mark' | 'atom';

/** The object replacement character an atom occupies in the flat model. */
export const ATOM_CHAR = '￼';

export interface InlineSpan {
    /** Inclusive start, UTF-16 code units. */
    start: number;
    /** Exclusive end. */
    end: number;
    /** Mark or atom type: a standard phrasing type or a plugin node type. */
    type: string;
    /** Type-specific payload: `url`/`title` for links, `url`/`alt`/`title` for images, plugin fields. */
    attrs?: Record<string, string>;
}

/** The flat inline model: a run of text plus ranged marks and one-character atoms. */
export interface InlineFlat {
    text: string;
    spans: InlineSpan[];
}

/** How a phrasing node maps onto the flat model. */
export interface InlineFlatSpec<N extends Node = Node> {
    /** Role `inline` only: plain text (default) or a hard break (a newline in the flat text). */
    kind?: 'text' | 'break';
    /** A mark whose content is its own literal `value` (inline code): nothing nests inside it except `wrapsLiteral` marks. */
    literal?: boolean;
    /** A mark that may enclose a literal mark (a link over inline code). */
    wrapsLiteral?: boolean;
    /** Outer-to-inner nesting order when extents tie (lower sits outermost). Default `99`. */
    priority?: number;
    /** The attrs a node carries (default: every string / number / boolean own property except `type`, `children`, `value`, `position`, `data`, `key`). */
    toFlat?(node: N): Record<string, string>;
    /** Build the node back: an atom from its attrs, a mark as the wrapper around `children`. */
    fromFlat?(span: InlineSpan, children: PhrasingContent[]): PhrasingContent;
}

export interface BlockMenuEntry {
    label: string;
    icon?: string;
    group?: string;
    keywords?: string[];
    /** Build a fresh block of this type (used by the slash menu / block menu). */
    create(): BlockContent;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** A renderable child: an element of the renderer's type or a raw string (for text). */
export type RenderChild<E> = E | string;

/** Document-wide facts a render pass collects before rendering (`collect` hooks fill it; `definitions` for CommonMark references). */
export type RenderEnv = Record<string, unknown>;

/** What a spec's `props` hook sees of the node's surroundings. */
export interface PropsContext {
    /** The node's parent (`undefined` when rendering detached phrasing content). */
    parent?: Node;
    /** Index in the parent's children. */
    index: number;
    /** Ancestors from the outermost down to `parent`, each with the index it has in its own parent (`-1` for the root). */
    ancestors: readonly { node: Node; index: number }[];
    env: RenderEnv;
    sanitizeUrl(url: string, kind: 'link' | 'image'): string;
    /** The render context's link handler, forwarded to link-like components. */
    onLink?: unknown;
}

/** What a spec's `render` hook can do — render children, reach components, resolve the env. */
export interface NodeRenderApi<E> {
    component(type: string): ((props: Record<string, unknown>) => RenderChild<E> | null | undefined) | undefined;
    /** Render phrasing content (index-keyed). */
    renderInline(nodes: readonly Node[]): RenderChild<E>[];
    /** Render blocks with `<parentKey>.<i>` path keys. */
    renderBlocks(nodes: readonly Node[], parentKey: string): RenderChild<E>[];
    /** A text child through the `text` component (or the raw string without one). */
    text(value: string): RenderChild<E>;
    sanitizeUrl(url: string, kind: 'link' | 'image'): string;
    onLink?: unknown;
    env: RenderEnv;
}

export interface NodeSpec<N extends Node = Node> {
    type: string;
    role: NodeRole;
    /** Carries a reconciliation key. Default: every role except `inline`, `mark` and `atom`. */
    keyed?: boolean;
    /** Holds editable text (a text selection can live in it). Default: `textblock` and `code`. */
    editable?: boolean;
    /** Containers: the block type an empty one is filled with so a caret has somewhere to live (list item and blockquote → paragraph). */
    fillsWith?: string;
    /** Text blocks: may hold hard breaks (paragraph yes, heading and table cell no). */
    allowsHardBreak?: boolean;
    /** Enter at the end of this block creates a block of this type after it (heading → paragraph). */
    splitsTo?: string;
    /** Containers: the block that receives the caret when entered. Default: first editable descendant. */
    entry?(node: N): Node | undefined;
    /** Convert this block's content to phrasing content (code → paragraph turns `value` into text). */
    toInline?(node: N): PhrasingContent[];
    /** Build this block from phrasing content plus attrs (paragraph → code joins the text). Also how `createBlock` makes an empty one. */
    fromInline?(children: PhrasingContent[], attrs?: Record<string, unknown>): BlockContent;
    /** Void blocks: can be selected as a block (default `true`). */
    isSelectable?: boolean;
    /** Slash / block menu entry. */
    menu?: BlockMenuEntry;
    /** Phrasing roles: the flat-model mapping. */
    inline?: InlineFlatSpec<N>;
    // -- rendering --
    /** Extra props for the node's component beyond `node` and `children` (a heading's `depth`, a list item's `number`, a link's sanitised `url`). */
    props?(node: N, ctx: PropsContext): Record<string, unknown>;
    /**
     * Render the node by hand instead of through its component — the escape
     * hatch for nodes that resolve against the env (references) or expand to
     * several pieces. Return `null` to fall through to the default path.
     * `key` is the block key, or `null` in inline position.
     */
    render?<E>(node: N, api: NodeRenderApi<E>, key: string | null): RenderChild<E>[] | null;
    /** Plain-text projection: what the node renders as when no component exists for it. */
    text?(node: N): string;
    /** Fold document-wide facts into the render env before rendering (a definition registers its label). */
    collect?(node: N, env: RenderEnv): void;
    /** The component may return a plain string — the node needs no element of its own (raw HTML rendered as text). Silences the string-block warning. */
    textOutput?: boolean;
}

export interface Schema {
    readonly specs: ReadonlyMap<string, NodeSpec>;
    get(type: string): NodeSpec | undefined;
    role(type: string): NodeRole | undefined;
    /** Unknown types are keyed (a plugin block the schema does not know still reconciles by key). */
    isKeyed(type: string): boolean;
    isEditable(type: string): boolean;
    /** `container` or `table`: the children are keyed blocks. */
    isContainer(type: string): boolean;
    /** Block types that hold editable text, in registration order. */
    readonly editableTypes: ReadonlySet<string>;
    /** The block an empty document gets. */
    readonly defaultBlock: string;
    /** An empty block of `type` (`fromInline([])`, else the menu entry's `create()`). Throws for a type that can make neither. */
    createBlock(type: string): BlockContent;
    /** Every spec with a menu entry, in registration order. */
    menu(): readonly NodeSpec[];
}

export interface CreateSchemaOptions {
    /** Default `'paragraph'`. Should name a spec with `fromInline`. */
    defaultBlock?: string;
}

const UNKEYED_ROLES: ReadonlySet<NodeRole> = new Set(['inline', 'mark', 'atom']);
const EDITABLE_ROLES: ReadonlySet<NodeRole> = new Set(['textblock', 'code']);

/** Build a schema from exactly these specs — nothing is implied. A later spec with the same type replaces an earlier one (dev-warned). */
export function createSchema(specs: readonly NodeSpec[], options: CreateSchemaOptions = {}): Schema {
    const map = new Map<string, NodeSpec>();
    for (const spec of specs) {
        if (__DEV__ && map.has(spec.type)) console.warn(`[@sigx/markdown] Node spec "${spec.type}" replaces an earlier one.`);
        map.set(spec.type, spec);
    }
    const defaultBlock = options.defaultBlock ?? 'paragraph';
    const editableTypes = new Set<string>();
    for (const spec of map.values()) if (spec.editable ?? EDITABLE_ROLES.has(spec.role)) editableTypes.add(spec.type);
    const createBlock = (type: string): BlockContent => {
        const spec = map.get(type);
        if (spec?.fromInline) return spec.fromInline([]);
        if (spec?.menu) return spec.menu.create();
        throw new Error(`[@sigx/markdown] Cannot create a "${type}" block: no fromInline or menu entry.`);
    };
    return {
        specs: map,
        get: (type) => map.get(type),
        role: (type) => map.get(type)?.role,
        isKeyed: (type) => {
            const spec = map.get(type);
            return spec ? (spec.keyed ?? !UNKEYED_ROLES.has(spec.role)) : true;
        },
        isEditable: (type) => editableTypes.has(type),
        isContainer: (type) => {
            const role = map.get(type)?.role;
            return role === 'container' || role === 'table';
        },
        editableTypes,
        defaultBlock,
        createBlock,
        menu: () => [...map.values()].filter((s) => s.menu),
    };
}

/** The default `toFlat`: every string / number / boolean own property except `type`, `children`, `value`, `position`, `data`, `key`. */
export function inlineAttrsOf(node: Node): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(node as unknown as Record<string, unknown>)) {
        if (k === 'type' || k === 'children' || k === 'value' || k === 'position' || k === 'data' || k === 'key') continue;
        if (typeof v === 'string') attrs[k] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') attrs[k] = String(v);
    }
    return attrs;
}

/** The plain text of phrasing content (literal values concatenated, atoms skipped). */
export function phrasingText(nodes: readonly PhrasingContent[]): string {
    let out = '';
    for (const n of nodes) {
        if ('value' in n && typeof (n as { value: unknown }).value === 'string') out += (n as { value: string }).value;
        else if (Array.isArray((n as { children?: unknown }).children)) out += phrasingText((n as { children: PhrasingContent[] }).children);
    }
    return out;
}
