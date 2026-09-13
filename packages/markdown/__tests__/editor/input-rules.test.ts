import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/parser/index.js';
import { toMarkdown } from '../../src/serializer/index.js';
import { markdownSchema } from '../../src/schema/index.js';
import { createState, textSelection } from '../../src/editor/state.js';
import type { EditorSelection, EditorState } from '../../src/editor/state.js';
import type { BlockContent, Root } from '../../src/ast/index.js';
import { applyTransaction } from '../../src/editor/transaction.js';
import type { Transaction, TransactionMeta } from '../../src/editor/transaction.js';
import { insertText } from '../../src/editor/commands.js';
import type { CommandContext } from '../../src/editor/commands.js';
import { applyEnterRules, applyInputRules, isInputRuleEntry, triggerChars } from '../../src/editor/input-rules.js';
import { markdownEnterRules as enterInputRules, markdownInputRules as baseInputRules } from '../../src/editor/markdown/index.js';
import { markdownFormat } from '../../src/markdown/index.js';
import type { InputRule } from '../../src/editor/input-rules.js';
import { createHistory } from '../../src/editor/history.js';

const schema = markdownSchema;
const ctx: CommandContext = { schema, formats: [markdownFormat] };

const doc = (...children: BlockContent[]): Root => ({ type: 'root', children });
/** A paragraph holding `text` literally (markdown would parse `**a*` or a fence). */
const p = (text: string): BlockContent => ({ type: 'paragraph', children: text ? [{ type: 'text', value: text }] : [] });

function stateOf(md: string | Root, selection: EditorSelection): EditorState {
    return createState(typeof md === 'string' ? parseMarkdown(md) : md, selection, schema);
}

function apply(state: EditorState, tr: Transaction): EditorState {
    return applyTransaction(state, tr, ctx).state;
}

/**
 * Type `text` at the selection (through `insertText`, as a command or a
 * surface would), then consult the rules against the resulting state.
 * Returns the markdown after the rule (or after the typing when none fired).
 */
function type(md: string | Root, selection: EditorSelection, text: string, opts: { origin?: TransactionMeta['origin']; rules?: readonly InputRule[] } = {}) {
    const state = stateOf(md, selection);
    let typed!: Transaction;
    insertText(text, { origin: opts.origin ?? 'command' })(state, (t) => (typed = t), ctx);
    const afterTyping = apply(state, typed);
    const rule = applyInputRules(opts.rules ?? baseInputRules, typed, afterTyping, ctx);
    const next = rule ? apply(afterTyping, rule) : afterTyping;
    return { fired: !!rule, tr: rule, md: toMarkdown(next.doc), state: next, typed, afterTyping };
}

function enter(md: string | Root, selection: EditorSelection) {
    const state = stateOf(md, selection);
    const tr = applyEnterRules(state, ctx, enterInputRules);
    const next = tr ? apply(state, tr) : state;
    return { fired: !!tr, tr, md: toMarkdown(next.doc), state: next };
}

const at = (key: string, offset: number, to?: number) => textSelection(key, offset, to);

