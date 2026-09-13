import { afterEach, describe, expect, it } from 'vitest';
import { jsx } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextView } from '../../src/dom/index.js';
import { shikiPlugin, type ShikiModule } from '../../src/shiki/index.js';
import { markdownFormat } from '../../src/markdown/index.js';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
});

function mount(node: unknown): HTMLDivElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    render(node as never, container);
    return container;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake `shiki`: one red token per line. */
const fakeShiki: ShikiModule = {
    createHighlighter: async () => ({
        codeToTokens: (code) => ({ tokens: code.split('\n').map((line) => [{ content: line, color: '#f00' }]) }),
        loadLanguage: async () => undefined,
        getLoadedLanguages: () => ['ts'],
    }),
};

describe('shikiPlugin', () => {
    it('contributes a highlighted code slot through components.dom', () => {
        const plugin = shikiPlugin({ load: () => Promise.resolve(fakeShiki), debounceMs: 0 });
        expect(plugin.name).toBe('shiki');
        expect(typeof plugin.components?.dom?.code).toBe('function');
    });

    it('highlights code blocks of a RichTextView that installs it', async () => {
        const plugins = [shikiPlugin({ load: () => Promise.resolve(fakeShiki) })];
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '```ts\nconst x = 1\n```', plugins }));
        expect(c.querySelector('pre > code')!.textContent).toBe('const x = 1');
        await tick();
        await tick();
        const token = c.querySelector('[data-line] > span') as HTMLElement;
        expect(token.textContent).toBe('const x = 1');
        expect(token.style.color).toBe('#f00');
    });
});
