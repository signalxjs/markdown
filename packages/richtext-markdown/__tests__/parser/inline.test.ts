import { describe, expect, it, vi } from 'vitest';
import { parseInline, toPlainText } from '../../src/parser/index.js';
import { resolveMarkdownPlugins } from '../../src/plugin/resolve.js';
import type { RichTextPlugin } from '@sigx/richtext';
import type { InlineSyntaxExtension } from '../../src/plugin/markdown.js';
import type { PhrasingContent } from '@sigx/richtext';

const text = (value: string): PhrasingContent => ({ type: 'text', value });

describe('parseInline', () => {
    it('parses plain text', () => {
        expect(parseInline('hello world')).toEqual([text('hello world')]);
    });

    it('parses strong with surrounding text', () => {
        expect(parseInline('a **b** c')).toEqual([text('a '), { type: 'strong', children: [text('b')] }, text(' c')]);
    });

    it('parses emphasis with underscore', () => {
        expect(parseInline('_x_')).toEqual([{ type: 'emphasis', children: [text('x')] }]);
    });

    it('does not treat intraword underscores as emphasis', () => {
        expect(parseInline('foo_bar_baz')).toEqual([text('foo_bar_baz')]);
    });

    it('parses nested emphasis', () => {
        expect(parseInline('**a _b_ c**')).toEqual([
            { type: 'strong', children: [text('a '), { type: 'emphasis', children: [text('b')] }, text(' c')] },
        ]);
    });

    it('parses strong inside emphasis (***x***)', () => {
        expect(parseInline('***x***')).toEqual([
            { type: 'emphasis', children: [{ type: 'strong', children: [text('x')] }] },
        ]);
    });

    it('applies the rule of 3', () => {
        // Spec example: `*foo**bar**baz*`
        expect(parseInline('*foo**bar**baz*')).toEqual([
            { type: 'emphasis', children: [text('foo'), { type: 'strong', children: [text('bar')] }, text('baz')] },
        ]);
        // `foo***bar***baz` → foo<em><strong>bar</strong></em>baz
        expect(parseInline('foo***bar***baz')).toEqual([
            text('foo'),
            { type: 'emphasis', children: [{ type: 'strong', children: [text('bar')] }] },
            text('baz'),
        ]);
    });

    it('parses strikethrough (double tilde only)', () => {
        expect(parseInline('~~gone~~')).toEqual([{ type: 'delete', children: [text('gone')] }]);
        expect(parseInline('~one~')).toEqual([text('~one~')]);
    });

    it('parses a code span (literal content, entities not decoded)', () => {
        expect(parseInline('use `a*b` now')).toEqual([text('use '), { type: 'inlineCode', value: 'a*b' }, text(' now')]);
        expect(parseInline('`&amp;`')).toEqual([{ type: 'inlineCode', value: '&amp;' }]);
        expect(parseInline('`` a`b ``')).toEqual([{ type: 'inlineCode', value: 'a`b' }]);
    });

    it('parses a link with title', () => {
        expect(parseInline('[t](http://x "hi")')).toEqual([{ type: 'link', url: 'http://x', title: 'hi', children: [text('t')] }]);
    });

    it('parses an image with plain-text alt', () => {
        expect(parseInline('![*alt* text](http://img.png)')).toEqual([{ type: 'image', url: 'http://img.png', alt: 'alt text' }]);
    });

    it('parses an angle autolink as a link flagged autolink', () => {
        expect(parseInline('<https://x.com>')).toEqual([
            { type: 'link', url: 'https://x.com', children: [text('https://x.com')], data: { autolink: true } },
        ]);
        expect(parseInline('<a@b.co>')).toEqual([
            { type: 'link', url: 'mailto:a@b.co', children: [text('a@b.co')], data: { autolink: true } },
        ]);
    });

    it('parses a bare GFM autolink and trims trailing punctuation', () => {
        expect(parseInline('see https://x.com.')).toEqual([
            text('see '),
            { type: 'link', url: 'https://x.com', children: [text('https://x.com')], data: { autolink: true } },
            text('.'),
        ]);
        expect(parseInline('www.example.com/a_b')[0]).toMatchObject({ type: 'link', url: 'http://www.example.com/a_b' });
    });

    it('parses bare GFM email autolinks', () => {
        expect(parseInline('mail foo@bar.baz.')).toEqual([
            text('mail '),
            { type: 'link', url: 'mailto:foo@bar.baz', children: [text('foo@bar.baz')], data: { autolink: true } },
            text('.'),
        ]);
        expect(parseInline('a.b-c_d@a.b_')).toEqual([text('a.b-c_d@a.b_')]);
        expect(parseInline('x@y')).toEqual([text('x@y')]);
    });

    it('honors backslash escapes', () => {
        expect(parseInline('a \\* b')).toEqual([text('a * b')]);
        expect(parseInline('\\\\')).toEqual([text('\\')]);
    });

    it('decodes entity and numeric character references into literal text', () => {
        expect(parseInline('&amp; &#42; &#x2A; &copy;')).toEqual([text('& * * ©')]);
        expect(parseInline('&#42;x&#42;')).toEqual([text('*x*')]);
        expect(parseInline('&bogus; &#0;')).toEqual([text('&bogus; �')]);
    });

    it('keeps the raw url in the AST (sanitisation is a render concern)', () => {
        expect(parseInline('[x](javascript:alert(1))')).toEqual([
            { type: 'link', url: 'javascript:alert(1)', children: [text('x')] },
        ]);
    });

    it('keeps soft line breaks as newlines and strips surrounding spaces', () => {
        expect(parseInline('one  \n   two')).toEqual([text('one'), { type: 'break' }, text('two')]);
        expect(parseInline('one \n   two')).toEqual([text('one\ntwo')]);
        expect(parseInline('one\\\ntwo')).toEqual([text('one'), { type: 'break' }, text('two')]);
    });

    it('parses reference links whether or not a definition exists', () => {
        expect(parseInline('[foo][Bar]')).toEqual([
            { type: 'linkReference', identifier: 'bar', label: 'Bar', referenceType: 'full', children: [text('foo')] },
        ]);
        expect(parseInline('[foo][]')).toEqual([
            { type: 'linkReference', identifier: 'foo', label: 'foo', referenceType: 'collapsed', children: [text('foo')] },
        ]);
        expect(parseInline('[foo]')).toEqual([
            { type: 'linkReference', identifier: 'foo', label: 'foo', referenceType: 'shortcut', children: [text('foo')] },
        ]);
        expect(parseInline('![foo]')).toEqual([
            { type: 'imageReference', identifier: 'foo', label: 'foo', referenceType: 'shortcut', alt: 'foo' },
        ]);
    });

    it('does not nest links inside links', () => {
        const out = parseInline('[a [b](c)](d)');
        expect(out[0]).toEqual(text('[a '));
        expect(out[1]).toMatchObject({ type: 'link', url: 'c' });
    });

    // -- streaming-tail edge cases: never throw, degrade to literal --
    it('renders a lone delimiter literally', () => {
        expect(parseInline('text **bo')).toEqual([text('text **bo')]);
    });

    it('renders a half-open inline link as a shortcut reference plus text', () => {
        expect(parseInline('[anchor](')).toEqual([
            { type: 'linkReference', identifier: 'anchor', label: 'anchor', referenceType: 'shortcut', children: [text('anchor')] },
            text('('),
        ]);
    });

    it('renders an unterminated code span literally', () => {
        expect(parseInline('a `b')).toEqual([text('a `b')]);
    });

    it('attaches positions when a point mapper is given', () => {
        const pointAt = (i: number) => ({ line: 1, column: i + 1, offset: i });
        const out = parseInline('a **b**', { pointAt });
        expect(out[0].position).toEqual({ start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 3, offset: 2 } });
        // Emphasis spans its delimiters (mdast); the inner text is just `b`.
        expect(out[1].position).toEqual({ start: { line: 1, column: 3, offset: 2 }, end: { line: 1, column: 8, offset: 7 } });
        expect((out[1] as { children: PhrasingContent[] }).children[0].position).toEqual({
            start: { line: 1, column: 5, offset: 4 },
            end: { line: 1, column: 6, offset: 5 },
        });
    });

    it('flattens to plain text', () => {
        expect(toPlainText(parseInline('a **b** `c` ![d](e)'))).toBe('a b c d');
    });
});

