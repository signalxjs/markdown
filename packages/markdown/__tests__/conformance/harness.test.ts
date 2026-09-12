/**
 * The rest of the `testing` entry: `strip()` / `stripPositions()` and the
 * streaming harness `feed()` / `seededChunks()`.
 */

import { describe, expect, it } from 'vitest';
import type { Code, Link, Paragraph, Root, Text } from '../../src/ast/index.js';
import { feed, seededChunks, strip, stripPositions } from '../../src/testing/index.js';

const pos = (offset: number) => ({
    start: { line: 1, column: offset + 1, offset },
    end: { line: 1, column: offset + 2, offset: offset + 1 },
});

describe('strip', () => {
    it('removes keys, positions, open flags and data.autolink, deeply', () => {
        const link: Link = {
            type: 'link',
            url: 'https://x.com',
            data: { autolink: true },
            position: pos(0),
            children: [{ type: 'text', value: 'x', position: pos(0) }],
        };
        const code: Code = { type: 'code', key: 'b-1', value: 'x', open: true, position: pos(0) };
        const tree: Root = {
            type: 'root',
            position: pos(0),
            children: [{ type: 'paragraph', key: 'b-0', position: pos(0), children: [link] }, code],
        };
        expect(strip(tree)).toEqual({
            type: 'root',
            children: [
                { type: 'paragraph', children: [{ type: 'link', url: 'https://x.com', children: [{ type: 'text', value: 'x' }] }] },
                { type: 'code', value: 'x' },
            ],
        });
    });

    it('keeps other data fields', () => {
        const link: Link = { type: 'link', url: '/u', data: { autolink: true, hName: 'a' }, children: [] };
        expect(strip(link)).toEqual({ type: 'link', url: '/u', data: { hName: 'a' }, children: [] });
    });

    it('merges adjacent text siblings and drops empty texts', () => {
        const para: Paragraph = {
            type: 'paragraph',
            children: [
                { type: 'text', value: 'a' },
                { type: 'text', value: '' },
                { type: 'text', value: 'b' },
                { type: 'emphasis', children: [{ type: 'text', value: 'c' }, { type: 'text', value: 'd' }] },
                { type: 'text', value: '' },
                { type: 'text', value: 'e' },
            ],
        };
        expect(strip(para)).toEqual({
            type: 'paragraph',
            children: [
                { type: 'text', value: 'ab' },
                { type: 'emphasis', children: [{ type: 'text', value: 'cd' }] },
                { type: 'text', value: 'e' },
            ],
        });
    });

    it('does not mutate the input', () => {
        const text: Text = { type: 'text', value: 'a', position: pos(0) };
        const para: Paragraph = { type: 'paragraph', key: 'b-0', children: [text, { type: 'text', value: 'b' }] };
        const before = JSON.stringify(para);
        strip(para);
        expect(JSON.stringify(para)).toBe(before);
        expect(para.children[0]).toBe(text);
    });

    it('copies array fields', () => {
        const align: ('left' | null)[] = ['left', null];
        const out = strip({ type: 'table', align, children: [] } as unknown as Root) as unknown as { align: unknown[] };
        expect(out.align).toEqual(align);
        expect(out.align).not.toBe(align);
    });
});

describe('stripPositions', () => {
    it('removes positions only', () => {
        const code: Code = { type: 'code', key: 'b-1', value: 'x', open: true, position: pos(0) };
        const link: Link = { type: 'link', url: '/u', data: { autolink: true }, position: pos(0), children: [] };
        const tree: Root = { type: 'root', position: pos(0), children: [{ type: 'paragraph', children: [link] }, code] };
        expect(stripPositions(tree)).toEqual({
            type: 'root',
            children: [
                { type: 'paragraph', children: [{ type: 'link', url: '/u', data: { autolink: true }, children: [] }] },
                { type: 'code', key: 'b-1', value: 'x', open: true },
            ],
        });
    });

    it('keeps adjacent texts separate', () => {
        const para: Paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'a' }, { type: 'text', value: 'b' }] };
        expect(stripPositions(para).children).toHaveLength(2);
    });
});

