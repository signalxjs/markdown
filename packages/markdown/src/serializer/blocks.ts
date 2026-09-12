/**
 * Block serialization. Containers (blockquote, list item) serialize their
 * children unprefixed and then prefix every output line, so nested content
 * never needs to know its depth; `State.indent` only informs plugin rules.
 *
 * Joining: siblings are separated by one blank line, except inside a tight
 * list item where a single newline is used whenever the next block can
 * interrupt what precedes it (a paragraph cannot follow a paragraph, a
 * table, an html block or a lazy-continuable container without a blank line
 * — those cases get one, which is the least destructive outcome).
 */

import type {
    Blockquote,
    Code,
    Definition,
    Heading,
    List,
    ListItem,
    Literal,
    Node,
    Paragraph,
    Root,
    Table,
    TableRow,
} from '../ast/index.js';
import { escapeLabel, longestRun } from './escape.js';
import {
    PHRASING_TYPES,
    destination,
    runRule,
    serializeInline,
    serializePhrasing,
    serializeUnknown,
    type State,
} from './inline.js';

/** HTML block kinds 1–6 — the ones that may interrupt a paragraph. */
const HTML_INTERRUPT =
    /^<(?:(?:script|pre|style|textarea)(?:[ \t>]|$)|!--|\?|![a-zA-Z]|!\[CDATA\[|\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|\/>|$))/i;

/** Types after which the next line is always a new block (no lazy continuation, no blank-line end). */
const CLOSED_BLOCKS: ReadonlySet<string> = new Set(['heading', 'thematicBreak', 'code']);

function canInterruptParagraph(node: Node): boolean {
    switch (node.type) {
        case 'heading':
        case 'thematicBreak':
        case 'blockquote':
        case 'code':
            return true;
        case 'list': {
            const list = node as List;
            const first = list.children?.[0];
            if (!first || !first.children?.length) return false;
            return !list.ordered || list.start == null || list.start === 1;
        }
        case 'html':
            return HTML_INTERRUPT.test((node as Literal).value ?? '');
        default:
            return false;
    }
}

function otherBullet(ch: string): string {
    return ch === '-' ? '*' : '-';
}

function otherOrdered(ch: string): string {
    return ch === '.' ? ')' : '.';
}

/** Prefix every line after the first with `indent` (blank lines stay blank). */
function indentLines(text: string, indent: string): string {
    return text.replace(/\n(?!\n|$)/g, '\n' + indent);
}

/**
 * Serialize block siblings. `tight` selects the tight-list-item joining;
 * `marker` is the enclosing list item's marker character (the first block
 * must not merge with it into a thematic break).
 */
export function serializeBlocks(nodes: readonly Node[], state: State, tight = false, marker?: string): string {
    let out = '';
    let prev: Node | undefined;
    let prevListChar: string | undefined;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        let s: string;
        let listChar: string | undefined;
        if (node.type === 'list' && !state.rules.has('list')) {
            const list = node as List;
            const ordered = !!list.ordered;
            listChar = ordered ? '.' : state.options.bullet;
            // Two adjacent lists with the same marker would re-parse as one.
            if (prev?.type === 'list' && !!(prev as List).ordered === ordered && prevListChar === listChar) {
                listChar = ordered ? otherOrdered(listChar) : otherBullet(listChar);
            }
            s = serializeList(list, state, listChar);
        } else {
            let avoid: string | undefined;
            if (node.type === 'thematicBreak') {
                if (prev === undefined) avoid = marker;
                else if (tight && prev.type === 'paragraph') avoid = '-'; // `---` would be a setext underline
            }
            s = serializeBlock(node, state, avoid);
        }
        if (s === '') continue;
        if (prev !== undefined) {
            const single = tight && (CLOSED_BLOCKS.has(prev.type) || (prev.type !== 'html' && canInterruptParagraph(node)));
            out += single ? '\n' : '\n\n';
        }
        out += s;
        prev = node;
        prevListChar = listChar;
    }
    return out;
}

/** Serialize any node. `avoid` is a rule character a thematic break must not use. */
export function serializeBlock(node: Node, state: State, avoid?: string): string {
    const rule = state.rules.get(node.type);
    if (rule) return runRule(rule, node, state);
    switch (node.type) {
        case 'root':
            return serializeBlocks((node as Root).children ?? [], state);
        case 'paragraph':
            return serializeParagraph(node as Paragraph, state);
        case 'heading':
            return serializeHeading(node as Heading, state);
        case 'thematicBreak': {
            const rule = state.options.rule;
            return rule[0] === avoid ? (rule === '---' ? '***' : '---') : rule;
        }
        case 'blockquote':
            return serializeBlockquote(node as Blockquote, state);
        case 'list':
            return serializeList(node as List, state, (node as List).ordered ? '.' : state.options.bullet);
        case 'listItem':
            return serializeListItem(node as ListItem, state, state.options.bullet, !!(node as ListItem).spread);
        case 'code':
            return serializeCode(node as Code, state);
        case 'html':
            return (node as Literal).value ?? '';
        case 'definition': {
            const def = node as Definition;
            return '[' + escapeLabel(def.label ?? def.identifier) + ']: ' + destination(def.url, def.title);
        }
        case 'table':
            return serializeTable(node as Table, state);
        case 'tableRow':
            return tableRow((node as TableRow).children.map((cell) => serializeCell(cell, state)));
        case 'tableCell':
            return serializeCell(node as TableRow['children'][number], state);
        default:
            if (PHRASING_TYPES.has(node.type)) return serializePhrasing(node, state, true);
            return serializeUnknown(node, state);
    }
}

