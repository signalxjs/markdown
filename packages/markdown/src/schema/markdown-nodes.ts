/**
 * The node specs markdown needs beyond the standard vocabulary: raw HTML
 * blocks and CommonMark's reference definitions. Their types are part of the
 * AST (so trees stay mdast-assignable); their specs are registered by the
 * markdown side, not implied by the core — including how a reference
 * resolves against the definitions collected from the document, and the
 * literal source an unresolved one renders as.
 */

import type { Definition, ImageReference, LinkReference, Literal, Parent, PhrasingContent } from '../ast/index.js';
import { createSchema, inlineAttrsOf, phrasingText, type NodeSpec, type RenderEnv, type Schema } from './spec.js';
import { phrasingToText, standardNodes } from './standard.js';

type ReferenceType = 'shortcut' | 'collapsed' | 'full';

/** The env slot definitions are collected into (first definition per identifier wins, CommonMark). */
export interface DefinitionsEnv {
    definitions?: Map<string, Definition>;
}

function definitionsOf(env: RenderEnv): Map<string, Definition> | undefined {
    return (env as DefinitionsEnv).definitions;
}

/** The bracket suffix that follows a reference's label in the source. */
function referenceSuffix(node: LinkReference | ImageReference): string {
    switch (node.referenceType) {
        case 'full':
            return `[${node.label ?? node.identifier}]`;
        case 'collapsed':
            return '[]';
        default:
            return '';
    }
}

export const markdownNodes: readonly NodeSpec[] = [
    {
        type: 'html',
        role: 'code',
        splitsTo: 'paragraph',
        toInline: (node) => {
            const value = (node as Literal).value;
            return value ? [{ type: 'text', value }] : [];
        },
        fromInline: (children) => ({ type: 'html', value: phrasingToText(children) }),
        props: (node) => ({ value: (node as Literal).value }),
        text: (node) => (node as Literal).value,
        textOutput: true,
    },
    {
        type: 'definition',
        role: 'void',
        collect: (node, env) => {
            const def = node as Definition;
            const map = ((env as DefinitionsEnv).definitions ??= new Map());
            if (!map.has(def.identifier)) map.set(def.identifier, def);
        },
        // Renders nothing unless a `definition` component exists.
        render: (_node, api) => (api.component('definition') ? null : []),
        textOutput: true,
    },
    {
        type: 'linkReference',
        role: 'atom',
        inline: {
            // The label text rides along as `text` so the atom rebuilds its children.
            toFlat: (node) => ({ ...inlineAttrsOf(node), text: phrasingText((node as Parent).children as PhrasingContent[]) }),
            fromFlat: (span) => {
                const attrs = span.attrs ?? {};
                const node: LinkReference = {
                    type: 'linkReference',
                    identifier: attrs.identifier ?? '',
                    label: attrs.label ?? attrs.identifier ?? '',
                    referenceType: (attrs.referenceType as ReferenceType) ?? 'shortcut',
                    children: [{ type: 'text', value: attrs.text ?? attrs.label ?? '' }],
                };
                return node;
            },
        },
        /**
         * A resolved reference renders through the `link` component; an
         * unresolved one renders as the literal source — `[`, the rendered
         * children, `]…` — so the visible text matches what was written.
         */
        render: (node, api) => {
            const ref = node as LinkReference;
            const def = definitionsOf(api.env)?.get(ref.identifier);
            const children = api.renderInline(ref.children);
            const link = api.component('link');
            if (def && link) {
                const el = link({ node: ref, url: api.sanitizeUrl(def.url, 'link'), title: def.title ?? null, autolink: false, children, onLink: api.onLink });
                return el == null ? [] : [el];
            }
            return [api.text('['), ...children, api.text(`]${referenceSuffix(ref)}`)];
        },
    },
    {
        type: 'imageReference',
        role: 'atom',
        inline: {
            fromFlat: (span) => {
                const attrs = span.attrs ?? {};
                const node: ImageReference = {
                    type: 'imageReference',
                    identifier: attrs.identifier ?? '',
                    label: attrs.label ?? attrs.identifier ?? '',
                    referenceType: (attrs.referenceType as ReferenceType) ?? 'shortcut',
                    alt: attrs.alt ?? '',
                };
                return node;
            },
        },
        render: (node, api) => {
            const ref = node as ImageReference;
            const def = definitionsOf(api.env)?.get(ref.identifier);
            const alt = ref.alt ?? '';
            const image = api.component('image');
            if (def && image) {
                const el = image({ node: ref, url: api.sanitizeUrl(def.url, 'image'), alt, title: def.title ?? null, children: [] });
                return el == null ? [] : [el];
            }
            return [api.text(`![${alt}]${referenceSuffix(ref)}`)];
        },
        text: (node) => (node as ImageReference).alt ?? '',
    },
];

/** The standard vocabulary plus the markdown specs — what a markdown document is edited with. */
export const markdownSchema: Schema = createSchema([...standardNodes, ...markdownNodes]);
