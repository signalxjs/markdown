/**
 * `<CodeBlock>` — the chrome around a fenced code block: a header with the
 * language label and a clipboard copy button, then `<pre><code>`.
 *
 * A component (not a plain element) so it can hold the "copied" state; the
 * render engine stamps the block's key onto it, so it survives streaming.
 * Highlighters (`@sigx/markdown/shiki`) reuse it by passing their token
 * markup as `body` instead of the raw `value`.
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { partAttrs } from './parts.js';

export type CodeBlockProps =
    & Define.Prop<'value', string, true>
    & Define.Prop<'lang', string | null>
    & Define.Prop<'meta', string | null>
    /** `true` while the fence is unterminated (streaming). */
    & Define.Prop<'open', boolean>
    /** Rendered inside `<code>` instead of the raw `value` (highlighted tokens). */
    & Define.Prop<'body', JSXElement>
    & Define.Prop<'classPrefix', string>
    /** Show the copy button. Default `true`; it is omitted when the Clipboard API is absent. */
    & Define.Prop<'copyButton', boolean>;

const COPIED_MS = 1500;

export const CodeBlock = component<CodeBlockProps>(({ props, signal, onUnmounted }) => {
    const copied = signal(false);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;

    const copy = (): void => {
        if (!canCopy) return;
        void navigator.clipboard.writeText(props.value).then(() => {
            copied.value = true;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                copied.value = false;
                timer = null;
            }, COPIED_MS);
        });
    };

    onUnmounted(() => {
        if (timer !== null) clearTimeout(timer);
    });

    return () => {
        const prefix = props.classPrefix;
        const lang = props.lang ?? null;
        const body = partAttrs('code-body', prefix);
        // Compose the prefix class with the conventional `language-*` class.
        const bodyClass = [body.class, lang ? `language-${lang}` : undefined].filter(Boolean).join(' ') || undefined;
        return (
            <div
                {...partAttrs('code', prefix)}
                data-lang={lang ?? undefined}
                data-open={props.open ? '' : undefined}
                data-copied={copied.value ? '' : undefined}
            >
                <div {...partAttrs('code-header', prefix)}>
                    <span {...partAttrs('code-lang', prefix)}>{lang ?? ''}</span>
                    {props.copyButton !== false && canCopy ? (
                        <button type="button" {...partAttrs('copy', prefix)} aria-label="Copy code" onClick={copy}>
                            {copied.value ? 'Copied' : 'Copy'}
                        </button>
                    ) : null}
                </div>
                <pre {...partAttrs('pre', prefix)}>
                    <code data-scope={body['data-scope']} data-part={body['data-part']} class={bodyClass}>
                        {props.body ?? props.value}
                    </code>
                </pre>
            </div>
        );
    };
});
