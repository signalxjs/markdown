import { describe, expect, it } from 'vitest';
import { decodeEntities, decodeEntity, NAMED_ENTITIES } from '../../src/utils/index.js';

describe('NAMED_ENTITIES', () => {
    it('is the HTML 4.01 set plus apos', () => {
        expect(Object.keys(NAMED_ENTITIES)).toHaveLength(253);
    });

    it('maps names to exact code points', () => {
        expect(NAMED_ENTITIES.amp).toBe('&');
        expect(NAMED_ENTITIES.lt).toBe('<');
        expect(NAMED_ENTITIES.gt).toBe('>');
        expect(NAMED_ENTITIES.quot).toBe('"');
        expect(NAMED_ENTITIES.apos).toBe("'");
        expect(NAMED_ENTITIES.nbsp).toBe('\u00A0');
        expect(NAMED_ENTITIES.hellip).toBe('…');
        expect(NAMED_ENTITIES.mdash).toBe('—');
        expect(NAMED_ENTITIES.ndash).toBe('–');
        expect(NAMED_ENTITIES.rarr).toBe('→');
        expect(NAMED_ENTITIES.euro).toBe('€');
        expect(NAMED_ENTITIES.zwj).toBe('\u200D');
        expect(NAMED_ENTITIES.zwnj).toBe('\u200C');
        expect(NAMED_ENTITIES.Agrave).toBe('À');
        expect(NAMED_ENTITIES.yuml).toBe('ÿ');
        expect(NAMED_ENTITIES.Alpha).toBe('Α');
        expect(NAMED_ENTITIES.omega).toBe('ω');
        expect(NAMED_ENTITIES.copy).toBe('©');
        expect(NAMED_ENTITIES.frac12).toBe('½');
        expect(NAMED_ENTITIES.ouml).toBe('ö');
        expect(NAMED_ENTITIES.AElig).toBe('Æ');
    });

    it('holds single code points only', () => {
        for (const [name, value] of Object.entries(NAMED_ENTITIES)) {
            expect([...value], name).toHaveLength(1);
        }
    });
});

describe('decodeEntity', () => {
    it('decodes named references', () => {
        expect(decodeEntity('&amp;')).toBe('&');
        expect(decodeEntity('&nbsp;')).toBe('\u00A0');
        expect(decodeEntity('&copy;')).toBe('©');
        expect(decodeEntity('&AElig;')).toBe('Æ');
    });

    it('is case-sensitive on names', () => {
        expect(decodeEntity('&AMP;')).toBeNull();
        expect(decodeEntity('&Auml;')).toBe('Ä');
        expect(decodeEntity('&auml;')).toBe('ä');
    });

    it('decodes decimal references', () => {
        expect(decodeEntity('&#65;')).toBe('A');
        expect(decodeEntity('&#35;')).toBe('#');
        expect(decodeEntity('&#1234;')).toBe('Ӓ');
        expect(decodeEntity('&#128512;')).toBe('\u{1F600}');
    });

    it('decodes hex references, either x', () => {
        expect(decodeEntity('&#x41;')).toBe('A');
        expect(decodeEntity('&#X41;')).toBe('A');
        expect(decodeEntity('&#x1F600;')).toBe('\u{1F600}');
        expect(decodeEntity('&#XcaB;')).toBe('ಫ');
    });

    it('returns null for unknown names', () => {
        expect(decodeEntity('&foobar;')).toBeNull();
        expect(decodeEntity('&MadeUpEntity;')).toBeNull();
        expect(decodeEntity('&Dcaron;')).toBeNull();
    });

    it('never hits Object.prototype', () => {
        expect(decodeEntity('&constructor;')).toBeNull();
        expect(decodeEntity('&toString;')).toBeNull();
        expect(decodeEntity('&hasOwnProperty;')).toBeNull();
        expect(decodeEntity('&constructor;', { x: 'y' })).toBeNull();
    });

    it('maps &#0; to U+FFFD', () => {
        expect(decodeEntity('&#0;')).toBe('\uFFFD');
        expect(decodeEntity('&#x0;')).toBe('\uFFFD');
        expect(decodeEntity('&#0000000;')).toBe('\uFFFD');
    });

    it('maps out-of-range code points to U+FFFD', () => {
        expect(decodeEntity('&#1114112;')).toBe('\uFFFD');
        expect(decodeEntity('&#x110000;')).toBe('\uFFFD');
        expect(decodeEntity('&#9999999;')).toBe('\uFFFD');
        expect(decodeEntity('&#xFFFFFF;')).toBe('\uFFFD');
        expect(decodeEntity('&#x10FFFF;')).toBe('\u{10FFFF}');
    });

    it('maps surrogates to U+FFFD', () => {
        expect(decodeEntity('&#xD800;')).toBe('\uFFFD');
        expect(decodeEntity('&#xDFFF;')).toBe('\uFFFD');
        expect(decodeEntity('&#55296;')).toBe('\uFFFD');
        expect(decodeEntity('&#xD7FF;')).toBe('\uD7FF');
        expect(decodeEntity('&#xE000;')).toBe('\uE000');
    });

    it('rejects references that break the shape rules', () => {
        expect(decodeEntity('&amp')).toBeNull();
        expect(decodeEntity('amp;')).toBeNull();
        expect(decodeEntity('&;')).toBeNull();
        expect(decodeEntity('&#;')).toBeNull();
        expect(decodeEntity('&#x;')).toBeNull();
        expect(decodeEntity('&#12345678;')).toBeNull();
        expect(decodeEntity('&#x1234567;')).toBeNull();
        expect(decodeEntity('&#xG1;')).toBeNull();
        expect(decodeEntity('&#1a;')).toBeNull();
        expect(decodeEntity('&1abc;')).toBeNull();
        expect(decodeEntity('&a;')).toBeNull();
        expect(decodeEntity('&' + 'a'.repeat(33) + ';')).toBeNull();
        expect(decodeEntity('&am p;')).toBeNull();
        expect(decodeEntity('')).toBeNull();
    });

    it('lets an extra table win over the built-in one', () => {
        expect(decodeEntity('&amp;', { amp: 'X' })).toBe('X');
        expect(decodeEntity('&amp;', new Map([['amp', 'Y']]))).toBe('Y');
        expect(decodeEntity('&Dcaron;', { Dcaron: 'Ď' })).toBe('Ď');
        expect(decodeEntity('&Dcaron;', new Map([['Dcaron', 'Ď']]))).toBe('Ď');
        expect(decodeEntity('&nbsp;', { Dcaron: 'Ď' })).toBe('\u00A0');
        expect(decodeEntity('&nope;', { Dcaron: 'Ď' })).toBeNull();
    });
});

