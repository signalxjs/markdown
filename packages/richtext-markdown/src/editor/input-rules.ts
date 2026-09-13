/**
 * Markdown's input rules — the shortcuts that fire as you type markdown
 * syntax into a rich-text editor: `# ` at the start of a paragraph makes a
 * heading, `**bold**` becomes strong text, a fence or `---` on Enter becomes
 * a code block or a rule. Installed through `markdownPreset`; an editor
 * without it never interprets markdown syntax.
 */

import type { BlockContent, List, ListItem } from '@sigx/richtext';
import type { CommandContext } from '@sigx/richtext/editor';
import type { InlineFlat } from '@sigx/richtext/editor';
import { addMark, removeMark, sliceFlat, toInline } from '@sigx/richtext/editor';
import type { EnterRule, InputRule, InputRuleContext } from '@sigx/richtext/editor';
import type { EditorSelection } from '@sigx/richtext/editor';
import { textSelection } from '@sigx/richtext/editor';
import type { Step } from '@sigx/richtext/editor';
import type { Transaction } from '@sigx/richtext/editor';

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
    triggers: [' '],
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
    triggers: [' '],
    match: /^[-*+] \[( |x|X)\] $/,
    handler: (rc, m) => wrapInList('task', rc, 'task', 1, m[1] !== ' '),
};

const bullet: InputRule = {
    name: 'bullet',
    scope: 'blockStart',
    triggers: [' '],
    match: /^[-*+] $/,
    handler: (rc) => wrapInList('bullet', rc, 'bullet'),
};

const ordered: InputRule = {
    name: 'ordered',
    scope: 'blockStart',
    triggers: [' '],
    match: /^(\d{1,9})[.)] $/,
    handler: (rc, m) => wrapInList('ordered', rc, 'ordered', Number(m[1])),
};

const blockquote: InputRule = {
    name: 'blockquote',
    scope: 'blockStart',
    triggers: [' '],
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
        triggers: variants.map((v) => v.open[v.open.length - 1]),
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
    triggers: [')'],
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

/** The markdown input rules, in the order they are tried. */
export const markdownInputRules: readonly InputRule[] = [heading, task, bullet, ordered, blockquote, strong, emphasis, inlineCode, del, link];

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

/** The markdown Enter rules: a fence line becomes a code block, `---` a thematic break. */
export const markdownEnterRules: readonly EnterRule[] = [codeFence, thematicBreak];
