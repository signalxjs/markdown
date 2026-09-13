/**
 * `<RichTextView>` — the web renderer.
 *
 * Owns one incremental engine per instance (the format's, when it offers
 * one), so a growing `value` (an AI token loop through `createTextStream`,
 * or `useChat`'s `part.text`) re-parses only the live tail and re-renders
 * only the block still being written: finalized blocks keep their identity
 * and their keys, and the DOM reconciler never remounts them.
 *
 * Rendering is generic and schema-driven: `format` decides how `value` is
 * parsed (this entry knows no format — pass `markdownFormat` from the root
 * entry), `components` overrides any slot of the
 * default DOM map (a design system passes its own), `plugins` add node types
 * (`nodes`), syntax (`formats`) and — through `components.dom` — their
 * renderers.
 *
 * @example
 * ```tsx
 * <RichTextView value={stream.value.value} format={markdownFormat} onLink={(url) => router.push(url)} />
 * ```
 */

import { computed } from '@sigx/reactivity';
import { component, mergeProps, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import type { Root } from '../ast/index.js';
import { createReparseEngine, type DocumentFormat, type IncrementalEngine } from '../document/index.js';
import type { RichTextPlugin } from '../plugin/index.js';
import { renderDocument, type RenderContext, type UrlKind } from '../render/index.js';
import { createSchema, standardNodes, type Schema } from '../schema/index.js';
import { createDomComponents, type DomComponents, type DomLinkHandler } from './components.js';
import { partAttrs } from './parts.js';

export type RichTextViewProps = Define.WithAttrs<
    /** Source text in `format`. Reactive: append to it and only the live block re-renders. */
    & Define.Prop<'value', string>
    /** A parsed tree instead of source (wins over `value`). Keys are assigned if missing. */
    & Define.Prop<'root', Root>
    /** The format `value` is written in (its `nodes` join the schema). A new identity re-creates the engine. */
    & Define.Prop<'format', DocumentFormat, true>
    /** Plugins. Pass a stable array: a new identity re-creates the engine and re-parses from scratch. */
    & Define.Prop<'plugins', readonly RichTextPlugin[]>
    /** The schema to render with. Default: the standard specs, the format's and every plugin's `nodes`. */
    & Define.Prop<'schema', Schema>
    /** Overrides for any slot of the default component map, plus plugin node renderers. */
    & Define.Prop<'components', Partial<DomComponents>>
    /** Link clicks are routed here (with `preventDefault`) instead of navigating. */
    & Define.Prop<'onLink', DomLinkHandler>
    /** `target` for external links when no `onLink` is given. */
    & Define.Prop<'linkTarget', '_blank' | '_self'>
    /** Replace the default URL allow-list (`http(s)`, `mailto`, `tel`, relative). */
    & Define.Prop<'sanitizeUrl', (url: string, kind: UrlKind) => string>
    /** Adds `<prefix>-<part>` classes next to the `data-part` attributes. */
    & Define.Prop<'classPrefix', string>
    /** Show the copy button on code blocks. Default `true`. */
    & Define.Prop<'copyButton', boolean>
>;

const OWN_PROPS = ['value', 'root', 'format', 'plugins', 'schema', 'components', 'onLink', 'linkTarget', 'sanitizeUrl', 'classPrefix', 'copyButton'] as const;

/** The DOM renderers plugins ship (`plugin.components.dom`), merged in registration order. */
export function pluginDomComponents(plugins: readonly RichTextPlugin[] | undefined): Partial<DomComponents> {
    const out: Partial<DomComponents> = {};
    for (const plugin of plugins ?? []) Object.assign(out, plugin.components?.dom as Partial<DomComponents> | undefined);
    return out;
}

/** The format's incremental engine, or a re-parse engine when it has none. */
export function engineFor(format: DocumentFormat, plugins: readonly RichTextPlugin[] | undefined): IncrementalEngine {
    return format.createIncrementalEngine?.({ plugins }) ?? createReparseEngine((source) => format.parse(source, { plugins }));
}

export const RichTextView = component<RichTextViewProps>(({ props }) => {
    // The engine captures its format and plugins at construction; recreate it
    // when either prop changes identity (rare — normally module constants).
    let lastFormat = props.format;
    let lastPlugins = props.plugins;
    let engine = engineFor(lastFormat, lastPlugins);
    const root = computed<Root>(() => {
        if (props.root) return props.root;
        const format = props.format;
        if (format !== lastFormat || props.plugins !== lastPlugins) {
            lastFormat = format;
            lastPlugins = props.plugins;
            engine = engineFor(format, lastPlugins);
        }
        return engine.parse(props.value ?? '');
    });

    const schema = computed<Schema>(
        () => props.schema ?? createSchema([...standardNodes, ...(props.format.nodes ?? []), ...(props.plugins ?? []).flatMap((p) => p.nodes ?? [])]),
    );
    const pluginComponents = computed(() => pluginDomComponents(props.plugins));

    const defaults = computed(() =>
        createDomComponents({ classPrefix: props.classPrefix, linkTarget: props.linkTarget, copyButton: props.copyButton }),
    );

    // Host attributes land on the root element (`id`, `style`, `aria-*`, …);
    // `class` composes with the part class instead of replacing it.
    const rootAttrs = mergeProps(
        () => {
            const rest: Record<string, unknown> = { ...props };
            for (const key of OWN_PROPS) delete rest[key];
            return rest;
        },
        () => partAttrs('root', props.classPrefix),
    );

    return () => {
        const components: DomComponents = { ...defaults.value, ...pluginComponents.value, ...props.components };
        if (!props.components?.root) {
            components.root = ({ children }) => <div {...rootAttrs}>{children}</div>;
        }
        const ctx: RenderContext<JSXElement> = {
            components,
            schema: schema.value,
            onLink: props.onLink as unknown as RenderContext<JSXElement>['onLink'],
            sanitizeUrl: props.sanitizeUrl,
        };
        return renderDocument(root.value, ctx);
    };
});