describe('feed', () => {
    const engine = {
        calls: [] as string[],
        parse(source: string): Root {
            this.calls.push(source);
            return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: source }] }] };
        },
    };

    it('feeds growing prefixes in fixed chunks and returns every tree', () => {
        engine.calls = [];
        const results = feed(engine, 'abcdefg', 3);
        expect(engine.calls).toEqual(['abc', 'abcdef', 'abcdefg']);
        expect(results).toHaveLength(3);
        expect((results[2].children[0] as Paragraph).children[0]).toEqual({ type: 'text', value: 'abcdefg' });
    });

    it('takes chunk sizes from a function of the step index', () => {
        engine.calls = [];
        const steps: number[] = [];
        feed(engine, 'abcdefghij', (i) => {
            steps.push(i);
            return i + 1;
        });
        expect(steps).toEqual([0, 1, 2, 3]);
        expect(engine.calls).toEqual(['a', 'abc', 'abcdef', 'abcdefghij']);
    });

    it('treats sizes below one or not finite as one', () => {
        engine.calls = [];
        feed(engine, 'abc', 0);
        expect(engine.calls).toEqual(['a', 'ab', 'abc']);
        engine.calls = [];
        feed(engine, 'ab', () => Number.NaN);
        expect(engine.calls).toEqual(['a', 'ab']);
    });

    it('parses an empty source once', () => {
        engine.calls = [];
        expect(feed(engine, '', 4)).toHaveLength(1);
        expect(engine.calls).toEqual(['']);
    });
});

describe('seededChunks', () => {
    it('is deterministic for a seed and pure in the step index', () => {
        const a = seededChunks(42, 1, 5);
        const b = seededChunks(42, 1, 5);
        const first = Array.from({ length: 20 }, (_, i) => a(i));
        const second = Array.from({ length: 20 }, (_, i) => b(i));
        expect(first).toEqual(second);
        expect(a(7)).toBe(first[7]);
        expect(a(3)).toBe(first[3]);
        expect(b(19)).toBe(first[19]);
    });

    it('stays within [min, max] and uses the whole range', () => {
        const next = seededChunks(7, 2, 4);
        const seen = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const n = next(i);
            expect(n).toBeGreaterThanOrEqual(2);
            expect(n).toBeLessThanOrEqual(4);
            seen.add(n);
        }
        expect([...seen].sort()).toEqual([2, 3, 4]);
    });

    it('differs between seeds', () => {
        const a = seededChunks(1, 1, 100);
        const b = seededChunks(2, 1, 100);
        expect(Array.from({ length: 10 }, (_, i) => a(i))).not.toEqual(Array.from({ length: 10 }, (_, i) => b(i)));
    });

    it('tolerates a swapped or degenerate range', () => {
        const swapped = seededChunks(3, 5, 1);
        for (let i = 0; i < 20; i++) {
            expect(swapped(i)).toBeGreaterThanOrEqual(1);
            expect(swapped(i)).toBeLessThanOrEqual(5);
        }
        const fixed = seededChunks(3, 4, 4);
        expect(fixed(0)).toBe(4);
        expect(fixed(9)).toBe(4);
    });

    it('drives feed reproducibly', () => {
        const engine = { parse: (source: string): Root => ({ type: 'root', children: [{ type: 'html', value: source }] }) };
        const source = 'x'.repeat(50);
        const first = feed(engine, source, seededChunks(9, 1, 8)).map((r) => (r.children[0] as Code).value.length);
        const second = feed(engine, source, seededChunks(9, 1, 8)).map((r) => (r.children[0] as Code).value.length);
        expect(first).toEqual(second);
        expect(first[first.length - 1]).toBe(50);
    });
});
