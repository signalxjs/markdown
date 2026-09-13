/**
 * The node specs markdown needs beyond the standard vocabulary: raw HTML
 * blocks and CommonMark's reference definitions. Their types are part of the
 * AST (so trees stay mdast-assignable); their specs are registered by the
 * markdown side, not implied by the core.
 */

import type { ImageReference, LinkReference, Literal, Parent, PhrasingContent } from '../ast/index.js';
import { createSchema, inlineAttrsOf, phrasingText, type NodeSpec, type Schema } from './spec.js';
import { phrasingToText, standardNodes } from './standard.js';

type ReferenceType = 'shortcut' | 'collapsed' | 'full';

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
    },
    { type: 'definition', role: 'void' },
    {
        type: 'linkReference',
        role: 'atom',
        inline: {
            // The label text rides along as `text` so the atom rebuilds its children.
            toFlat: (node) => ({ ...inlineAttrsOf(node), text: phrasingText(((node as Parent).children as PhrasingContent[])) }),
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
    },
];

/** The standard vocabulary plus the markdown specs — what a markdown document is edited with. */
export const markdownSchema: Schema = createSchema([...standardNodes, ...markdownNodes]);
