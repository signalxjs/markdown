/**
 * `plainTextFormat` — the smallest format: blank-line-separated paragraphs,
 * a newline inside a paragraph is a hard break. What an editor falls back to
 * for `text/plain` when no other format claims it.
 */

import type { Paragraph, PhrasingContent, Root, RootContent } from '../ast/index.js';
import { phrasingToText } from '../schema/index.js';
import type { DocumentFormat } from './format.js';
import { createReparseEngine } from './incremental.js';

function paragraphOf(text: string): Paragraph {
    const children: PhrasingContent[] = [];
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        if (line) children.push({ type: 'text', value: line });
        if (i < lines.length - 1) children.push({ type: 'break' });
    });
    return { type: 'paragraph', children };
}

export function parsePlainText(source: string): Root {
    const norm = (source ?? '').replace(/\r\n?/g, '\n');
    const children: Paragraph[] = [];
    for (const chunk of norm.split(/\n[ \t]*\n+/)) {
        if (chunk.trim() === '') continue;
        children.push(paragraphOf(chunk));
    }
    children.forEach((p, i) => {
        p.key = `b-${i}`;
    });
    return { type: 'root', children };
}

export function serializePlainText(node: Root | RootContent): string {
    if (node.type === 'root') return node.children.map(serializePlainText).join('\n\n');
    if ('value' in node && typeof node.value === 'string') return node.value;
    const children = (node as { children?: RootContent[] }).children;
    if (!children) return '';
    const phrasing = children.every((c) => !('children' in c) || c.type === 'link' || c.type === 'strong' || c.type === 'emphasis' || c.type === 'delete' || c.type === 'linkReference');
    return phrasing ? phrasingToText(children as PhrasingContent[]) : children.map(serializePlainText).join('\n\n');
}

export const plainTextFormat: DocumentFormat = {
    id: 'text',
    mime: ['text/plain'],
    parse: (source) => parsePlainText(source),
    serialize: (node) => serializePlainText(node),
    createIncrementalEngine: () => createReparseEngine(parsePlainText),
};
