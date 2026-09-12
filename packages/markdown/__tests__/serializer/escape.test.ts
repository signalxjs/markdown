import { describe, expect, it } from 'vitest';
import { escapeLabel, escapeLinkDest, escapeText, longestRun, quoteTitle } from '../../src/serializer/escape.js';

describe('escapeText — inline rules', () => {
    it('always escapes backslash, backtick, star, underscore and brackets', () => {
        expect(escapeText('a\\b `c` *d* _e_ [f]')).toBe('a\\\\b \\`c\\` \\*d\\* \\_e\\_ \\[f\\]');
    });

    it('escapes < only when it could open a tag or autolink, or ends the run', () => {
        expect(escapeText('1 < 2')).toBe('1 < 2');
        expect(escapeText('<b>')).toBe('\\<b>');
        expect(escapeText('</b>')).toBe('\\</b>');
        expect(escapeText('<!-- x -->')).toBe('\\<!-- x -->');
        expect(escapeText('<?php')).toBe('\\<?php');
        expect(escapeText('a <')).toBe('a \\<');
    });

    it('escapes & only when it would form an entity, or ends the run', () => {
        expect(escapeText('a & b')).toBe('a & b');
        expect(escapeText('&amp;')).toBe('\\&amp;');
        expect(escapeText('&#39;')).toBe('\\&#39;');
        expect(escapeText('&#x27;')).toBe('\\&#x27;');
        expect(escapeText('&nope')).toBe('&nope');
        expect(escapeText('a &')).toBe('a \\&');
    });

    it('escapes doubled tildes and tildes at the edges', () => {
        expect(escapeText('a ~ b')).toBe('a ~ b');
        expect(escapeText('a ~~b~~')).toBe('a \\~\\~b\\~\\~');
        expect(escapeText('~a~')).toBe('\\~a\\~');
    });

    it('escapes ! before [ or at the end of the run', () => {
        expect(escapeText('hi!')).toBe('hi\\!');
        expect(escapeText('hi! there')).toBe('hi! there');
        expect(escapeText('![x]')).toBe('\\!\\[x\\]');
    });

    it('breaks bare URLs with entities so they stay text', () => {
        expect(escapeText('see https://example.com/x')).toBe('see https&#x3A;//example.com/x');
        expect(escapeText('HTTP://x')).toBe('HTTP&#x3A;//x');
        expect(escapeText('go to www.example.com')).toBe('go to www&#x2E;example.com');
        expect(escapeText('(www.example.com)')).toBe('(www&#x2E;example.com)');
        // Mid-word is not a boundary.
        expect(escapeText('awww.yes')).toBe('awww.yes');
        expect(escapeText('xhttp://y')).toBe('xhttp://y');
    });

    it('breaks email autolinks with an entity', () => {
        expect(escapeText('mail me@example.com')).toBe('mail me&#x40;example.com');
        expect(escapeText('@handle')).toBe('@handle');
        expect(escapeText('a @ b')).toBe('a @ b');
    });
});

