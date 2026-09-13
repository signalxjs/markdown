/**
 * `createTextStream()` — a one-line bridge between an AI token loop and a
 * view.
 *
 * It owns a reactive `value` signal and coalesces bursts of `append()` calls
 * into a single signal write per `flushIntervalMs` window, so a fast token
 * stream re-renders at a bounded rate instead of once per token. `pipe()`
 * drains an `AsyncIterable<string>` (a completion stream) into it. Format-
 * agnostic: it accumulates text; the view parses it with whatever format it
 * was given.
 *
 * @example
 * ```ts
 * const text = createTextStream({ flushIntervalMs: 16 });
 *
 * // producer — by hand…
 * for await (const token of completion) text.append(token);
 * text.done();
 * // …or piped
 * await text.pipe(completion, controller.signal);
 *
 * // consumer
 * <RichTextView value={text.value.value} format={markdownFormat} />
 * ```
 */

import { signal, type PrimitiveSignal } from '@sigx/reactivity';

export interface CreateTextStreamOptions {
    /**
     * Coalesce `append()` calls within this many milliseconds into a single
     * `value` update. `0` (default) flushes synchronously on every append.
     * A small value such as `16` caps re-renders to ~60fps under fast streams.
     */
    flushIntervalMs?: number;
}

export interface TextStream {
    /** Reactive accumulated source. */
    readonly value: PrimitiveSignal<string>;
    /** Reactive completion flag, set by {@link TextStream.done}. */
    readonly finished: PrimitiveSignal<boolean>;
    /** Append a token/chunk; buffered and coalesced into `value`. */
    append(chunk: string): void;
    /** Flush any pending buffer and mark the stream complete. */
    done(): void;
    /** Clear the buffer, `value`, and `finished` (e.g. for a regenerate). */
    reset(): void;
    /**
     * Append every chunk of `source`, then `done()`. When `signal` aborts,
     * consumption stops (the iterator is returned), the buffer is flushed and
     * `done()` is NOT called. Rejects only when the source throws — after the
     * buffer was flushed.
     */
    pipe(source: AsyncIterable<string>, signal?: AbortSignal): Promise<void>;
}

export function createTextStream(opts?: CreateTextStreamOptions): TextStream {
    const flushIntervalMs = opts?.flushIntervalMs ?? 0;
    const value = signal('');
    const finished = signal(false);

    let buffer = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (value.value !== buffer) value.value = buffer;
    };

    const schedule = (): void => {
        if (flushIntervalMs <= 0) {
            flush();
            return;
        }
        if (timer === null) timer = setTimeout(flush, flushIntervalMs);
    };

    const append = (chunk: string): void => {
        if (!chunk) return;
        buffer += chunk;
        if (finished.value) finished.value = false;
        schedule();
    };

    const done = (): void => {
        flush();
        finished.value = true;
    };

    const pipe = async (source: AsyncIterable<string>, abort?: AbortSignal): Promise<void> => {
        if (abort?.aborted) {
            flush();
            return;
        }
        const iterator = source[Symbol.asyncIterator]();
        // The abort must also interrupt a `next()` that is still pending (a
        // stalled token stream), so every step races the abort signal.
        let onAbort: (() => void) | undefined;
        const aborted = abort
            ? new Promise<void>((resolve) => {
                  onAbort = () => resolve();
                  abort.addEventListener('abort', onAbort, { once: true });
              })
            : null;
        try {
            for (;;) {
                const step = aborted ? await Promise.race([iterator.next(), aborted]) : await iterator.next();
                if (step === undefined || abort?.aborted) {
                    // Stop consuming; let the source clean up in the background —
                    // awaiting it could hang on a stalled stream.
                    Promise.resolve(iterator.return?.()).catch(() => {});
                    flush();
                    return;
                }
                if (step.done) {
                    done();
                    return;
                }
                append(step.value);
            }
        } catch (err) {
            flush();
            throw err;
        } finally {
            if (abort && onAbort) abort.removeEventListener('abort', onAbort);
        }
    };

    return {
        value,
        finished,
        append,
        done,
        reset(): void {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            buffer = '';
            value.value = '';
            finished.value = false;
        },
        pipe,
    };
}