describe('applyInputRules gating', () => {
    it('only fires for a single replaceInline step from a surface or command ending in a trigger char', () => {
        expect(type('', at('b-0', 0), '# ').fired).toBe(true);
        expect(type('', at('b-0', 0), '# ', { origin: 'surface' }).fired).toBe(true);
        expect(type('', at('b-0', 0), '# ', { origin: 'paste' }).fired).toBe(false);
        // Text not ending in a trigger character.
        expect(type(doc(p('#')), at('b-0', 1), ' x').fired).toBe(false);
        expect(triggerChars(baseInputRules).has(' ')).toBe(true);
        expect(triggerChars([])).toEqual(new Set());
    });

    it('ignores transactions that are not typing', () => {
        const state = stateOf('# ', at('b-0', 2));
        const notTyping: Transaction = { steps: [{ type: 'setAttrs', key: 'b-0', attrs: {} }], meta: { origin: 'command' } };
        expect(applyInputRules(baseInputRules, notTyping, state, ctx)).toBeNull();
        const twoSteps: Transaction = {
            steps: [
                { type: 'replaceInline', key: 'b-0', from: 0, to: 0, slice: { text: '#', spans: [] } },
                { type: 'replaceInline', key: 'b-0', from: 1, to: 1, slice: { text: ' ', spans: [] } },
            ],
            meta: { origin: 'command' },
        };
        expect(applyInputRules(baseInputRules, twoSteps, state, ctx)).toBeNull();
    });

    it('requires the caret to sit right after the typed text', () => {
        const state = stateOf('# ', at('b-0', 0));
        const tr: Transaction = { steps: [{ type: 'replaceInline', key: 'b-0', from: 1, to: 1, slice: { text: ' ', spans: [] } }], meta: { origin: 'surface' } };
        expect(applyInputRules(baseInputRules, tr, state, ctx)).toBeNull();
    });

    it('never fires in code blocks or inside inline code', () => {
        expect(type('```\n\n```', at('b-0', 0), '# ').fired).toBe(false);
        expect(type('`a` b', at('b-0', 1), '**x**').fired).toBe(false);
        // Marks whose source overlaps a code span are left alone.
        expect(type(doc({ type: 'paragraph', children: [{ type: 'inlineCode', value: '**a' }] }), at('b-0', 3), '**').fired).toBe(false);
    });

    it('tags the transaction so the history can undo just the rule', () => {
        const r = type('', at('b-0', 0), '# ');
        expect(r.tr!.meta).toEqual({ origin: 'inputRule', inputRule: 'heading', group: 'typing' });
        const history = createHistory();
        const typing = applyTransaction(r.afterTyping, r.typed, ctx);
        history.record(r.typed, typing.inverse, null, r.afterTyping.selection);
        const rule = applyTransaction(r.afterTyping, r.tr!, ctx);
        history.record(r.tr!, rule.inverse, r.afterTyping.selection, r.state.selection);
        expect(history.done).toHaveLength(2);
        expect(isInputRuleEntry(history.peekInputRule())).toBe(true);
        expect(isInputRuleEntry(history.done[0])).toBe(false);
        expect(isInputRuleEntry(null)).toBe(false);
    });
});

describe('block-start rules', () => {
    it('heading: `#… ` becomes a heading of that depth, keeping the rest of the text', () => {
        const r = type('', at('b-0', 0), '# ');
        expect(r.md).toBe('#\n');
        expect(r.state.doc.children[0]).toMatchObject({ type: 'heading', depth: 1 });
        expect(r.state.selection).toEqual(at('b-0', 0));
        expect(type('', at('b-0', 0), '### ').state.doc.children[0]).toMatchObject({ type: 'heading', depth: 3 });
        expect(type('', at('b-0', 0), '####### ').fired).toBe(false);
        // Typed in front of existing text: the text becomes the heading's.
        const front = type('hello **w**', at('b-0', 0), '## ');
        expect(front.md).toBe('## hello **w**\n');
        expect(front.state.selection).toEqual(at('b-0', 0));
    });

    it('block-start rules only fire at the block start and only in paragraphs', () => {
        expect(type('a', at('b-0', 1), '# ').fired).toBe(false);
        expect(type('# h', at('b-0', 0), '# ').fired).toBe(false);
        expect(type('# h', at('b-0', 0), '- ').fired).toBe(false);
        expect(type('| a |\n| - |\n| b |', at('b-0.1.0', 0), '# ').fired).toBe(false);
    });

    it('bullet: `- `, `* `, `+ ` wrap the paragraph in a bullet list', () => {
        for (const marker of ['- ', '* ', '+ ']) {
            const r = type('item', at('b-0', 0), marker);
            expect(r.md).toBe('- item\n');
            expect(r.state.selection).toEqual(at('b-0.0.0', 0));
        }
        expect(type('', at('b-0', 0), '- ').tr!.meta.inputRule).toBe('bullet');
    });

    it('ordered: `1. ` / `3) ` start an ordered list at that number', () => {
        expect(type('item', at('b-0', 0), '1. ').md).toBe('1. item\n');
        const r = type('item', at('b-0', 0), '3) ');
        expect(r.state.doc.children[0]).toMatchObject({ type: 'list', ordered: true, start: 3 });
        expect(r.state.selection).toEqual(at('b-0.0.0', 0));
        expect(type('item', at('b-0', 0), '1234567890. ').fired).toBe(false);
    });

    it('task: `- [ ] ` / `- [x] ` make a task item, checked for x', () => {
        expect(type('todo', at('b-0', 0), '- [ ] ').md).toBe('- [ ] todo\n');
        expect(type('done', at('b-0', 0), '* [x] ').md).toBe('- [x] done\n');
        expect(type('done', at('b-0', 0), '- [X] ').md).toBe('- [x] done\n');
    });

    it('list rules do not fire in a paragraph that already is a list item', () => {
        expect(type('- a', at('b-0.0.0', 0), '- ').fired).toBe(false);
        expect(type('- a', at('b-0.0.0', 0), '1. ').fired).toBe(false);
        // …but do inside a blockquote.
        expect(type('> a', at('b-0.0', 0), '- ').md).toBe('> - a\n');
    });

    it('blockquote: `> ` wraps the paragraph', () => {
        const r = type('quote', at('b-0', 0), '> ');
        expect(r.md).toBe('> quote\n');
        expect(r.state.selection).toEqual(at('b-0.0', 0));
    });
});

