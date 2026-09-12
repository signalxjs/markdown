import { describe, expect, it, vi } from 'vitest';
import { NO_PLUGINS, resolvePlugins } from '../../src/plugin/index.js';
import type { BlockSyntaxExtension, InlineSyntaxExtension, MarkdownPlugin } from '../../src/plugin/index.js';

const inline = (name: string, ch: string): InlineSyntaxExtension => ({ name, triggerChars: [ch], match: () => null });
const block = (name: string, ch: string): BlockSyntaxExtension => ({
    name,
    triggerChars: [ch],
    start: () => null,
    continue: () => 'close',
    finish: () => ({ type: 'paragraph', children: [] }),
});

describe('resolvePlugins', () => {
    it('returns the shared empty resolution for no plugins', () => {
        expect(resolvePlugins()).toBe(NO_PLUGINS);
        expect(resolvePlugins([])).toBe(NO_PLUGINS);
    });

    it('collects extensions, triggers, rules, entities and transforms in order', () => {
        const a: MarkdownPlugin = {
            name: 'a',
            inline: [inline('m', '@')],
            block: [block('note', ':')],
            serialize: { m: () => 'm', x: () => 'x-a' },
            entities: { foo: 'F' },
            transformBlock: (n) => n,
        };
        const b: MarkdownPlugin = { name: 'b', inline: [inline('e', ':')], serialize: { x: () => 'x-b' }, transformDocument: () => {} };
        const r = resolvePlugins([a, b]);
        expect(r.plugins.map((p) => p.name)).toEqual(['a', 'b']);
        expect(r.inline.map((e) => e.name)).toEqual(['m', 'e']);
        expect([...r.inlineTriggers]).toEqual(['@', ':']);
        expect([...r.blockTriggers]).toEqual([':']);
        expect(r.serialize.get('x')!({ type: 'x' }, {} as never)).toBe('x-b');
        expect(r.entities.get('foo')).toBe('F');
        expect(r.transformBlock).toHaveLength(1);
        expect(r.transformDocument).toHaveLength(1);
        expect(Object.isFrozen(r)).toBe(true);
    });

    it('drops duplicates and invalid extensions with a dev warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const r = resolvePlugins([
            { name: 'a', inline: [inline('m', '@')] },
            { name: 'a', inline: [inline('n', '#')] },
            { name: 'c', inline: [inline('m', '$'), { name: 'bad', triggerChars: [], match: () => null }, inline('', '%')] },
            { name: '' } as MarkdownPlugin,
        ]);
        expect(r.plugins.map((p) => p.name)).toEqual(['a', 'c']);
        expect(r.inline.map((e) => e.name)).toEqual(['m']);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
