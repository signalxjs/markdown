import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plainTokens } from '@sigx/richtext/dom';
import { createShikiHighlighter, DEFAULT_LANGS, type ShikiHighlighterLike, type ShikiModule, type ShikiTokenLike } from '../src/index.js';

// ---------------------------------------------------------------------------
// A fake `shiki` module: records `createHighlighter` calls and hands out a
// highlighter whose tokens carry dual-theme `htmlStyle` variables.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
    createHighlighter: vi.fn<(opts: { themes: string[]; langs: string[] }) => Promise<ShikiHighlighterLike>>(),
}));

vi.mock('shiki', () => ({
    createHighlighter: (opts: { themes: string[]; langs: string[] }) => mocks.createHighlighter(opts),
}));

const LIGHT = '#111111';
const DARK = '#eeeeee';

interface FakeShiki {
    highlighter: ShikiHighlighterLike;
    codeToTokens: ReturnType<typeof vi.fn>;
    loadLanguage: ReturnType<typeof vi.fn>;
    loaded: Set<string>;
}

function createFakeShiki(opts: { langs: string[]; htmlStyle?: (line: string) => ShikiTokenLike['htmlStyle'] }): FakeShiki {
    const loaded = new Set(opts.langs);
    const htmlStyle = opts.htmlStyle ?? (() => ({ '--shiki-light': LIGHT, '--shiki-dark': DARK }));
    const codeToTokens = vi.fn((code: string) => ({
        tokens: code.split('\n').map((line): ShikiTokenLike[] => [{ content: line, htmlStyle: htmlStyle(line) }]),
    }));
    const loadLanguage = vi.fn(async (...langs: string[]) => {
        for (const lang of langs) {
            if (lang.startsWith('bogus')) throw new Error(`no grammar for ${lang}`);
            loaded.add(lang);
        }
    });
    const highlighter: ShikiHighlighterLike = {
        codeToTokens,
        loadLanguage,
        getLoadedLanguages: () => [...loaded],
    };
    return { highlighter, codeToTokens, loadLanguage, loaded };
}

/** Install a fake module behind the mocked `import('shiki')`. */
function installFakeShiki(opts: { langs?: string[]; htmlStyle?: (line: string) => ShikiTokenLike['htmlStyle'] } = {}): FakeShiki {
    const fake = createFakeShiki({ langs: opts.langs ?? ['typescript', 'ts', 'javascript'], htmlStyle: opts.htmlStyle });
    mocks.createHighlighter.mockImplementation(async () => fake.highlighter);
    return fake;
}

beforeEach(() => {
    mocks.createHighlighter.mockReset();
});

// ---------------------------------------------------------------------------