describe('inline rules', () => {
    it('strong: `**x**` and `__x__`', () => {
        const r = type(doc(p('a **bold*')), at('b-0', 9), '*');
        expect(r.md).toBe('a **bold**\n');
        expect(r.state.selection).toEqual(at('b-0', 6));
        expect(r.tr!.meta.inputRule).toBe('strong');
        expect(type(doc(p('a __bold_')), at('b-0', 9), '_').md).toBe('a **bold**\n');
        // Typed in the middle of a line: only the part before the caret is consulted.
        const mid = type(doc(p('**b* tail')), at('b-0', 4), '*');
        expect(mid.md).toBe('**b** tail\n');
        expect(mid.state.selection).toEqual(at('b-0', 1));
    });

    it('emphasis: `*x*` and `_x_`, but not `**x*` and not intraword `_`', () => {
        expect(type(doc(p('a *em')), at('b-0', 5), '*').md).toBe('a *em*\n');
        expect(type(doc(p('a _em')), at('b-0', 5), '_').md).toBe('a *em*\n');
        // The opener is the second `*` of a strong opener: wait for the closer.
        expect(type(doc(p('**bold')), at('b-0', 6), '*').fired).toBe(false);
        expect(type(doc(p('snake_case')), at('b-0', 10), '_').fired).toBe(false);
        // Whitespace next to the delimiters is not emphasis.
        expect(type(doc(p('a * em')), at('b-0', 6), '*').fired).toBe(false);
    });

    it('inlineCode: `` `x` `` drops the marks inside', () => {
        const r = type(doc(p('run `**cmd**')), at('b-0', 12), '`');
        expect(r.md).toBe('run `**cmd**`\n');
        expect(r.state.selection).toEqual(at('b-0', 11));
        expect(r.state.doc.children[0]).toMatchObject({ children: [{ type: 'text', value: 'run ' }, { type: 'inlineCode', value: '**cmd**' }] });
    });

    it('delete: `~~x~~`', () => {
        const r = type(doc(p('a ~~gone~')), at('b-0', 9), '~');
        expect(r.md).toBe('a ~~gone~~\n');
        expect(r.state.selection).toEqual(at('b-0', 6));
    });

    it('link: `[text](url)` typed literally becomes a link', () => {
        const r = type(doc(p('see [docs](https://x')), at('b-0', 20), ')');
        expect(r.md).toBe('see [docs](https://x)\n');
        expect(r.state.selection).toEqual(at('b-0', 8));
        expect(r.tr!.meta.inputRule).toBe('link');
        // An image is not a link.
        expect(type(doc(p('![alt](u')), at('b-0', 8), ')').fired).toBe(false);
    });

    it('keeps existing marks and atoms inside the converted range', () => {
        const nested = doc({ type: 'paragraph', children: [{ type: 'text', value: '**a ' }, { type: 'emphasis', children: [{ type: 'text', value: 'b' }] }, { type: 'text', value: ' c*' }] });
        expect(type(nested, at('b-0', 8), '*').md).toBe('**a *b* c**\n');
        const withImage = doc({ type: 'paragraph', children: [{ type: 'text', value: '**see ' }, { type: 'image', url: 'u', alt: 'i' }, { type: 'text', value: '*' }] });
        const atom = type(withImage, at('b-0', 8), '*');
        expect(atom.md).toBe('**see ![i](u)**\n');
    });

    it('inline rules fire in headings and table cells too', () => {
        expect(type(doc({ type: 'heading', depth: 1, children: [{ type: 'text', value: 'a **b*' }] }), at('b-0', 6), '*').md).toBe('# a **b**\n');
        expect(type('| a |\n| - |\n| *b |', at('b-0.1.0', 2), '*').md).toContain('| *b* |');
    });

    it('rule order and custom rule sets', () => {
        const names = baseInputRules.map((r) => r.name);
        expect(names).toEqual(['heading', 'task', 'bullet', 'ordered', 'blockquote', 'strong', 'emphasis', 'inlineCode', 'delete', 'link']);
        const shout: InputRule = {
            name: 'shout',
            scope: 'inline',
            triggers: [' '],
            match: /!! $/,
            blockTypes: ['heading'],
            handler: (rc) => ({ steps: [{ type: 'replaceInline', key: rc.key, from: rc.from, to: rc.to, slice: { text: '! ', spans: [] } }], meta: { origin: 'inputRule', inputRule: 'shout' } }),
        };
        expect(type('# hi!!', at('b-0', 4), ' ', { rules: [shout] }).md).toBe('# hi!\n');
        expect(type('hi!!', at('b-0', 4), ' ', { rules: [shout] }).fired).toBe(false);
    });
});

