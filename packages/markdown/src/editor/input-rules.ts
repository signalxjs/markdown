/**
 * Input rules — markdown shortcuts that fire as you type. `# ` at the start
 * of a paragraph makes a heading, `**bold**` becomes strong text, and so on.
 *
 * The editor runs `applyInputRules` after every typing transaction (a single
 * `replaceInline` step whose inserted text ends in a trigger character): a
 * rule matches the text before the caret and answers with a follow-up
 * transaction tagged `origin: 'inputRule'`, which the history keeps as its
 * own entry so Backspace right after can undo just the rule (see
 * `isInputRuleEntry`). Enter never reaches a rule as text, so the fence and
 * thematic-break shortcuts are `enterInputRules`, which the editor consults
 * before `splitBlock`.
 */

import type { BlockContent, List, ListItem } from '../ast/index.js';
import type { CommandContext } from './commands.js';
import type { InlineFlat } from './inline-flat.js';
import { addMark, marksAt, removeMark, sliceFlat, toInline } from './inline-flat.js';
import type { EditorSelection, EditorState } from './state.js';
import { textSelection } from './state.js';
import type { Step } from './steps.js';
import { flatOf } from './steps.js';
import type { Transaction } from './transaction.js';

export interface InputRuleContext {
    state: EditorState;
    /** The block the caret is in. */
    key: string;
    /** The block's flat model, after the typed text. */
    flat: InlineFlat;
    /** Where the match starts (`m.index`). */
    from: number;
    /** The caret (exclusive end of the match). */
    to: number;
    ctx: CommandContext;
}

export interface InputRule {
    name: string;
    /** `blockStart` rules match the whole text from the block start to the caret; `inline` rules match a suffix of it. */
    scope: 'blockStart' | 'inline';
    match: RegExp;
    /** Block types the rule applies in (default: paragraph for `blockStart`, any inline container for `inline`). */
    blockTypes?: string[];
    handler(rc: InputRuleContext, m: RegExpMatchArray): Transaction | null;
}

/** A rule the editor consults on Enter: it matches the whole text of the block. */
export interface EnterRule {
    name: string;
    match: RegExp;
    /** Default: paragraph. */
    blockTypes?: string[];
    handler(rc: InputRuleContext, m: RegExpMatchArray): Transaction | null;
}

/** The characters that end a typed slice and make the editor consult the rules. */
export const TRIGGER_CHARS: ReadonlySet<string> = new Set([' ', '`', '*', '_', '~', ')', ']']);

function ruleTransaction(name: string, steps: Step[], selection: EditorSelection): Transaction {
    return { steps, selection, meta: { origin: 'inputRule', inputRule: name, group: 'typing' } };
}

function keyAt(parentKey: string | null, index: number): string {
    return parentKey === null ? `b-${index}` : `${parentKey}.${index}`;
}

function paragraphOf(flat: InlineFlat, ctx: CommandContext): BlockContent {
    return { type: 'paragraph', children: toInline(flat, ctx.schema) };
}

/** Whether an inline-code span touches `[from, to)`. */
function overlapsCode(flat: InlineFlat, from: number, to: number): boolean {
    return flat.spans.some((s) => s.type === 'inlineCode' && s.start < to && s.end > from);
}

// ---------------------------------------------------------------------------
// Block-start rules
// ---------------------------------------------------------------------------

const heading: InputRule = {
    name: 'heading',
    scope: 'blockStart',
    match: /^(#{1,6}) $/,
    handler(rc, m) {
        const spec = rc.ctx.schema.get('heading');
        if (!spec?.fromInline) return null;
        const rest = sliceFlat(rc.flat, rc.to, rc.flat.text.length);
        const node = spec.fromInline(toInline(rest, rc.ctx.schema), { depth: m[1].length });
        return ruleTransaction('heading', [{ type: 'replaceBlock', key: rc.key, node }], textSelection(rc.key, 0));
    },
};

function wrapInList(name: string, rc: InputRuleContext, kind: 'bullet' | 'ordered' | 'task', start = 1, checked?: boolean): Transaction | null {
    const entry = rc.state.index().get(rc.key);
    // Inside a list item the marker would re-list an item that already is one.
    if (!entry || entry.parent.type === 'listItem') return null;
    const rest = sliceFlat(rc.flat, rc.to, rc.flat.text.length);
    const item: ListItem = { type: 'listItem', spread: false, children: [paragraphOf(rest, rc.ctx)] };
    if (kind === 'task') item.checked = checked ?? false;
    const list: List = { type: 'list', ordered: kind === 'ordered', spread: false, children: [item] };
    if (kind === 'ordered') list.start = start;
    return ruleTransaction(name, [{ type: 'replaceBlock', key: rc.key, node: list }], textSelection(`${rc.key}.0.0`, 0));
}

const task: InputRule = {
    name: 'task',
    scope: 'blockStart',
    match: /^[-*+] \[( |x|X)\] $/,
    handler: (rc, m) => wrapInList('task', rc, 'task', 1, m[1] !== ' '),
};

const bullet: InputRule = {
    name: 'bullet',
    scope: 'blockStart',
    match: /^[-*+] $/,
    handler: (rc) => wrapInList('bullet', rc, 'bullet'),
};

const ordered: InputRule = {
    name: 'ordered',
    scope: 'blockStart',
    match: /^(\d{1,9})[.)] $/,
    handler: (rc, m) => wrapInList('ordered', rc, 'ordered', Number(m[1])),
};

