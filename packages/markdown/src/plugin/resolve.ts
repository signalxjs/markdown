/**
 * Resolve a plugin list's markdown slots into the lookup tables the markdown
 * parser and serializer consume. Done once per parser/engine/view instance;
 * the result is immutable so a caller mutating its plugin array afterwards
 * cannot change parse behaviour under cached finalized blocks.
 */

import type { BlockSyntaxExtension, InlineSyntaxExtension, MarkdownPluginSlice, SerializeRule } from './markdown.js';
import type { RichTextPlugin } from './types.js';

export interface ResolvedMarkdownPlugins {
    /** The plugins that were kept, in order. */
    readonly plugins: readonly RichTextPlugin[];
    /** Block extensions in registration order. */
    // oxlint-disable-next-line no-explicit-any
    readonly block: readonly BlockSyntaxExtension<any, any>[];
    /** Inline extensions in registration order. */
    // oxlint-disable-next-line no-explicit-any
    readonly inline: readonly InlineSyntaxExtension<any>[];
    /** Union of block trigger chars. */
    readonly blockTriggers: ReadonlySet<string>;
    /** Union of inline trigger chars. */
    readonly inlineTriggers: ReadonlySet<string>;
    /** Serializer rules by node type (last registered wins). */
    // oxlint-disable-next-line no-explicit-any
    readonly serialize: ReadonlyMap<string, SerializeRule<any>>;
    /** Extra named entities (last registered wins). */
    readonly entities: ReadonlyMap<string, string>;
    /** Block transforms in registration order. */
    readonly transformBlock: readonly NonNullable<MarkdownPluginSlice['transformBlock']>[];
    /** Document transforms in registration order. */
    readonly transformDocument: readonly NonNullable<MarkdownPluginSlice['transformDocument']>[];
}

const EMPTY: ResolvedMarkdownPlugins = Object.freeze({
    plugins: Object.freeze([]),
    block: Object.freeze([]),
    inline: Object.freeze([]),
    blockTriggers: new Set<string>(),
    inlineTriggers: new Set<string>(),
    serialize: new Map(),
    entities: new Map(),
    transformBlock: Object.freeze([]),
    transformDocument: Object.freeze([]),
}) as ResolvedMarkdownPlugins;

/** Resolve (and validate) the markdown slots of a plugin list. `undefined`/empty yields a shared empty result. */
export function resolveMarkdownPlugins(plugins?: readonly RichTextPlugin[] | null): ResolvedMarkdownPlugins {
    if (!plugins || plugins.length === 0) return EMPTY;

    const kept: RichTextPlugin[] = [];
    const names = new Set<string>();
    // oxlint-disable-next-line no-explicit-any
    const block: BlockSyntaxExtension<any, any>[] = [];
    // oxlint-disable-next-line no-explicit-any
    const inline: InlineSyntaxExtension<any>[] = [];
    const blockTriggers = new Set<string>();
    const inlineTriggers = new Set<string>();
    // oxlint-disable-next-line no-explicit-any
    const serialize = new Map<string, SerializeRule<any>>();
    const entities = new Map<string, string>();
    const transformBlock: NonNullable<MarkdownPluginSlice['transformBlock']>[] = [];
    const transformDocument: NonNullable<MarkdownPluginSlice['transformDocument']>[] = [];
    const extNames = new Set<string>();

    for (const plugin of plugins) {
        if (!plugin || typeof plugin.name !== 'string' || plugin.name === '') {
            if (__DEV__) console.warn('[@sigx/markdown] Ignoring a plugin without a name.');
            continue;
        }
        if (names.has(plugin.name)) {
            if (__DEV__) console.warn(`[@sigx/markdown] Duplicate plugin "${plugin.name}" ignored.`);
            continue;
        }
        names.add(plugin.name);
        kept.push(plugin);

        const slice = plugin.formats?.markdown;
        if (!slice) continue;
        for (const ext of slice.block ?? []) {
            if (!validExtension(ext, plugin.name, extNames)) continue;
            block.push(ext);
            for (const ch of ext.triggerChars) blockTriggers.add(ch);
        }
        for (const ext of slice.inline ?? []) {
            if (!validExtension(ext, plugin.name, extNames)) continue;
            inline.push(ext);
            for (const ch of ext.triggerChars) inlineTriggers.add(ch);
        }
        if (slice.serialize) {
            for (const [type, rule] of Object.entries(slice.serialize)) serialize.set(type, rule);
        }
        if (slice.entities) {
            for (const [name, value] of Object.entries(slice.entities)) entities.set(name, value);
        }
        if (slice.transformBlock) transformBlock.push(slice.transformBlock);
        if (slice.transformDocument) transformDocument.push(slice.transformDocument);
    }

    return Object.freeze({
        plugins: Object.freeze(kept),
        block: Object.freeze(block),
        inline: Object.freeze(inline),
        blockTriggers,
        inlineTriggers,
        serialize,
        entities,
        transformBlock: Object.freeze(transformBlock),
        transformDocument: Object.freeze(transformDocument),
    });
}

function validExtension(
    ext: { name?: unknown; triggerChars?: unknown },
    pluginName: string,
    seen: Set<string>,
): boolean {
    if (typeof ext.name !== 'string' || ext.name === '') {
        if (__DEV__) console.warn(`[@sigx/markdown] Plugin "${pluginName}" registers an extension without a name; ignored.`);
        return false;
    }
    const chars = ext.triggerChars;
    if (!Array.isArray(chars) || chars.length === 0 || chars.some((c) => typeof c !== 'string' || c.length !== 1)) {
        if (__DEV__) {
            console.warn(
                `[@sigx/markdown] Extension "${ext.name}" (plugin "${pluginName}") needs a non-empty triggerChars list of single characters; ignored.`,
            );
        }
        return false;
    }
    if (seen.has(ext.name)) {
        if (__DEV__) console.warn(`[@sigx/markdown] Duplicate extension name "${ext.name}" (plugin "${pluginName}"); ignored.`);
        return false;
    }
    seen.add(ext.name);
    return true;
}

/** The shared empty resolution, for callers that want to test for "no plugins". */
export const NO_MARKDOWN_PLUGINS: ResolvedMarkdownPlugins = EMPTY;
