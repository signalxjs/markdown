import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/parser/index.js';
import { toMarkdown } from '../../src/serializer/index.js';
import { createState, normalizeDoc } from '../../src/editor/state.js';
import type { Root } from '../../src/ast/index.js';

describe('normalizeDoc', () => {
    it('gives an empty root, an empty list item and an empty blockquote a paragraph for the caret', () => {
        const doc: Root = {
            type: 'root',
            children: [
                { type: 'list', ordered: false, spread: false, children: [{ type: 'listItem', spread: false, children: [] }] },
                { type: 'blockquote', children: [] },
            ],
        };
        expect(normalizeDoc(doc)).toBe(doc);
        expect(doc.children[0]).toMatchObject({ children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [] }] }] });
        expect(doc.children[1]).toMatchObject({ children: [{ type: 'paragraph', children: [] }] });
        expect(normalizeDoc({ type: 'root', children: [] }).children).toEqual([expect.objectContaining({ type: 'paragraph', children: [] })]);
    });

    it('leaves a list item or blockquote that has content but no paragraph alone: the caret enters its first editable descendant', () => {
        // Inserting a paragraph here would rewrite the document on load (`- - a` → `-\n  - a`).
        for (const md of ['- - a', '- ```\n  x\n  ```', '> ```js\n> x\n> ```', '> - a']) {
            const state = createState(parseMarkdown(md), null);
            expect(toMarkdown(state.doc)).toBe(`${md}\n`);
            expect(state.index().editable()).toHaveLength(1);
        }
    });

    it('assigns keys to every block when any is missing and keeps them when all are present', () => {
        const doc = normalizeDoc({ type: 'root', children: [{ type: 'paragraph', children: [] }, { type: 'blockquote', children: [{ type: 'paragraph', children: [] }] }] });
        expect(doc.children.map((c) => c.key)).toEqual(['b-0', 'b-1']);
        expect((doc.children[1] as { children: { key?: string }[] }).children[0].key).toBe('b-1.0');
        const keyed = normalizeDoc({ type: 'root', children: [{ type: 'paragraph', key: 'custom', children: [] }] });
        expect(keyed.children[0].key).toBe('custom');
    });
});
