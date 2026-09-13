/**
 * `toMarkdown()` — AST → markdown. Deterministic and CommonMark-safe:
 * `parse(toMarkdown(parse(md)))` is structurally equal to `parse(md)`.
 * Never throws — a misbehaving plugin rule or an unknown node degrades to its
 * children (dev-warned).
 */

import type { Node, Root, RootContent } from '../ast/index.js';
import { resolveMarkdownPlugins, type RichTextPlugin } from '../plugin/index.js';
import { serializeBlock, serializeBlocks } from './blocks.js';
import type { SerializerOptions, State } from './inline.js';

export interface ToMarkdownOptions {
    /** Plugins whose `serialize` rules handle extra (or override built-in) node types. */
    plugins?: readonly RichTextPlugin[];
    /** Bullet list marker. Default `-`. */
    bullet?: '-' | '*' | '+';
    /** Emphasis delimiter. Default `*` (see `inline.ts` for when the other one is used). */
    emphasis?: '*' | '_';
    /** Strong delimiter. Default `**`. */
    strong?: '**' | '__';
    /** Code fence character. Default `` ` `` (`~` is used when the info string contains a backtick). */
    fence?: '`' | '~';
    /** Thematic break. Default `---`. */
    rule?: '---' | '***' | '___';
    /** `true` (default): `1. 2. 3.`; `false`: `1. 1. 1.`. */
    incrementListMarker?: boolean;
    /** Line ending, default `\n`. */
    lineEnding?: '\n' | '\r\n';
}

const DEFAULTS: SerializerOptions = {
    bullet: '-',
    emphasis: '*',
    strong: '**',
    fence: '`',
    rule: '---',
    incrementListMarker: true,
    lineEnding: '\n',
};

/**
 * Serialize a tree (or any single node) to markdown. A non-empty result ends
 * with exactly one line ending; an empty root gives `''`.
 */
export function toMarkdown(node: Root | RootContent, options: ToMarkdownOptions = {}): string {
    const opts: SerializerOptions = {
        bullet: options.bullet ?? DEFAULTS.bullet,
        emphasis: options.emphasis ?? DEFAULTS.emphasis,
        strong: options.strong ?? DEFAULTS.strong,
        fence: options.fence ?? DEFAULTS.fence,
        rule: options.rule ?? DEFAULTS.rule,
        incrementListMarker: options.incrementListMarker ?? DEFAULTS.incrementListMarker,
        lineEnding: options.lineEnding ?? DEFAULTS.lineEnding,
    };
    const state: State = {
        options: opts,
        raw: options as Readonly<Record<string, unknown>>,
        rules: resolveMarkdownPlugins(options.plugins).serialize,
        indent: '',
        serialize: (n: Node) => serializeBlock(n, state),
        serializeBlocks: (nodes: readonly Node[]) => serializeBlocks(nodes, state),
    };
    let out = serializeBlock(node, state).replace(/\n+$/, '');
    if (out === '') return '';
    out += '\n';
    return opts.lineEnding === '\r\n' ? out.replace(/\r?\n/g, '\r\n') : out;
}
