import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/parser/index.js';
import { toMarkdown } from '../../src/serializer/index.js';
import { applyStep, invertStep, updateBlock } from '../../src/editor/steps.js';
import type { Step } from '../../src/editor/steps.js';
import { buildIndex } from '../../src/editor/state.js';
import type { List, Paragraph, Root } from '../../src/ast/index.js';

const doc = () => parseMarkdown('# Title\n\nHello **world**\n\n- a\n- b\n  - b1\n\n```ts\nx\n```');

describe('applyStep — structural sharing', () => {
    it('replaces inline text and shares every other block', () => {
        const root = doc();
        const plain = applyStep(root, { type: 'replaceInline', key: 'b-1', from: 6, to: 11, slice: { text: 'there', spans: [] } });
        expect(toMarkdown(plain.children[1])).toBe('Hello there\n'); // the inserted text carries only the slice's marks
        const next = applyStep(root, { type: 'replaceInline', key: 'b-1', from: 6, to: 11, slice: { text: 'there', spans: [{ start: 0, end: 5, type: 'strong' }] } });
        expect(toMarkdown(next.children[1])).toBe('Hello **there**\n');
        expect(next.children[0]).toBe(root.children[0]);
        expect(next.children[2]).toBe(root.children[2]);
        expect(next.children[3]).toBe(root.children[3]);
        expect(next).not.toBe(root);
        expect(root.children[1]).toBe(root.children[1]); // input untouched
        expect(toMarkdown(root.children[1])).toBe('Hello **world**\n');
    });

    it('updates a nested block and shares its siblings', () => {
        const root = doc();
        const next = applyStep(root, { type: 'setInline', key: 'b-2.1.1.0.0', flat: { text: 'B1', spans: [] } });
        const list = next.children[2] as List;
        const oldList = root.children[2] as List;
        expect(list.children[0]).toBe(oldList.children[0]);
        expect(list.children[1]).not.toBe(oldList.children[1]);
        expect(toMarkdown(list)).toBe('- a\n- b\n  - B1\n');
    });

    it('setValue and setAttrs', () => {
        const root = doc();
        const v = applyStep(root, { type: 'setValue', key: 'b-3', value: 'y' });
        expect((v.children[3] as { value: string }).value).toBe('y');
        const a = applyStep(root, { type: 'setAttrs', key: 'b-0', attrs: { depth: 3 } });
        expect((a.children[0] as { depth: number }).depth).toBe(3);
        const cleared = applyStep(root, { type: 'setAttrs', key: 'b-3', attrs: { lang: undefined } });
        expect('lang' in cleared.children[3]).toBe(false);
    });

    it('replaceBlock keeps the key and re-keys the new subtree', () => {
        const root = doc();
        const next = applyStep(root, { type: 'replaceBlock', key: 'b-1', node: { type: 'heading', depth: 2, children: [{ type: 'text', value: 'H' }] } });
        expect(next.children[1]).toMatchObject({ type: 'heading', key: 'b-1', depth: 2 });
    });

    it('insertBlock / removeBlock re-key the siblings', () => {
        const root = doc();
        const inserted = applyStep(root, { type: 'insertBlock', parentKey: null, index: 1, node: { type: 'thematicBreak' } });
        expect(inserted.children.map((c) => `${c.type}:${c.key}`)).toEqual(['heading:b-0', 'thematicBreak:b-1', 'paragraph:b-2', 'list:b-3', 'code:b-4']);
        const list = inserted.children[3] as List;
        expect(list.children[1].key).toBe('b-3.1');
        expect(list.children[1].children[1].key).toBe('b-3.1.1');
        const removed = applyStep(inserted, { type: 'removeBlock', parentKey: null, index: 1 });
        expect(removed.children.map((c) => c.key)).toEqual(['b-0', 'b-1', 'b-2', 'b-3']);
        const nested = applyStep(root, { type: 'insertBlock', parentKey: 'b-2', index: 0, node: { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'z' }] }] } });
        expect(toMarkdown(nested.children[2])).toBe('- z\n- a\n- b\n  - b1\n');
        expect((nested.children[2] as List).children.map((i) => i.key)).toEqual(['b-2.0', 'b-2.1', 'b-2.2']);
    });

    it('moveBlock within a parent and across parents', () => {
        const root = doc();
        const up = applyStep(root, { type: 'moveBlock', key: 'b-3', to: { parentKey: null, index: 0 } });
        expect(up.children.map((c) => c.type)).toEqual(['code', 'heading', 'paragraph', 'list']);
        const down = applyStep(root, { type: 'moveBlock', key: 'b-0', to: { parentKey: null, index: 4 } });
        expect(down.children.map((c) => c.type)).toEqual(['paragraph', 'list', 'code', 'heading']);
        const into = applyStep(root, { type: 'moveBlock', key: 'b-1', to: { parentKey: 'b-2.0', index: 1 } });
        expect(toMarkdown(into.children[1])).toBe('- a\n\n  Hello **world**\n- b\n  - b1\n');
        expect(() => applyStep(root, { type: 'moveBlock', key: 'b-2', to: { parentKey: 'b-2.0', index: 0 } })).toThrow(/into itself/);
    });

    it('rejects unknown keys and out-of-range ranges', () => {
        const root = doc();
        expect(() => applyStep(root, { type: 'setValue', key: 'nope', value: '' })).toThrow(/Unknown block key/);
        expect(() => applyStep(root, { type: 'replaceInline', key: 'b-1', from: 0, to: 99, slice: { text: '', spans: [] } })).toThrow(/outside/);
        expect(() => applyStep(root, { type: 'setInline', key: 'b-2', flat: { text: '', spans: [] } })).toThrow(/no inline content/);
    });

    it('updateBlock throws for an unknown key and keeps identity elsewhere', () => {
        const root = doc();
        expect(() => updateBlock(root, 'x', (n) => n)).toThrow();
        const same = updateBlock(root, 'b-1', (n) => n);
        expect(same.children[1]).toBe(root.children[1]);
    });
});

