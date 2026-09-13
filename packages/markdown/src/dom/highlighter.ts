/**
 * The code-highlighting contract a code-block component consumes. Implement
 * it to plug in any engine; `@sigx/markdown/shiki` implements it over
 * `shiki`. Dependency-free — no engine is named here.
 */

/** One highlighted token: text plus the inline style it renders with. */
export interface HighlightedToken {
    content: string;
    /** Foreground colour (the light theme's in dual-theme mode). */
    color?: string;
    /** Extra inline styles, e.g. dual-theme CSS variables (`--shiki-dark`). */
    style?: Record<string, string>;
}

export interface CodeHighlighter {
    /**
     * Synchronously return cached tokens for `(code, lang)`, or `null`. A
     * language that needs no engine (`null`, `text`) or is known to be
     * unavailable resolves synchronously to plain tokens.
     */
    peek(code: string, lang: string | null): HighlightedToken[][] | null;
    /**
     * Highlight (loading the engine and the grammar on demand); resolves to
     * token lines. Never rejects: on any failure it resolves to plain-text
     * tokens (one token per line, no colour).
     */
    highlight(code: string, lang: string | null): Promise<HighlightedToken[][]>;
    /** Whether a language is (or can be) supported. */
    supports?(lang: string): boolean;
}

/** Plain-text tokens: one uncoloured token per line. */
export function plainTokens(code: string): HighlightedToken[][] {
    return code.split('\n').map((line) => [{ content: line }]);
}
