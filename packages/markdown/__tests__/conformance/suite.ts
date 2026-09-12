/**
 * The conformance harness shared by `commonmark.test.ts` and `gfm.test.ts`
 * (not a test file itself — vitest only collects `*.test.ts`).
 *
 * Every example is one `it`: an example listed in `known-failures.json` must
 * FAIL (its output must differ from the spec's), so the list can only
 * shrink — the moment the parser gets an example right, the test tells you
 * to delete it from the list. An unlisted example must match exactly.
 * A second `it` per section proves the parser never throws on any prefix of
 * any example, which is what a token stream hands it.
 */

import { describe, expect, it } from 'vitest';
import type { Root } from '../../src/ast/index.js';
import type { Example } from '../helpers.js';

export interface ConformanceSuite {
    /** Suite name used in messages, e.g. `CommonMark`. */
    name: string;
    examples: readonly Example[];
    /** Example numbers expected to fail (from `known-failures.json`). */
    knownFailures: readonly number[];
    parse: (source: string) => Root;
    render: (root: Root) => string;
}

function describeMismatch(name: string, ex: Example, actual: string): string {
    return [
        `${name} example ${ex.example} (${ex.section})`,
        `markdown: ${JSON.stringify(ex.markdown)}`,
        `expected: ${JSON.stringify(ex.html)}`,
        `actual:   ${JSON.stringify(actual)}`,
    ].join('\n');
}

export function runConformance(suite: ConformanceSuite): void {
    const known = new Set(suite.knownFailures);
    const sections = new Map<string, Example[]>();
    for (const ex of suite.examples) {
        const list = sections.get(ex.section);
        if (list) list.push(ex);
        else sections.set(ex.section, [ex]);
    }

    for (const [section, examples] of sections) {
        describe(section, () => {
            for (const ex of examples) {
                const expectedToFail = known.has(ex.example);
                it(`#${ex.example}${expectedToFail ? ' (known failure)' : ''}`, () => {
                    const actual = suite.render(suite.parse(ex.markdown));
                    if (expectedToFail) {
                        expect(
                            actual,
                            `${suite.name} example ${ex.example} (${ex.section}) now passes — ` +
                                'remove it from known-failures.json',
                        ).not.toBe(ex.html);
                    } else {
                        expect(actual, describeMismatch(suite.name, ex, actual)).toBe(ex.html);
                    }
                });
            }

            it('never throws on any prefix', () => {
                for (const ex of examples) {
                    const md = ex.markdown;
                    for (let i = 0; i <= md.length; i++) {
                        const prefix = md.slice(0, i);
                        try {
                            suite.parse(prefix);
                        } catch (error) {
                            throw new Error(
                                `${suite.name} example ${ex.example} (${ex.section}): parse threw on prefix ` +
                                    `${JSON.stringify(prefix)} (${i}/${md.length} chars): ${String(error)}`,
                                { cause: error },
                            );
                        }
                    }
                }
            });
        });
    }
}