describe('invertStep', () => {
    const cases: Step[] = [
        { type: 'replaceInline', key: 'b-1', from: 0, to: 5, slice: { text: 'Bye', spans: [{ start: 0, end: 3, type: 'emphasis' }] } },
        { type: 'setInline', key: 'b-0', flat: { text: 'New', spans: [] } },
        { type: 'setValue', key: 'b-3', value: 'changed' },
        { type: 'setAttrs', key: 'b-2', attrs: { ordered: true, start: 3, spread: true } },
        { type: 'replaceBlock', key: 'b-1', node: { type: 'thematicBreak' } },
        { type: 'insertBlock', parentKey: null, index: 2, node: { type: 'paragraph', children: [{ type: 'text', value: 'ins' }] } },
        { type: 'removeBlock', parentKey: 'b-2', index: 0 },
        { type: 'moveBlock', key: 'b-3', to: { parentKey: null, index: 0 } },
        { type: 'moveBlock', key: 'b-1', to: { parentKey: 'b-2.1', index: 1 } },
        { type: 'replaceDoc', doc: { type: 'root', children: [] } },
    ];

    for (const step of cases) {
        it(`round-trips ${step.type}`, () => {
            const root = doc();
            const inverse = invertStep(root, step);
            const applied = applyStep(root, step);
            const back = applyStep(applied, inverse);
            expect(toMarkdown(back)).toBe(toMarkdown(root));
            expect(strip(back)).toEqual(strip(root));
        });
    }

    it('random step sequences undo in reverse order', () => {
        let seed = 7;
        const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const root = doc();
        let cur: Root = root;
        const inverses: Step[] = [];
        for (let i = 0; i < 40; i++) {
            const index = buildIndex(cur);
            const editable = index.editable().filter((k) => (index.get(k)!.node as { type: string }).type !== 'code');
            const key = editable[Math.floor(rnd() * editable.length)];
            const flat = (index.get(key)!.node as Paragraph).children;
            const len = flat.reduce((n, c) => n + ((c as { value?: string }).value?.length ?? 1), 0);
            const from = Math.floor(rnd() * (len + 1));
            const to = Math.min(len, from + Math.floor(rnd() * 3));
            const step: Step = rnd() < 0.7
                ? { type: 'replaceInline', key, from, to, slice: { text: rnd() < 0.5 ? 'x' : '', spans: [] } }
                : { type: 'insertBlock', parentKey: null, index: Math.floor(rnd() * (cur.children.length + 1)), node: { type: 'paragraph', children: [{ type: 'text', value: 'p' }] } };
            inverses.push(invertStep(cur, step));
            cur = applyStep(cur, step);
        }
        for (const inv of inverses.reverse()) cur = applyStep(cur, inv);
        expect(strip(cur)).toEqual(strip(root));
    });
});

function strip(root: Root): unknown {
    return JSON.parse(JSON.stringify(root, (k, v) => (k === 'position' || k === 'key' ? undefined : v)));
}