describe('applyEnterRules', () => {
    it('codeFence: ```lang becomes an empty code block with that language', () => {
        const r = enter(doc(p('```ts')), at('b-0', 5));
        expect(r.fired).toBe(true);
        expect(r.state.doc.children[0]).toMatchObject({ type: 'code', lang: 'ts', value: '' });
        expect(r.state.selection).toEqual(at('b-0', 0));
        expect(r.tr!.meta).toMatchObject({ origin: 'inputRule', inputRule: 'codeFence' });
        expect(enter(doc(p('```')), at('b-0', 3)).state.doc.children[0]).toMatchObject({ type: 'code', lang: null });
        expect(enter(doc(p('~~~c++')), at('b-0', 6)).state.doc.children[0]).toMatchObject({ type: 'code', lang: 'c++' });
    });

    it('thematicBreak: ---, ***, ___ become a rule with a paragraph after', () => {
        // `---` alone parses as a setext underline / hr, so build the paragraph by hand.
        for (const text of ['---', '***', '___', '-----']) {
            const state = stateOf(doc(p(text)), at('b-0', text.length));
            const tr = applyEnterRules(state, ctx, enterInputRules);
            expect(tr).not.toBeNull();
            const next = apply(state, tr!);
            expect(next.doc.children.map((c) => c.type)).toEqual(['thematicBreak', 'paragraph']);
            expect(next.selection).toEqual(at('b-1', 0));
            expect(tr!.meta.inputRule).toBe('thematicBreak');
        }
    });

    it('only fires with a collapsed caret at the end of a paragraph', () => {
        expect(enter(doc(p('```ts')), at('b-0', 2)).fired).toBe(false);
        expect(enter(doc(p('```ts')), at('b-0', 0, 5)).fired).toBe(false);
        expect(enter(doc({ type: 'heading', depth: 1, children: [{ type: 'text', value: '```' }] }), at('b-0', 3)).fired).toBe(false);
        expect(enter(doc(p('```ts x')), at('b-0', 7)).fired).toBe(false);
        expect(enter('```\nx\n```', at('b-0', 1)).fired).toBe(false);
        expect(enterInputRules.map((r) => r.name)).toEqual(['codeFence', 'thematicBreak']);
    });

    it('works inside a list item', () => {
        const r = enter(doc({ type: 'list', ordered: false, spread: false, children: [{ type: 'listItem', spread: false, children: [p('```js')] }] }), at('b-0.0.0', 5));
        expect(r.state.doc.children[0]).toMatchObject({ type: 'list', children: [{ children: [{ type: 'code', lang: 'js' }] }] });
        expect(r.state.selection).toEqual(at('b-0.0.0', 0));
    });
});
