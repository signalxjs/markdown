/**
 * `shikiPlugin()` — the plugin form of Shiki highlighting: a `code` slot for
 * the DOM component map, contributed through `components.dom` so
 * `<RichTextView plugins={[shikiPlugin()]}>` needs nothing else.
 */

import type { RichTextPlugin } from '../plugin/index.js';
import { highlightedCodeBlock, type HighlightedCodeBlockOptions } from '../dom/index.js';
import { createShikiHighlighter, type ShikiOptions } from './highlighter.js';

export interface ShikiPluginOptions extends ShikiOptions, HighlightedCodeBlockOptions {}

export function shikiPlugin(options: ShikiPluginOptions = {}): RichTextPlugin {
    const { debounceMs, classPrefix, copyButton, ...shiki } = options;
    return {
        name: 'shiki',
        components: { dom: { code: highlightedCodeBlock(createShikiHighlighter(shiki), { debounceMs, classPrefix, copyButton }) } },
    };
}