describe('escapeText — line-start rules', () => {
    it('does nothing at line start when not asked', () => {
        expect(escapeText('# not a heading')).toBe('# not a heading');
        expect(escapeText('- not a list')).toBe('- not a list');
    });

    it('escapes ATX headings (followed by space or end) but not hashtags', () => {
        expect(escapeText('# h', true)).toBe('\\# h');
        expect(escapeText('###### h', true)).toBe('\\###### h');
        expect(escapeText('#', true)).toBe('\\#');
        expect(escapeText('#hashtag', true)).toBe('#hashtag');
        expect(escapeText('####### seven', true)).toBe('####### seven');
    });

    it('escapes blockquote and table markers', () => {
        expect(escapeText('> q', true)).toBe('\\> q');
        expect(escapeText('>q', true)).toBe('\\>q');
        expect(escapeText('| a |', true)).toBe('\\| a |');
    });

    it('escapes bullets followed by whitespace or end, not dashes in words', () => {
        expect(escapeText('- a', true)).toBe('\\- a');
        expect(escapeText('+ a', true)).toBe('\\+ a');
        expect(escapeText('-', true)).toBe('\\-');
        expect(escapeText('-a', true)).toBe('-a');
        expect(escapeText('* a', true)).toBe('\\* a');
    });

    it('escapes ordered markers (up to 9 digits) before the delimiter', () => {
        expect(escapeText('1. a', true)).toBe('1\\. a');
        expect(escapeText('42) a', true)).toBe('42\\) a');
        expect(escapeText('7.', true)).toBe('7\\.');
        expect(escapeText('1.5 kg', true)).toBe('1.5 kg');
        expect(escapeText('1234567890. a', true)).toBe('1234567890. a');
    });

    it('escapes setext underline / thematic break lookalikes', () => {
        expect(escapeText('---', true)).toBe('\\---');
        expect(escapeText('===', true)).toBe('\\===');
        expect(escapeText('=', true)).toBe('\\=');
        expect(escapeText('- - -', true)).toBe('\\- - -');
        expect(escapeText('--x', true)).toBe('--x');
    });

    it('honours up to three spaces of indentation and neutralises code indentation', () => {
        expect(escapeText('   # h', true)).toBe('   \\# h');
        expect(escapeText('    code', true)).toBe('&#x20;   code');
        expect(escapeText('\tcode', true)).toBe('&#x9;code');
    });

    it('treats every line after a soft break as a line start', () => {
        expect(escapeText('a\n- b\n# c')).toBe('a\n\\- b\n\\# c');
        expect(escapeText('a\n1. b', false)).toBe('a\n1\\. b');
    });

    it('is a no-op on empty text', () => {
        expect(escapeText('', true)).toBe('');
    });
});

describe('escapeLinkDest', () => {
    it('escapes parens and angle brackets in the bare form', () => {
        expect(escapeLinkDest('https://x.y/a(b)c')).toBe('https://x.y/a\\(b\\)c');
        expect(escapeLinkDest('<a>')).toBe('\\<a\\>');
        expect(escapeLinkDest('a\\b')).toBe('a\\\\b');
    });

    it('angle-wraps on whitespace, empty, control chars and unbalanced parens', () => {
        expect(escapeLinkDest('a b')).toBe('<a b>');
        expect(escapeLinkDest('')).toBe('<>');
        expect(escapeLinkDest('a)b')).toBe('<a)b>');
        expect(escapeLinkDest('a(b')).toBe('<a(b>');
        expect(escapeLinkDest('a\u0001b')).toBe('<a\u0001b>');
        expect(escapeLinkDest('a <b> c')).toBe('<a \\<b\\> c>');
        expect(escapeLinkDest('a\nb')).toBe('<a%0Ab>');
    });
});

describe('quoteTitle', () => {
    it('picks the quote that is absent', () => {
        expect(quoteTitle('plain')).toBe('"plain"');
        expect(quoteTitle('say "hi"')).toBe("'say \"hi\"'");
        expect(quoteTitle('it\'s "x"')).toBe('(it\'s "x")');
        expect(quoteTitle('it\'s "x" (y)')).toBe('"it\'s \\"x\\" (y)"');
        expect(quoteTitle('a\\b')).toBe('"a\\\\b"');
    });
});

describe('escapeLabel', () => {
    it('escapes bare brackets and keeps existing escapes', () => {
        expect(escapeLabel('a]b')).toBe('a\\]b');
        expect(escapeLabel('a\\]b')).toBe('a\\]b');
        expect(escapeLabel('[x')).toBe('\\[x');
        expect(escapeLabel('end\\')).toBe('end\\\\');
    });
});

describe('longestRun', () => {
    it('finds the longest run of a character', () => {
        expect(longestRun('a``b```c`', '`')).toBe(3);
        expect(longestRun('abc', '`')).toBe(0);
        expect(longestRun('', '~')).toBe(0);
    });
});
