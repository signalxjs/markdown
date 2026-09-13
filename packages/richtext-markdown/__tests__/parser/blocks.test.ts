import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/parser/index.js';
import { sliceSource } from '@sigx/richtext';
import type { BlockContent, Code, Heading, List, Paragraph, Table } from '@sigx/richtext';

const types = (blocks: BlockContent[]) => blocks.map((b) => b.type);
const parse = (src: string) => parseMarkdown(src).children;

describe('parseMarkdown (blocks)', () => {
    it('parses ATX headings with depth and stripped closing sequence', () => {
        const b = parse('# One\n\n### Three ###\n\n#5 not a heading\n\n#');
        expect(types(b)).toEqual(['heading', 'heading', 'paragraph', 'heading']);
        expect((b[0] as Heading).depth).toBe(1);
        expect((b[1] as Heading).depth).toBe(3);
        expect((b[1] as Heading).children).toEqual([{ type: 'text', value: 'Three', position: expect.anything() }]);
        expect((b[3] as Heading).children).toEqual([]);
    });

    it('parses setext headings', () => {
        const b = parse('Title\n=====\n\nSub\ntitle\n---');
        expect(types(b)).toEqual(['heading', 'heading']);
        expect((b[0] as Heading).depth).toBe(1);
        expect((b[1] as Heading).depth).toBe(2);
        expect((b[1] as Heading).children[0]).toMatchObject({ type: 'text', value: 'Sub\ntitle' });
    });

    it('parses a paragraph keeping soft breaks as newlines', () => {
        const b = parse('line one\n  line two');
        expect(b).toHaveLength(1);
        expect((b[0] as Paragraph).children[0]).toMatchObject({ type: 'text', value: 'line one\nline two' });
    });

    it('parses a fenced code block with lang, meta and inner blank lines', () => {
        const b = parse('```ts title="x"\na\n\nb\n```');
        expect(b).toHaveLength(1);
        expect(b[0]).toMatchObject({ type: 'code', lang: 'ts', meta: 'title="x"', value: 'a\n\nb' });
        expect((b[0] as Code).open).toBeUndefined();
    });

    it('keeps an unterminated fence open', () => {
        const b = parse('```\ncode');
        expect(b[0]).toMatchObject({ type: 'code', value: 'code', open: true });
    });

    it('parses an indented code block and drops trailing blank lines', () => {
        const b = parse('    a\n      b\n\n    c\n\n\nafter');
        expect(types(b)).toEqual(['code', 'paragraph']);
        expect(b[0]).toMatchObject({ type: 'code', lang: null, value: 'a\n  b\n\nc' });
    });

    it('does not start indented code inside a paragraph', () => {
        const b = parse('para\n    still para');
        expect(b).toHaveLength(1);
        expect(b[0].type).toBe('paragraph');
    });

    it('parses a blockquote with nested blocks and lazy continuation', () => {
        const b = parse('> # Q\n> body\ncontinued');
        expect(b[0].type).toBe('blockquote');
        const inner = (b[0] as { children: BlockContent[] }).children;
        expect(types(inner)).toEqual(['heading', 'paragraph']);
        expect((inner[1] as Paragraph).children[0]).toMatchObject({ value: 'body\ncontinued' });
    });

    it('supports nested blockquote laziness', () => {
        const b = parse('> > a\nb');
        const outer = b[0] as { children: BlockContent[] };
        const inner = outer.children[0] as { children: BlockContent[] };
        expect(inner.children[0]).toMatchObject({ type: 'paragraph' });
        expect((inner.children[0] as Paragraph).children[0]).toMatchObject({ value: 'a\nb' });
    });

    it('parses an unordered tight list', () => {
        const b = parse('- a\n- b');
        expect(b[0]).toMatchObject({ type: 'list', ordered: false, spread: false });
        expect((b[0] as List).children).toHaveLength(2);
        expect((b[0] as List).children[0].spread).toBe(false);
    });

    it('parses a loose list and an ordered start number', () => {
        const b = parse('3. a\n\n4. b');
        expect(b[0]).toMatchObject({ type: 'list', ordered: true, start: 3, spread: true });
    });

    it('parses nested lists by indentation', () => {
        const b = parse('- a\n  - b\n- c');
        const list = b[0] as List;
        expect(list.children).toHaveLength(2);
        expect(types(list.children[0].children)).toEqual(['paragraph', 'list']);
    });

    it('parses task list items', () => {
        const b = parse('- [ ] todo\n- [x] done\n- [ ]');
        const items = (b[0] as List).children;
        expect(items[0].checked).toBe(false);
        expect(items[1].checked).toBe(true);
        expect(items[1].children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: 'done' }] });
        expect(items[2].checked).toBeUndefined();
    });

    it('only lets an ordered list starting at 1 interrupt a paragraph', () => {
        expect(types(parse('para\n2. no'))).toEqual(['paragraph']);
        expect(types(parse('para\n1. yes'))).toEqual(['paragraph', 'list']);
        expect(types(parse('para\n- yes'))).toEqual(['paragraph', 'list']);
    });

    it('parses thematic breaks (and not as a list)', () => {
        expect(parse('* * *')[0].type).toBe('thematicBreak');
        expect(parse('---')[0].type).toBe('thematicBreak');
        expect(types(parse('- a\n---'))).toEqual(['list', 'thematicBreak']);
    });

    it('parses a GFM table with alignment and normalises row width', () => {
        const b = parse('| a | b | c |\n| :-- | :--: | --: |\n| 1 | 2 |\n| x | y | z | extra |');
        expect(b[0].type).toBe('table');
        const t = b[0] as Table;
        expect(t.align).toEqual(['left', 'center', 'right']);
        expect(t.children).toHaveLength(3);
        expect(t.children[1].children).toHaveLength(3);
        expect(t.children[1].children[2].children).toEqual([]);
        expect(t.children[2].children).toHaveLength(3);
    });

    it('ends a table at a blank line or another block', () => {
        const b = parse('| a |\n| - |\n| 1 |\n\n| 2 |');
        expect(types(b)).toEqual(['table', 'paragraph']);
        expect(types(parse('| a |\n| - |\n> q'))).toEqual(['table', 'blockquote']);
    });

    it('treats an incomplete table as a paragraph', () => {
        expect(parse('| a | b |')[0].type).toBe('paragraph');
        expect(parse('| a | b |\n| - |')[0].type).toBe('paragraph');
    });

    it('extracts link reference definitions from paragraphs', () => {
        const b = parse('[foo]: /url "t"\n[Bar]:\n  <x y>\nrest');
        expect(types(b)).toEqual(['definition', 'definition', 'paragraph']);
        expect(b[0]).toMatchObject({ type: 'definition', identifier: 'foo', label: 'foo', url: '/url', title: 't' });
        expect(b[1]).toMatchObject({ identifier: 'bar', label: 'Bar', url: 'x y', title: null });
        expect((b[2] as Paragraph).children[0]).toMatchObject({ value: 'rest' });
    });

    it('normalises identifiers after decoding character references, keeping backslash escapes', () => {
        const b = parse('[&amp; Foo]: /u\n\n[&amp;  foo] [& FOO] [foo\\\\]\n\n[foo\\\\]: /v');
        expect(b[0]).toMatchObject({ type: 'definition', identifier: '& foo' });
        const refs = (b[1] as Paragraph).children.filter((n) => n.type === 'linkReference');
        expect(refs.map((r) => (r as { identifier: string }).identifier)).toEqual(['& foo', '& foo', 'foo\\\\']);
        expect(b[2]).toMatchObject({ type: 'definition', identifier: 'foo\\\\' });
    });

    it('does not treat a definition under a setext underline as a heading', () => {
        const b = parse('[foo]: /url\n===');
        expect(types(b)).toEqual(['definition', 'paragraph']);
    });

    it('renders raw HTML as literal text (no HTML sink)', () => {
        const b = parse('<script>alert(1)</script>');
        expect(b[0].type).toBe('paragraph');
        expect((b[0] as Paragraph).children[0]).toMatchObject({ value: '<script>alert(1)</script>' });
    });

    it('handles tabs as 4-column stops', () => {
        const b = parse('\tcode\n\n-\tx');
        expect(b[0]).toMatchObject({ type: 'code', value: 'code' });
        expect(b[1]).toMatchObject({ type: 'list' });
    });

    it('handles empty input and input that is only blank lines', () => {
        expect(parseMarkdown('').children).toEqual([]);
        expect(parseMarkdown('\n\n  \n').children).toEqual([]);
    });

    it('does not throw on partial streaming input', () => {
        const partials = ['#', '# H', '# H\n\n- ', '# H\n\n- a\n\n```', '# H\n\n```\ncode', '| a |\n|', '[x]:', '> > '];
        for (const p of partials) expect(() => parseMarkdown(p)).not.toThrow();
    });

    it('assigns path keys and positions', () => {
        const src = '# T\n\n- a\n- b\n\n| x |\n| - |\n| 1 |';
        const root = parseMarkdown(src);
        expect(root.children.map((c) => c.key)).toEqual(['b-0', 'b-1', 'b-2']);
        const list = root.children[1] as List;
        expect(list.children.map((i) => i.key)).toEqual(['b-1.0', 'b-1.1']);
        expect(list.children[0].children[0].key).toBe('b-1.0.0');
        const table = root.children[2] as Table;
        expect(table.children[1].key).toBe('b-2.1');
        expect(table.children[1].children[0].key).toBe('b-2.1.0');
        expect(sliceSource(src, root.children[0])).toBe('# T');
        expect(sliceSource(src, list)).toBe('- a\n- b');
        expect(root.children[0].position).toEqual({ start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 4, offset: 3 } });
        expect(list.position!.start).toEqual({ line: 3, column: 1, offset: 5 });
        expect(root.position!.end.offset).toBe(src.length);
    });

    it('normalises CRLF and NUL', () => {
        const root = parseMarkdown('a\r\nb\r\n\r\n ');
        expect(root.children).toHaveLength(2);
        expect((root.children[1] as Paragraph).children[0]).toMatchObject({ value: '�' });
    });
});
