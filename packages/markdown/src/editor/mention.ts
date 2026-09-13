/**
 * The mention editor plugin: `@[label](id)` syntax and serializer from the
 * core `mentionPlugin`, plus the node spec (mentions are atoms in the flat
 * model) and the editor slice — `@` opens a suggestion session whose pick
 * inserts a chip.
 *
 * Platform-neutral; a DOM chip renderer comes from `@sigx/markdown/editor/dom`.
 */

import { mentionPlugin } from '../plugins/index.js';
import { ATOM_CHAR } from './inline-flat.js';
import type { EditorPlugin } from './plugin.js';
import type { TriggerItem, TriggerSpec } from './trigger/index.js';

export interface MentionItem extends TriggerItem {
    id: string;
    label: string;
}

export interface MentionPluginOptions {
    /** Resolve suggestions for the text typed after `@`. */
    onQuery: (query: string) => MentionItem[] | Promise<MentionItem[]>;
    /** Trigger character. Default `@`. */
    trigger?: string;
    /** Debounce between queries in ms. */
    debounce?: number;
    /** Extra attrs to store on the chip from the picked item (default: `id` and `label` only). */
    attrsOf?: (item: MentionItem) => Record<string, string>;
}

export function createMentionPlugin(options: MentionPluginOptions): EditorPlugin {
    const trigger: TriggerSpec = {
        char: options.trigger ?? '@',
        debounce: options.debounce,
        onQuery: options.onQuery,
        onSelect: (item, api) => {
            const picked = item as MentionItem;
            const attrs = options.attrsOf ? options.attrsOf(picked) : { id: picked.id, label: picked.label };
            api.replaceQuery({ text: `${ATOM_CHAR} `, spans: [{ start: 0, end: 1, type: 'mention', attrs }] });
        },
    };
    return {
        ...mentionPlugin,
        editor: { triggers: [trigger] },
    };
}
