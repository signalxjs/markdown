/**
 * The render engine: walks a tree and dispatches every node to a
 * {@link ComponentMap} renderer, driven by the schema. Platform-free —
 * generic over the element type `E` and free of any runtime import, so the
 * same engine drives the DOM view, Lynx and a terminal renderer; format-free —
 * it has no per-type code, every node type is described by its `NodeSpec`
 * (role, props, an optional `render` escape hatch, a `text` projection).
 *
 * What the engine keeps for itself (so components stay simple and a design
 * system cannot break streaming by accident):
 *  - AST recursion — children are fully rendered before a component is called
 *    (inline children for text blocks and marks, keyed blocks for containers);
 *  - Reconciliation keys — stamped on the element *after* the component
 *    returns: `node.key`, or a positional path key (`b-<i>` / `<parent>.<i>`,
 *    see `ast/keys.ts`) for a keyless tree, so a finalized block never
 *    remounts whatever element the component chose. Inline children get
 *    their index as key; strings are never touched.
 *  - The render env — `collect` hooks run over the document first (CommonMark
 *    definitions), `render` hooks resolve against it.
 */

import { childKey, topKey } from '../ast/index.js';
import type { BlockContent, Keyed, Node, Parent, PhrasingContent, Root, Text } from '../ast/index.js';
import type { NodeRenderApi, NodeSpec, PropsContext, RenderChild, RenderEnv, Schema } from '../schema/index.js';
import type { ComponentMap, LinkHandler } from './components.js';
import { sanitizeUrl as defaultSanitizeUrl, type UrlKind } from './sanitize.js';

export interface RenderContext<E> {
    components: ComponentMap<E>;
    /** The schema: what every node type is and what its component receives. */
    schema: Schema;
    /** The render env. Default: collected from the tree through the specs' `collect` hooks (`renderDocument`, `renderBlock`); empty for `renderInline`. */
    env?: RenderEnv;
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
    const eng = createEngine(ctx, ctx.env ?? collectEnv(root, ctx.schema), root);
    const children: RenderChild<E>[] = [];
    root.children.forEach((child, i) => renderBlockNode(child, eng, topKey(i), i, children));
    return eng.C.root({ node: root, children });
}

/**
 * Render one block — for consumers rendering a subset (a per-block memoised
 * view). `key` is the positional key used when the node carries none, and the
 * parent key of its descendants. `null` when the block renders to nothing (a
 * `definition` without a component). The env defaults to what the block
 * itself collects; pass `ctx.env` to resolve document-wide.
 */
export function renderBlock<E>(node: BlockContent, ctx: RenderContext<E>, key: string): E | null {
    const root: Root = { type: 'root', children: [node] };
    const eng = createEngine(ctx, ctx.env ?? collectEnv(root, ctx.schema), root);
    const out: RenderChild<E>[] = [];
    renderBlockNode(node, eng, key, 0, out);
    if (__DEV__ && out.length > 1) {
        console.warn(
            `[@sigx/richtext] renderBlock: a "${node.type}" node without a component expanded to ${out.length} elements; only the first is returned. Use renderDocument() or register a component.`,
        );
    }
    return out.length > 0 ? (out[0] as E) : null;
}

/** Render a run of phrasing content (index-keyed). The env is empty unless `ctx.env` is set. */
export function renderInline<E>(nodes: PhrasingContent[], ctx: RenderContext<E>): RenderChild<E>[] {
    return renderInlineNodes(nodes, createEngine(ctx, ctx.env ?? {}, undefined));
}

/**
 * Run every spec's `collect` hook over the root and its containers' descendants
 * (block level only — O(blocks), not O(inline nodes)) and return the env.
 */
export function collectEnv(root: Root, schema: Schema): RenderEnv {
    const env: RenderEnv = {};
    const walk = (node: Node): void => {
        schema.get(node.type)?.collect?.(node, env);
        if (node !== root && !schema.isContainer(node.type)) return;
        const children = (node as Parent).children;
        if (!children) return;
        for (const child of children) walk(child);
    };
    walk(root);
    return env;
}

