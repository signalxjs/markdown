/**
 * The round-trip suite: every CommonMark and GFM example whose tree uses only
 * the standard vocabulary (no raw `html`, no reference definitions — HTML has
 * neither) survives `parseHtml(toHtml(tree))` structurally, modulo what HTML
 * cannot carry: soft line breaks and whitespace runs (collapsed on both
 * sides), a fence's `meta`, and per-item looseness (HTML only knows a loose
 * list), and URLs compare after commonmark's `normalizeURI` (the writer
 * percent-encodes; HTML keeps the encoded form). `known-roundtrip-failures.json` lists the examples that still differ;
 * it can only shrink — a fixed example must be removed from it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { List, Node, Parent, Root, Text } from '@sigx/richtext';
import { strip } from '@sigx/richtext/testing';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { loadCommonMark, loadGfm, type Example } from '../../richtext-markdown/__tests__/helpers.js';
import { parseHtml } from '../src/parse.js';
import { normalizeUri, toHtml } from '../src/serialize.js';

interface KnownFailures {
    commonmark: number[];
    gfm: number[];
}

const known = JSON.parse(readFileSync(join(import.meta.dirname, 'known-roundtrip-failures.json'), 'utf8')) as KnownFailures;

const SKIP_TYPES = new Set(['html', 'definition', 'linkReference', 'imageReference']);

function uses(node: Node, types: ReadonlySet<string>): boolean {
    if (types.has(node.type)) return true;
    const children = (node as Parent).children;
    return Array.isArray(children) && children.some((c) => uses(c, types));
}

/** What HTML cannot carry, normalised on both sides. */
function normalize(root: Root): Root {
    const out = strip(root);
    const walk = (node: Node, inCode: boolean): void => {
        if (node.type === 'code') {
            (node as { meta?: string | null }).meta = null;
            return;
        }
        if (node.type === 'image' && (node as { alt?: string | null }).alt == null) (node as unknown as { alt: string }).alt = '';
        if (node.type === 'image' || node.type === 'link') (node as unknown as { url: string }).url = normalizeUri((node as unknown as { url: string }).url);
        if (node.type === 'list') {
            const list = node as List;
            const loose = list.spread === true || list.children.some((i) => i.spread === true);
            list.spread = loose;
            for (const item of list.children) item.spread = loose;
        }
        const children = (node as Parent).children;
        if (!Array.isArray(children)) return;
        const phrasing = node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell';
        for (const child of children) walk(child, inCode);
        if (phrasing) settle(children as Node[]);
    };
    walk(out, false);
    return out;
}

/** Collapse whitespace in the leaves of a phrasing container and trim its edges (HTML rendering semantics). */
function settle(children: Node[]): void {
    const leaves: { node: Text | Node; parent: Node[] }[] = [];
    const collect = (nodes: Node[]): void => {
        for (const n of nodes) {
            if (n.type === 'text' || n.type === 'break' || n.type === 'inlineCode' || n.type === 'image') leaves.push({ node: n, parent: nodes });
            else if (Array.isArray((n as Parent).children)) collect((n as Parent).children as Node[]);
            else leaves.push({ node: n, parent: nodes });
        }
    };
    collect(children);
    for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i].node;
        if (leaf.type !== 'text') continue;
        const text = leaf as Text;
        text.value = text.value.replace(/[ \t\r\n\f]+/g, ' ');
        const prev = leaves[i - 1]?.node;
        const next = leaves[i + 1]?.node;
        if (text.value.startsWith(' ') && (!prev || prev.type === 'break' || (prev.type === 'text' && (prev as Text).value.endsWith(' ')))) text.value = text.value.slice(1);
        if (text.value.endsWith(' ') && (!next || next.type === 'break')) text.value = text.value.slice(0, -1);
    }
    for (const { node, parent } of leaves) {
        if (node.type === 'text' && (node as Text).value === '') parent.splice(parent.indexOf(node), 1);
    }
    // Empty marks left behind, and adjacent texts split by a removed leaf.
    const prune = (nodes: Node[]): void => {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            const kids = (n as Parent).children as Node[] | undefined;
            if (Array.isArray(kids)) {
                prune(kids);
                if (kids.length === 0 && n.type !== 'image') nodes.splice(i, 1);
            }
        }
        for (let i = nodes.length - 1; i > 0; i--) {
            if (nodes[i].type === 'text' && nodes[i - 1].type === 'text') {
                (nodes[i - 1] as Text).value += (nodes[i] as Text).value;
                nodes.splice(i, 1);
            }
        }
    };
    prune(children);
}

function roundTrips(example: Example): boolean | null {
    const tree = parseMarkdown(example.markdown);
    if (uses(tree, SKIP_TYPES)) return null;
    const expected = normalize(tree);
    const actual = normalize(parseHtml(toHtml(tree, { sanitize: false })));
    try {
        expect(actual).toEqual(expected);
        return true;
    } catch {
        return false;
    }
}

function suite(name: keyof KnownFailures, examples: Example[]): void {
    describe(`round trip: ${name}`, () => {
        const expectedFailures = new Set(known[name]);
        for (const example of examples) {
            it(`example ${example.example} (${example.section})`, () => {
                const ok = roundTrips(example);
                if (ok === null) return;
                if (expectedFailures.has(example.example)) {
                    expect(ok, `example ${example.example} now round-trips — remove it from known-roundtrip-failures.json`).toBe(false);
                } else {
                    const tree = parseMarkdown(example.markdown);
                    expect(normalize(parseHtml(toHtml(tree, { sanitize: false })))).toEqual(normalize(tree));
                }
            });
        }
    });
}

suite('commonmark', loadCommonMark());
suite('gfm', loadGfm());

describe('round trip: robustness', () => {
    it('never throws on any prefix of the rendered fixtures', () => {
        for (const example of loadGfm()) {
            const html = toHtml(parseMarkdown(example.markdown), { sanitize: false });
            for (let i = 0; i <= html.length; i += Math.max(1, Math.floor(html.length / 40))) expect(() => parseHtml(html.slice(0, i))).not.toThrow();
        }
    });
});
