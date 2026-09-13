import { describe, expect, it } from 'vitest';
import { createIncrementalEngine, parseMarkdown } from '../../src/parser/index.js';
import type { InlineSyntaxExtension, RichTextPlugin } from '../../src/plugin/index.js';
import type { Code, List, Paragraph, PhrasingContent } from '../../src/ast/index.js';

describe('incremental engine', () => {
    it('reuses finalized blocks by reference across chunks', () => {
        const e = createIncrementalEngine();
        const full = '# A\n\nparagraph one\n\nmore text';
        const r2 = e.parse(full);
        const r3 = e.parse(full + ' even more');
        expect(r3.children[0]).toBe(r2.children[0]);
        expect(r3.children[1]).toBe(r2.children[1]);
        expect(r3.children[2].type).toBe('paragraph');
        expect(e.inspect()).toEqual({ cut: 20, finalized: 2 });
    });

    it('keeps the trailing block key stable when it finalizes (no remount)', () => {
        const e = createIncrementalEngine();
        const r1 = e.parse('a\n\nb');
        expect(r1.children[1].key).toBe('b-1');
        const r2 = e.parse('a\n\nb\n\nc');
        expect(r2.children[1].key).toBe('b-1');
        expect((r2.children[1] as Paragraph).children[0]).toMatchObject({ value: 'b' });
        expect(r2.children[2].key).toBe('b-2');
    });

    it('keeps stable item keys as a streaming list grows', () => {
        const e = createIncrementalEngine();
        const a = e.parse('- a\n- b');
        const b = e.parse('- a\n- b\n- c');
        const itemsA = (a.children[0] as List).children;
        const itemsB = (b.children[0] as List).children;
        expect(itemsB).toHaveLength(3);
        expect(itemsA[0].key).toBe(itemsB[0].key);
        expect(itemsA[1].key).toBe(itemsB[1].key);
        expect(itemsB[2].key).toBe('b-0.2');
    });

    it('grows an open code block and drops `open` on the closing fence', () => {
        const e = createIncrementalEngine();
        const open = e.parse('```ts\nline1');
        expect(open.children[0]).toMatchObject({ type: 'code', open: true, value: 'line1' });
        const more = e.parse('```ts\nline1\nline2');
        expect(more.children[0]).toMatchObject({ open: true, value: 'line1\nline2' });
        expect(more.children[0].key).toBe(open.children[0].key);
        const done = e.parse('```ts\nline1\nline2\n```');
        expect(done.children[0]).toMatchObject({ value: 'line1\nline2' });
        expect((done.children[0] as Code).open).toBeUndefined();
    });

    it('feeds char-by-char: finalized blocks are referentially identical and equal a one-shot parse', () => {
        const e = createIncrementalEngine();
        const doc = '# Title\n\nSome **bold** text.\n\n- one\n- two\n\nDone.\n\n> quote\n> more\n\n| a |\n| - |\n| 1 |';
        let prev: ReturnType<typeof e.parse> | null = null;
        let prevFinalized = 0;
        for (let i = 1; i <= doc.length; i++) {
            const root = e.parse(doc.slice(0, i));
            const finalized = e.inspect().finalized;
            expect(finalized).toBeGreaterThanOrEqual(prevFinalized);
            if (prev) for (let k = 0; k < prevFinalized; k++) expect(root.children[k]).toBe(prev.children[k]);
            prev = root;
            prevFinalized = finalized;
            expect(JSON.parse(JSON.stringify(root.children))).toEqual(JSON.parse(JSON.stringify(parseMarkdown(doc.slice(0, i)).children)));
        }
        expect(e.parse(doc).children.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'paragraph', 'blockquote', 'table']);
        // Everything but the table (still open at EOF) is finalized by now.
        expect(e.inspect().finalized).toBe(5);
    });

    it('keeps a block open while the unterminated last line could still rejoin it', () => {
        const e = createIncrementalEngine();
        e.parse('Foo\n    ');
        expect(e.inspect().finalized).toBe(0);
        expect(e.parse('Foo\n    ba').children).toHaveLength(1);
        const e2 = createIncrementalEngine();
        e2.parse('aaa\n#');
        expect(e2.inspect().finalized).toBe(0);
        expect((e2.parse('aaa\n#x').children[0] as Paragraph).children[0]).toMatchObject({ value: 'aaa\n#x' });
        const e3 = createIncrementalEngine();
        e3.parse('1. a\n\n2');
        expect(e3.inspect().finalized).toBe(0);
        expect((e3.parse('1. a\n\n2.').children[0] as List).children).toHaveLength(2);
        const e4 = createIncrementalEngine();
        e4.parse('- a\n*');
        expect(e4.inspect().finalized).toBe(0); // `**` would be a lazy continuation of the item
        e4.parse('- a\n**\n');
        expect(e4.inspect().finalized).toBe(0);
        expect(e4.parse('- a\n**\n\nD').children).toHaveLength(2);
        expect(e4.inspect().finalized).toBe(0); // `D` is unterminated: conservative
        e4.parse('- a\n**\n\nD\n');
        expect(e4.inspect().finalized).toBe(1); // the closing line is complete
    });

    it('never mutates a finalized block when a definition arrives later', () => {
        const e = createIncrementalEngine();
        const r1 = e.parse('see [a][x]\n\nnext');
        const r2 = e.parse('see [a][x]\n\nnext\n\n[x]: /u');
        expect(r2.children[0]).toBe(r1.children[0]);
        expect(r2.children[2].type).toBe('definition');
    });

    it('full re-parses when the source is replaced, not appended', () => {
        const e = createIncrementalEngine();
        e.parse('# A\n\nbody');
        const replaced = e.parse('completely different');
        expect(replaced.children).toHaveLength(1);
        expect(replaced.children[0].type).toBe('paragraph');
        expect(replaced.children[0].key).toBe('b-0');
        expect(e.inspect()).toEqual({ cut: 0, finalized: 0 });
    });

    it('returns the cached prefix for a blank tail and carries a root position', () => {
        const e = createIncrementalEngine();
        const r1 = e.parse('a\n\nb\n\n');
        const r2 = e.parse('a\n\nb\n\n\n');
        expect(r2.children).toHaveLength(2);
        expect(r2.children[0]).toBe(r1.children[0]);
        expect(r2.position!.end.offset).toBe(7);
    });

    it('keeps positions absolute in the live tail', () => {
        const e = createIncrementalEngine();
        const src = 'one\n\ntwo\n\nthree';
        const root = e.parse(src);
        expect(root.children[2].position!.start).toEqual({ line: 5, column: 1, offset: 10 });
        expect(src.slice(root.children[2].position!.start.offset)).toBe('three');
    });
});