/**
 * The schema types a component map leaves unrendered: no component, no
 * `render` hook and no `text` projection — they would fall back to their
 * children with a dev warning. A design-system sanity check.
 */
export function missingComponents<E>(schema: Schema, components: ComponentMap<E>): string[] {
    const out: string[] = [];
    for (const spec of schema.specs.values()) {
        if (components[spec.type] || spec.render || spec.text) continue;
        out.push(spec.type);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Engine state (resolved once per call)
// ---------------------------------------------------------------------------

interface Engine<E> {
    C: ComponentMap<E>;
    schema: Schema;
    env: RenderEnv;
    onLink: LinkHandler | undefined;
    sanitize: (url: string, kind: UrlKind) => string;
    /** Stamps `key` on `el`; a no-op for strings and nothing. */
    stamp: (el: RenderChild<E> | null | undefined, key: string) => void;
    /** Whether the default (VNode `.key`) stamping is in use — gates the string-block dev warning. */
    defaultStamp: boolean;
    /** The ancestors of the node being rendered, outermost first, each with its index in its own parent. */
    stack: { node: Node; index: number }[];
}

function defaultStampKey(el: unknown, key: string): void {
    (el as { key?: string }).key = key;
}

function createEngine<E>(ctx: RenderContext<E>, env: RenderEnv, root: Root | undefined): Engine<E> {
    const stampKey = ctx.stampKey ?? defaultStampKey;
    return {
        C: ctx.components,
        schema: ctx.schema,
        env,
        onLink: ctx.onLink,
        sanitize: ctx.sanitizeUrl ?? defaultSanitizeUrl,
        stamp: (el, key) => {
            if (el != null && typeof el !== 'string') stampKey(el as E, key);
        },
        defaultStamp: ctx.stampKey === undefined,
        stack: root ? [{ node: root, index: -1 }] : [],
    };
}

function textNode(value: string): Text {
    return { type: 'text', value };
}

function renderApi<E>(eng: Engine<E>): NodeRenderApi<E> {
    return {
        component: (type) => eng.C[type] as ((props: Record<string, unknown>) => RenderChild<E> | null | undefined) | undefined,
        renderInline: (nodes) => renderInlineNodes(nodes, eng),
        renderBlocks: (nodes, parentKey) => renderBlocks(nodes, eng, parentKey),
        text: (value) => textChild(value, eng),
        sanitizeUrl: eng.sanitize,
        onLink: eng.onLink,
        env: eng.env,
    };
}

/** A text child through the `text` component, or the raw string without one. */
function textChild<E>(value: string, eng: Engine<E>): RenderChild<E> {
    const text = eng.C.text;
    return text ? text({ node: textNode(value), value }) : value;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const PHRASING_ROLES: ReadonlySet<string> = new Set(['inline', 'mark', 'atom']);
const INLINE_CHILDREN_ROLES: ReadonlySet<string> = new Set(['textblock', 'mark']);
/** Roles whose element must carry a key: a string return is a bug (unless the spec says `textOutput`). */
const ELEMENT_ROLES: ReadonlySet<string> = new Set(['textblock', 'container', 'table', 'code', 'void']);

/** Render a block container's children with `<parentKey>.<i>` path keys. */
function renderBlocks<E>(nodes: readonly Node[], eng: Engine<E>, parentKey: string): RenderChild<E>[] {
    const out: RenderChild<E>[] = [];
    nodes.forEach((child, i) => renderBlockNode(child, eng, childKey(parentKey, i), i, out));
    return out;
}

/**
 * Render one node in block position into `out`. Almost always exactly one
 * element; nothing for a skipped `definition`, and possibly several for a
 * node that falls back to its children. Phrasing content in block position
 * (a plugin block whose children are inline) keeps its index key.
 */
function renderBlockNode<E>(node: Node, eng: Engine<E>, pathKey: string, index: number, out: RenderChild<E>[]): void {
    const role = eng.schema.role(node.type);
    if (role && PHRASING_ROLES.has(role)) {
        renderInlinePiece(node, eng, index, out);
        return;
    }
    renderNode(node, eng, (node as Keyed).key ?? pathKey, index, out);
}

function renderInlineNodes<E>(nodes: readonly Node[], eng: Engine<E>): RenderChild<E>[] {
    const out: RenderChild<E>[] = [];
    for (let i = 0; i < nodes.length; i++) renderInlinePiece(nodes[i], eng, i, out);
    return out;
}

/**
 * Render one inline node into `out` and key what it produced by its index:
 * `"<i>"` for the usual single child, `"<i>.<j>"` per piece when a node
 * expands to several (an unresolved reference, a fallback to children).
 */
function renderInlinePiece<E>(node: Node, eng: Engine<E>, index: number, out: RenderChild<E>[]): void {
    const before = out.length;
    renderNode(node, eng, null, index, out);
    const added = out.length - before;
    if (added === 1) eng.stamp(out[before], String(index));
    else for (let j = 0; j < added; j++) eng.stamp(out[before + j], `${index}.${j}`);
}

/**
 * The one dispatch: `spec.render` (escape hatch) → the node's component with
 * `{ node, children, ...spec.props }` → `spec.text` through the `text`
 * component → the rendered children alone (dev-warned once per type).
 * `key` is the block key, or `null` in inline position (the caller keys by
 * index there).
 */
function renderNode<E>(node: Node, eng: Engine<E>, key: string | null, index: number, out: RenderChild<E>[]): void {
    const spec = eng.schema.get(node.type) as NodeSpec | undefined;

    if (spec?.render) {
        const pieces = spec.render(node, renderApi(eng), key);
        if (pieces) {
            if (key !== null && pieces.length === 1) eng.stamp(pieces[0], key);
            for (const piece of pieces) out.push(piece);
            return;
        }
    }

    const kids = (node as Partial<Parent>).children;
    const renderChildren = (): RenderChild<E>[] => {
        if (!Array.isArray(kids)) return [];
        // Text blocks and marks hold phrasing content; containers hold keyed
        // blocks; an unknown type follows its position.
        const inline = spec ? INLINE_CHILDREN_ROLES.has(spec.role) : key === null;
        eng.stack.push({ node, index });
        try {
            return inline || key === null ? renderInlineNodes(kids, eng) : renderBlocks(kids, eng, key);
        } finally {
            eng.stack.pop();
        }
    };

    const component = eng.C[node.type];
    if (component) {
        const props = spec?.props ? spec.props(node, propsContext(eng, index)) : undefined;
        const el = component({ node, children: renderChildren(), ...props });
        if (el == null) return;
        if (key !== null) {
            if (__DEV__ && typeof el === 'string' && spec && ELEMENT_ROLES.has(spec.role) && !spec.textOutput) warnStringBlock(node.type, eng);
            eng.stamp(el, key);
        }
        out.push(el);
        return;
    }

    if (spec?.text) {
        const el = textChild(spec.text(node), eng);
        if (key !== null) eng.stamp(el, key);
        out.push(el);
        return;
    }

    if (__DEV__ && !warnedTypes.has(node.type)) {
        warnedTypes.add(node.type);
        console.warn(`[@sigx/richtext] No component or text projection for node type "${node.type}"; rendering its children only.`);
    }
    for (const child of renderChildren()) out.push(child);
}

function propsContext<E>(eng: Engine<E>, index: number): PropsContext {
    const ancestors = eng.stack.slice();
    return {
        parent: ancestors[ancestors.length - 1]?.node,
        index,
        ancestors,
        env: eng.env,
        sanitizeUrl: eng.sanitize,
        onLink: eng.onLink,
    };
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
        `[@sigx/richtext] The "${slot}" component returned a string; a block must be an element so it can carry a reconciliation key (pass stampKey to opt out).`,
    );
}