describe('createShikiHighlighter', () => {
    it('imports shiki lazily — not before the first highlight()', async () => {
        installFakeShiki();
        const h = createShikiHighlighter();
        expect(mocks.createHighlighter).not.toHaveBeenCalled();
        expect(h.peek('const x = 1', 'ts')).toBeNull();
        expect(h.supports?.('ts')).toBe(true);
        expect(mocks.createHighlighter).not.toHaveBeenCalled();

        await h.highlight('const x = 1', 'ts');
        expect(mocks.createHighlighter).toHaveBeenCalledTimes(1);
        expect(mocks.createHighlighter).toHaveBeenCalledWith({
            themes: ['github-light', 'github-dark'],
            langs: [...DEFAULT_LANGS],
        });
    });

    it('creates a single highlighter instance for every call', async () => {
        installFakeShiki();
        const h = createShikiHighlighter();
        await Promise.all([h.highlight('a', 'ts'), h.highlight('b', 'ts'), h.highlight('c', 'javascript')]);
        await h.highlight('d', 'ts');
        expect(mocks.createHighlighter).toHaveBeenCalledTimes(1);
    });

    it('passes the configured themes and preload langs through', async () => {
        const fake = installFakeShiki({ langs: ['rust'] });
        const h = createShikiHighlighter({ themes: { light: 'min-light', dark: 'min-dark' }, langs: ['rust'] });
        await h.highlight('fn main() {}', 'rust');
        expect(mocks.createHighlighter).toHaveBeenCalledWith({ themes: ['min-light', 'min-dark'], langs: ['rust'] });
        expect(fake.codeToTokens).toHaveBeenCalledWith('fn main() {}', {
            lang: 'rust',
            themes: { light: 'min-light', dark: 'min-dark' },
            defaultColor: false,
        });
    });

    it('maps dual-theme htmlStyle to color + --shiki-dark', async () => {
        installFakeShiki();
        const h = createShikiHighlighter();
        const lines = await h.highlight('const x = 1\nx++', 'ts');
        expect(lines).toEqual([
            [{ content: 'const x = 1', color: LIGHT, style: { '--shiki-dark': DARK } }],
            [{ content: 'x++', color: LIGHT, style: { '--shiki-dark': DARK } }],
        ]);
    });

    it('accepts htmlStyle as a string and keeps other declarations as style', async () => {
        installFakeShiki({ htmlStyle: () => `--shiki-light:${LIGHT};--shiki-dark:${DARK};--shiki-dark-font-style:italic;` });
        const h = createShikiHighlighter();
        const [[token]] = await h.highlight('x', 'ts');
        expect(token).toEqual({
            content: 'x',
            color: LIGHT,
            style: { '--shiki-dark': DARK, '--shiki-dark-font-style': 'italic' },
        });
    });

    it("prefers shiki's own color and leaves a token without styles bare", async () => {
        const fake = installFakeShiki();
        fake.codeToTokens.mockImplementation((code: string) => ({
            tokens: [[{ content: code, color: '#abcdef', htmlStyle: { '--shiki-dark': DARK } }], [{ content: '' }]],
        }));
        const h = createShikiHighlighter();
        const lines = await h.highlight('x', 'ts');
        expect(lines).toEqual([[{ content: 'x', color: '#abcdef', style: { '--shiki-dark': DARK } }], [{ content: '' }]]);
    });

    it('peek() is null until highlight() has run, then returns the cached lines', async () => {
        installFakeShiki();
        const h = createShikiHighlighter();
        expect(h.peek('const x = 1', 'ts')).toBeNull();
        const lines = await h.highlight('const x = 1', 'ts');
        expect(h.peek('const x = 1', 'ts')).toBe(lines);
        // Other code or another language is a miss.
        expect(h.peek('const x = 2', 'ts')).toBeNull();
        expect(h.peek('const x = 1', 'javascript')).toBeNull();
        // A cache hit resolves to the same lines without tokenizing again.
        expect(await h.highlight('const x = 1', 'ts')).toBe(lines);
    });

    it('normalises the language for lookup (case, whitespace)', async () => {
        installFakeShiki();
        const h = createShikiHighlighter();
        const lines = await h.highlight('x', 'TS ');
        expect(h.peek('x', 'ts')).toBe(lines);
    });

    it('evicts the least recently used entry (cacheSize: 2)', async () => {
        installFakeShiki();
        const h = createShikiHighlighter({ cacheSize: 2 });
        await h.highlight('a', 'ts');
        await h.highlight('b', 'ts');
        await h.highlight('c', 'ts');
        expect(h.peek('a', 'ts')).toBeNull();
        expect(h.peek('b', 'ts')).not.toBeNull();
        expect(h.peek('c', 'ts')).not.toBeNull();

        // Touching `b` makes `c` the coldest.
        h.peek('b', 'ts');
        await h.highlight('d', 'ts');
        expect(h.peek('c', 'ts')).toBeNull();
        expect(h.peek('b', 'ts')).not.toBeNull();
        expect(h.peek('d', 'ts')).not.toBeNull();
    });

    it('shares one in-flight highlight for the same (code, lang)', async () => {
        const fake = installFakeShiki();
        const h = createShikiHighlighter();
        const [a, b] = await Promise.all([h.highlight('x', 'ts'), h.highlight('x', 'ts')]);
        expect(a).toBe(b);
        expect(fake.codeToTokens).toHaveBeenCalledTimes(1);
    });

    it('loads an unknown language on demand, once', async () => {
        const fake = installFakeShiki();
        const h = createShikiHighlighter();
        const lines = await h.highlight('print(1)', 'python');
        expect(fake.loadLanguage).toHaveBeenCalledTimes(1);
        expect(fake.loadLanguage).toHaveBeenCalledWith('python');
        expect(lines).toEqual([[{ content: 'print(1)', color: LIGHT, style: { '--shiki-dark': DARK } }]]);

        await h.highlight('print(2)', 'python');
        expect(fake.loadLanguage).toHaveBeenCalledTimes(1);
        expect(fake.codeToTokens).toHaveBeenCalledTimes(2);
    });

    it('shares one in-flight grammar load between concurrent calls', async () => {
        const fake = installFakeShiki();
        const h = createShikiHighlighter();
        await Promise.all([h.highlight('a', 'python'), h.highlight('b', 'python')]);
        expect(fake.loadLanguage).toHaveBeenCalledTimes(1);
    });

    it('falls back to plain tokens when a grammar fails to load, and never retries it', async () => {
        const fake = installFakeShiki();
        const h = createShikiHighlighter();
        expect(await h.highlight('a\nb', 'bogus')).toEqual(plainTokens('a\nb'));
        expect(fake.loadLanguage).toHaveBeenCalledTimes(1);
        expect(fake.codeToTokens).not.toHaveBeenCalled();

        expect(await h.highlight('c', 'bogus')).toEqual(plainTokens('c'));
        expect(fake.loadLanguage).toHaveBeenCalledTimes(1);
        // Known bad: answered synchronously from now on.
        expect(h.peek('d', 'bogus')).toEqual(plainTokens('d'));
        expect(h.supports?.('bogus')).toBe(false);
    });

    it('does not load grammars when loadLanguages is false', async () => {
        const fake = installFakeShiki();
        const h = createShikiHighlighter({ loadLanguages: false });
        expect(await h.highlight('print(1)', 'python')).toEqual(plainTokens('print(1)'));
        expect(fake.loadLanguage).not.toHaveBeenCalled();
        expect(fake.codeToTokens).not.toHaveBeenCalled();
        expect(h.supports?.('python')).toBe(false);
        // Preloaded grammars still work.
        expect(await h.highlight('x', 'ts')).toEqual([[{ content: 'x', color: LIGHT, style: { '--shiki-dark': DARK } }]]);
    });

    it('returns plain tokens for a null or plain-text language without touching shiki', async () => {
        installFakeShiki();
        const h = createShikiHighlighter();
        expect(await h.highlight('a\nb', null)).toEqual(plainTokens('a\nb'));
        expect(await h.highlight('a', 'text')).toEqual(plainTokens('a'));
        expect(await h.highlight('a', '')).toEqual(plainTokens('a'));
        expect(h.peek('a\nb', null)).toEqual(plainTokens('a\nb'));
        expect(h.peek('a', 'plaintext')).toEqual(plainTokens('a'));
        expect(h.supports?.('text')).toBe(false);
        expect(mocks.createHighlighter).not.toHaveBeenCalled();
    });

    it('uses the load option instead of import("shiki")', async () => {
        installFakeShiki();
        const fake = createFakeShiki({ langs: ['ts'] });
        const mod: ShikiModule = { createHighlighter: vi.fn(async () => fake.highlighter) };
        const load = vi.fn(async () => mod);
        const h = createShikiHighlighter({ load, langs: ['ts'] });
        expect(load).not.toHaveBeenCalled();

        await h.highlight('x', 'ts');
        await h.highlight('y', 'ts');
        expect(load).toHaveBeenCalledTimes(1);
        expect(mod.createHighlighter).toHaveBeenCalledTimes(1);
        expect(fake.codeToTokens).toHaveBeenCalledTimes(2);
        expect(mocks.createHighlighter).not.toHaveBeenCalled();
    });

    it('never rejects: a failing load resolves to plain tokens', async () => {
        const h = createShikiHighlighter({ load: () => Promise.reject(new Error('offline')) });
        await expect(h.highlight('a\nb', 'ts')).resolves.toEqual(plainTokens('a\nb'));
        await expect(h.highlight('c', 'ts')).resolves.toEqual(plainTokens('c'));
    });

    it('never rejects: a throwing createHighlighter or tokenizer resolves to plain tokens', async () => {
        mocks.createHighlighter.mockRejectedValue(new Error('no wasm'));
        const h1 = createShikiHighlighter();
        await expect(h1.highlight('x', 'ts')).resolves.toEqual(plainTokens('x'));

        const fake = installFakeShiki();
        fake.codeToTokens.mockImplementation(() => {
            throw new Error('tokenizer exploded');
        });
        const h2 = createShikiHighlighter();
        await expect(h2.highlight('x', 'ts')).resolves.toEqual(plainTokens('x'));
    });
});

describe('plainTokens', () => {
    it('yields one uncoloured token per line', () => {
        expect(plainTokens('a\n\nb')).toEqual([[{ content: 'a' }], [{ content: '' }], [{ content: 'b' }]]);
        expect(plainTokens('')).toEqual([[{ content: '' }]]);
    });
});
