import { describe, expect, it, vi } from 'vitest';
import { createSchema, inlineAttrsOf, phrasingText } from '../../src/schema/index.js';
import type { NodeSpec } from '../../src/schema/index.js';

const para: NodeSpec = { type: 'paragraph', role: 'textblock', fromInline: (children) => ({ type: 'paragraph', children }) };

describe('createSchema', () => {
    it('holds exactly the specs it was given — nothing is implied', () => {
        const schema = createSchema([para]);
        expect([...schema.specs.keys()]).toEqual(['paragraph']);
        expect(schema.get('heading')).toBeUndefined();
        expect(schema.role('heading')).toBeUndefined();
        expect(schema.menu()).toEqual([]);
    });

    it('derives keyed, editable and container from the role, with per-spec overrides', () => {
        const schema = createSchema([
            para,
            { type: 'quote', role: 'container' },
            { type: 'grid', role: 'table' },
            { type: 'fence', role: 'code' },
            { type: 'rule', role: 'void' },
            { type: 'text', role: 'inline' },
            { type: 'strong', role: 'mark' },
            { type: 'chip', role: 'atom' },
            { type: 'note', role: 'void', editable: true, keyed: false },
        ]);
        expect(['paragraph', 'quote', 'grid', 'fence', 'rule'].map((t) => schema.isKeyed(t))).toEqual([true, true, true, true, true]);
        expect(['text', 'strong', 'chip'].map((t) => schema.isKeyed(t))).toEqual([false, false, false]);
        expect(schema.isKeyed('note')).toBe(false);
        expect([...schema.editableTypes]).toEqual(['paragraph', 'fence', 'note']);
        expect(schema.isEditable('quote')).toBe(false);
        expect(schema.isContainer('quote')).toBe(true);
        expect(schema.isContainer('grid')).toBe(true);
        expect(schema.isContainer('paragraph')).toBe(false);
    });

    it('treats an unknown type as keyed, not editable, not a container', () => {
        const schema = createSchema([para]);
        expect(schema.isKeyed('callout')).toBe(true);
        expect(schema.isEditable('callout')).toBe(false);
        expect(schema.isContainer('callout')).toBe(false);
    });

    it('creates empty blocks through fromInline, then the menu entry, and refuses otherwise', () => {
        const schema = createSchema([para, { type: 'rule', role: 'void', menu: { label: 'Rule', create: () => ({ type: 'thematicBreak' }) } }, { type: 'quote', role: 'container' }]);
        expect(schema.createBlock('paragraph')).toEqual({ type: 'paragraph', children: [] });
        expect(schema.createBlock('rule')).toEqual({ type: 'thematicBreak' });
        expect(() => schema.createBlock('quote')).toThrow(/Cannot create/);
        expect(schema.defaultBlock).toBe('paragraph');
        expect(createSchema([{ ...para, type: 'p' }], { defaultBlock: 'p' }).defaultBlock).toBe('p');
    });

    it('lets a later spec replace an earlier one with a dev warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const schema = createSchema([para, { ...para, allowsHardBreak: true }]);
        expect(schema.get('paragraph')?.allowsHardBreak).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"paragraph" replaces'));
        warn.mockRestore();
    });

    it('lists menu entries in registration order', () => {
        const schema = createSchema([
            { type: 'b', role: 'void', menu: { label: 'B', create: () => ({ type: 'thematicBreak' }) } },
            para,
            { type: 'a', role: 'void', menu: { label: 'A', create: () => ({ type: 'thematicBreak' }) } },
        ]);
        expect(schema.menu().map((s) => s.type)).toEqual(['b', 'a']);
    });
});

describe('inlineAttrsOf / phrasingText', () => {
    it('keeps scalar own properties and drops the structural ones', () => {
        expect(inlineAttrsOf({ type: 'link', url: 'u', title: 't', data: { autolink: true }, position: undefined, children: [], key: 'k', value: 'v', depth: 2, checked: true } as never)).toEqual({ url: 'u', title: 't', depth: '2', checked: 'true' });
    });

    it('concatenates literal values through marks and skips atoms', () => {
        expect(phrasingText([{ type: 'text', value: 'a' }, { type: 'strong', children: [{ type: 'inlineCode', value: 'b' }] }, { type: 'image', url: 'u', alt: 'x' }])).toBe('ab');
    });
});
