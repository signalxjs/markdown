/**
 * The plugin contract — one object that contributes to the parser, the
 * serializer, every renderer and the editor at once.
 *
 * Parser extensions are trigger-char gated so a plugin costs nothing on text
 * that never contains its trigger, and must be pure and streaming-safe: the
 * incremental engine reuses finalized blocks by reference and only re-parses
 * the live tail, so `match`/`start`/`continue`/`finish` must give the same
 * answer for the same input every time and must return "no match" on a
 * partial tail instead of guessing. The parser hardens against extensions
 * that throw, do not advance or overrun (treated as no match, dev-warned) so
 * "never throws" holds for the whole parse.
 */

import type { BlockContent, Node, Parent, PhrasingContent, Position } from '../ast/index.js';
import type { NodeSpec } from '../schema/index.js';

// ---------------------------------------------------------------------------
// Block syntax extensions
// ---------------------------------------------------------------------------

/** One source line as the block parser sees it, after the open containers' prefixes were consumed. */
export interface LineInfo {
    /** The remaining text of the line (no trailing newline). */
    text: string;
    /** Indentation in columns of the first non-space character of `text`. */
    indent: number;
    /** Absolute offset of `text[0]` in the normalised source. */
    offset: number;
    /** 1-based line number. */
    line: number;
    /** `true` when `text` is empty or whitespace only. */
    blank: boolean;
}

export interface BlockStartContext {
    /** Whether a paragraph is open at this level (only `interruptsParagraph` extensions may start then). */
    paragraphOpen: boolean;
}

/** Per-block scratch state an extension carries between `start`, `continue` and `finish`. */
export interface BlockState<M = unknown> {
    /** The lines consumed so far (the first entry is the `start` line unless `start` consumed nothing). */
    lines: LineInfo[];
    /** Whatever `start` returned as `meta`. */
    meta: M;
}

export interface BlockFinishContext {
    /** `true` when the block was closed by the end of the input (streaming: the block may still grow). */
    open: boolean;
    /** Parse a text run as inline content. `offset` is the absolute offset of `text[0]` (for positions). */
    parseInline(text: string, offset?: number): PhrasingContent[];
    /** Parse lines as nested block content (for container-like extensions). */
    parseBlocks(lines: readonly LineInfo[]): BlockContent[];
    /** The block's own position (start of the first line to end of the last). */
    position: Position;
}

export type BlockContinue = 'continue' | 'close' | 'consume-and-close';

export interface BlockSyntaxExtension<N extends Node = BlockContent, M = unknown> {
    /** Stable name; duplicates across plugins warn in dev. */
    name: string;
    /** Characters that can begin the block (the first non-space char). Gates `start`. */
    triggerChars: readonly string[];
    /** May this block start on a line that would otherwise continue a paragraph? Default `false`. */
    interruptsParagraph?: boolean;
    /**
     * Try to open the block on `line`. Return `null` when it does not start
     * here. `consumed: false` (default `true`) leaves the line for the block's
     * own `continue`/body handling instead of recording it as the first line.
     */
    start(line: LineInfo, ctx: BlockStartContext): { meta?: M; consumed?: boolean } | null;
    /**
     * Called for every following line. `'continue'` consumes it, `'close'`
     * ends the block BEFORE this line (the line is reprocessed), and
     * `'consume-and-close'` consumes it and ends the block.
     */
    continue(line: LineInfo, state: BlockState<M>): BlockContinue;
    /** Build the node. Must tolerate `ctx.open === true` (a half block at the end of the input). */
    finish(state: BlockState<M>, ctx: BlockFinishContext): N;
}

// ---------------------------------------------------------------------------
// Inline syntax extensions
// ---------------------------------------------------------------------------

export interface InlineMatchContext {
    /** Parse nested inline content (e.g. a label). */
    parseInline(text: string): PhrasingContent[];
    /** Build a position for the content range `[start, end)` of the current text run. */
    position(start: number, end: number): Position | undefined;
}

export interface InlineSyntaxExtension<N extends Node = PhrasingContent> {
    /** Stable name; duplicates across plugins warn in dev. */
    name: string;
    /** Characters that can begin the construct. Gates `match`. Must be non-empty. */
    triggerChars: readonly string[];
    /**
     * Try to match anchored at `pos` (`text[pos]` is one of `triggerChars`).
     * Return the node and the exclusive end index, or `null` — including on a
     * partial tail (streaming-safe). Must be pure.
     */
    match(text: string, pos: number, ctx: InlineMatchContext): { node: N; end: number } | null;
}

// ---------------------------------------------------------------------------
// Serializer rules
// ---------------------------------------------------------------------------

export interface SerializeContext {
    /** Serialize a parent's children (inline for phrasing parents, blocks joined by blank lines otherwise). */
    serializeChildren(node: Parent): string;
    /** Escape a text run so it round-trips as literal text. */
    escapeText(text: string, atLineStart?: boolean): string;
    /** Serialize any node with the current options and rules. */
    serialize(node: Node): string;
    /** Indentation prefix for continuation lines of the current block. */
    indent: string;
    /** The options `toMarkdown` was called with. */
    options: Readonly<Record<string, unknown>>;
}

export type SerializeRule<N extends Node = Node> = (node: N, ctx: SerializeContext) => string;

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export interface BlockTransformContext {
    parseInline(text: string, offset?: number): PhrasingContent[];
}

// ---------------------------------------------------------------------------
// Components (per platform, augmented by `./dom` and the Lynx package)
// ---------------------------------------------------------------------------

/**
 * Platform component maps a plugin may ship renderers for. Empty here; the
 * DOM entry augments it with `dom`, `@sigx/lynx-markdown` with `lynx`, a
 * terminal renderer with `terminal`. A plugin carrying both `dom` and `lynx`
 * renderers only bundles the one the app imports.
 */
// oxlint-disable-next-line no-empty-interface
export interface MarkdownPlatformComponents {}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

export interface MarkdownPlugin {
    /** Unique plugin name; a duplicate is dropped with a dev warning. */
    name: string;
    /** Node types this plugin adds to the vocabulary (their role, editing and flat-model mapping). */
    nodes?: readonly NodeSpec[];
    /** Block-level syntax. Tried before the built-in block starts. */
    // oxlint-disable-next-line no-explicit-any
    block?: readonly BlockSyntaxExtension<any, any>[];
    /** Inline syntax. Tried after backslash escapes, before the built-in inline scanners. */
    // oxlint-disable-next-line no-explicit-any
    inline?: readonly InlineSyntaxExtension<any>[];
    /** Serializer rules keyed by node type. Also the render fallback source for a node without a component. */
    // oxlint-disable-next-line no-explicit-any
    serialize?: Readonly<Record<string, SerializeRule<any>>>;
    /**
     * Rewrite a top-level block once it is parsed (a finalized block is
     * transformed once, ever). Return a replacement or nothing. Must be pure.
     */
    transformBlock?: (node: BlockContent, ctx: BlockTransformContext) => BlockContent | void;
    /**
     * Document-wide transform. Honoured by `parseMarkdown` only; the
     * incremental engine cannot run it (it would break block reuse) and warns
     * in dev.
     */
    transformDocument?: (root: import('../ast/index.js').Root) => void;
    /** Extra named character references, `name → replacement`. */
    entities?: Readonly<Record<string, string>>;
    /** Renderers per platform (see `MarkdownPlatformComponents`). */
    components?: Partial<MarkdownPlatformComponents>;
    /** Editor contributions; typed and consumed by `@sigx/markdown/editor`. */
    editor?: unknown;
}
