/**
 * `parseHtml()` — HTML in, the standard tree out. Platform-free (no
 * `DOMParser`), built for the markup that reaches a clipboard, a CMS field
 * or an LLM answer rather than for the full HTML5 algorithm:
 *
 * - The element table maps `p h1–h6 blockquote ul ol li pre>code hr table
 *   thead tbody tfoot tr th td strong b em i del s strike code a img br` to
 *   the standard nodes; `input[type=checkbox]` first in a list item is the
 *   task state; `ol[start]`, `td/th[align]` (or `style="text-align"`) and
 *   `code[class^=language-]` carry over.
 * - Sectioning and styling wrappers (`div section article main header footer
 *   nav aside figure details span font u sub sup mark small …`) are
 *   transparent, and so is any element the table does not know (or dropped
 *   with `unknown: 'drop'`). Stray phrasing at block level becomes a
 *   paragraph; whitespace between blocks is dropped and whitespace inside
 *   phrasing collapsed (except in `pre`).
 * - Only `href` and `src` survive, both through the core's `sanitizeUrl`;
 *   no other attribute reaches the tree, so pasted markup cannot smuggle
 *   handlers or styles.
 * - Plugins add element rules under `formats.html.elements` (tried first).
 *
 * Out of scope (deliberately): Word / Google Docs cleanup, CSS semantics
 * beyond `text-align`, `math` / `svg`.
 */

import type { AlignType, BlockContent, Code, Image, Link, List, ListItem, Node, PhrasingContent, Root, Table, TableCell, TableRow, UrlKind } from '@sigx/richtext';
import { assignKeys, sanitizeUrl } from '@sigx/richtext';
import type { RichTextPlugin } from '@sigx/richtext';
import type { HtmlElementContext } from './plugin.js';
import { resolveHtmlPlugins, type ResolvedHtmlPlugins } from './resolve.js';
import { buildTree, textOf, type HtmlElement, type HtmlNode } from './tree.js';

export interface ParseHtmlOptions {
    plugins?: readonly RichTextPlugin[];
    /** Elements outside the table: `'transparent'` (default — their content is kept) or `'drop'`. */
    unknown?: 'transparent' | 'drop';
}

/** Elements that start a block (and end a phrasing run) at block level. */
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'menu', 'li', 'pre', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd', 'address', 'form', 'fieldset', 'center', 'body', 'html', 'dialog', 'hgroup']);

const MARK_TAGS: Readonly<Record<string, 'strong' | 'emphasis' | 'delete'>> = { strong: 'strong', b: 'strong', em: 'emphasis', i: 'emphasis', del: 'delete', s: 'delete', strike: 'delete' };

const BLOCK_ROLES = new Set(['textblock', 'container', 'table', 'code', 'void']);

const WS = /[ \t\r\n\f]+/g;

export function parseHtml(source: string, options: ParseHtmlOptions = {}): Root {
    const parser = new HtmlParser(resolveHtmlPlugins(options.plugins), options.unknown ?? 'transparent');
    const root: Root = { type: 'root', children: parser.blocks(buildTree(source)) };
    assignKeys(root, parser.resolved.schema);
    return root;
}

class HtmlParser {
    constructor(
        readonly resolved: ResolvedHtmlPlugins,
        private readonly unknown: 'transparent' | 'drop',
    ) {}

    // -- blocks ---------------------------------------------------------------

    blocks(nodes: readonly HtmlNode[]): BlockContent[] {
        const out: BlockContent[] = [];
        let run: HtmlNode[] = [];
        const flush = (): void => {
            if (run.length === 0) return;
            const children = this.inlines(run);
            run = [];
            if (children.length) out.push({ type: 'paragraph', children });
        };
        for (const node of nodes) {
            if (node.type === 'text') {
                run.push(node);
                continue;
            }
            const custom = this.custom(node);
            if (custom) {
                if (BLOCK_ROLES.has(this.resolved.schema.role(custom.type) ?? 'inline')) {
                    flush();
                    out.push(custom as BlockContent);
                } else run.push(node);
                continue;
            }
            if (!BLOCK_TAGS.has(node.tag)) {
                run.push(node);
                continue;
            }
            flush();
            out.push(...this.block(node));
        }
        flush();
        return out;
    }

