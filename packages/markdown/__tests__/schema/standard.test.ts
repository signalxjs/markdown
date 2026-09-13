import { describe, expect, it } from 'vitest';
import { assignKeys, markdownNodes, markdownSchema, standardNodes, standardSchema } from '../../src/schema/index.js';
import { parseMarkdown } from '../../src/parser/index.js';
import type { Root } from '../../src/ast/index.js';

const MDAST_BLOCKS = ['paragraph', 'heading', 'thematicBreak', 'blockquote', 'list', 'listItem', 'code', 'html', 'definition', 'table', 'tableRow', 'tableCell'];
const MDAST_PHRASING = ['text', 'emphasis', 'strong', 'delete', 'inlineCode', 'break', 'link', 'image', 'linkReference', 'imageReference'];

describe('standardNodes / markdownNodes', () => {
    it('cover the mdast vocabulary between them, once each', () => {
        const types = [...standardNodes, ...markdownNodes].map((s) => s.type);
        expect(new Set(types).size).toBe(types.length);
        expect(types.sort()).toEqual([...MDAST_BLOCKS, ...MDAST_PHRASING].sort());
        expect(markdownNodes.map((s) => s.type).sort()).toEqual(['definition', 'html', 'imageReference', 'linkReference']);
    });

    it('key every block-level type and no phrasing type', () => {
        for (const t of MDAST_BLOCKS) expect(markdownSchema.isKeyed(t), t).toBe(true);
        for (const t of MDAST_PHRASING) expect(markdownSchema.isKeyed(t), t).toBe(false);
        expect(markdownSchema.isKeyed('root')).toBe(true); // never asked: assignKeys starts below the root
        expect(markdownSchema.isKeyed('callout')).toBe(true);
    });

    it('make text blocks and code blocks editable, and lists, quotes and tables containers', () => {
        expect([...markdownSchema.editableTypes]).toEqual(['paragraph', 'heading', 'tableCell', 'code', 'html']);
        expect([...standardSchema.editableTypes]).toEqual(['paragraph', 'heading', 'tableCell', 'code']);
        for (const t of ['blockquote', 'list', 'listItem', 'table', 'tableRow']) expect(markdownSchema.isContainer(t), t).toBe(true);
        for (const t of ['paragraph', 'code', 'thematicBreak', 'definition', 'html']) expect(markdownSchema.isContainer(t), t).toBe(false);
    });

    it('fill empty list items and blockquotes with a paragraph', () => {
        expect(markdownSchema.get('listItem')?.fillsWith).toBe('paragraph');
        expect(markdownSchema.get('blockquote')?.fillsWith).toBe('paragraph');
        expect(markdownSchema.get('list')?.fillsWith).toBeUndefined();
    });

    it('describe the inline model: inline code is a literal, links wrap it, nesting priority is link < code < strong < emphasis < delete', () => {
        const inline = (t: string) => markdownSchema.get(t)?.inline;
        expect(inline('inlineCode')?.literal).toBe(true);
        expect(inline('link')?.wrapsLiteral).toBe(true);
        expect(['link', 'inlineCode', 'strong', 'emphasis', 'delete'].map((t) => inline(t)?.priority)).toEqual([0, 1, 2, 3, 4]);
        expect(inline('break')?.kind).toBe('break');
        expect(markdownSchema.role('image')).toBe('atom');
        expect(markdownSchema.role('linkReference')).toBe('atom');
    });
});

describe('assignKeys', () => {
    it('keys blocks, list items, rows and cells with parent-relative keys and leaves phrasing content alone', () => {
        const root: Root = { type: 'root', children: [{ type: 'list', ordered: false, spread: false, children: [{ type: 'listItem', spread: false, children: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', value: 'a' }] }] }] }] }] };
        assignKeys(root, markdownSchema);
        const list = root.children[0] as { key?: string; children: { key?: string; children: { key?: string; children: { key?: string }[] }[] }[] };
        expect(list.key).toBe('b-0');
        expect(list.children[0].key).toBe('b-0.0');
        expect(list.children[0].children[0].key).toBe('b-0.0.0');
        expect(list.children[0].children[0].children[0].key).toBeUndefined();
    });

    it('re-keys a parsed tree exactly as the parser did', () => {
        const keysOf = (root: Root): string[] => {
            const out: string[] = [];
            const walk = (n: { key?: string; children?: unknown[] }): void => {
                if (n.key) out.push(n.key);
                for (const c of n.children ?? []) walk(c as { key?: string; children?: unknown[] });
            };
            walk(root);
            return out;
        };
        const parsed = parseMarkdown('# T\n\n- a\n  - b\n\n| x |\n|---|\n| y |\n\n[x]: /u');
        const copy = JSON.parse(JSON.stringify(parsed, (k, v) => (k === 'key' ? undefined : v))) as Root;
        expect(keysOf(copy)).toEqual([]);
        assignKeys(copy, markdownSchema);
        expect(keysOf(copy)).toEqual(keysOf(parsed));
        expect(keysOf(copy)).toContain('b-1.0.1.0.0'); // the nested list item's paragraph
        expect(keysOf(copy)).toContain('b-2.1.0'); // the body row's cell
    });
});
