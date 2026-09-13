import { describe, expect, it } from 'vitest';
import { DEFAULT_SAFE_SCHEMES, sanitizeUrl } from '../../src/render/index.js';

describe('sanitizeUrl', () => {
    it('passes http(s), mailto and tel links through', () => {
        expect(sanitizeUrl('https://example.com/a?b=1#c', 'link')).toBe('https://example.com/a?b=1#c');
        expect(sanitizeUrl('http://example.com', 'link')).toBe('http://example.com');
        expect(sanitizeUrl('mailto:a@example.com', 'link')).toBe('mailto:a@example.com');
        expect(sanitizeUrl('tel:+123', 'link')).toBe('tel:+123');
        expect(sanitizeUrl('HTTPS://EXAMPLE.COM', 'link')).toBe('HTTPS://EXAMPLE.COM');
    });

    it('blocks every other scheme with "#"', () => {
        expect(sanitizeUrl('javascript:alert(1)', 'link')).toBe('#');
        expect(sanitizeUrl('JavaScript:alert(1)', 'link')).toBe('#');
        expect(sanitizeUrl('vbscript:x', 'link')).toBe('#');
        expect(sanitizeUrl('data:text/html,<script>', 'link')).toBe('#');
        expect(sanitizeUrl('file:///etc/passwd', 'link')).toBe('#');
        expect(sanitizeUrl('a:b', 'link')).toBe('#');
    });

    it('sees through tab, newline and C0-control smuggling in the scheme', () => {
        expect(sanitizeUrl('java\nscript:alert(1)', 'link')).toBe('#');
        expect(sanitizeUrl('java\tscript:alert(1)', 'link')).toBe('#');
        expect(sanitizeUrl(String.fromCharCode(1) + 'javascript:alert(1)', 'link')).toBe('#');
        expect(sanitizeUrl(String.fromCharCode(31) + 'javascript:alert(1)' + String.fromCharCode(0), 'link')).toBe('#');
    });

    it('passes scheme-less URLs through', () => {
        expect(sanitizeUrl('/docs/intro', 'link')).toBe('/docs/intro');
        expect(sanitizeUrl('intro.md', 'link')).toBe('intro.md');
        expect(sanitizeUrl('#anchor', 'link')).toBe('#anchor');
        expect(sanitizeUrl('?q=1', 'link')).toBe('?q=1');
        expect(sanitizeUrl('//cdn.example.com/x.js', 'link')).toBe('//cdn.example.com/x.js');
        expect(sanitizeUrl('foo/bar:baz', 'link')).toBe('foo/bar:baz');
    });

    it('trims and keeps an empty URL empty', () => {
        expect(sanitizeUrl('  https://example.com  ', 'link')).toBe('https://example.com');
        expect(sanitizeUrl('', 'link')).toBe('');
        expect(sanitizeUrl('   ', 'link')).toBe('');
    });

    it('keeps images to http(s) and relative URLs', () => {
        expect(sanitizeUrl('https://example.com/a.png', 'image')).toBe('https://example.com/a.png');
        expect(sanitizeUrl('a.png', 'image')).toBe('a.png');
        expect(sanitizeUrl('mailto:a@example.com', 'image')).toBe('#');
        expect(sanitizeUrl('data:image/png;base64,AAAA', 'image')).toBe('#');
        expect(sanitizeUrl('javascript:alert(1)', 'image')).toBe('#');
    });

    it('decodes nothing', () => {
        expect(sanitizeUrl('%6Aavascript:alert(1)', 'link')).toBe('%6Aavascript:alert(1)');
    });

    it('exports the default scheme lists', () => {
        expect(DEFAULT_SAFE_SCHEMES.link).toEqual(['http', 'https', 'mailto', 'tel']);
        expect(DEFAULT_SAFE_SCHEMES.image).toEqual(['http', 'https']);
        expect(Object.isFrozen(DEFAULT_SAFE_SCHEMES)).toBe(true);
    });
});
