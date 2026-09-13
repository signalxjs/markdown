import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/tokenizer.js';

describe('tokenize', () => {
    it('reads start tags with attributes, end tags and decoded text', () => {
        expect(tokenize('<p class="x" data-a=\'1\' hidden>a &amp; b &#x41;</p>')).toEqual([
            { kind: 'open', name: 'p', attrs: { class: 'x', 'data-a': '1', hidden: '' }, selfClosing: false },
            { kind: 'text', value: 'a & b A' },
            { kind: 'close', name: 'p' },
        ]);
    });

    it('lowercases names, keeps the first duplicate attribute, and marks self-closing tags', () => {
        expect(tokenize('<IMG SRC=a src="b"/>')).toEqual([{ kind: 'open', name: 'img', attrs: { src: 'a' }, selfClosing: true }]);
        // An unquoted value runs to whitespace or `>`: the slash is part of it.
        expect(tokenize('<img src=b/>')).toEqual([{ kind: 'open', name: 'img', attrs: { src: 'b/' }, selfClosing: false }]);
        expect(tokenize('<BR>')).toEqual([{ kind: 'open', name: 'br', attrs: {}, selfClosing: false }]);
        expect(tokenize('</br>')).toEqual([{ kind: 'open', name: 'br', attrs: {}, selfClosing: true }]);
    });

    it('skips comments, doctypes and processing instructions', () => {
        expect(tokenize('<!doctype html><!-- x --><?xml ?>a<!-- unterminated')).toEqual([{ kind: 'text', value: 'a' }]);
    });

    it('swallows scripts, styles, heads and other non-text elements whole', () => {
        expect(tokenize('<head><title>t</title><style>p{}</style></head><body><script>alert("<p>")</script><p>x</p><svg><circle/></svg></body>')).toEqual([
            { kind: 'open', name: 'head', attrs: {}, selfClosing: false },
            { kind: 'close', name: 'head' },
            { kind: 'open', name: 'body', attrs: {}, selfClosing: false },
            { kind: 'open', name: 'script', attrs: {}, selfClosing: false },
            { kind: 'close', name: 'script' },
            { kind: 'open', name: 'p', attrs: {}, selfClosing: false },
            { kind: 'text', value: 'x' },
            { kind: 'close', name: 'p' },
            { kind: 'open', name: 'svg', attrs: {}, selfClosing: false },
            { kind: 'close', name: 'svg' },
            { kind: 'close', name: 'body' },
        ]);
    });

    it('treats a bare < as text and drops an unterminated tag at the end', () => {
        expect(tokenize('a < b <c')).toEqual([{ kind: 'text', value: 'a < b ' }]);
        expect(tokenize('<p a="unterminated')).toEqual([]);
        expect(tokenize('<script>never closed')).toEqual([{ kind: 'open', name: 'script', attrs: {}, selfClosing: false }]);
    });

    it('never throws on any prefix of a document', () => {
        const doc = '<!doctype html><html><head><title>T</title></head><body><h1 id="a">Hi &amp; <em>there</em></h1><p>x<br/>y</p><ul><li><input type="checkbox" checked>a</li></ul><table><tr><td align="left">1</td></tr></table><script>1<2</script></body></html>';
        for (let i = 0; i <= doc.length; i++) expect(() => tokenize(doc.slice(0, i))).not.toThrow();
    });
});
