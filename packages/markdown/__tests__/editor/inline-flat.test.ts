import { describe, expect, it } from 'vitest';
import { parseInline } from '../../src/parser/index.js';
import { toMarkdown } from '../../src/serializer/index.js';
import { resolvePlugins } from '../../src/plugin/index.js';
import { mentionPlugin } from '../../src/plugins/index.js';
import {
    ATOM_CHAR,
    addMark,
    concatFlat,
    flatEquals,
    marksAt,
    mergeAdjacent,
    removeMark,
    sliceFlat,
    spliceFlat,
    toFlat,
    toInline,
    toggleMark,
} from '../../src/editor/inline-flat.js';
import type { InlineSpan } from '../../src/editor/inline-flat.js';
import { createSchema, markdownNodes, markdownSchema, standardNodes } from '../../src/schema/index.js';
import type { PhrasingContent } from '../../src/ast/index.js';

const md = (nodes: PhrasingContent[]) => toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: nodes }] });
const roundTrip = (src: string, schema = markdownSchema) => md(toInline(toFlat(parseInline(src), schema), schema));

describe('toFlat / toInline', () => {
    it('flattens marks into ranges and rebuilds nested trees', () => {
        const flat = toFlat(parseInline('a **b _c_** `d` [e](u "t")'), markdownSchema);
        expect(flat.text).toBe('a b c d e');
        expect(flat.spans).toEqual([
            { start: 2, end: 5, type: 'strong' },
            { start: 4, end: 5, type: 'emphasis' },
            { start: 6, end: 7, type: 'inlineCode' },
            { start: 8, end: 9, type: 'link', attrs: { url: 'u', title: 't' } },
        ]);
        expect(toInline(flat, markdownSchema)).toEqual(parseInline('a **b _c_** `d` [e](u "t")'));
    });

    it('re-nests overlapping marks by extent so the tree is valid', () => {
        const flat = { text: 'abcd', spans: [{ start: 0, end: 3, type: 'strong' }, { start: 1, end: 4, type: 'emphasis' }] };
        // strong[0,3) and emphasis[1,4): emphasis stays active longer from
        // the overlap on, so it sits outside and strong closes/reopens.
        expect(md(toInline(flat, markdownSchema))).toBe('**a**_**bc**d_\n');
        // and the rebuilt tree flattens back to the same ranges
        expect(flatEquals(toFlat(toInline(flat, markdownSchema), markdownSchema), flat)).toBe(true);
    });

    it('keeps images as one atom character carrying attrs', () => {
        const flat = toFlat(parseInline('x ![alt](u "t") y'), markdownSchema);
        expect(flat.text).toBe(`x ${ATOM_CHAR} y`);
        expect(flat.spans).toEqual([{ start: 2, end: 3, type: 'image', attrs: { url: 'u', alt: 'alt', title: 't' } }]);
        expect(toInline(flat, markdownSchema)).toEqual(parseInline('x ![alt](u "t") y'));
    });

    it('maps hard breaks to newlines and back', () => {
        const flat = toFlat(parseInline('a  \nb'), markdownSchema);
        expect(flat.text).toBe('a\nb');
        expect(toInline(flat, markdownSchema)).toEqual([{ type: 'text', value: 'a' }, { type: 'break' }, { type: 'text', value: 'b' }]);
    });

    it('suppresses marks inside code but keeps an enclosing link', () => {
        const flat = { text: 'code', spans: [{ start: 0, end: 4, type: 'inlineCode' }, { start: 1, end: 3, type: 'strong' }, { start: 0, end: 4, type: 'link', attrs: { url: 'u' } }] };
        expect(md(toInline(flat, markdownSchema))).toBe('[`code`](u)\n');
    });

    it('round-trips through the serializer for a corpus', () => {
        for (const src of ['plain', '**b** *i* ~~s~~', 'a[b](c)d', '`x` and `y`', '***both***', 'a **b *c* d** e', '![i](u) text', 'l1  \nl2']) {
            expect(roundTrip(src)).toBe(toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: parseInline(src) }] }));
        }
    });

    it('handles plugin atoms and marks through their node specs', () => {
        const schema = createSchema([
            ...standardNodes,
            ...markdownNodes,
            { type: 'mention', role: 'atom', inline: { fromFlat: (s) => ({ type: 'mention', id: s.attrs!.id, label: s.attrs!.label }) as never } },
            { type: 'highlight', role: 'mark' },
        ]);
        const plugins = resolvePlugins([mentionPlugin]);
        const nodes = parseInline('hi @[Andy](u1)!', { plugins });
        const flat = toFlat(nodes, schema);
        expect(flat.text).toBe(`hi ${ATOM_CHAR}!`);
        expect(flat.spans).toEqual([{ start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy' } }]);
        expect(toInline(flat, schema)).toEqual(nodes);
        const hl = { text: 'ab', spans: [{ start: 0, end: 1, type: 'highlight', attrs: { color: 'y' } }] };
        expect(toInline(hl, schema)).toEqual([{ type: 'highlight', color: 'y', children: [{ type: 'text', value: 'a' }] }, { type: 'text', value: 'b' }]);
    });

    it('keeps the character under an unknown one-character mark span (only U+FFFC makes an unknown span an atom)', () => {
        const flat = { text: 'ab', spans: [{ start: 0, end: 1, type: 'highlight' }] };
        expect(toInline(flat, markdownSchema)).toEqual([{ type: 'highlight', children: [{ type: 'text', value: 'a' }] }, { type: 'text', value: 'b' }]);
        expect(flatEquals(toFlat(toInline(flat, markdownSchema), markdownSchema), flat, markdownSchema)).toBe(true);
        const chip = { text: `${ATOM_CHAR}b`, spans: [{ start: 0, end: 1, type: 'chip', attrs: { id: '1' } }] };
        expect(toInline(chip, markdownSchema)).toEqual([{ type: 'chip', id: '1' }, { type: 'text', value: 'b' }]);
    });

    it('keeps unresolved references as atoms', () => {
        const nodes = parseInline('see [foo][bar]');
        const flat = toFlat(nodes, markdownSchema);
        expect(flat.spans[0]).toMatchObject({ type: 'linkReference', attrs: { identifier: 'bar', label: 'bar', referenceType: 'full', text: 'foo' } });
        expect(toInline(flat, markdownSchema)).toEqual(nodes);
    });
});

describe('flat editing helpers', () => {
    const base = { text: 'hello world', spans: [{ start: 0, end: 5, type: 'strong' }, { start: 6, end: 11, type: 'emphasis' }] };

    it('flatEquals ignores span order and detects differences', () => {
        expect(flatEquals(base, { text: 'hello world', spans: [...base.spans].reverse() })).toBe(true);
        expect(flatEquals(base, { ...base, text: 'hello worle' })).toBe(false);
        expect(flatEquals(base, { text: base.text, spans: [base.spans[0]] })).toBe(false);
    });

    it('spliceFlat inserts, deletes and shifts spans', () => {
        const inserted = spliceFlat(base, 5, 5, { text: ',', spans: [] });
        expect(inserted.text).toBe('hello, world');
        expect(inserted.spans).toEqual([{ start: 0, end: 5, type: 'strong' }, { start: 7, end: 12, type: 'emphasis' }]);
        const grown = spliceFlat(base, 2, 2, { text: 'XX', spans: [] });
        expect(grown.spans[0]).toEqual({ start: 0, end: 7, type: 'strong' }); // straddled: grows
        const atEnd = spliceFlat(base, 5, 5, { text: 'X', spans: [] });
        expect(atEnd.spans[0]).toEqual({ start: 0, end: 5, type: 'strong' }); // at the edge: unchanged
        const deleted = spliceFlat(base, 3, 8, { text: '', spans: [] });
        expect(deleted.text).toBe('helrld');
        expect(deleted.spans).toEqual([{ start: 0, end: 3, type: 'strong' }, { start: 3, end: 6, type: 'emphasis' }]);
        // Exactness: the inverse splice restores the original model.
        const back = spliceFlat(deleted, 3, 3, sliceFlat(base, 3, 8));
        expect(flatEquals(back, base)).toBe(true);
        const withSpans = spliceFlat(base, 11, 11, { text: '!', spans: [{ start: 0, end: 1, type: 'delete' }] });
        expect(withSpans.spans).toContainEqual({ start: 11, end: 12, type: 'delete' });
    });

    it('spliceFlat drops an atom inside the replaced range', () => {
        const flat = { text: `a${ATOM_CHAR}b`, spans: [{ start: 1, end: 2, type: 'image', attrs: { url: 'u' } }] };
        expect(spliceFlat(flat, 1, 2, { text: '', spans: [] })).toEqual({ text: 'ab', spans: [] });
    });

    it('sliceFlat and concatFlat are inverses', () => {
        const a = sliceFlat(base, 0, 6);
        const b = sliceFlat(base, 6, 11);
        expect(a).toEqual({ text: 'hello ', spans: [{ start: 0, end: 5, type: 'strong' }] });
        expect(b).toEqual({ text: 'world', spans: [{ start: 0, end: 5, type: 'emphasis' }] });
        expect(flatEquals(concatFlat(a, b), base)).toBe(true);
    });

    it('marksAt reports marks at a caret and over a range', () => {
        expect(marksAt(base, 3)).toEqual(['strong']);
        expect(marksAt(base, 5)).toEqual(['strong']);
        expect(marksAt(base, 6)).toEqual([]);
        expect(marksAt(base, 7, 9)).toEqual(['emphasis']);
        expect(marksAt(base, 3, 8)).toEqual([]);
    });

    it('mergeAdjacent joins a mark that covers an atom with its neighbour but never two atoms', () => {
        const text = ATOM_CHAR + 'x' + ATOM_CHAR + ATOM_CHAR;
        const spans: InlineSpan[] = [
            { start: 0, end: 1, type: 'image', attrs: { url: 'u' } },
            { start: 0, end: 1, type: 'strong' },
            { start: 1, end: 2, type: 'strong' },
            { start: 2, end: 3, type: 'mention', attrs: { id: '1' } },
            { start: 3, end: 4, type: 'mention', attrs: { id: '1' } },
        ];
        expect(mergeAdjacent(spans, text, markdownSchema)).toEqual([
            { start: 0, end: 2, type: 'strong' },
            { start: 0, end: 1, type: 'image', attrs: { url: 'u' } },
            { start: 2, end: 3, type: 'mention', attrs: { id: '1' } },
            { start: 3, end: 4, type: 'mention', attrs: { id: '1' } },
        ]);
        expect(marksAt({ text, spans }, 1, 1, markdownSchema)).toEqual(['strong']);
    });

    it('toggleMark adds, merges and removes', () => {
        const on = toggleMark(base, 'delete', 2, 4);
        expect(on.spans).toContainEqual({ start: 2, end: 4, type: 'delete' });
        const merged = addMark(on, 'delete', 4, 6);
        expect(merged.spans.filter((s) => s.type === 'delete')).toEqual([{ start: 2, end: 6, type: 'delete' }]);
        const off = toggleMark(merged, 'delete', 3, 5);
        expect(off.spans.filter((s) => s.type === 'delete')).toEqual([{ start: 2, end: 3, type: 'delete' }, { start: 5, end: 6, type: 'delete' }]);
        expect(removeMark(base, 'strong', 0, 11).spans).toEqual([{ start: 6, end: 11, type: 'emphasis' }]);
        const linked = addMark(base, 'link', 0, 5, { url: 'x' });
        expect(linked.spans).toContainEqual({ start: 0, end: 5, type: 'link', attrs: { url: 'x' } });
    });
});
