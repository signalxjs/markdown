import { describe, expect, it } from 'vitest';
import { createMarkdownStream } from '../../src/stream/index.js';

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('createMarkdownStream', () => {
    it('accumulates appended chunks into value (sync flush)', () => {
        const md = createMarkdownStream();
        md.append('# ');
        md.append('Hi');
        expect(md.value.value).toBe('# Hi');
    });

    it('coalesces appends within the flush interval', async () => {
        const md = createMarkdownStream({ flushIntervalMs: 40 });
        md.append('a');
        md.append('b');
        expect(md.value.value).toBe(''); // not flushed yet
        await tick(60);
        expect(md.value.value).toBe('ab');
    });

    it('done() flushes immediately and sets finished', () => {
        const md = createMarkdownStream({ flushIntervalMs: 1000 });
        md.append('x');
        expect(md.value.value).toBe('');
        md.done();
        expect(md.value.value).toBe('x');
        expect(md.finished.value).toBe(true);
    });

    it('reset() clears value and finished', () => {
        const md = createMarkdownStream();
        md.append('hello');
        md.done();
        md.reset();
        expect(md.value.value).toBe('');
        expect(md.finished.value).toBe(false);
    });

    it('ignores empty chunks', () => {
        const md = createMarkdownStream();
        md.append('');
        expect(md.value.value).toBe('');
    });

    it('appending after done() clears finished again', () => {
        const md = createMarkdownStream();
        md.append('a');
        md.done();
        md.append('b');
        expect(md.finished.value).toBe(false);
        expect(md.value.value).toBe('ab');
    });
});

describe('createMarkdownStream().pipe', () => {
    async function* tokens(...chunks: string[]): AsyncGenerator<string> {
        for (const chunk of chunks) {
            await tick(1);
            yield chunk;
        }
    }

    it('appends every chunk and calls done() when the source ends', async () => {
        const md = createMarkdownStream({ flushIntervalMs: 1000 });
        await md.pipe(tokens('# ', 'Hi', '!'));
        expect(md.value.value).toBe('# Hi!');
        expect(md.finished.value).toBe(true);
    });

    it('stops consuming on abort, returns the iterator, flushes, and does not call done()', async () => {
        const md = createMarkdownStream({ flushIntervalMs: 1000 });
        const controller = new AbortController();
        let returned = false;
        let pulls = 0;
        const source: AsyncIterable<string> = {
            [Symbol.asyncIterator]: () => ({
                next: () => {
                    pulls++;
                    // one chunk, then a stream that never yields again
                    return pulls === 1 ? Promise.resolve({ value: 'partial', done: false }) : new Promise(() => {});
                },
                return: () => {
                    returned = true;
                    return Promise.resolve({ value: undefined, done: true });
                },
            }),
        };
        const piping = md.pipe(source, controller.signal);
        await tick(5);
        expect(md.value.value).toBe(''); // still buffered
        controller.abort();
        await piping; // resolves even though next() is stalled
        expect(md.value.value).toBe('partial');
        expect(md.finished.value).toBe(false);
        expect(returned).toBe(true);
        expect(pulls).toBe(2);
    });

    it('breaks out of a for-await style generator on abort (finally runs)', async () => {
        const md = createMarkdownStream();
        const controller = new AbortController();
        let cleaned = false;
        async function* gen(): AsyncGenerator<string> {
            try {
                yield 'a';
                await tick(1);
                yield 'b';
                await tick(30);
                yield 'never';
            } finally {
                cleaned = true;
            }
        }
        const piping = md.pipe(gen(), controller.signal);
        await tick(5);
        controller.abort();
        await piping;
        expect(md.value.value).toBe('ab');
        expect(md.finished.value).toBe(false);
        await tick(40);
        expect(cleaned).toBe(true);
    });

    it('does nothing but flush when the signal is already aborted', async () => {
        const md = createMarkdownStream({ flushIntervalMs: 1000 });
        md.append('x');
        let pulled = false;
        const source: AsyncIterable<string> = {
            [Symbol.asyncIterator]: () => ({
                next: () => {
                    pulled = true;
                    return Promise.resolve({ value: undefined, done: true });
                },
            }),
        };
        await md.pipe(source, AbortSignal.abort());
        expect(pulled).toBe(false);
        expect(md.value.value).toBe('x');
        expect(md.finished.value).toBe(false);
    });

    it('rejects when the source throws, after flushing what arrived', async () => {
        const md = createMarkdownStream({ flushIntervalMs: 1000 });
        async function* failing(): AsyncGenerator<string> {
            yield 'a';
            yield 'b';
            throw new Error('boom');
        }
        await expect(md.pipe(failing())).rejects.toThrow('boom');
        expect(md.value.value).toBe('ab');
        expect(md.finished.value).toBe(false);
    });
});
