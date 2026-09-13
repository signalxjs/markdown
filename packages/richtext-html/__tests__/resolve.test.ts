import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RichTextPlugin } from '@sigx/richtext';
import { resolveHtmlPlugins } from '../src/resolve.js';

afterEach(() => vi.restoreAllMocks());

describe('resolveHtmlPlugins', () => {
    it('returns one frozen empty result for no plugins', () => {
        const a = resolveHtmlPlugins();
        expect(resolveHtmlPlugins([])).toBe(a);
        expect(resolveHtmlPlugins(null)).toBe(a);
        expect(Object.isFrozen(a)).toBe(true);
        expect(Object.isFrozen(a.plugins)).toBe(true);
        expect(a.schema.role('paragraph')).toBe('textblock');
    });

    it('collects element rules by lowercased tag in order and serializer rules by type, last wins', () => {
        const r1 = () => null;
        const r2 = () => null;
        const s1 = () => 'a';
        const s2 = () => 'b';
        const resolved = resolveHtmlPlugins([
            { name: 'a', formats: { html: { elements: { SPAN: r1 }, serialize: { x: s1 } } } },
            { name: 'b', nodes: [{ type: 'x', role: 'inline' }], formats: { html: { elements: { span: r2 }, serialize: { x: s2 } } } },
        ]);
        expect(resolved.elements.get('span')).toEqual([r1, r2]);
        expect(resolved.serialize.get('x')).toBe(s2);
        expect(resolved.schema.role('x')).toBe('inline');
        expect(resolved.plugins.map((p) => p.name)).toEqual(['a', 'b']);
        expect(Object.isFrozen(resolved)).toBe(true);
    });

    it('skips invalid, unnamed and duplicate plugins with a dev warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const plugins = [null, undefined, {} as RichTextPlugin, { name: '' }, { name: 'a' }, { name: 'a' }] as unknown as RichTextPlugin[];
        const resolved = resolveHtmlPlugins(plugins);
        expect(resolved.plugins.map((p) => p.name)).toEqual(['a']);
        expect(warn).toHaveBeenCalledTimes(5);
    });
});