describe('incremental engine (plugins)', () => {
    const mention: InlineSyntaxExtension = {
        name: 'mention',
        triggerChars: ['@'],
        match(text, pos) {
            const m = /^@\[([^\]\n]+)\]\(([^)\n]+)\)/.exec(text.slice(pos));
            if (!m) return null;
            return { node: { type: 'mention', label: m[1], id: m[2] } as unknown as PhrasingContent, end: pos + m[0].length };
        },
    };
    const plugin: RichTextPlugin = { name: 'mention', formats: { markdown: { inline: [mention] } } };

    it('parses extensions in finalized and live blocks', () => {
        const e = createIncrementalEngine({ plugins: [plugin] });
        const root = e.parse('hi @[Andy](u1)\n\nstill typing @[Bea](u2)');
        expect((root.children[0] as Paragraph).children[1]).toMatchObject({ type: 'mention' });
        expect((root.children[1] as Paragraph).children[1]).toMatchObject({ type: 'mention', label: 'Bea', id: 'u2' });
    });

    it('keeps finalized blocks reference-equal across appends spanning an extension', () => {
        const e = createIncrementalEngine({ plugins: [plugin] });
        const r1 = e.parse('cc @[Andy](u1) done\n\nnext');
        const r2 = e.parse('cc @[Andy](u1) done\n\nnext block grows');
        expect(r2.children[0]).toBe(r1.children[0]);
    });

    it('degrades a streaming partial extension to text, then resolves it', () => {
        const e = createIncrementalEngine({ plugins: [plugin] });
        const full = 'ping @[Andy](u1) ok';
        for (let i = 1; i <= full.length; i++) expect(e.parse(full.slice(0, i)).children).toHaveLength(1);
        const final = e.parse(full);
        expect((final.children[0] as Paragraph).children).toMatchObject([
            { type: 'text', value: 'ping ' },
            { type: 'mention', label: 'Andy', id: 'u1' },
            { type: 'text', value: ' ok' },
        ]);
    });

    it('runs transformBlock once per finalized block', () => {
        let calls = 0;
        const p: RichTextPlugin = {
            name: 't',
            formats: {
                markdown: {
                    transformBlock: (node) => {
                        calls++;
                        return node;
                    },
                },
            },
        };
        const e = createIncrementalEngine({ plugins: [p] });
        e.parse('a\n\nb');
        e.parse('a\n\nb\n\nc');
        e.parse('a\n\nb\n\nc!');
        // a: once (finalized on call 1); b: live on call 1, finalized on call 2; c: live on 2 and 3.
        expect(calls).toBe(5);
    });
});