    private block(el: HtmlElement): BlockContent[] {
        switch (el.tag) {
            case 'p': {
                const children = this.inlines(el.children);
                return children.length ? [{ type: 'paragraph', children }] : [];
            }
            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6':
                return [{ type: 'heading', depth: Number(el.tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, children: this.inlines(el.children) }];
            case 'blockquote':
                return [{ type: 'blockquote', children: this.blocks(el.children) }];
            case 'ul':
            case 'ol':
            case 'menu':
                return [this.list(el)];
            case 'li':
                // A stray item outside a list: a list of one.
                return [{ type: 'list', ordered: false, start: null, spread: false, children: [this.listItem(el)] }];
            case 'pre':
                return [this.code(el)];
            case 'hr':
                return [{ type: 'thematicBreak' }];
            case 'table': {
                const table = this.table(el);
                return table ? [table] : [];
            }
            default:
                // Sectioning wrappers, table parts outside a table, dt/dd, …: transparent.
                return this.blocks(el.children);
        }
    }

    private list(el: HtmlElement): List {
        const ordered = el.tag === 'ol';
        const items: ListItem[] = [];
        let stray: HtmlNode[] = [];
        const flushStray = (): void => {
            if (!stray.length) return;
            const children = this.blocks(stray);
            stray = [];
            if (children.length) items.push({ type: 'listItem', spread: false, children });
        };
        for (const child of el.children) {
            if (child.type === 'element' && child.tag === 'li') {
                flushStray();
                items.push(this.listItem(child));
            } else stray.push(child);
        }
        flushStray();
        const start = ordered ? parseStart(el.attrs.start) : null;
        return { type: 'list', ordered, start, spread: items.some((i) => i.spread === true), children: items };
    }

    private listItem(el: HtmlElement): ListItem {
        let checked: boolean | null = null;
        const children = el.children.slice();
        // A task item: a checkbox first (directly, or first in the leading paragraph).
        const box = firstCheckbox(children);
        if (box) checked = 'checked' in box.attrs;
        const blocks = this.blocks(children);
        const spread = el.children.some((c) => c.type === 'element' && c.tag === 'p');
        const item: ListItem = { type: 'listItem', spread, children: blocks };
        if (checked !== null) item.checked = checked;
        return item;
    }

    private code(el: HtmlElement): Code {
        const inner = el.children.find((c): c is HtmlElement => c.type === 'element' && c.tag === 'code');
        const lang = langOf(inner?.attrs.class) ?? langOf(el.attrs.class);
        let value = textOf(inner ? inner.children : el.children);
        // HTML drops a newline right after `<pre>`; the writer adds one before `</code>`.
        if (value.startsWith('\n')) value = value.slice(1);
        if (value.endsWith('\n')) value = value.slice(0, -1);
        return { type: 'code', lang, meta: null, value };
    }

    private table(el: HtmlElement): Table | null {
        const rows: HtmlElement[] = [];
        const collect = (nodes: readonly HtmlNode[]): void => {
            for (const n of nodes) {
                if (n.type !== 'element') continue;
                if (n.tag === 'tr') rows.push(n);
                else if (n.tag === 'thead' || n.tag === 'tbody' || n.tag === 'tfoot') collect(n.children);
            }
        };
        collect(el.children);
        if (!rows.length) return null;
        const children: TableRow[] = rows.map((row) => ({
            type: 'tableRow',
            children: row.children.filter((c): c is HtmlElement => c.type === 'element' && (c.tag === 'td' || c.tag === 'th')).map((cell): TableCell => ({ type: 'tableCell', children: this.inlines(cell.children) })),
        }));
        const header = rows[0].children.filter((c): c is HtmlElement => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
        const align: AlignType[] = header.map((cell) => alignOf(cell.attrs));
        return { type: 'table', align, children };
    }

    // -- inlines ------------------------------------------------------------

    inlines(nodes: readonly HtmlNode[], pre = false): PhrasingContent[] {
        const out: PhrasingContent[] = [];
        for (const node of nodes) {
            if (node.type === 'text') {
                out.push({ type: 'text', value: pre ? node.value : node.value.replace(WS, ' ') });
                continue;
            }
            const custom = this.custom(node);
            if (custom) {
                if (BLOCK_ROLES.has(this.resolved.schema.role(custom.type) ?? 'inline')) out.push(...this.inlines(node.children, pre));
                else out.push(custom as PhrasingContent);
                continue;
            }
            out.push(...this.inline(node, pre));
        }
        return finishInlines(out, pre);
    }

    private inline(el: HtmlElement, pre: boolean): PhrasingContent[] {
        const mark = MARK_TAGS[el.tag];
        if (mark) {
            const children = this.inlines(el.children, pre);
            return children.length ? [{ type: mark, children } as PhrasingContent] : [];
        }
        switch (el.tag) {
            case 'code': {
                const value = textOf(el.children).replace(/\r?\n/g, ' ');
                return value ? [{ type: 'inlineCode', value }] : [];
            }
            case 'br':
                return [{ type: 'break' }];
            case 'a': {
                const children = this.inlines(el.children, pre);
                const link: Link = { type: 'link', url: sanitizeUrl(el.attrs.href ?? '', 'link'), children };
                if (el.attrs.title) link.title = el.attrs.title;
                return children.length ? [link] : [];
            }
            case 'img': {
                const image: Image = { type: 'image', url: sanitizeUrl(el.attrs.src ?? '', 'image'), alt: el.attrs.alt ?? '' };
                if (el.attrs.title) image.title = el.attrs.title;
                return [image];
            }
            case 'input':
                // Form controls carry no document text (a task checkbox is read by the list item).
                return [];
            case 'pre':
                return this.inlines(el.children, true);
            default:
                if (this.unknown === 'drop' && !TRANSPARENT.has(el.tag) && !BLOCK_TAGS.has(el.tag)) return [];
                return this.inlines(el.children, pre);
        }
    }

    /** The first plugin element rule that claims `el`. */
    private custom(el: HtmlElement): Node | null {
        const rules = this.resolved.elements.get(el.tag);
        if (!rules) return null;
        const ctx: HtmlElementContext = {
            inlines: () => this.inlines(el.children),
            blocks: () => this.blocks(el.children),
            text: () => textOf(el.children),
            sanitizeUrl: (url: string, kind: UrlKind) => sanitizeUrl(url, kind),
        };
        for (const rule of rules) {
            const node = rule(el, ctx);
            if (node) return node;
        }
        return null;
    }
}

/** Phrasing wrappers that stay transparent even under `unknown: 'drop'`. */
const TRANSPARENT = new Set(['span', 'font', 'u', 'sub', 'sup', 'mark', 'small', 'big', 'abbr', 'cite', 'q', 'kbd', 'samp', 'var', 'time', 'label', 'dfn', 'ins', 'bdi', 'bdo', 'ruby', 'rt', 'rp', 'data', 'output', 'tt', 'nobr', 'wbr']);

function parseStart(value: string | undefined): number {
    const n = value === undefined ? NaN : parseInt(value, 10);
    return Number.isFinite(n) ? n : 1;
}

function langOf(className: string | undefined): string | null {
    if (!className) return null;
    for (const cls of className.split(/\s+/)) {
        const m = /^(?:language|lang)-(.+)$/.exec(cls);
        if (m) return m[1];
    }
    return null;
}

function alignOf(attrs: Record<string, string>): AlignType {
    const a = (attrs.align ?? /text-align\s*:\s*(left|right|center)/i.exec(attrs.style ?? '')?.[1] ?? '').toLowerCase();
    return a === 'left' || a === 'right' || a === 'center' ? a : null;
}

/** The task checkbox at the start of a list item: removed from the content, its state returned. */
function firstCheckbox(children: HtmlNode[]): HtmlElement | null {
    for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c.type === 'text') {
            if (c.value.trim() === '') continue;
            return null;
        }
        if (c.tag === 'input' && (c.attrs.type ?? '').toLowerCase() === 'checkbox') {
            children.splice(i, 1);
            return c;
        }
        if (c.tag === 'p') {
            const inner = firstCheckbox(c.children);
            return inner;
        }
        return null;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Merge adjacent texts and identical marks, drop empties, and settle whitespace at the run's edges and around breaks. */
function finishInlines(nodes: PhrasingContent[], pre: boolean): PhrasingContent[] {
    const merged = mergeInlines(nodes);
    if (!pre) settleWhitespace(merged);
    return dropEmpty(merged);
}

function mergeInlines(nodes: readonly PhrasingContent[]): PhrasingContent[] {
    const out: PhrasingContent[] = [];
    for (const node of nodes) {
        const prev = out[out.length - 1];
        if (node.type === 'text') {
            if (node.value === '') continue;
            if (prev && prev.type === 'text') {
                prev.value += node.value;
                continue;
            }
            out.push({ type: 'text', value: node.value });
            continue;
        }
        if (isMark(node)) {
            // `<b><b>x</b></b>` → one mark; `<b>a</b><b>b</b>` → one mark.
            const children = mergeInlines(node.children.flatMap((c) => (sameMark(c, node) ? (c as { children: PhrasingContent[] }).children : [c])));
            if (prev && sameMark(prev, node)) {
                (prev as { children: PhrasingContent[] }).children = mergeInlines([...(prev as { children: PhrasingContent[] }).children, ...children]);
                continue;
            }
            out.push({ ...node, children } as PhrasingContent);
            continue;
        }
        out.push(node);
    }
    return out;
}

function isMark(node: PhrasingContent): node is PhrasingContent & { children: PhrasingContent[] } {
    return node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete' || node.type === 'link';
}

function sameMark(a: PhrasingContent, b: PhrasingContent): boolean {
    if (a.type !== b.type || !isMark(a) || !isMark(b)) return false;
    if (a.type === 'link') return (a as Link).url === (b as Link).url && ((a as Link).title ?? null) === ((b as Link).title ?? null);
    return true;
}

/** Leaves in document order (text and break nodes), with the array that holds each. */
function leaves(nodes: PhrasingContent[], out: { node: PhrasingContent; in: PhrasingContent[] }[] = []): typeof out {
    for (const node of nodes) {
        if (node.type === 'text' || node.type === 'break' || node.type === 'inlineCode' || node.type === 'image') out.push({ node, in: nodes });
        else if (isMark(node)) leaves(node.children, out);
        else out.push({ node, in: nodes });
    }
    return out;
}

function settleWhitespace(nodes: PhrasingContent[]): void {
    const all = leaves(nodes);
    for (let i = 0; i < all.length; i++) {
        const leaf = all[i].node;
        if (leaf.type !== 'text') continue;
        const prev = all[i - 1]?.node;
        // Leading space: dropped at the start, after a break, and after a text that already ends with one.
        if (leaf.value.startsWith(' ') && (!prev || prev.type === 'break' || (prev.type === 'text' && prev.value.endsWith(' ')))) leaf.value = leaf.value.slice(1);
        // Trailing space: dropped at the end and before a break.
        const next = all[i + 1]?.node;
        if (leaf.value.endsWith(' ') && (!next || next.type === 'break')) leaf.value = leaf.value.slice(0, -1);
    }
}

function dropEmpty(nodes: PhrasingContent[]): PhrasingContent[] {
    const out: PhrasingContent[] = [];
    for (const node of nodes) {
        if (node.type === 'text') {
            if (node.value === '') continue;
            const prev = out[out.length - 1];
            if (prev && prev.type === 'text') {
                prev.value += node.value;
                continue;
            }
            out.push(node);
            continue;
        }
        if (isMark(node)) {
            const children = dropEmpty(node.children);
            if (!children.length) continue;
            out.push({ ...node, children } as PhrasingContent);
            continue;
        }
        out.push(node);
    }
    return out;
}
