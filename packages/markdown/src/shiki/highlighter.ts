/**
 * `createShikiHighlighter()` — a `CodeHighlighter` (see `@sigx/markdown/dom`) on top of `shiki`,
 * which is an optional peer: the module is imported lazily on the first
 * `highlight()` call (or through the `load` option, so an app can hand in a
 * fine-grained bundle instead of the full `shiki` entry), a single
 * highlighter instance is shared, grammars outside the preloaded set are
 * loaded on demand and results are kept in a small LRU cache so a block that
 * re-renders (streaming, a re-mount) can be highlighted synchronously through
 * `peek()`.
 *
 * `highlight()` never rejects: if the import, the grammar or the tokenizer
 * fails, the code resolves to plain-text tokens (one token per line, no
 * colour) — a code block is never worse than unhighlighted.
 *
 * Tokens are produced in shiki's dual-theme mode with `defaultColor: false`,
 * so each token carries the light colour in `color` and the dark one as the
 * `--shiki-dark` CSS variable in `style`; a stylesheet switches with
 * `[data-theme="dark"] [data-part="code-body"] span { color: var(--shiki-dark) }`.
 */

import { plainTokens, type CodeHighlighter, type HighlightedToken } from '../dom/index.js';

export interface ShikiThemes {
    light: string;
    dark: string;
}

export interface ShikiOptions {
    /** Default `{ light: 'github-light', dark: 'github-dark' }`. */
    themes?: ShikiThemes;
    /** Grammars to preload with the highlighter. Default: {@link DEFAULT_LANGS}. */
    langs?: string[];
    /** Load other bundled grammars on demand (`loadLanguage`). Default `true`. */
    loadLanguages?: boolean;
    /** How to load the shiki module. Default `() => import('shiki')`; apps pass their own for a fine-grained bundle. */
    load?: () => Promise<ShikiModule>;
    /** LRU cache entries (one per distinct `(lang, code)`). Default `200`. */
    cacheSize?: number;
}

/** The subset of the shiki module we use — hand-written so no shiki types leak into the public d.ts. */
export interface ShikiModule {
    createHighlighter(opts: { themes: string[]; langs: string[] }): Promise<ShikiHighlighterLike>;
}

export interface ShikiTokenLike {
    content: string;
    color?: string;
    /** shiki ≥ 1.x: an object; older builds: a `prop: value;` string. */
    htmlStyle?: Record<string, string> | string;
}

export interface ShikiHighlighterLike {
    codeToTokens(
        code: string,
        opts: { lang: string; themes: { light: string; dark: string }; defaultColor?: false | string },
    ): { tokens: ShikiTokenLike[][] };
    loadLanguage(...langs: string[]): Promise<void>;
    getLoadedLanguages(): string[];
}

export const DEFAULT_THEMES: Readonly<ShikiThemes> = { light: 'github-light', dark: 'github-dark' };

export const DEFAULT_LANGS: readonly string[] = [
    'javascript',
    'typescript',
    'jsx',
    'tsx',
    'json',
    'css',
    'html',
    'markdown',
    'bash',
    'shell',
];

const DEFAULT_CACHE_SIZE = 200;

/** Fence languages that mean "no highlighting" — never sent to shiki. */
const PLAIN_LANGS: ReadonlySet<string> = new Set(['text', 'txt', 'plain', 'plaintext']);

/** The fence language normalised for lookup, or `null` when it means plain text. */
function normalizeLang(lang: string | null | undefined): string | null {
    if (lang == null) return null;
    const name = lang.trim().toLowerCase();
    return name === '' || PLAIN_LANGS.has(name) ? null : name;
}

/** Cache keys are `<lang> NUL <code>` — NUL cannot occur in a fence language. */
const KEY_SEPARATOR = String.fromCharCode(0);

function cacheKey(lang: string, code: string): string {
    return lang + KEY_SEPARATOR + code;
}

/** Turn shiki's `htmlStyle` (object or `prop: value;` string) into a style record. */
function parseHtmlStyle(htmlStyle: ShikiTokenLike['htmlStyle']): Record<string, string> | null {
    if (!htmlStyle) return null;
    if (typeof htmlStyle === 'object') return htmlStyle;
    const out: Record<string, string> = {};
    for (const decl of htmlStyle.split(';')) {
        const i = decl.indexOf(':');
        if (i === -1) continue;
        const prop = decl.slice(0, i).trim();
        const value = decl.slice(i + 1).trim();
        if (prop && value) out[prop] = value;
    }
    return out;
}

/**
 * Map a shiki token to a {@link HighlightedToken}: the light colour goes to
 * `color` (shiki's own `color`, or the `--shiki-light` variable in
 * `defaultColor: false` mode), everything else in `htmlStyle` — the
 * `--shiki-dark` variable, font-style variables — is kept as `style`.
 */