const DEFINITION_LOOKALIKE = /^ {0,3}\[(?:\\[\s\S]|[^\\\]])*\]:/;

function serializeParagraph(node: Paragraph, state: State): string {
    let s = serializeInline(node.children, state, true);
    // Trailing whitespace never survives a parse; a hard break at the very
    // end would re-parse as a literal backslash.
    s = s.replace(/[ \t\n]+$/, '');
    // Text backslashes are escaped in pairs, so an odd trailing run is a break's.
    if (/\\*$/.exec(s)![0].length % 2 === 1) s = s.slice(0, -1);
    // `[ref]: …` on the first line would be a definition.
    if (DEFINITION_LOOKALIKE.test(s)) s = s.replace(/\]:/, ']\\:');
    return s;
}

/** Collapse the output of a run of phrasing content onto one line. */
function singleLine(s: string): string {
    return s.replace(/\\\n/g, ' ').replace(/\n/g, ' ');
}

function serializeHeading(node: Heading, state: State): string {
    const depth = Math.min(6, Math.max(1, node.depth | 0));
    let content = singleLine(serializeInline(node.children, state, false)).trim();
    // A trailing `#` run after a space would be a closing sequence.
    content = content.replace(/(^|\s)(#+)$/, '$1\\$2');
    const hashes = '#'.repeat(depth);
    return content === '' ? hashes : hashes + ' ' + content;
}

function serializeBlockquote(node: Blockquote, state: State): string {
    const saved = state.indent;
    state.indent += '> ';
    const body = serializeBlocks(node.children ?? [], state);
    state.indent = saved;
    if (body === '') return '>';
    return body
        .split('\n')
        .map((line) => (line === '' ? '>' : '> ' + line))
        .join('\n');
}

function serializeList(list: List, state: State, ch: string): string {
    const items = list.children ?? [];
    const ordered = !!list.ordered;
    const loose = !!list.spread || items.some((item) => !!item.spread);
    let n = list.start ?? 1;
    let out = '';
    for (let i = 0; i < items.length; i++) {
        const marker = ordered ? `${n}${ch}` : ch;
        if (ordered && state.options.incrementListMarker) n++;
        if (i > 0) out += loose ? '\n\n' : '\n';
        out += serializeListItem(items[i], state, marker, loose);
    }
    return out;
}

function serializeListItem(item: ListItem, state: State, marker: string, loose: boolean): string {
    const indent = ' '.repeat(marker.length + 1);
    const saved = state.indent;
    state.indent += indent;
    let body = serializeBlocks(item.children ?? [], state, !loose, marker[0]);
    state.indent = saved;
    if (item.checked === true || item.checked === false) {
        const box = item.checked ? '[x]' : '[ ]';
        body = body === '' ? box : box + ' ' + body;
    }
    if (body === '') return marker;
    return marker + ' ' + indentLines(body, indent);
}

function serializeCode(node: Code, state: State): string {
    const value = node.value ?? '';
    let info = node.lang ?? '';
    if (node.meta) info += (info ? ' ' : '') + node.meta;
    info = info.replace(/\r?\n/g, ' ');
    let ch = state.options.fence;
    // A backtick fence's info string may not contain backticks.
    if (ch === '`' && info.includes('`')) ch = '~';
    const fence = ch.repeat(Math.max(3, longestRun(value, ch) + 1));
    return fence + info + '\n' + (value === '' ? '' : value + '\n') + fence;
}

function serializeTable(table: Table, state: State): string {
    const rows = table.children ?? [];
    if (rows.length === 0) return '';
    const width = Math.max(1, rows[0].children?.length ?? 0);
    const align = table.align ?? [];
    const lines: string[] = [];
    for (let r = 0; r < rows.length; r++) {
        const cells: string[] = [];
        const rowCells = rows[r].children ?? [];
        for (let c = 0; c < width; c++) cells.push(rowCells[c] ? serializeCell(rowCells[c], state) : '');
        lines.push(tableRow(cells));
        if (r === 0) {
            const delims: string[] = [];
            for (let c = 0; c < width; c++) {
                const a = align[c];
                delims.push(a === 'left' ? ':--' : a === 'center' ? ':-:' : a === 'right' ? '--:' : '---');
            }
            lines.push(tableRow(delims));
        }
    }
    return lines.join('\n');
}

function tableRow(cells: readonly string[]): string {
    return '| ' + cells.join(' | ') + ' |';
}

function serializeCell(cell: TableRow['children'][number], state: State): string {
    // A cell is one line, and every `|` in it (even inside code) must be
    // escaped; a `|` already behind an odd number of backslashes is left alone.
    return singleLine(serializeInline(cell.children, state, false)).replace(/\\*\|/g, (m) =>
        m.length % 2 === 1 ? '\\' + m : m,
    );
}