const blockquote: InputRule = {
    name: 'blockquote',
    scope: 'blockStart',
    match: /^> $/,
    handler(rc) {
        const rest = sliceFlat(rc.flat, rc.to, rc.flat.text.length);
        const node: BlockContent = { type: 'blockquote', children: [paragraphOf(rest, rc.ctx)] };
        return ruleTransaction('blockquote', [{ type: 'replaceBlock', key: rc.key, node }], textSelection(`${rc.key}.0`, 0));
    },
};

// ---------------------------------------------------------------------------
// Inline mark rules
// ---------------------------------------------------------------------------

interface MarkVariant {
    /** The delimiter (`**`, `_`, `` ` ``…). */
    open: string;
    /** Character class the character before the opener must NOT be in (`*` so `**a*` is not emphasis; `_\w` so `snake_case_` is not). */
    notBefore: string;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A rule turning `<open>text<open>` into a mark over `text`. Each variant
 * becomes one alternative, capturing the whole source and the inner text;
 * the inner text may not start or end with whitespace or contain the
 * delimiter character. Existing marks and atoms inside are kept.
 */
function markRule(name: string, mark: string, variants: MarkVariant[]): InputRule {
    const alternatives = variants.map(({ open, notBefore }) => {
        const d = escapeRegExp(open[0]);
        const o = escapeRegExp(open);
        const inner = `[^${d}\\s](?:[^${d}]*[^${d}\\s])?`;
        return `(?:^|[^${notBefore}])(${o}(${inner})${o})`;
    });
    return {
        name,
        scope: 'inline',
        match: new RegExp(`(?:${alternatives.join('|')})$`),
        handler(rc, m) {
            for (let i = 0; i < variants.length; i++) {
                const source = m[1 + i * 2];
                if (source === undefined) continue;
                const open = variants[i].open;
                const from = rc.to - source.length;
                if (overlapsCode(rc.flat, from, rc.to)) return null;
                let inner = sliceFlat(rc.flat, from + open.length, rc.to - open.length);
                if (mark === 'inlineCode') inner = { text: inner.text, spans: [] };
                const slice = addMark(inner, mark, 0, inner.text.length);
                return ruleTransaction(name, [{ type: 'replaceInline', key: rc.key, from, to: rc.to, slice }], textSelection(rc.key, from + inner.text.length));
            }
            return null;
        },
    };
}

const strong = markRule('strong', 'strong', [
    { open: '**', notBefore: '*' },
    { open: '__', notBefore: '_\\w' },
]);

const emphasis = markRule('emphasis', 'emphasis', [
    { open: '*', notBefore: '*' },
    { open: '_', notBefore: '_\\w' },
]);

const inlineCode = markRule('inlineCode', 'inlineCode', [{ open: '`', notBefore: '`' }]);

const del = markRule('delete', 'delete', [{ open: '~~', notBefore: '~' }]);

const link: InputRule = {
    name: 'link',
    scope: 'inline',
    match: /(?:^|[^!])(\[([^[\]]+)\]\(([^()\s]+)\))$/,
    handler(rc, m) {
        const source = m[1];
        const text = m[2];
        const url = m[3];
        const from = rc.to - source.length;
        if (overlapsCode(rc.flat, from, rc.to)) return null;
        const inner = sliceFlat(rc.flat, from + 1, from + 1 + text.length);
        const slice = addMark(removeMark(inner, 'link', 0, inner.text.length), 'link', 0, inner.text.length, { url });
        return ruleTransaction('link', [{ type: 'replaceInline', key: rc.key, from, to: rc.to, slice }], textSelection(rc.key, from + inner.text.length));
    },
};

/** The built-in rules, in the order they are tried. */
export const baseInputRules: InputRule[] = [heading, task, bullet, ordered, blockquote, strong, emphasis, inlineCode, del, link];

// ---------------------------------------------------------------------------
// Enter rules
// ---------------------------------------------------------------------------

const codeFence: EnterRule = {
    name: 'codeFence',
    match: /^(?:```|~~~)([\w+#.-]*)\s*$/,
    handler(rc, m) {
        const spec = rc.ctx.schema.get('code');
        if (!spec?.fromInline) return null;
        const node = spec.fromInline([], { lang: m[1] || null });
        return ruleTransaction('codeFence', [{ type: 'replaceBlock', key: rc.key, node }], textSelection(rc.key, 0));
    },
};

const thematicBreak: EnterRule = {
    name: 'thematicBreak',
    match: /^(?:-{3,}|\*{3,}|_{3,})\s*$/,
    handler(rc) {
        const entry = rc.state.index().get(rc.key);
        if (!entry) return null;
        const steps: Step[] = [
            { type: 'replaceBlock', key: rc.key, node: { type: 'thematicBreak' } },
            { type: 'insertBlock', parentKey: entry.parentKey, index: entry.index + 1, node: { type: 'paragraph', children: [] } },
        ];
        return ruleTransaction('thematicBreak', steps, textSelection(keyAt(entry.parentKey, entry.index + 1), 0));
    },
};

export const enterInputRules: EnterRule[] = [codeFence, thematicBreak];

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function appliesTo(rule: { scope?: 'blockStart' | 'inline'; blockTypes?: string[] }, type: string, ctx: CommandContext): boolean {
    if (rule.blockTypes) return rule.blockTypes.includes(type);
    if (rule.scope === 'inline') return ctx.schema.role(type) === 'textblock';
    return type === 'paragraph';
}

/**
 * Try the rules against the state a typing transaction produced. `tr` must
 * be a single `replaceInline` step from a surface or a command whose text
 * ends in a trigger character, with the caret right after it. Returns the
 * follow-up transaction of the first rule that fires, or `null`.
 */
export function applyInputRules(rules: readonly InputRule[], tr: Transaction, state: EditorState, ctx: CommandContext): Transaction | null {
    if (tr.steps.length !== 1) return null;
    const step = tr.steps[0];
    if (step.type !== 'replaceInline') return null;
    if (tr.meta.origin !== 'surface' && tr.meta.origin !== 'command') return null;
    const typed = step.slice.text;
    if (!typed || !TRIGGER_CHARS.has(typed[typed.length - 1])) return null;
    const caret = step.from + typed.length;
    const sel = state.selection;
    if (!sel || sel.mode !== 'text' || sel.anchor.key !== step.key || sel.anchor.offset !== caret || sel.head.offset !== caret) return null;
    const entry = state.index().get(step.key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return null;
    const flat = flatOf(entry.node, ctx);
    if (caret > flat.text.length) return null;
    // Never inside inline code.
    if (marksAt(flat, caret, caret, ctx.schema).includes('inlineCode')) return null;
    const text = flat.text.slice(0, caret);

    for (const rule of rules) {
        if (!appliesTo(rule, entry.node.type, ctx)) continue;
        rule.match.lastIndex = 0;
        const m = rule.match.exec(text);
        if (!m) continue;
        const end = m.index + m[0].length;
        if (rule.scope === 'blockStart' ? m.index !== 0 || end !== text.length : end !== text.length) continue;
        const out = rule.handler({ state, key: step.key, flat, from: m.index, to: caret, ctx }, m);
        if (out) return out;
    }
    return null;
}

/** Try the Enter rules: a collapsed caret at the end of a paragraph whose whole text matches. */
export function applyEnterRules(state: EditorState, ctx: CommandContext, rules: readonly EnterRule[] = enterInputRules): Transaction | null {
    const sel = state.selection;
    if (!sel || sel.mode !== 'text' || sel.anchor.offset !== sel.head.offset) return null;
    const key = sel.anchor.key;
    const entry = state.index().get(key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return null;
    const flat = flatOf(entry.node, ctx);
    if (sel.anchor.offset !== flat.text.length) return null;
    const text = flat.text;
    for (const rule of rules) {
        if (!appliesTo(rule, entry.node.type, ctx)) continue;
        rule.match.lastIndex = 0;
        const m = rule.match.exec(text);
        if (!m || m.index !== 0 || m[0].length !== text.length) continue;
        const out = rule.handler({ state, key, flat, from: 0, to: text.length, ctx }, m);
        if (out) return out;
    }
    return null;
}

/** Whether a history entry was produced by an input rule (Backspace right after undoes just that entry). */
export function isInputRuleEntry(entry: { inputRule?: string } | null | undefined): boolean {
    return !!entry?.inputRule;
}
