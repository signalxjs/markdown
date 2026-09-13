import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, render, signal } from 'sigx';
import { RichTextView, highlightedCodeBlock, type CodeHighlighter, type DomComponents, type HighlightedToken } from '../../src/dom/index.js';
import { markdownFormat } from '@sigx/richtext-markdown';

// ---------------------------------------------------------------------------
// A controllable fake highlighter: every highlight() call is parked until the
// test resolves it, and resolved results land in the peek() cache.
// ---------------------------------------------------------------------------

const LIGHT = '#ff0000';
const DARK = '#00ff00';

function colorize(code: string): HighlightedToken[][] {
    return code.split('\n').map((line) => [{ content: line, color: LIGHT, style: { '--shiki-dark': DARK } }]);
}

interface PendingCall {
    code: string;
    lang: string | null;
    resolve(): void;
}

interface FakeHighlighter {
    highlighter: CodeHighlighter;
    calls: PendingCall[];
    cache: Map<string, HighlightedToken[][]>;
    /** Resolve every parked call, oldest first. */
    resolveAll(): void;
}

function createFakeHighlighter(opts: { supports?: (lang: string) => boolean } = {}): FakeHighlighter {
    const cache = new Map<string, HighlightedToken[][]>();
    const calls: PendingCall[] = [];
    const key = (code: string, lang: string | null) => `${lang}:${code}`;
    const highlighter: CodeHighlighter = {
        peek: (code, lang) => cache.get(key(code, lang)) ?? null,
        highlight: (code, lang) =>
            new Promise<HighlightedToken[][]>((resolve) => {
                calls.push({
                    code,
                    lang,
                    resolve: () => {
                        const lines = colorize(code);
                        cache.set(key(code, lang), lines);
                        resolve(lines);
                    },
                });
            }),
        supports: opts.supports,
    };
    return {
        highlighter,
        calls,
        cache,
        resolveAll: () => {
            for (const call of calls.splice(0)) call.resolve();
        },
    };
}

/** Let resolved promises and the renderer's microtasks settle. */
async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

interface Mounted {
    container: HTMLElement;
    source: { value: string };
    code(): HTMLElement;
    lines(): HTMLElement[];
    tokens(): HTMLElement[];
}

/**
 * Mount a `<RichTextView>` whose `value` follows a signal. The view sits
 * inside a wrapper component so a signal write re-renders it with new props
 * (there is no JSX compiler in the test pipeline to make `value={…}` lazy).
 */
function mount(initial: string, components: Partial<DomComponents>): Mounted {
    const source = signal(initial);
    const App = component(() => () => <RichTextView format={markdownFormat} value={source.value} components={components} />);
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(<App />, container);
    const code = (): HTMLElement => {
        const el = container.querySelector<HTMLElement>('[data-part="code-body"]');
        if (!el) throw new Error('no code element rendered');
        return el;
    };
    return {
        container,
        source,
        code,
        lines: () => [...code().querySelectorAll<HTMLElement>('[data-line]')],
        tokens: () => [...code().querySelectorAll<HTMLElement>('[data-line] > span')],
    };
}

