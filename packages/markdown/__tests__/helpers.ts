/**
 * Shared fixture loaders. Everything is read synchronously relative to this
 * file so a test can call a loader at module level and build `describe`
 * blocks from the data.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** One spec example: the CommonMark `spec.json` shape (GFM cases use the same). */
export interface Example {
    example: number;
    section: string;
    markdown: string;
    html: string;
}

/** `conformance/known-failures.json`: examples expected to fail, per suite. */
export interface KnownFailures {
    commonmark: number[];
    gfm: number[];
}

const FIXTURES = join(import.meta.dirname, 'fixtures');

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function listFiles(dir: string, ext: string): string[] {
    return readdirSync(dir)
        .filter((name) => name.endsWith(ext))
        .sort()
        .map((name) => join(dir, name));
}

/** The vendored CommonMark 0.31.2 examples (see `fixtures/commonmark/LICENSE.md`). */
export function loadCommonMark(): Example[] {
    return readJson<Example[]>(join(FIXTURES, 'commonmark', 'spec.json'));
}

/** The hand-written GFM cases, every `fixtures/gfm/*.json` concatenated in file-name order. */
export function loadGfm(): Example[] {
    return listFiles(join(FIXTURES, 'gfm'), '.json').flatMap((file) => readJson<Example[]>(file));
}

/** The AI-answer-shaped documents under `fixtures/sigx/`, keyed by file name without `.md`. */
export function loadSigxFixtures(): { name: string; source: string }[] {
    return listFiles(join(FIXTURES, 'sigx'), '.md').map((file) => ({
        name: basename(file, '.md'),
        source: readFileSync(file, 'utf8'),
    }));
}

/** The conformance suites' expected-failure lists. */
export function loadKnownFailures(): KnownFailures {
    return readJson<KnownFailures>(join(import.meta.dirname, 'conformance', 'known-failures.json'));
}
