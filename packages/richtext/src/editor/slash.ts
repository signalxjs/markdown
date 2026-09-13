/**
 * The slash command plugin: typing `/` opens a suggestion list of block
 * types (from the schema's menu entries plus any `items` given); picking one
 * removes the `/query` and turns the block into it (or inserts it after).
 *
 * Platform-neutral — the popup is the view's; this contributes the trigger.
 */

import type { BlockContent } from '../ast/index.js';
import { insertBlockAfter, type Command } from './commands.js';
import { filterMenu, turnIntoCommand } from './menu.js';
import type { EditorPlugin } from './plugin.js';
import { standardNodes, type BlockMenuEntry, type NodeSpec } from '../schema/index.js';
import type { TriggerItem, TriggerSpec } from './trigger/index.js';

/** A custom slash entry: `run` a command, or let `create()` build the block that is inserted (replacing an empty paragraph). */
export interface SlashItem extends BlockMenuEntry {
    id: string;
    /** Run this instead of inserting `create()`. */
    run?: Command;
}

export interface SlashPluginOptions {
    /** Trigger character. Default `/`. */
    trigger?: string;
    /** Node specs whose menu entries appear (default: the standard vocabulary). Pass the plugin specs too when using plugin blocks. */
    nodes?: readonly NodeSpec[];
    /** Extra items appended after the block types. */
    items?: readonly SlashItem[];
    /** Hide some built-in entries by block type. */
    exclude?: readonly string[];
}

interface SlashTriggerItem extends TriggerItem {
    spec?: NodeSpec;
    run?: Command;
    create?: () => BlockContent;
    keywords?: readonly string[];
    icon?: string;
    group?: string;
}

export function createSlashPlugin(options: SlashPluginOptions = {}): EditorPlugin {
    const exclude = new Set(options.exclude ?? []);
    const specs = (options.nodes ?? standardNodes).filter((s) => s.menu && !exclude.has(s.type));
    const entries: SlashTriggerItem[] = [
        ...specs.map((spec) => ({ id: `block:${spec.type}`, label: spec.menu!.label, keywords: spec.menu!.keywords, icon: spec.menu!.icon, group: spec.menu!.group, spec })),
        ...(options.items ?? []).map((item) => ({ id: item.id, label: item.label, keywords: item.keywords, icon: item.icon, group: item.group, run: item.run, create: item.create })),
    ];
    const trigger: TriggerSpec = {
        char: options.trigger ?? '/',
        onQuery: (query) => filterMenu(entries, query),
        onSelect: (item, api) => {
            const picked = item as SlashTriggerItem;
            api.replaceQuery({ text: '', spans: [] });
            // A custom item runs its command, else inserts what it creates; a schema entry converts or inserts.
            const command = picked.run ?? (picked.spec ? turnIntoCommand(picked.spec) : picked.create ? insertBlockAfter(picked.create()) : null);
            if (command) api.run(command);
        },
    };
    return { name: 'slash', editor: { triggers: [trigger] } };
}
