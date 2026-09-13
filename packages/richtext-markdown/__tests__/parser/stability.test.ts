/**
 * The incremental stability suite: for every fixture and every prefix, the
 * incremental engine must (1) agree with a one-shot parse, (2) keep every
 * finalized block referentially identical, (3) keep keys and positions
 * stable, and (4) never throw.
 */
import { describe, expect, it } from 'vitest';
import { createIncrementalEngine, parseMarkdown } from '../../src/parser/index.js';
import { mentionPlugin } from '../../src/mention.js';
import { seededChunks, strip } from '@sigx/richtext/testing';
import { loadCommonMark, loadSigxFixtures } from '../helpers.js';
import type { RichTextPlugin } from '@sigx/richtext';
import type { BlockSyntaxExtension } from '../../src/plugin/markdown.js';
import type { Root } from '@sigx/richtext';

/** A `:::note` … `:::` container block extension, the shape a callout plugin has. */
const notePlugin: RichTextPlugin = {
    name: 'note',
    formats: {
        markdown: {
            block: [
        {
            name: 'note',
            triggerChars: [':'],
            start: (line) => (/^:::\s*\w+\s*$/.test(line.text) ? { meta: line.text.replace(/^:::\s*/, '').trim(), consumed: false } : null),
            continue: (line) => (/^:::\s*$/.test(line.text) ? 'consume-and-close' : 'continue'),
            finish: (state, ctx) => {
                const body = state.lines.filter((l) => !/^:::\s*$/.test(l.text));
                return { type: 'note', kind: state.meta, children: ctx.parseBlocks(body) } as never;
            },
        } satisfies BlockSyntaxExtension<never, string>,
    ],
    serialize: { note: (node: { kind: string }, ctx) => `:::${node.kind}\n${ctx.serializeChildren(node as never)}\n:::` },
        },
    },
};

const plugins = [mentionPlugin, notePlugin];

/**
 * Feed `source` in chunks and assert the invariants after every step. Uses
 * the engine's own finalized count: everything before it must be the same
 * object as in the previous step, and finalized blocks never un-finalize.
 */
function checkRun(
    source: string,
    chunkAt: (i: number) => number,
    options: { plugins?: RichTextPlugin[]; label: string },
): Root {
    const engine = createIncrementalEngine({ plugins: options.plugins });
    let prev: Root | null = null;
    let prevFinalized = 0;
    let consumed = 0;
    let step = 0;
    let root: Root = engine.parse('');
    while (consumed < source.length) {
        consumed = Math.min(source.length, consumed + Math.max(1, chunkAt(step++)));
        const prefix = source.slice(0, consumed);
        root = engine.parse(prefix);
        const finalized = engine.inspect().finalized;
        const label = `${options.label} prefix ${JSON.stringify(prefix)}`;
        // (1) incremental ≡ one-shot
        expect(strip(root), label).toEqual(strip(parseMarkdown(prefix, { plugins: options.plugins })));
        // (2) finalized blocks never un-finalize and keep their identity
        expect(finalized, label).toBeGreaterThanOrEqual(prevFinalized);
        if (prev) {
            for (let k = 0; k < prevFinalized; k++) expect(root.children[k], label).toBe(prev.children[k]);
        }
        // (3) keys and positions
        root.children.forEach((child, k) => {
            expect(child.key, label).toBe(`b-${k}`);
            expect(child.position!.end.offset, label).toBeLessThanOrEqual(prefix.length);
        });
        prev = root;
        prevFinalized = finalized;
    }
    return root;
}

describe('incremental stability (sigx fixtures, char by char)', () => {
    for (const { name, source } of loadSigxFixtures()) {
        it(`is stable for ${name}`, () => {
            const final = checkRun(source, () => 1, { plugins, label: name });
            // Nested keys are path-based and unique.
            const keys = new Set<string>();
            const walk = (node: { key?: string; children?: unknown[] }, parentKey?: string): void => {
                if (node.key) {
                    expect(keys.has(node.key)).toBe(false);
                    keys.add(node.key);
                    if (parentKey) expect(node.key.startsWith(parentKey + '.')).toBe(true);
                }
                for (const c of node.children ?? []) {
                    const child = c as { key?: string; type: string; children?: unknown[] };
                    if (child.key !== undefined) walk(child, node.key);
                }
            };
            for (const child of final.children) walk(child as never);
        });
    }
});

describe('incremental stability (CommonMark corpus, random chunks)', () => {
    const examples = loadCommonMark();
    const bySection = new Map<string, typeof examples>();
    for (const ex of examples) {
        const list = bySection.get(ex.section) ?? [];
        list.push(ex);
        bySection.set(ex.section, list);
    }
    for (const [section, list] of bySection) {
        it(`is stable for ${section}`, () => {
            for (const ex of list) {
                checkRun(ex.markdown, seededChunks(ex.example, 1, 24), { label: `example ${ex.example}` });
            }
        });

        it(`is stable for ${section} (char by char)`, () => {
            for (const ex of list) {
                checkRun(ex.markdown, () => 1, { label: `example ${ex.example}` });
            }
        });
    }
});
