/**
 * `shikiCodeBlock()` — a `code` slot for the DOM component map that renders
 * fenced blocks through a {@link CodeHighlighter} inside the default
 * `<CodeBlock>` chrome.
 *
 * The slot yields a `<ShikiCode>` component vnode, so the render engine
 * stamps the block key on it and the instance — its tokens, its pending
 * highlight — survives a streaming re-render. While a fence is still open
 * the highlight is debounced (`debounceMs`, default 120 ms) so an AI token
 * loop does not tokenize on every keystroke; the tokens of the last result
 * stay on screen with the newly appended tail rendered plain, so the block
 * never flashes back to unhighlighted text. A closed fence highlights at
 * once, a cached result (`peek`) renders synchronously, and a generation
 * counter drops results that arrive out of order.
 *
 * Tokens become `<span data-line>` rows of `<span style>` tokens — never
 * `innerHTML`.
 */

import { watch } from '@sigx/reactivity';
import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { CodeBlock, type DomMarkdownComponents } from '../dom/index.js';
import type { CodeHighlighter, HighlightedToken } from './highlighter.js';

export interface ShikiCodeBlockOptions {
    /** Delay before highlighting an unterminated (streaming) fence. Default `120`. `0` highlights immediately. */
    debounceMs?: number;
    /** Forwarded to `<CodeBlock>`: adds `<prefix>-<part>` classes next to the data attributes. */
    classPrefix?: string;
    /** Forwarded to `<CodeBlock>`: show the copy button. Default `true`. */
    copyButton?: boolean;
}

export const DEFAULT_DEBOUNCE_MS = 120;

type ShikiCodeProps =
    & Define.Prop<'value', string, true>
    & Define.Prop<'lang', string | null>
    & Define.Prop<'meta', string | null>
    & Define.Prop<'open', boolean>
    & Define.Prop<'highlighter', CodeHighlighter, true>
    & Define.Prop<'debounceMs', number>
    & Define.Prop<'classPrefix', string>
    & Define.Prop<'copyButton', boolean>;

/** The last highlight result, remembered with the input it was computed from. */
interface Highlighted {
    value: string;
    lang: string | null;
    lines: HighlightedToken[][];
}

/**
 * The token lines to show for `value` given the last result: the result
 * itself when it is current, the result plus the appended tail as plain
 * tokens while a fence streams, or `null` (plain text) when unrelated.
 */
function linesFor(current: Highlighted, value: string): HighlightedToken[][] | null {
    if (current.value === value) return current.lines;
    if (!value.startsWith(current.value)) return null;
    const tail = value.slice(current.value.length).split('\n');
    const lines = current.lines.slice();
    if (lines.length === 0) lines.push([]);
    if (tail[0] !== '') lines[lines.length - 1] = [...lines[lines.length - 1], { content: tail[0] }];
    for (let i = 1; i < tail.length; i++) lines.push([{ content: tail[i] }]);
    return lines;
}

function tokenStyle(token: HighlightedToken): Record<string, string | undefined> | undefined {
    if (token.color === undefined && token.style === undefined) return undefined;
    return { color: token.color, ...token.style };
}

/** Lines joined by newlines (between, not after — the text content stays exactly `value`). */
function renderLines(lines: HighlightedToken[][]): JSXElement {
    const last = lines.length - 1;
    return (
        <>
            {lines.map((line, i) => (
                <span data-line="">
                    {line.map((token) => <span style={tokenStyle(token)}>{token.content}</span>)}
                    {i < last ? '\n' : null}
                </span>
            ))}
        </>
    );
}

const ShikiCode = component<ShikiCodeProps>(({ props, signal, onUnmounted }) => {
    // Results live outside the signal (token arrays are not worth a deep
    // proxy); `version` is bumped to re-render.
    const version = signal(0);
    let current: Highlighted | null = null;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const setCurrent = (next: Highlighted | null): void => {
        current = next;
        version.value++;
    };

    const cancelTimer = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const run = (): void => {
        cancelTimer();
        const value = props.value;
        const lang = props.lang ?? null;
        const gen = ++generation;
        void props.highlighter.highlight(value, lang).then((lines) => {
            if (gen !== generation) return; // superseded while in flight
            setCurrent({ value, lang, lines });
        });
    };

    /** (Re)highlight for the current props: cached → now; otherwise debounced while the fence is open. */
    const schedule = (): void => {
        cancelTimer();
        generation++;
        const highlighter = props.highlighter;
        const value = props.value;
        const lang = props.lang ?? null;
        if (lang === null || (highlighter.supports && !highlighter.supports(lang))) {
            if (current !== null) setCurrent(null);
            return;
        }
        const hit = highlighter.peek(value, lang);
        if (hit !== null) {
            setCurrent({ value, lang, lines: hit });
            return;
        }
        const delay = props.open ? (props.debounceMs ?? DEFAULT_DEBOUNCE_MS) : 0;
        if (delay > 0) timer = setTimeout(run, delay);
        else run();
    };

    schedule();
    const stop = watch(() => [props.value, props.lang, props.open, props.highlighter], schedule);

    onUnmounted(() => {
        stop();
        cancelTimer();
        generation++;
    });

    return () => {
        void version.value;
        const value = props.value;
        const lang = props.lang ?? null;
        const lines = current !== null && current.lang === lang ? linesFor(current, value) : null;
        return (
            <CodeBlock
                value={value}
                lang={lang}
                meta={props.meta ?? null}
                open={props.open}
                classPrefix={props.classPrefix}
                copyButton={props.copyButton}
                body={lines !== null ? renderLines(lines) : undefined}
            />
        );
    };
});

/**
 * Build a `code` renderer for `MarkdownView`'s `components` that highlights
 * through `highlighter`.
 *
 * @example
 * ```tsx
 * const highlighter = createShikiHighlighter();
 * const components = { code: shikiCodeBlock(highlighter) };
 * <MarkdownView value={text} components={components} />
 * ```
 */
export function shikiCodeBlock(highlighter: CodeHighlighter, options: ShikiCodeBlockOptions = {}): DomMarkdownComponents['code'] {
    const { debounceMs, classPrefix, copyButton } = options;
    return ({ value, lang, meta, open }) => (
        <ShikiCode
            value={value}
            lang={lang}
            meta={meta}
            open={open}
            highlighter={highlighter}
            debounceMs={debounceMs}
            classPrefix={classPrefix}
            copyButton={copyButton}
        />
    );
}
