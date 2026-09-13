/**
 * The mention editor plugin: the `mention` node spec (mentions are atoms in
 * the flat model) plus the editor slice — `@` opens a suggestion session
 * whose pick inserts a chip. Syntax comes from the formats: pass
 * `formats: { markdown: mentionMarkdown }` (from `@sigx/richtext-markdown`)
 * so the editor reads and writes `@[label](id)`.
 *
 * Platform-neutral; a DOM chip renderer comes from `@sigx/richtext/editor/dom`.
 */

import type { PluginFormats } from '../plugin/index.js';
import { mentionNode } from '../plugins/index.js';
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
    /** How mentions are written per format (`{ markdown: mentionMarkdown }`). Without a slice a format renders the node's text projection. */
    formats?: Partial<PluginFormats>;
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
        name: 'mention',
        nodes: [mentionNode],
        ...(options.formats ? { formats: options.formats } : {}),
        editor: { triggers: [trigger] },
    };
}
