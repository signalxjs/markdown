import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { toMarkdown } from '@sigx/richtext-markdown';
import { createEditor } from '../../src/editor/editor.js';
import { createSlashPlugin } from '../../src/editor/slash.js';
import { filterMenu, turnIntoCommand } from '../../src/editor/menu.js';
import { standardNodes } from '../../src/schema/index.js';
import { textSelection } from '../../src/editor/state.js';
import type { TriggerItem, TriggerSelectApi } from '../../src/editor/trigger/index.js';
import type { Command } from '../../src/editor/commands.js';
import { commands } from '../../src/editor/registry.js';

const md = (e: ReturnType<typeof createEditor>) => toMarkdown(e.state.doc);

/** Drive the plugin's trigger the way the view does: query, then pick with a real `TriggerSelectApi`. */
function pick(e: ReturnType<typeof createEditor>, plugin: ReturnType<typeof createSlashPlugin>, key: string, from: number, to: number, label: string): void {
    const spec = (plugin.editor!.triggers as NonNullable<typeof plugin.editor>['triggers'])![0];
    const items = spec.onQuery(label) as TriggerItem[];
    const item = items.find((i) => i.label === label)!;
    const api: TriggerSelectApi = {
        replaceQuery: (slice) => e.dispatch({ steps: [{ type: 'replaceInline', key, from, to, slice }], selection: textSelection(key, from + slice.text.length), meta: { origin: 'command' } }),
        range: { key, from, to },
        commands,
        dispatch: e.dispatch,
        state: e.state,
        run: (c: Command | string) => e.run(c),
    };
    spec.onSelect(item, api);
}

describe('createSlashPlugin', () => {
    it('lists the schema menu entries, filtered by label and keywords', () => {
        const plugin = createSlashPlugin();
        const spec = plugin.editor!.triggers![0];
        expect(spec.char).toBe('/');
        const all = spec.onQuery('') as TriggerItem[];
        expect(all.map((i) => i.label)).toContain('Heading');
        expect(all.map((i) => i.label)).toContain('Divider');
        expect((spec.onQuery('hr') as TriggerItem[]).map((i) => i.label)).toEqual(['Divider']);
        expect((spec.onQuery('QUO') as TriggerItem[]).map((i) => i.label)).toEqual(['Quote']);
        expect(createSlashPlugin({ exclude: ['table'] }).editor!.triggers![0].onQuery('table')).toEqual([]);
    });

    it('a pick removes the query and converts or inserts the block', () => {
        const plugin = createSlashPlugin();
        const e = createEditor({ doc: parseMarkdown('hi /hea'), plugins: [plugin] });
        pick(e, plugin, 'b-0', 3, 7, 'Heading');
        expect(md(e)).toBe('# hi\n');
        const e2 = createEditor({ doc: parseMarkdown('/div'), plugins: [plugin] });
        pick(e2, plugin, 'b-0', 0, 4, 'Divider');
        expect(md(e2)).toBe('---\n');
        expect(e2.state.selection).toEqual({ mode: 'block', anchorKey: 'b-0', headKey: 'b-0' });
    });

    it('a custom item runs its command, or inserts what it creates', () => {
        const ran: string[] = [];
        const plugin = createSlashPlugin({
            items: [
                { id: 'shout', label: 'Shout', create: () => ({ type: 'paragraph', children: [] }), run: () => (ran.push('shout'), true) },
                { id: 'note', label: 'Note', keywords: ['callout'], create: () => ({ type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'note' }] }] }) },
            ],
        });
        const spec = plugin.editor!.triggers![0];
        expect((spec.onQuery('callout') as TriggerItem[]).map((i) => i.label)).toEqual(['Note']);
        const e = createEditor({ doc: parseMarkdown('/note'), plugins: [plugin] });
        pick(e, plugin, 'b-0', 0, 5, 'Note');
        expect(md(e)).toBe('> note\n');
        pick(e, plugin, 'b-0.0', 0, 0, 'Shout');
        expect(ran).toEqual(['shout']);
    });
});

describe('menu helpers', () => {
    it('turnIntoCommand converts inline kinds in place and wraps or inserts the rest', () => {
        const specs = new Map(standardNodes.map((s) => [s.type, s]));
        const e = createEditor({ doc: parseMarkdown('a') });
        e.run(turnIntoCommand(specs.get('heading')!));
        expect(md(e)).toBe('# a\n');
        e.run(turnIntoCommand(specs.get('list')!));
        expect(md(e)).toBe('- # a\n');
        e.run(turnIntoCommand(specs.get('list')!));
        expect(md(e)).toBe('# a\n');
        e.run(turnIntoCommand(specs.get('blockquote')!));
        expect(md(e)).toBe('> # a\n');
        e.run(turnIntoCommand(specs.get('code')!));
        expect(md(e)).toBe('> ```\n> a\n> ```\n');
    });

    it('filterMenu matches every word against label and keywords, empty query returns all', () => {
        const entries = [
            { label: 'Bulleted list', keywords: ['ul'] },
            { label: 'Numbered list', keywords: ['ol', 'ordered'] },
        ];
        expect(filterMenu(entries, '')).toHaveLength(2);
        expect(filterMenu(entries, 'list ord').map((e) => e.label)).toEqual(['Numbered list']);
        expect(filterMenu(entries, 'UL').map((e) => e.label)).toEqual(['Bulleted list']);
        expect(filterMenu(entries, 'x')).toEqual([]);
    });
});
