import { describe, expect, it, vi } from 'vitest';
import type { BlockContent, Root } from '../../src/ast/index.js';
import { createLineEngine, createReparseEngine, plainTextFormat, type LineBlockParser } from '../../src/document/index.js';
import { markdownFormat } from '@sigx/richtext-markdown';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { mentionPlugin } from '@sigx/richtext-markdown';
import { feed, strip } from '../../src/testing/index.js';

describe('createReparseEngine', () => {
    it('re-parses the whole source every time and reports nothing finalized', () => {
        const parse = vi.fn((src: string): Root => ({ type: 'root', children: src ? [{ type: 'paragraph', key: 'b-0', children: [{ type: 'text', value: src }] }] : [] }));
        const engine = createReparseEngine(parse);
        expect(engine.parse('a').children).toHaveLength(1);
        expect(engine.parse('ab').children[0]).toMatchObject({ children: [{ value: 'ab' }] });
        expect(parse).toHaveBeenCalledTimes(2);
        expect(engine.inspect()).toEqual({ cut: 0, finalized: 0 });
        engine.reset();
        expect(engine.parse(undefined as unknown as string).children).toEqual([]);
    });
});

describe('createLineEngine', () => {
    /** A toy line parser: one paragraph per line; the last line is open until a newline ends it. */
    const lineParser: LineBlockParser = {
        normalize: (src) => src.replace(/\r\n?/g, '\n'),
        parseBlocks: (tail, base) => {
            const lines = tail.split('\n');
            const children: BlockContent[] = [];
            let offset = base.offset;
            lines.forEach((line, i) => {
                const isLast = i === lines.length - 1;
                if (isLast && line === '') return;
                children.push({
                    type: 'paragraph',
                    key: `b-${base.index + children.length}`,
                    children: [{ type: 'text', value: line }],
                    position: { start: { line: base.line + i, column: 1, offset }, end: { line: base.line + i, column: line.length + 1, offset: offset + line.length } },
                });
                offset += line.length + 1;
            });
            const endsWithNewline = tail.endsWith('\n');
            return { children, end: { line: base.line + lines.length - 1, column: 1, offset: base.offset + tail.length }, openCount: children.length && !endsWithNewline ? 1 : 0 };
        },
    };

    it('keeps finalized blocks by reference, cuts at a line start and re-parses only the tail', () => {
        const engine = createLineEngine(lineParser);
        const a = engine.parse('one\ntw');
        expect(a.children.map((c) => (c as { children: { value: string }[] }).children[0].value)).toEqual(['one', 'tw']);
        expect(engine.inspect()).toEqual({ cut: 4, finalized: 1 });
        const b = engine.parse('one\ntwo\nthr');
        expect(b.children[0]).toBe(a.children[0]);
        expect(b.children[1]).not.toBe(a.children[1]);
        expect(b.children.map((c) => c.key)).toEqual(['b-0', 'b-1', 'b-2']);
        expect(engine.inspect()).toEqual({ cut: 8, finalized: 2 });
    });

    it('falls back to a full re-parse when the source is replaced rather than appended', () => {
        const engine = createLineEngine(lineParser);
        engine.parse('one\ntwo\n');
        expect(engine.inspect().finalized).toBe(2);
        const c = engine.parse('uno\n');
        expect(c.children).toHaveLength(1);
        expect(engine.inspect()).toEqual({ cut: 4, finalized: 1 });
    });

    it('applies transform once to every block, finalized or live', () => {
        const transform = vi.fn((b: BlockContent) => b);
        const engine = createLineEngine({ ...lineParser, transform });
        engine.parse('a\nb');
        engine.parse('a\nb\nc');
        // a finalized once; b live then finalized; c live
        expect(transform).toHaveBeenCalledTimes(4);
    });
});

describe('plainTextFormat', () => {
    it('parses blank-line paragraphs with hard breaks and serializes them back', () => {
        const root = plainTextFormat.parse('one\ntwo\r\n\r\n\nthree');
        expect(strip(root)).toEqual({
            type: 'root',
            children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'one' }, { type: 'break' }, { type: 'text', value: 'two' }] },
                { type: 'paragraph', children: [{ type: 'text', value: 'three' }] },
            ],
        });
        expect(root.children.map((c) => c.key)).toEqual(['b-0', 'b-1']);
        expect(plainTextFormat.serialize(root)).toBe('one\ntwo\n\nthree');
        expect(plainTextFormat.serialize(parseMarkdown('# T\n\n- **a** b\n\n```\nx\n```'))).toBe('T\n\na b\n\nx');
    });

    it('offers a re-parse engine and claims text/plain', () => {
        expect(plainTextFormat.id).toBe('text');
        expect(plainTextFormat.mime).toEqual(['text/plain']);
        const engine = plainTextFormat.createIncrementalEngine!();
        expect(engine.parse('a\n\nb').children).toHaveLength(2);
        expect(engine.inspect()).toEqual({ cut: 0, finalized: 0 });
    });
});

describe('markdownFormat', () => {
    it('is the markdown codec with its extra node specs and a streaming engine', () => {
        expect(markdownFormat.id).toBe('markdown');
        expect(markdownFormat.mime[0]).toBe('text/markdown');
        expect(markdownFormat.nodes?.map((n) => n.type)).toEqual(['html', 'definition', 'linkReference', 'imageReference']);
        const md = '# T\n\nhi @[Andy](u1)';
        const root = markdownFormat.parse(md, { plugins: [mentionPlugin] });
        expect(strip(root)).toEqual(strip(parseMarkdown(md, { plugins: [mentionPlugin] })));
        expect(markdownFormat.serialize(root, { plugins: [mentionPlugin], bullet: '*' })).toBe('# T\n\nhi @[Andy](u1)\n');
    });

    it('streams with finalized blocks stable across chunks', () => {
        const engine = markdownFormat.createIncrementalEngine!();
        const steps = feed(engine, '# A\n\npara\n\n- x\n- y\n', 5);
        const last = steps[steps.length - 1];
        expect(last.children.map((c) => c.type)).toEqual(['heading', 'paragraph', 'list']);
        // the list that ends the source may still grow: it stays live
        expect(engine.inspect().finalized).toBe(2);
        expect(steps[steps.length - 2].children[0]).toBe(last.children[0]);
    });
});