describe('decodeEntities', () => {
    it('returns the same string when there is no &', () => {
        const text = 'plain text with #65; and x41;';
        expect(decodeEntities(text)).toBe(text);
        expect(decodeEntities('')).toBe('');
    });

    it('decodes every valid reference in a string', () => {
        expect(decodeEntities('&nbsp; &amp; &copy; &AElig; &frac34;')).toBe('\u00A0 & © Æ ¾');
        expect(decodeEntities('&#35; &#1234; &#992; &#0;')).toBe('# Ӓ Ϡ \uFFFD');
        expect(decodeEntities('&#X22; &#XD06; &#xcab;')).toBe('" ആ ಫ');
        expect(decodeEntities('a&rarr;b&hellip;')).toBe('a→b…');
    });

    it('leaves invalid and unknown references literal', () => {
        expect(decodeEntities('&nbsp &x; &#; &#x;')).toBe('&nbsp &x; &#; &#x;');
        expect(decodeEntities('&#87654321; &#abcdef0;')).toBe('&#87654321; &#abcdef0;');
        expect(decodeEntities('&ThisIsNotDefined; &hi?;')).toBe('&ThisIsNotDefined; &hi?;');
        expect(decodeEntities('&MadeUpEntity;')).toBe('&MadeUpEntity;');
        expect(decodeEntities('&copy')).toBe('&copy');
        expect(decodeEntities('&#65')).toBe('&#65');
        expect(decodeEntities('& and &&')).toBe('& and &&');
    });

    it('maps out-of-range, surrogate and zero code points to U+FFFD', () => {
        expect(decodeEntities('&#1114112;')).toBe('\uFFFD');
        expect(decodeEntities('&#xD800;')).toBe('\uFFFD');
        expect(decodeEntities('&#0;')).toBe('\uFFFD');
    });

    it('decodes exactly once', () => {
        expect(decodeEntities('&amp;amp;')).toBe('&amp;');
        expect(decodeEntities('&amp;#65;')).toBe('&#65;');
        expect(decodeEntities('&#38;amp;')).toBe('&amp;');
    });

    it('uses the extra table first', () => {
        expect(decodeEntities('&amp;&Dcaron;', { amp: '+', Dcaron: 'Ď' })).toBe('+Ď');
        expect(decodeEntities('&amp;&Dcaron;', new Map([['Dcaron', 'Ď']]))).toBe('&Ď');
    });

    it('never hits Object.prototype', () => {
        expect(decodeEntities('&toString;&constructor;')).toBe('&toString;&constructor;');
    });
});
