/**
 * Block menu helpers shared by the slash command plugin and the DOM block
 * menu: the command that turns the selected block into what a schema menu
 * entry creates, and a fuzzy-ish filter over menu entries.
 */

import { insertBlockAfter, setBlockType, toggleList, wrapInBlockquote, type Command } from './commands.js';
import type { BlockEditorSpec } from './schema.js';

/** The command a menu entry runs: inline/code kinds convert the block in place, lists and quotes wrap it, everything else inserts after it (replacing an empty paragraph). */
export function turnIntoCommand(spec: BlockEditorSpec): Command {
    const created = spec.menu ? spec.menu.create() : { type: spec.type };
    if (spec.kind === 'inline' && spec.fromInline) {
        const attrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(created)) if (k !== 'type' && k !== 'children') attrs[k] = v;
        return setBlockType(spec.type, attrs);
    }
    if (spec.type === 'list') return toggleList((created as { ordered?: boolean; children?: { checked?: boolean | null }[] }).ordered ? 'ordered' : 'bullet');
    if (spec.type === 'blockquote') return wrapInBlockquote;
    if (spec.kind === 'code' && spec.fromInline) return setBlockType(spec.type, { lang: (created as { lang?: string | null }).lang ?? null });
    return insertBlockAfter(created as Parameters<typeof insertBlockAfter>[0]);
}

/** Menu entries whose label or keywords contain every word of `query` (case-insensitive); an empty query returns all. */
export function filterMenu<T extends { label: string; keywords?: readonly string[] }>(entries: readonly T[], query: string): T[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [...entries];
    return entries.filter((e) => {
        const hay = [e.label, ...(e.keywords ?? [])].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
    });
}
