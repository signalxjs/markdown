/**
 * `<RichTextView>` on happy-dom: mounted through `render` from
 * `@sigx/runtime-dom` (tests may use the `sigx` umbrella for JSX).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, jsx, signal } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextView, createDomComponents } from '../../src/dom/index.js';
import { type RichTextPlugin } from '../../src/index.js';
import { mentionPlugin } from '@sigx/richtext-markdown';
import type { DomComponents } from '../../src/dom/index.js';
import { markdownFormat } from '@sigx/richtext-markdown';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
    vi.restoreAllMocks();
});

function mount(node: unknown): HTMLDivElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    render(node as never, container);
    return container;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('RichTextView (default components)', () => {
    it('renders blocks and inline nodes with data-scope / data-part attributes and no classes', () => {
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '# Hi\n\nSome **bold** `code` and [a link](https://x.com "T").\n\n- one\n- [x] done\n\n---\n\n> q\n\n| a | b |\n| :-- | --: |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```' }));
        const root = c.firstElementChild as HTMLElement;
        expect(root.tagName).toBe('DIV');
        expect(root.getAttribute('data-scope')).toBe('richtext');
        expect(root.getAttribute('data-part')).toBe('root');
        expect(root.className).toBe('');
        const h = root.querySelector('[data-part=heading]') as HTMLElement;
        expect(h.tagName).toBe('H1');
        expect(h.getAttribute('data-depth')).toBe('1');
        expect(root.querySelector('strong[data-part=strong]')!.textContent).toBe('bold');
        expect(root.querySelector('code[data-part=inline-code]')!.textContent).toBe('code');
        const a = root.querySelector('a[data-part=link]') as HTMLAnchorElement;
        expect(a.getAttribute('href')).toBe('https://x.com');
        expect(a.getAttribute('title')).toBe('T');
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
        const items = root.querySelectorAll('li[data-part=list-item]');
        expect(items).toHaveLength(2);
        expect(items[1].hasAttribute('data-task')).toBe(true);
        expect(items[1].hasAttribute('data-checked')).toBe(true);
        expect((items[1].querySelector('input') as HTMLInputElement).checked).toBe(true);
        expect(root.querySelector('hr[data-part=thematic-break]')).toBeTruthy();
        expect(root.querySelector('blockquote[data-part=blockquote]')!.textContent).toBe('q');
        expect(root.querySelectorAll('thead th[data-part=table-cell]')).toHaveLength(2);
        expect(root.querySelector('tbody td[data-align=right]')!.textContent).toBe('2');
        const code = root.querySelector('[data-part=code]') as HTMLElement;
        expect(code.getAttribute('data-lang')).toBe('ts');
        expect(code.hasAttribute('data-open')).toBe(false);
        expect(code.querySelector('[data-part=code-lang]')!.textContent).toBe('ts');
        expect(code.querySelector('pre > code')!.textContent).toBe('const x = 1;');
        expect(code.querySelector('pre > code')!.className).toBe('language-ts');
    });

    it('renders html nodes and unresolved references as literal text', () => {
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '<script>alert(1)</script>\n\n[foo][bar]' }));
        expect(c.querySelector('script')).toBeNull();
        expect(c.textContent).toContain('<script>alert(1)</script>');
        expect(c.textContent).toContain('[foo][bar]');
        expect(c.querySelector('a')).toBeNull();
    });

    it('resolves references against definitions and sanitises urls', () => {
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '[foo][bar] [x](javascript:alert(1))\n\n[bar]: /url "t"' }));
        const links = c.querySelectorAll('a');
        expect(links[0].getAttribute('href')).toBe('/url');
        expect(links[0].getAttribute('title')).toBe('t');
        expect(links[1].getAttribute('href')).toBe('#');
    });

    it('adds prefixed classes and forwards host attributes to the root', () => {
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '# T', classPrefix: 'md', class: 'prose', id: 'doc', 'aria-label': 'Answer' }));
        const root = c.firstElementChild as HTMLElement;
        expect(root.id).toBe('doc');
        expect(root.getAttribute('aria-label')).toBe('Answer');
        expect(root.classList.contains('prose')).toBe(true);
        expect(root.classList.contains('md-root')).toBe(true);
        expect(root.querySelector('h1')!.classList.contains('md-heading')).toBe(true);
        const c2 = mount(jsx(RichTextView, { format: markdownFormat, value: '```ts\nx\n```', classPrefix: 'md' }));
        const body = c2.querySelector('pre > code')!;
        expect(body.classList.contains('md-code-body')).toBe(true);
        expect(body.classList.contains('language-ts')).toBe(true);
    });

    it('routes link clicks to onLink with the event and prevents navigation', () => {
        const onLink = vi.fn();
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '[go](https://example.com)', onLink }));
        const a = c.querySelector('a')!;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        a.dispatchEvent(event);
        expect(onLink).toHaveBeenCalledTimes(1);
        expect(onLink.mock.calls[0][0]).toBe('https://example.com');
        expect(onLink.mock.calls[0][1]).toMatchObject({ type: 'link', url: 'https://example.com' });
        expect(onLink.mock.calls[0][2]).toBe(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('sets linkTarget on external links only', () => {
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '[a](https://x.com) [b](/local)', linkTarget: '_blank' }));
        const links = c.querySelectorAll('a');
        expect(links[0].getAttribute('target')).toBe('_blank');
        expect(links[1].getAttribute('target')).toBeNull();
    });

    it('accepts component overrides and plugin node components', () => {
        const components: Partial<DomComponents> = {
            heading: ({ depth, children }) => jsx('div', { class: `h${depth}`, children }),
            mention: ({ node }) => jsx('span', { class: 'mention', children: `@${(node as { label: string }).label}` }),
        };
        const plugins = [mentionPlugin];
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '# T\n\nhi @[Andy](u1)', components, plugins }));
        expect(c.querySelector('div.h1')!.textContent).toBe('T');
        expect(c.querySelector('h1')).toBeNull();
        expect(c.querySelector('span.mention')!.textContent).toBe('@Andy');
    });

    it('renders a plugin node without a component through the text projection of its spec', () => {
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: 'hi @[Andy](u1)', plugins: [mentionPlugin] }));
        expect(c.textContent).toBe('hi @Andy');
    });

    it('merges the DOM components plugins ship (components.dom) under the explicit overrides', () => {
        const loud: DomComponents['paragraph'] = ({ children }) => jsx('p', { class: 'loud', children });
        const mine: DomComponents['paragraph'] = ({ children }) => jsx('p', { class: 'mine', children });
        const plugin: RichTextPlugin = { name: 'loud', components: { dom: { paragraph: loud } } };
        expect(mount(jsx(RichTextView, { format: markdownFormat, value: 'a', plugins: [plugin] })).querySelector('p.loud')).toBeTruthy();
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: 'a', plugins: [plugin], components: { paragraph: mine } }));
        expect(c.querySelector('p.mine')).toBeTruthy();
        expect(c.querySelector('p.loud')).toBeNull();
    });

    it('renders a pre-parsed root', () => {
        const root = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'pre-parsed' }] }] } as never;
        const c = mount(jsx(RichTextView, { format: markdownFormat, root }));
        expect(c.querySelector('p[data-part=paragraph]')!.textContent).toBe('pre-parsed');
    });

    it('uses createDomComponents defaults as the base of the merged map', () => {
        const base = createDomComponents({ classPrefix: 'x' });
        expect(typeof base.paragraph).toBe('function');
        expect(typeof base.link).toBe('function');
    });
});

describe('RichTextView (streaming)', () => {
    it('keeps the first block mounted while a second streams in', async () => {
        const source = signal('First paragraph.\n\n');
        const App = component(() => () => jsx(RichTextView, { format: markdownFormat, value: source.value }));
        const c = mount(jsx(App, {}));
        const first = c.querySelector('p')!;
        expect(first.textContent).toBe('First paragraph.');

        source.value = 'First paragraph.\n\nSecond **para';
        await tick();
        expect(c.querySelectorAll('p')).toHaveLength(2);
        expect(c.querySelector('p')).toBe(first);

        source.value = 'First paragraph.\n\nSecond **paragraph**.\n\n- item';
        await tick();
        expect(c.querySelector('p')).toBe(first);
        expect(c.querySelector('strong')!.textContent).toBe('paragraph');
        expect(c.querySelector('li')!.textContent).toBe('item');
    });

    it('marks an unterminated fence open and keeps its element while it grows', async () => {
        const source = signal('```ts\nline1');
        const App = component(() => () => jsx(RichTextView, { format: markdownFormat, value: source.value }));
        const c = mount(jsx(App, {}));
        const block = c.querySelector('[data-part=code]')!;
        expect(block.hasAttribute('data-open')).toBe(true);
        source.value = '```ts\nline1\nline2\n```';
        await tick();
        expect(c.querySelector('[data-part=code]')).toBe(block);
        expect(block.hasAttribute('data-open')).toBe(false);
        expect(block.querySelector('code')!.textContent).toBe('line1\nline2');
    });

    it('re-creates the engine when the plugins prop changes identity', async () => {
        const plugins = signal<{ list: RichTextPlugin[] }>({ list: [] });
        const App = component(() => () => jsx(RichTextView, { format: markdownFormat, value: 'hi @[Andy](u1)', plugins: plugins.list }));
        const c = mount(jsx(App, {}));
        // Without the plugin `[Andy](u1)` is an ordinary inline link.
        expect(c.querySelector('a')!.getAttribute('href')).toBe('u1');
        plugins.list = [mentionPlugin];
        await tick();
        expect(c.querySelector('a')).toBeNull();
        expect(c.textContent).toBe('hi @Andy');
    });
});

describe('CodeBlock copy button', () => {
    it('copies the code and shows a transient copied state', async () => {
        vi.useFakeTimers();
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const c = mount(jsx(RichTextView, { format: markdownFormat, value: '```\nabc\n```' }));
        const button = c.querySelector('button[data-part=copy]') as HTMLButtonElement;
        expect(button).toBeTruthy();
        button.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(writeText).toHaveBeenCalledWith('abc');
        expect(c.querySelector('[data-part=code]')!.hasAttribute('data-copied')).toBe(true);
        expect(button.textContent).toBe('Copied');
        await vi.advanceTimersByTimeAsync(1600);
        expect(c.querySelector('[data-part=code]')!.hasAttribute('data-copied')).toBe(false);
        vi.useRealTimers();
    });

    it('omits the button when the Clipboard API is absent or copyButton is false', () => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        expect(mount(jsx(RichTextView, { format: markdownFormat, value: '```\nabc\n```' })).querySelector('button')).toBeNull();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
        expect(mount(jsx(RichTextView, { format: markdownFormat, value: '```\nabc\n```', copyButton: false })).querySelector('button')).toBeNull();
    });
});
