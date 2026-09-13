import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, DocumentFormatError, fromJSON, toJSON } from '../../src/document/index.js';
import { parseMarkdown } from '@sigx/richtext-markdown';

describe('toJSON / fromJSON', () => {
    it('strips keys, positions and the open flag and stamps the version', () => {
        const root = parseMarkdown('# T\n\n```\nunterminated');
        const json = toJSON(root);
        expect(json.data.version).toBe(CURRENT_VERSION);
        expect(JSON.stringify(json)).not.toContain('"key"');
        expect(JSON.stringify(json)).not.toContain('"position"');
        expect(JSON.stringify(json)).not.toContain('"open"');
        expect(root.children[0].key).toBe('b-0'); // input untouched
    });

    it('records the source format id and rejects a non-string one', () => {
        const json = toJSON(parseMarkdown('a'), { format: 'markdown' });
        expect(json.data.format).toBe('markdown');
        expect(fromJSON(json).data?.format).toBe('markdown');
        expect(toJSON(parseMarkdown('a')).data.format).toBeUndefined();
        expect(() => fromJSON({ type: 'root', children: [], data: { format: 3 } })).toThrow(/data.format/);
    });

    it('can keep positions', () => {
        const json = toJSON(parseMarkdown('a'), { position: true });
        expect(json.children[0].position).toBeDefined();
    });

    it('round-trips through JSON.stringify and re-keys the tree', () => {
        const root = parseMarkdown('- a\n- b');
        const back = fromJSON(JSON.stringify(toJSON(root)));
        expect(back.children[0].key).toBe('b-0');
        expect((back.children[0] as { children: { key?: string }[] }).children[1].key).toBe('b-0.1');
    });

    it('rejects a wrong shape and a newer version', () => {
        expect(() => fromJSON({ type: 'paragraph' })).toThrow(DocumentFormatError);
        expect(() => fromJSON({ type: 'root', children: [{}] })).toThrow(/no string type/);
        try {
            fromJSON({ type: 'root', children: [], data: { version: CURRENT_VERSION + 1 } });
            throw new Error('did not throw');
        } catch (err) {
            expect((err as DocumentFormatError).code).toBe('unsupported-version');
        }
    });
});
