import { describe, expect, it } from 'vitest';
import { parseInline } from '../../../src/parser/index.js';
import { ATOM_CHAR, flatEquals, toFlat } from '../../../src/editor/inline-flat.js';
import { hostLength, offsetToPoint, pointToOffset, readInline, renderInline } from '../../../src/editor/dom/inline-dom.js';
import type { InlineFlat } from '../../../src/editor/inline-flat.js';
import { markdownSchema } from '../../../src/schema/index.js';

const host = () => document.createElement('div');
const flatOf = (md: string): InlineFlat => toFlat(parseInline(md), markdownSchema);

describe('renderInline / readInline', () => {
    it('renders marks as semantic tags and reads them back', () => {
        const h = host();
        const flat = flatOf('a **b _c_** `d` [e](u "t") ~~f~~');
        renderInline(h, flat);
        expect(h.innerHTML).toBe('a <strong>b <em>c</em></strong> <code>d</code> <a href="u" data-url="u" title="t">e</a> <del>f</del>');
        expect(flatEquals(readInline(h, markdownSchema), flat, markdownSchema)).toBe(true);
    });

    it('round-trips overlapping marks (close/reopen) and merges them back', () => {
        const h = host();
        const flat: InlineFlat = { text: 'abcd', spans: [{ start: 0, end: 3, type: 'strong' }, { start: 1, end: 4, type: 'emphasis' }] };
        renderInline(h, flat);
        expect(h.innerHTML).toBe('<strong>a<em>bc</em></strong><em>d</em>');
        expect(flatEquals(readInline(h, markdownSchema), flat, markdownSchema)).toBe(true);
    });

    it('renders atoms as non-editable chips carrying their attrs', () => {
        const h = host();
        const flat: InlineFlat = { text: `hi ${ATOM_CHAR}!`, spans: [{ start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy' } }] };
        renderInline(h, flat, { atoms: new Map([['mention', (s, d) => Object.assign(d.createElement('span'), { textContent: '@' + s.attrs!.label })]]) });
        const chip = h.querySelector('[data-atom=mention]') as HTMLElement;
        expect(chip.getAttribute('contenteditable')).toBe('false');
        expect(chip.textContent).toBe('@Andy');
        expect(JSON.parse(chip.getAttribute('data-attrs')!)).toEqual({ id: 'u1', label: 'Andy' });
        expect(flatEquals(readInline(h, markdownSchema), flat, markdownSchema)).toBe(true);
        // A mark wrapping an atom survives too.
        const wrapped: InlineFlat = { text: `${ATOM_CHAR}x`, spans: [{ start: 0, end: 1, type: 'image', attrs: { url: 'u', alt: 'a' } }, { start: 0, end: 2, type: 'strong' }] };
        renderInline(h, wrapped);
        expect(flatEquals(readInline(h, markdownSchema), wrapped, markdownSchema)).toBe(true);
    });

    it('renders hard breaks as <br data-break> and an empty host with a filler <br>', () => {
        const h = host();
        renderInline(h, { text: 'a\nb', spans: [] });
        expect(h.innerHTML).toBe('a<br data-break="">b');
        expect(readInline(h, markdownSchema).text).toBe('a\nb');
        renderInline(h, { text: '', spans: [] });
        expect(h.innerHTML).toBe('<br data-filler="">');
        expect(readInline(h, markdownSchema)).toEqual({ text: '', spans: [] });
        renderInline(h, { text: 'a\n', spans: [] });
        expect(readInline(h, markdownSchema).text).toBe('a\n');
    });

    it('tolerates browser-inserted tags and unknown wrappers on read-back', () => {
        const h = host();
        h.innerHTML = '<b>x</b><i>y</i><s>z</s><span style="color:red">w</span><font>v</font>u<br>';
        expect(readInline(h, markdownSchema)).toEqual({
            text: 'xyzwvu',
            spans: [{ start: 0, end: 1, type: 'strong' }, { start: 1, end: 2, type: 'emphasis' }, { start: 2, end: 3, type: 'delete' }],
        });
    });

    it('renders plugin marks as span[data-mark] with attrs', () => {
        const h = host();
        const flat: InlineFlat = { text: 'ab', spans: [{ start: 0, end: 1, type: 'highlight', attrs: { color: 'y' } }] };
        renderInline(h, flat);
        expect(h.innerHTML).toBe('<span data-mark="highlight" data-attrs="{&quot;color&quot;:&quot;y&quot;}">a</span>b');
        expect(flatEquals(readInline(h, markdownSchema), flat, markdownSchema)).toBe(true);
    });

    it('keeps the autolink flag through the DOM', () => {
        const h = host();
        const flat = flatOf('<https://x.com>');
        renderInline(h, flat);
        expect(h.querySelector('a')!.hasAttribute('data-autolink')).toBe(true);
        expect(flatEquals(readInline(h, markdownSchema), flat, markdownSchema)).toBe(true);
    });
});

describe('offsetToPoint / pointToOffset', () => {
    it('maps offsets through nested marks, atoms and breaks both ways', () => {
        const h = host();
        const flat: InlineFlat = {
            text: `ab${ATOM_CHAR}c\nd`,
            spans: [{ start: 0, end: 2, type: 'strong' }, { start: 2, end: 3, type: 'mention', attrs: { id: '1', label: 'x' } }, { start: 1, end: 4, type: 'emphasis' }],
        };
        renderInline(h, flat);
        expect(hostLength(h)).toBe(6);
        for (let o = 0; o <= 6; o++) {
            const p = offsetToPoint(h, o);
            expect(pointToOffset(h, p.node, p.offset), `offset ${o}`).toBe(o);
        }
        const inText = offsetToPoint(h, 1);
        expect(inText.node.nodeType).toBe(3);
        expect(inText.offset).toBe(1);
        // The boundary before the chip stays in the preceding text (a caret there types text, not into the chip).
        const beforeChip = offsetToPoint(h, 2);
        expect(beforeChip.node.nodeType).toBe(3);
        expect(beforeChip.offset).toBe(1);
        // After the chip there is no text node to sit in: an element point right after the chip.
        const afterChip = offsetToPoint(h, 3);
        expect(afterChip.node.nodeType).toBe(1);
        const chip = h.querySelector('[data-atom]')!;
        expect(afterChip.node).toBe(chip.parentNode);
        expect((afterChip.node as Element).childNodes[afterChip.offset - 1]).toBe(chip);
        // The atom is wrapped by the mark that covers it.
        expect(chip.parentElement!.tagName).toBe('EM');
    });

    it('clamps out-of-range and foreign points', () => {
        const h = host();
        renderInline(h, { text: 'abc', spans: [] });
        const past = offsetToPoint(h, 10);
        expect(past.node).toBe(h);
        expect(pointToOffset(h, past.node, past.offset)).toBe(3);
        expect(pointToOffset(h, document.body, 0)).toBe(0);
        expect(pointToOffset(h, h.firstChild!, 99)).toBe(3);
    });

    it('resolves a point inside an atom as after it and ignores the filler br', () => {
        const h = host();
        renderInline(h, { text: ATOM_CHAR, spans: [{ start: 0, end: 1, type: 'image', attrs: { url: 'u' } }] });
        const chip = h.querySelector('[data-atom]')!;
        expect(pointToOffset(h, chip.firstChild ?? chip, 0)).toBe(1);
        renderInline(h, { text: '', spans: [] });
        expect(offsetToPoint(h, 0)).toEqual({ node: h, offset: 0 });
        expect(pointToOffset(h, h, 1)).toBe(0);
    });
});
