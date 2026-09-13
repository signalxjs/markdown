import { describe, expect, it } from 'vitest';
import { EXIT, SKIP, map, visit } from '../../src/ast/index.js';
import { assignKeys } from '../../src/schema/index.js';
import { collectDefinitions } from '@sigx/richtext-markdown';
import { parseMarkdown } from '@sigx/richtext-markdown';

describe('visit / map / keys / definitions', () => {
    const root = parseMarkdown('# T\n\n- a **b**\n\n[x]: /u\n\n> [y]: /v\n> [x]: /dup');

    it('visits every node depth-first with a type test', () => {
        const seen: string[] = [];
        visit(root, (n) => {
            seen.push(n.type);
        });
        expect(seen[0]).toBe('root');
        expect(seen).toContain('strong');
        const texts: string[] = [];
        visit(root, 'text', (n) => {
            texts.push((n as unknown as { value: string }).value);
        });
        expect(texts).toEqual(['T', 'a ', 'b']);
    });

    it('supports SKIP and EXIT', () => {
        const seen: string[] = [];
        visit(root, (n) => {
            seen.push(n.type);
            if (n.type === 'list') return SKIP;
            if (n.type === 'definition') return EXIT;
        });
        expect(seen).not.toContain('listItem');
        expect(seen.filter((t) => t === 'definition')).toHaveLength(1);
    });

    it('maps to a new tree without touching the original', () => {
        const upper = map(root, (n) => (n.type === 'text' ? { ...n, value: (n as unknown as { value: string }).value.toUpperCase() } : n));
        expect((upper.children[0] as { children: { value: string }[] }).children[0].value).toBe('T');
        expect((root.children[0] as { children: { value: string }[] }).children[0].value).toBe('T');
    });

    it('collects definitions in document order, first wins', () => {
        const defs = collectDefinitions(root);
        expect([...defs.keys()]).toEqual(['x', 'y']);
        expect(defs.get('x')!.url).toBe('/u');
    });

    it('re-assigns keys on a keyless tree', () => {
        const bare = JSON.parse(JSON.stringify(root, (k, v) => (k === 'key' ? undefined : v)));
        assignKeys(bare);
        expect(bare.children[1].key).toBe('b-1');
        expect(bare.children[1].children[0].key).toBe('b-1.0');
        expect(bare.children[1].children[0].children[0].key).toBe('b-1.0.0');
    });
});