describe('parseInline (extensions)', () => {
    const mention: InlineSyntaxExtension = {
        name: 'mention',
        triggerChars: ['@'],
        match(text, pos) {
            const m = /^@\[([^\]\n]+)\]\(([^)\n]+)\)/.exec(text.slice(pos));
            if (!m) return null;
            return { node: { type: 'mention', label: m[1], id: m[2] } as unknown as PhrasingContent, end: pos + m[0].length };
        },
    };
    const plugin: RichTextPlugin = { name: 'mention', formats: { markdown: { inline: [mention] } } };
    const plugins = resolveMarkdownPlugins([plugin]);

    it('parses an extension node', () => {
        expect(parseInline('hi @[Andy](u1)!', { plugins })).toEqual([
            text('hi '),
            { type: 'mention', label: 'Andy', id: 'u1' },
            text('!'),
        ]);
    });

    it('is opaque to the emphasis stack', () => {
        expect(parseInline('**@[a](b)**', { plugins })).toEqual([
            { type: 'strong', children: [{ type: 'mention', label: 'a', id: 'b' }] },
        ]);
    });

    it('reaches extensions inside link labels', () => {
        const out = parseInline('[see @[a](b)](http://x)', { plugins });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ type: 'link', url: 'http://x', children: [text('see '), { type: 'mention' }] });
    });

    it('degrades a partial tail to literal text (streaming-safe)', () => {
        expect(parseInline('hi @[An', { plugins })).toEqual([text('hi @[An')]);
    });

    it('keeps a backslash-escaped trigger char literal', () => {
        expect(parseInline('\\@[a](b)', { plugins })[0]).toMatchObject({ type: 'text' });
        expect(parseInline('\\@[a](b)', { plugins }).some((n) => (n as { type: string }).type === 'mention')).toBe(false);
    });

    it('ignores non-advancing, out-of-bounds and throwing matches', () => {
        const broken: InlineSyntaxExtension = {
            name: 'broken',
            triggerChars: ['@'],
            match: (_t, pos) => ({ node: { type: 'x' } as unknown as PhrasingContent, end: pos }),
        };
        const greedy: InlineSyntaxExtension = {
            name: 'greedy',
            triggerChars: ['@'],
            match: (t) => ({ node: { type: 'x' } as unknown as PhrasingContent, end: t.length + 100 }),
        };
        const throwing: InlineSyntaxExtension = {
            name: 'throwing',
            triggerChars: ['@'],
            match: () => {
                throw new Error('plugin bug');
            },
        };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const ext of [broken, greedy, throwing]) {
            expect(parseInline('a @b', { plugins: resolveMarkdownPlugins([{ name: 'p', formats: { markdown: { inline: [ext] } } }]) })).toEqual([text('a @b')]);
        }
        warn.mockRestore();
    });

    it('never calls match when the trigger char is absent', () => {
        const spy = vi.fn(() => null);
        const ext: InlineSyntaxExtension = { name: 'x', triggerChars: ['@'], match: spy };
        parseInline('plain **bold** `code` [l](h)', { plugins: resolveMarkdownPlugins([{ name: 'p', formats: { markdown: { inline: [ext] } } }]) });
        expect(spy).not.toHaveBeenCalled();
    });

    it('first registered extension wins on a shared trigger char', () => {
        const first: InlineSyntaxExtension = {
            name: 'first',
            triggerChars: ['@'],
            match: (t, pos) => (t[pos + 1] === '!' ? { node: { type: 'first' } as unknown as PhrasingContent, end: pos + 2 } : null),
        };
        const both = resolveMarkdownPlugins([{ name: 'a', formats: { markdown: { inline: [first] } } }, plugin]);
        expect(parseInline('@!', { plugins: both })).toEqual([{ type: 'first' }]);
        expect(parseInline('@[a](b)', { plugins: both })[0]).toMatchObject({ type: 'mention' });
    });

    it('decodes plugin-provided entities', () => {
        const p = resolveMarkdownPlugins([{ name: 'e', formats: { markdown: { entities: { shrug: '¯\\_(ツ)_/¯' } } } }]);
        expect(parseInline('&shrug;', { plugins: p })).toEqual([text('¯\\_(ツ)_/¯')]);
    });
});
