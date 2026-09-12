/**
 * Default DOM components: one plain HTML element per mdast node, styled only
 * through `data-scope` / `data-part` (and an optional class prefix). No
 * stylesheet ships with the package; the docs carry a styling recipe.
 *
 * Security: `html` nodes render as literal text (there is no HTML sink), and
 * every `url` reaches these components already passed through the render
 * context's `sanitizeUrl`.
 */

import type { JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import type { Link, LinkReference } from '../ast/index.js';
import type { LinkHandler, MarkdownComponents } from '../render/index.js';
import { CodeBlock } from './code-block.js';
import { partAttrs } from './parts.js';

export type DomMarkdownComponents = MarkdownComponents<JSXElement>;

/** The `onLink` handler of the DOM view: the click event comes along. */
export type DomLinkHandler = (url: string, node: Link | LinkReference, event: MouseEvent) => void;

export interface DomComponentsOptions {
    /** Adds `<prefix>-<part>` classes next to the data attributes. */
    classPrefix?: string;
    /** `target` for external links (`http(s)://`). Default: none. */
    linkTarget?: '_blank' | '_self';
    /** Show the copy button on code blocks. Default `true`. */
    copyButton?: boolean;
}

const EXTERNAL = /^https?:\/\//i;

/** Build the default component map (call with options, or use `defaultComponents`). */
export function createDomComponents(options: DomComponentsOptions = {}): DomMarkdownComponents {
    const prefix = options.classPrefix;
    const part = (name: string) => partAttrs(name, prefix);

    return {
        root: ({ children }) => <div {...part('root')}>{children}</div>,
        paragraph: ({ children }) => <p {...part('paragraph')}>{children}</p>,
        heading: ({ depth, children }) => {
            const attrs = { ...part('heading'), 'data-depth': String(depth) };
            switch (depth) {
                case 1:
                    return <h1 {...attrs}>{children}</h1>;
                case 2:
                    return <h2 {...attrs}>{children}</h2>;
                case 3:
                    return <h3 {...attrs}>{children}</h3>;
                case 4:
                    return <h4 {...attrs}>{children}</h4>;
                case 5:
                    return <h5 {...attrs}>{children}</h5>;
                default:
                    return <h6 {...attrs}>{children}</h6>;
            }
        },
        blockquote: ({ children }) => <blockquote {...part('blockquote')}>{children}</blockquote>,
        list: ({ ordered, start, spread, children }) =>
            ordered ? (
                <ol {...part('list')} data-ordered="" data-spread={spread ? '' : undefined} start={start !== 1 ? start : undefined}>
                    {children}
                </ol>
            ) : (
                <ul {...part('list')} data-spread={spread ? '' : undefined}>
                    {children}
                </ul>
            ),
        listItem: ({ checked, children }) => (
            <li {...part('list-item')} data-task={checked !== null ? '' : undefined} data-checked={checked ? '' : undefined}>
                {checked !== null ? <input {...part('checkbox')} type="checkbox" disabled checked={checked} /> : null}
                {children}
            </li>
        ),
        code: ({ value, lang, meta, open }) => (
            <CodeBlock value={value} lang={lang} meta={meta} open={open} classPrefix={prefix} copyButton={options.copyButton} />
        ),
        thematicBreak: () => <hr {...part('thematic-break')} />,
        table: ({ children }) => (
            <table {...part('table')}>
                <thead {...part('table-head')}>{children[0]}</thead>
                {children.length > 1 ? <tbody {...part('table-body')}>{children.slice(1)}</tbody> : null}
            </table>
        ),
        tableRow: ({ children, header }) => (
            <tr {...part('table-row')} data-header={header ? '' : undefined}>
                {children}
            </tr>
        ),
        tableCell: ({ header, align, children }) =>
            header ? (
                <th {...part('table-cell')} data-align={align ?? undefined}>
                    {children}
                </th>
            ) : (
                <td {...part('table-cell')} data-align={align ?? undefined}>
                    {children}
                </td>
            ),
        html: ({ value }) => value,
        text: ({ value }) => value,
        emphasis: ({ children }) => <em {...part('emphasis')}>{children}</em>,
        strong: ({ children }) => <strong {...part('strong')}>{children}</strong>,
        delete: ({ children }) => <del {...part('delete')}>{children}</del>,
        inlineCode: ({ value }) => <code {...part('inline-code')}>{value}</code>,
        break: () => <br {...part('break')} />,
        link: ({ url, title, autolink, children, node, onLink }) => {
            const external = EXTERNAL.test(url);
            return (
                <a
                    {...part('link')}
                    href={url}
                    title={title ?? undefined}
                    target={external ? options.linkTarget : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                    data-autolink={autolink ? '' : undefined}
                    onClick={
                        onLink
                            ? (event: MouseEvent) => {
                                  event.preventDefault();
                                  (onLink as LinkHandler | DomLinkHandler)(url, node, event);
                              }
                            : undefined
                    }
                >
                    {children}
                </a>
            );
        },
        image: ({ url, alt, title }) => <img {...part('image')} src={url} alt={alt} title={title ?? undefined} loading="lazy" />,
    };
}

/** The defaults with no class prefix. */
export const defaultComponents: DomMarkdownComponents = createDomComponents();
