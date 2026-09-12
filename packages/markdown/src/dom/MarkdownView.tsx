/**
 * `<MarkdownView>` — the web renderer.
 *
 * Owns one incremental engine per instance, so a growing `value` (an AI token
 * loop through `createMarkdownStream`, or `useChat`'s `part.text`) re-parses
 * only the live tail and re-renders only the block still being written:
 * finalized blocks keep their identity and their keys, and the DOM reconciler
 * never remounts them.
 *
 * Rendering is generic: `components` overrides any slot of the default DOM
 * map (a design system passes its own), and `plugins` add syntax, node types
 * and — through `components` — their renderers.
 *
 * @example
 * ```tsx
 * <MarkdownView value={stream.value.value} onLink={(url) => router.push(url)} />
 * ```
 */

import { computed } from '@sigx/reactivity';
import { component, mergeProps, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import type { Root } from '../ast/index.js';
import type { MarkdownPlugin } from '../plugin/index.js';
import { resolvePlugins } from '../plugin/index.js';
import { createIncrementalEngine } from '../parser/index.js';
import { renderDocument, type RenderContext, type UrlKind } from '../render/index.js';
import { createDomComponents, type DomLinkHandler, type DomMarkdownComponents } from './components.js';
import { partAttrs } from './parts.js';

export type MarkdownViewProps = Define.WithAttrs<
    /** Markdown source. Reactive: append to it and only the live block re-renders. */
    & Define.Prop<'value', string>
    /** A parsed tree instead of source (wins over `value`). Keys are assigned if missing. */
    & Define.Prop<'root', Root>
    /** Plugins. Pass a stable array: a new identity re-creates the engine and re-parses from scratch. */
    & Define.Prop<'plugins', readonly MarkdownPlugin[]>
    /** Overrides for any slot of the default component map, plus plugin node renderers. */
    & Define.Prop<'components', Partial<DomMarkdownComponents>>
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

const OWN_PROPS = ['value', 'root', 'plugins', 'components', 'onLink', 'linkTarget', 'sanitizeUrl', 'classPrefix', 'copyButton'] as const;

export const MarkdownView = component<MarkdownViewProps>(({ props }) => {
    // The engine captures its plugins at construction; recreate it when the
    // prop changes identity (rare — normally a module constant).
    let engine = createIncrementalEngine({ plugins: props.plugins });
    let lastPlugins = props.plugins;
    const root = computed<Root>(() => {
        if (props.root) return props.root;
        if (props.plugins !== lastPlugins) {
            lastPlugins = props.plugins;
            engine = createIncrementalEngine({ plugins: lastPlugins });
        }
        return engine.parse(props.value ?? '');
    });

    const resolved = computed(() => resolvePlugins(props.plugins));

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
        const base = defaults.value;
        const overrides = props.components;
        const components: DomMarkdownComponents = overrides ? { ...base, ...overrides } : { ...base };
        if (!overrides?.root) {
            components.root = ({ children }) => <div {...rootAttrs}>{children}</div>;
        }
        const ctx: RenderContext<JSXElement> = {
            components,
            plugins: resolved.value,
            onLink: props.onLink as unknown as RenderContext<JSXElement>['onLink'],
            sanitizeUrl: props.sanitizeUrl,
        };
        return renderDocument(root.value, ctx);
    };
});