const CLOSED = '```ts\nconst x = 1\n```';
const OPEN = '```ts\nconst x = 1';

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('highlightedCodeBlock', () => {
    it('renders the plain value first, then the highlighted spans once highlight() resolves', async () => {
        const fake = createFakeHighlighter();
        const m = mount(CLOSED, { code: highlightedCodeBlock(fake.highlighter) });

        expect(m.code().textContent).toBe('const x = 1');
        expect(m.lines()).toHaveLength(0);
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]).toMatchObject({ code: 'const x = 1', lang: 'ts' });

        fake.resolveAll();
        await flush();

        expect(m.lines()).toHaveLength(1);
        expect(m.lines()[0].hasAttribute('data-line')).toBe(true);
        const [token] = m.tokens();
        expect(token.textContent).toBe('const x = 1');
        expect(token.style.color).toMatch(/^(#ff0000|rgb\(255, 0, 0\))$/);
        expect(token.style.getPropertyValue('--shiki-dark')).toBe(DARK);
        // The text is exactly the code — nothing added by the line markup.
        expect(m.code().textContent).toBe('const x = 1');
        // Never through an HTML sink.
        expect(m.code().innerHTML).not.toContain('&lt;');
    });

    it('keeps the code text exact across several lines', async () => {
        const fake = createFakeHighlighter();
        const m = mount('```ts\nconst x = 1\n\nx++\n```', { code: highlightedCodeBlock(fake.highlighter) });
        fake.resolveAll();
        await flush();
        expect(m.lines()).toHaveLength(3);
        expect(m.code().textContent).toBe('const x = 1\n\nx++');
    });

    it('renders spans synchronously on a peek() hit', () => {
        const fake = createFakeHighlighter();
        fake.cache.set('ts:const x = 1', colorize('const x = 1'));
        const m = mount(CLOSED, { code: highlightedCodeBlock(fake.highlighter) });

        expect(m.lines()).toHaveLength(1);
        expect(m.tokens()[0].style.getPropertyValue('--shiki-dark')).toBe(DARK);
        expect(fake.calls).toHaveLength(0);
    });

    it('leaves a fence without a language plain and never calls the highlighter', () => {
        const fake = createFakeHighlighter();
        const m = mount('```\nplain\n```', { code: highlightedCodeBlock(fake.highlighter) });
        expect(m.code().textContent).toBe('plain');
        expect(m.lines()).toHaveLength(0);
        expect(fake.calls).toHaveLength(0);
    });

    it('skips languages the highlighter says it does not support', () => {
        const fake = createFakeHighlighter({ supports: (lang) => lang !== 'ts' });
        const m = mount(CLOSED, { code: highlightedCodeBlock(fake.highlighter) });
        expect(m.lines()).toHaveLength(0);
        expect(fake.calls).toHaveLength(0);
    });

    it('drops a stale result that resolves after a newer one', async () => {
        const fake = createFakeHighlighter();
        const m = mount(CLOSED, { code: highlightedCodeBlock(fake.highlighter) });
        expect(fake.calls).toHaveLength(1);
        const older = fake.calls[0];

        m.source.value = '```ts\nconst y = 2\n```';
        await flush();
        expect(fake.calls).toHaveLength(2);
        const newer = fake.calls[1];
        expect(newer.code).toBe('const y = 2');

        newer.resolve();
        await flush();
        expect(m.lines()).toHaveLength(1);
        expect(m.code().textContent).toBe('const y = 2');

        older.resolve();
        await flush();
        expect(m.lines()).toHaveLength(1);
        expect(m.code().textContent).toBe('const y = 2');
        expect(m.tokens()[0].textContent).toBe('const y = 2');
    });

    it('keeps the code element across a streaming append and re-highlights after the debounce', async () => {
        vi.useFakeTimers();
        const fake = createFakeHighlighter();
        const m = mount(OPEN, { code: highlightedCodeBlock(fake.highlighter) });
        const codeEl = m.code();

        // Open fence: debounced, nothing yet.
        expect(fake.calls).toHaveLength(0);
        vi.advanceTimersByTime(119);
        expect(fake.calls).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]).toMatchObject({ code: 'const x = 1', lang: 'ts' });

        fake.resolveAll();
        await flush();
        expect(m.lines()).toHaveLength(1);
        expect(m.code()).toBe(codeEl);

        // Append: same element, the old tokens stay and the tail renders plain.
        m.source.value = '```ts\nconst x = 1;\nlet y';
        await flush();
        expect(m.code()).toBe(codeEl);
        expect(m.code().textContent).toBe('const x = 1;\nlet y');
        expect(m.lines()).toHaveLength(2);
        const [kept, tail, next] = m.tokens();
        expect(kept.style.getPropertyValue('--shiki-dark')).toBe(DARK);
        expect(tail.textContent).toBe(';');
        expect(tail.style.getPropertyValue('--shiki-dark')).toBe('');
        expect(next.textContent).toBe('let y');

        // Not re-highlighted until the debounce elapses; a second append inside it coalesces.
        expect(fake.calls).toHaveLength(0);
        vi.advanceTimersByTime(60);
        m.source.value = '```ts\nconst x = 1;\nlet y = 2';
        await flush();
        vi.advanceTimersByTime(119);
        expect(fake.calls).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]).toMatchObject({ code: 'const x = 1;\nlet y = 2', lang: 'ts' });

        fake.resolveAll();
        await flush();
        expect(m.code()).toBe(codeEl);
        expect(m.code().textContent).toBe('const x = 1;\nlet y = 2');
        for (const token of m.tokens()) expect(token.style.getPropertyValue('--shiki-dark')).toBe(DARK);
    });

    it('falls back to plain text when the value no longer extends the last result', async () => {
        const fake = createFakeHighlighter();
        const m = mount(CLOSED, { code: highlightedCodeBlock(fake.highlighter) });
        fake.resolveAll();
        await flush();
        expect(m.lines()).toHaveLength(1);

        m.source.value = '```ts\nlet z\n```';
        await flush();
        expect(m.lines()).toHaveLength(0);
        expect(m.code().textContent).toBe('let z');
    });

    it('debounces while open and highlights immediately when the fence closes', async () => {
        vi.useFakeTimers();
        const fake = createFakeHighlighter();
        const m = mount(OPEN, { code: highlightedCodeBlock(fake.highlighter) });
        expect(fake.calls).toHaveLength(0);

        m.source.value = CLOSED;
        await flush();
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]).toMatchObject({ code: 'const x = 1', lang: 'ts' });

        // The pending debounce was cancelled, not fired on top.
        vi.advanceTimersByTime(500);
        expect(fake.calls).toHaveLength(1);
    });

    it('honours debounceMs (0 highlights an open fence at once)', () => {
        vi.useFakeTimers();
        const fake = createFakeHighlighter();
        mount(OPEN, { code: highlightedCodeBlock(fake.highlighter, { debounceMs: 0 }) });
        expect(fake.calls).toHaveLength(1);

        const slow = createFakeHighlighter();
        mount(OPEN, { code: highlightedCodeBlock(slow.highlighter, { debounceMs: 500 }) });
        vi.advanceTimersByTime(499);
        expect(slow.calls).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(slow.calls).toHaveLength(1);
    });

    it('forwards classPrefix and copyButton to the CodeBlock chrome', () => {
        const fake = createFakeHighlighter();
        const m = mount(CLOSED, { code: highlightedCodeBlock(fake.highlighter, { classPrefix: 'md', copyButton: false }) });
        const block = m.container.querySelector('[data-part="code"]');
        expect(block?.classList.contains('md-code')).toBe(true);
        expect(block?.getAttribute('data-lang')).toBe('ts');
        expect(m.container.querySelector('[data-part="copy"]')).toBeNull();
    });
});
