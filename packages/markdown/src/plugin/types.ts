/**
 * The plugin contract — one object that contributes to the vocabulary, every
 * renderer, the editor and any number of formats at once.
 *
 * A plugin is format-agnostic: its node types (`nodes`), its renderers per
 * platform (`components`) and its editing behaviour (`editor`) describe the
 * tree; how its nodes are written in a given syntax lives under
 * `formats[<format id>]`, a slot each format types for itself
 * (`formats.markdown` is a `MarkdownPluginSlice`, see `./markdown.js`).
 */

import type { NodeSpec } from '../schema/index.js';

/** A platform component map as a plugin ships it: node type → render function (the platform types the props). */
// oxlint-disable-next-line no-explicit-any
export type PlatformComponentMap = { readonly [type: string]: ((props: any) => unknown) | undefined };

/**
 * Renderers a plugin ships per platform: `dom` for `@sigx/markdown/dom`
 * (merged into `<RichTextView>`'s component map), `lynx` for
 * `@sigx/lynx-markdown`, `terminal` for a terminal renderer. A plugin carrying
 * several only bundles the one the app imports.
 */
export interface PlatformComponents {
    dom?: PlatformComponentMap;
    lynx?: PlatformComponentMap;
    terminal?: PlatformComponentMap;
}

/**
 * Per-format syntax slots, keyed by `DocumentFormat.id`. Empty here; each
 * format merges its own typed slot in (`markdown: MarkdownPluginSlice`).
 */
// oxlint-disable-next-line no-empty-interface
export interface PluginFormats {}

export interface RichTextPlugin {
    /** Unique plugin name; a duplicate is dropped with a dev warning. */
    name: string;
    /** Node types this plugin adds to the vocabulary (their role, rendering props, editing and flat-model mapping). */
    nodes?: readonly NodeSpec[];
    /** Renderers per platform (see `PlatformComponents`). */
    components?: Partial<PlatformComponents>;
    /** Editor contributions; typed and consumed by `@sigx/markdown/editor`. */
    editor?: unknown;
    /** How this plugin's nodes are written in each format, keyed by format id. */
    formats?: Partial<PluginFormats>;
}
