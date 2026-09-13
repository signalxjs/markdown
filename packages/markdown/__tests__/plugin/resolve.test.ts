import { describe, expect, it, vi } from 'vitest';
import { NO_MARKDOWN_PLUGINS, resolveMarkdownPlugins } from '../../src/plugin/index.js';
import type { BlockSyntaxExtension, InlineSyntaxExtension, RichTextPlugin } from '../../src/plugin/index.js';

const inline = (name: string, ch: string): InlineSyntaxExtension => ({ name, triggerChars: [ch], match: () => null });
const block = (name: string, ch: string): BlockSyntaxExtension => ({
    name,
    triggerChars: [ch],
    start: () => null,
    continue: () => 'close',
    finish: () => ({ type: 'paragraph', children: [] }),
});

describe('resolveMarkdownPlugins', () => {
    it('returns the shared empty resolution for no plugins, and for plugins without a markdown slot', () => {
        expect(resolveMarkdownPlugins()).toBe(NO_MARKDOWN_PLUGINS);
        expect(resolveMarkdownPlugins([])).toBe(NO_MARKDOWN_PLUGINS);
        const r = resolveMarkdownPlugins([{ name: 'dom-only', nodes: [] }]);
        expect(r.plugins.map((p) => p.name)).toEqual(['dom-only']);
        expect(r.inline).toEqual([]);
    });

    it('collects extensions, triggers, rules, entities and transforms in order', () => {
        const a: RichTextPlugin = {
            name: 'a',
            formats: {
                markdown: {
                    inline: [inline('m', '@')],
                    block: [block('note', ':')],
                    serialize: { m: () => 'm', x: () => 'x-a' },
                    entities: { foo: 'F' },
                    transformBlock: (n) => n,
                },
            },
        };
        const b: RichTextPlugin = { name: 'b', formats: { markdown: { inline: [inline('e', ':')], serialize: { x: () => 'x-b' }, transformDocument: () => {} } } };
        const r = resolveMarkdownPlugins([a, b]);
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
        const r = resolveMarkdownPlugins([
            { name: 'a', formats: { markdown: { inline: [inline('m', '@')] } } },
            { name: 'a', formats: { markdown: { inline: [inline('n', '#')] } } },
            { name: 'c', formats: { markdown: { inline: [inline('m', '$'), { name: 'bad', triggerChars: [], match: () => null }, inline('', '%')] } } },
            { name: '' } as RichTextPlugin,
        ]);
        expect(r.plugins.map((p) => p.name)).toEqual(['a', 'c']);
        expect(r.inline.map((e) => e.name)).toEqual(['m']);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
