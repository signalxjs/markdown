/**
 * Resolve a plugin list's HTML slots into the lookup tables the parser and
 * serializer consume, plus the schema the vocabulary implies (the standard
 * specs and every plugin's `nodes`). Done once per parse / serialize call.
 */

import { createSchema, standardNodes, type NodeSpec, type RichTextPlugin, type Schema } from '@sigx/richtext';
import type { HtmlElementRule, HtmlPluginSlice, HtmlSerializeRule } from './plugin.js';

export interface ResolvedHtmlPlugins {
    readonly plugins: readonly RichTextPlugin[];
    /** Element rules by tag, in registration order. */
    readonly elements: ReadonlyMap<string, readonly HtmlElementRule[]>;
    /** Serializer rules by node type (last registered wins). */
    // oxlint-disable-next-line no-explicit-any
    readonly serialize: ReadonlyMap<string, HtmlSerializeRule<any>>;
    readonly schema: Schema;
}

let empty: ResolvedHtmlPlugins | undefined;

/** Resolve the HTML slots of a plugin list. `undefined`/empty yields a shared empty result. */
export function resolveHtmlPlugins(plugins?: readonly RichTextPlugin[] | null): ResolvedHtmlPlugins {
    if (!plugins || plugins.length === 0) {
        return (empty ??= { plugins: [], elements: new Map(), serialize: new Map(), schema: createSchema(standardNodes) });
    }
    const kept: RichTextPlugin[] = [];
    const names = new Set<string>();
    const elements = new Map<string, HtmlElementRule[]>();
    // oxlint-disable-next-line no-explicit-any
    const serialize = new Map<string, HtmlSerializeRule<any>>();
    const nodes: NodeSpec[] = [];
    for (const plugin of plugins) {
        if (names.has(plugin.name)) {
            if (__DEV__) console.warn(`[@sigx/richtext-html] Duplicate plugin "${plugin.name}" ignored.`);
            continue;
        }
        names.add(plugin.name);
        kept.push(plugin);
        nodes.push(...(plugin.nodes ?? []));
        const slice = (plugin.formats as { html?: HtmlPluginSlice } | undefined)?.html;
        if (!slice) continue;
        for (const [tag, rule] of Object.entries(slice.elements ?? {})) {
            const list = elements.get(tag.toLowerCase()) ?? [];
            list.push(rule);
            elements.set(tag.toLowerCase(), list);
        }
        for (const [type, rule] of Object.entries(slice.serialize ?? {})) serialize.set(type, rule);
    }
    return { plugins: kept, elements, serialize, schema: createSchema([...standardNodes, ...nodes]) };
}