function toHighlightedToken(token: ShikiTokenLike): HighlightedToken {
    const out: HighlightedToken = { content: token.content };
    const parsed = parseHtmlStyle(token.htmlStyle);
    let color = token.color;
    if (parsed) {
        let style: Record<string, string> | null = null;
        for (const prop in parsed) {
            const value = parsed[prop];
            if (prop === 'color') {
                color ??= value;
            } else if (prop === '--shiki-light' && color === undefined) {
                color = value;
            } else {
                (style ??= {})[prop] = value;
            }
        }
        if (style) out.style = style;
    }
    if (color !== undefined) out.color = color;
    return out;
}

/** Create a shared, lazily-loaded shiki-backed highlighter. */
export function createShikiHighlighter(options: ShikiOptions = {}): CodeHighlighter {
    const themes: ShikiThemes = { ...DEFAULT_THEMES, ...options.themes };
    const preload = options.langs ?? [...DEFAULT_LANGS];
    const loadLanguages = options.loadLanguages ?? true;
    const load = options.load ?? ((): Promise<ShikiModule> => import('shiki') as Promise<ShikiModule>);
    const cacheSize = Math.max(1, options.cacheSize ?? DEFAULT_CACHE_SIZE);

    // Insertion-ordered Map as an LRU: a hit is re-inserted at the end, the
    // first key is the coldest.
    const cache = new Map<string, HighlightedToken[][]>();
    const pending = new Map<string, Promise<HighlightedToken[][]>>();

    /** Languages that could not be loaded — never retried, always plain. */
    const failedLangs = new Set<string>();
    const langLoads = new Map<string, Promise<boolean>>();

    let highlighterPromise: Promise<ShikiHighlighterLike> | null = null;

    const cacheGet = (key: string): HighlightedToken[][] | null => {
        const hit = cache.get(key);
        if (hit === undefined) return null;
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    };

    const cacheSet = (key: string, tokens: HighlightedToken[][]): void => {
        cache.delete(key);
        cache.set(key, tokens);
        while (cache.size > cacheSize) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
        }
    };

    /** The shared highlighter. Started on first use; a failed load stays failed (every later call resolves plain). */
    const getHighlighter = (): Promise<ShikiHighlighterLike> => {
        highlighterPromise ??= load().then((mod) => mod.createHighlighter({ themes: [themes.light, themes.dark], langs: [...preload] }));
        return highlighterPromise;
    };

    /** Make sure `lang` is loaded; `false` when it cannot be (remembered, never retried). */
    const ensureLang = (h: ShikiHighlighterLike, lang: string): Promise<boolean> => {
        if (h.getLoadedLanguages().includes(lang)) return Promise.resolve(true);
        if (failedLangs.has(lang)) return Promise.resolve(false);
        if (!loadLanguages) {
            failedLangs.add(lang);
            return Promise.resolve(false);
        }
        let loading = langLoads.get(lang);
        if (!loading) {
            loading = h.loadLanguage(lang).then(
                () => true,
                () => {
                    failedLangs.add(lang);
                    return false;
                },
            );
            langLoads.set(lang, loading);
        }
        return loading;
    };

    const run = async (code: string, lang: string): Promise<HighlightedToken[][]> => {
        const h = await getHighlighter();
        if (!(await ensureLang(h, lang))) return plainTokens(code);
        const { tokens } = h.codeToTokens(code, { lang, themes: { light: themes.light, dark: themes.dark }, defaultColor: false });
        return tokens.map((line) => line.map(toHighlightedToken));
    };

    return {
        peek(code, rawLang) {
            const lang = normalizeLang(rawLang);
            if (lang === null || failedLangs.has(lang)) return plainTokens(code);
            return cacheGet(cacheKey(lang, code));
        },

        highlight(code, rawLang) {
            const lang = normalizeLang(rawLang);
            if (lang === null || failedLangs.has(lang)) return Promise.resolve(plainTokens(code));
            const key = cacheKey(lang, code);
            const hit = cacheGet(key);
            if (hit) return Promise.resolve(hit);
            let job = pending.get(key);
            if (!job) {
                job = run(code, lang)
                    .catch(() => plainTokens(code))
                    .then((tokens) => {
                        pending.delete(key);
                        cacheSet(key, tokens);
                        return tokens;
                    });
                pending.set(key, job);
            }
            return job;
        },

        // Optimistic until a load has failed: shiki's alias table (`ts` for
        // `typescript`, …) is the authority on what is loaded, so the answer
        // is only ever narrowed by a recorded failure.
        supports(rawLang) {
            const lang = normalizeLang(rawLang);
            return lang !== null && !failedLangs.has(lang);
        },
    };
}
