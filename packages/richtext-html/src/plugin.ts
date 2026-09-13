/**
 * The HTML slice of a `RichTextPlugin` — how a plugin's nodes are read from
 * and written to HTML — merged into `PluginFormats.html`.
 *
 * Reading is by element: a rule is keyed by tag name and receives the
 * element with helpers to convert its children; it returns the node it
 * recognises (block or phrasing, told apart by the node's schema role) or
 * `null` to let the next rule — and finally the built-in table — have it.
 * Writing is by node type, as for markdown.
 */

import type { BlockContent, Node, PhrasingContent, UrlKind } from '@sigx/richtext';
import type { HtmlElement } from './tree.js';

export interface HtmlElementContext {
    /** The element's children as phrasing content (whitespace collapsed, marks normalised). */
    inlines(): PhrasingContent[];
    /** The element's children as blocks (stray phrasing wrapped in paragraphs). */
    blocks(): BlockContent[];
    /** The element's text content, verbatim. */
    text(): string;
    sanitizeUrl(url: string, kind: UrlKind): string;
}

/** Turn an element into a node, or `null` to fall through. */
export type HtmlElementRule = (el: HtmlElement, ctx: HtmlElementContext) => Node | null;

export interface HtmlSerializeContext {
    /** Serialize phrasing content. */
    inlines(nodes: readonly Node[]): string;
    /** Serialize blocks (each on its own line). */
    blocks(nodes: readonly Node[]): string;
    /** Escape text content. */
    escape(text: string): string;
    /** Escape an attribute value (for double-quoted attributes). */
    attr(value: string): string;
    sanitizeUrl(url: string, kind: UrlKind): string;
}

/** Write a node of the plugin's type as HTML. */
export type HtmlSerializeRule<N extends Node = Node> = (node: N, ctx: HtmlSerializeContext) => string;

export interface HtmlPluginSlice {
    /** Element rules by tag name, tried in registration order before the built-in table. */
    // oxlint-disable-next-line no-explicit-any
    elements?: Readonly<Record<string, HtmlElementRule>>;
    /** Serializer rules by node type. */
    // oxlint-disable-next-line no-explicit-any
    serialize?: Readonly<Record<string, HtmlSerializeRule<any>>>;
}

declare module '@sigx/richtext' {
    interface PluginFormats {
        html: HtmlPluginSlice;
    }
}
