/**
 * `toHtml()` — a spec-conformance renderer. The HTML it writes for a tree
 * matches the reference output of the CommonMark spec (`spec.json`) and the
 * GFM spec byte for byte, so `toHtml(parseMarkdown(md)) === example.html` is
 * the whole conformance assertion. It is a test tool, not a product
 * renderer: no sanitising, no plugin hooks, no streaming state (`Code.open`
 * is ignored, an open fence renders like a closed one).
 *
 * Output shape follows commonmark.js's `HtmlRenderer`: block tags are
 * separated by a single newline written lazily — `cr()` emits `\n` only when
 * the buffer does not already end with one — which is exactly what yields
 * the spec's tight / loose list forms (`<li>foo</li>` versus
 * `<li>\n<p>foo</p>\n</li>`), `<li>foo\n<ul>…` for a tight item with a nested
 * list, and `<li></li>` for an empty item. A list is loose when `spread` is
 * set on the list or on any of its items (mdast-util-to-hast's rule); tight
 * items render their direct paragraph children unwrapped.
 *
 * Known limits — documented rather than fixed because the spec never
 * exercises them:
 *  - A fence whose only content is one blank line has `value === ''` in
 *    mdast and renders `<pre><code></code></pre>` (cmark keeps the newline).
 *  - An unresolved `imageReference` renders `![alt]` with `alt` as plain
 *    text: mdast keeps no inline children for it, so `![*a*]` loses the
 *    emphasis a full CommonMark renderer would show. Unresolved
 *    `linkReference`s keep their inline children (`[<em>a</em>]`).
 *  - `normalizeUri` ports commonmark.js's `encode(decode(uri))` (mdurl):
 *    unreserved and reserved ASCII pass through, existing `%XX` escapes are
 *    decoded and re-encoded (so `%41` becomes `A` while `%20` stays `%20`),
 *    everything else is UTF-8 percent-encoded and a lone surrogate becomes
 *    `%EF%BF%BD`. cmark's `houdini` escaper agrees on every spec example.
 *  - Table body rows are padded / truncated to the header width (GFM: "the
 *    remainder of the table's rows may vary in the number of cells"), so the
 *    parser may emit excess cells or not.
 *  - Unknown node types (plugin nodes) render their children, or their
 *    escaped `value`, with no wrapper.
 */

import type {
    AlignType,
    Code,
    Definition,
    Heading,
    Image,
    ImageReference,
    Link,
    LinkReference,
    List,
    ListItem,
    Node,
    Parent,
    Root,
    Table,
    TableRow,
} from '../ast/index.js';
import { collectDefinitions } from '../ast/index.js';

export interface ToHtmlOptions {
    /** Definitions to resolve references against; defaults to `collectDefinitions(root)`. */
    definitions?: ReadonlyMap<string, Definition>;
}

/** Render `root` to the CommonMark / GFM reference HTML. */
export function toHtml(root: Root, options: ToHtmlOptions = {}): string {
    const writer = new HtmlWriter(options.definitions ?? collectDefinitions(root));
    writer.blocks(root.children, false);
    return writer.out;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

const XML_SPECIAL = /[&<>"]/g;
const XML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeXml(text: string): string {
    return text.replace(XML_SPECIAL, (ch) => XML_ESCAPES[ch]);
}

// mdurl's defaults: what `encode` leaves alone and what `decode` keeps encoded.
const ENCODE_KEEP = ";/?:@&=+$,-_.!~*'()#";
const DECODE_KEEP = ';/?:@&=+$,#';
const ALNUM = /^[0-9a-z]$/i;
const HEX2 = /^[0-9a-f]{2}$/i;
const PERCENT_RUN = /(%[a-f0-9]{2})+/gi;

let encodeTable: string[] | undefined;
let decodeTable: string[] | undefined;

function hex2(code: number): string {
    return '%' + ('0' + code.toString(16).toUpperCase()).slice(-2);
}

function getEncodeTable(): string[] {
    if (encodeTable) return encodeTable;
    const table: string[] = [];
    for (let i = 0; i < 128; i++) {
        const ch = String.fromCharCode(i);
        table.push(ALNUM.test(ch) ? ch : hex2(i));
    }
    for (let i = 0; i < ENCODE_KEEP.length; i++) table[ENCODE_KEEP.charCodeAt(i)] = ENCODE_KEEP[i];
    return (encodeTable = table);
}

function getDecodeTable(): string[] {
    if (decodeTable) return decodeTable;
    const table: string[] = [];
    for (let i = 0; i < 128; i++) table.push(String.fromCharCode(i));
    for (let i = 0; i < DECODE_KEEP.length; i++) table[DECODE_KEEP.charCodeAt(i)] = hex2(DECODE_KEEP.charCodeAt(i));
    return (decodeTable = table);
}

function encodeUri(source: string): string {
    const table = getEncodeTable();
    let out = '';
    for (let i = 0, l = source.length; i < l; i++) {
        const code = source.charCodeAt(i);
        if (code === 0x25 /* % */ && i + 2 < l && HEX2.test(source.slice(i + 1, i + 3))) {
            out += source.slice(i, i + 3);
            i += 2;
            continue;
        }
        if (code < 128) {
            out += table[code];
            continue;
        }
        if (code >= 0xd800 && code <= 0xdfff) {
            if (code <= 0xdbff && i + 1 < l) {
                const next = source.charCodeAt(i + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    out += encodeURIComponent(source[i] + source[i + 1]);
                    i++;
                    continue;
                }
            }
            out += '%EF%BF%BD';
            continue;
        }
        out += encodeURIComponent(source[i]);
    }
    return out;
}

function decodeUri(source: string): string {
    if (source.indexOf('%') === -1) return source;
    const table = getDecodeTable();
    return source.replace(PERCENT_RUN, (seq) => {
        let out = '';
        for (let i = 0, l = seq.length; i < l; i += 3) {
            const b1 = parseInt(seq.slice(i + 1, i + 3), 16);
            if (b1 < 0x80) {
                out += table[b1];
                continue;
            }
            if ((b1 & 0xe0) === 0xc0 && i + 3 < l) {
                const b2 = parseInt(seq.slice(i + 4, i + 6), 16);
                if ((b2 & 0xc0) === 0x80) {
                    const chr = ((b1 << 6) & 0x7c0) | (b2 & 0x3f);
                    out += chr < 0x80 ? '\uFFFD\uFFFD' : String.fromCharCode(chr);
                    i += 3;
                    continue;
                }
            }
            if ((b1 & 0xf0) === 0xe0 && i + 6 < l) {
                const b2 = parseInt(seq.slice(i + 4, i + 6), 16);
                const b3 = parseInt(seq.slice(i + 7, i + 9), 16);
                if ((b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
                    const chr = ((b1 << 12) & 0xf000) | ((b2 << 6) & 0xfc0) | (b3 & 0x3f);
                    out += chr < 0x800 || (chr >= 0xd800 && chr <= 0xdfff)
                        ? '\uFFFD\uFFFD\uFFFD'
                        : String.fromCharCode(chr);
                    i += 6;
                    continue;
                }
            }
            if ((b1 & 0xf8) === 0xf0 && i + 9 < l) {
                const b2 = parseInt(seq.slice(i + 4, i + 6), 16);
                const b3 = parseInt(seq.slice(i + 7, i + 9), 16);
                const b4 = parseInt(seq.slice(i + 10, i + 12), 16);
                if ((b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80 && (b4 & 0xc0) === 0x80) {
                    let chr = ((b1 << 18) & 0x1c0000) | ((b2 << 12) & 0x3f000) | ((b3 << 6) & 0xfc0) | (b4 & 0x3f);
                    if (chr < 0x10000 || chr > 0x10ffff) {
                        out += '\uFFFD\uFFFD\uFFFD\uFFFD';
                    } else {
                        chr -= 0x10000;
                        out += String.fromCharCode(0xd800 + (chr >> 10), 0xdc00 + (chr & 0x3ff));
                    }
                    i += 9;
                    continue;
                }
            }
            out += '\uFFFD';
        }
        return out;
    });
}

/** commonmark.js `normalizeURI`: `encode(decode(uri))` with mdurl's rules (see the module comment). */
function normalizeUri(uri: string): string {
    return encodeUri(decodeUri(uri));
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

const CHECKBOX_CHECKED = '<input checked="" disabled="" type="checkbox"> ';
const CHECKBOX_UNCHECKED = '<input disabled="" type="checkbox"> ';

class HtmlWriter {
    out = '';

    constructor(private readonly definitions: ReadonlyMap<string, Definition>) {}

    /** A newline, unless the buffer already ends with one (or is empty). */
    private cr(): void {
        if (this.out.length > 0 && this.out.charCodeAt(this.out.length - 1) !== 0x0a) this.out += '\n';
    }

    // -- blocks -------------------------------------------------------------

    blocks(nodes: readonly Node[], tight: boolean): void {
        for (const node of nodes) this.block(node, tight);
    }

    private block(node: Node, tight: boolean): void {
        switch (node.type) {
            case 'paragraph':
                this.paragraph(node as Parent, tight, '');
                return;
            case 'heading': {
                const depth = (node as Heading).depth;
                this.cr();
                this.out += `<h${depth}>`;
                this.inlines((node as Parent).children);
                this.out += `</h${depth}>`;
                this.cr();
                return;
            }
            case 'thematicBreak':
                this.cr();
                this.out += '<hr />';
                this.cr();
                return;
            case 'blockquote':
                this.cr();
                this.out += '<blockquote>';
                this.cr();
                this.blocks((node as Parent).children, false);
                this.cr();
                this.out += '</blockquote>';
                this.cr();
                return;
            case 'list':
                this.list(node as List);
                return;
            case 'listItem':
                this.listItem(node as ListItem, tight);
                return;
            case 'code':
                this.code(node as Code);
                return;
            case 'html':
                this.cr();
                this.out += (node as Code).value;
                this.cr();
                return;
            case 'definition':
                return;
            case 'table':
                this.table(node as Table);
                return;
            default:
                this.unknown(node, () => this.blocks((node as Parent).children, tight));
        }
    }

    private paragraph(node: Parent, tight: boolean, prefix: string): void {
        if (!tight) {
            this.cr();
            this.out += '<p>';
        }
        this.out += prefix;
        this.inlines(node.children);
        if (!tight) {
            this.out += '</p>';
            this.cr();
        }
    }

    private list(list: List): void {
        const loose = list.spread === true || list.children.some((item) => item.spread === true);
        const tag = list.ordered ? 'ol' : 'ul';
        this.cr();
        this.out += `<${tag}`;
        if (list.ordered && list.start != null && list.start !== 1) this.out += ` start="${list.start}"`;
        this.out += '>';
        this.cr();
        for (const item of list.children) this.listItem(item, !loose);
        this.cr();
        this.out += `</${tag}>`;
        this.cr();
    }

    private listItem(item: ListItem, tight: boolean): void {
        this.out += '<li>';
        const checkbox = item.checked == null ? '' : item.checked ? CHECKBOX_CHECKED : CHECKBOX_UNCHECKED;
        let first = true;
        for (const child of item.children) {
            if (first && checkbox !== '' && child.type === 'paragraph') this.paragraph(child as Parent, tight, checkbox);
            else this.block(child, tight);
            first = false;
        }
        this.out += '</li>';
        this.cr();
    }

    private code(node: Code): void {
        this.cr();
        this.out += '<pre><code';
        if (node.lang) this.out += ` class="language-${escapeXml(node.lang)}"`;
        this.out += '>';
        if (node.value !== '') this.out += escapeXml(node.value) + '\n';
        this.out += '</code></pre>';
        this.cr();
    }

    private table(table: Table): void {
        this.cr();
        this.out += '<table>';
        this.cr();
        const [head, ...body] = table.children;
        if (head) {
            const width = head.children.length;
            const align = table.align ?? [];
            this.out += '<thead>';
            this.cr();
            this.tableRow(head, 'th', width, align);
            this.out += '</thead>';
            this.cr();
            if (body.length > 0) {
                this.out += '<tbody>';
                this.cr();
                for (const row of body) this.tableRow(row, 'td', width, align);
                this.out += '</tbody>';
                this.cr();
            }
        }
        this.out += '</table>';
        this.cr();
    }

    private tableRow(row: TableRow, tag: 'th' | 'td', width: number, align: readonly AlignType[]): void {
        this.out += '<tr>';
        this.cr();
        for (let i = 0; i < width; i++) {
            const cell = row.children[i];
            const a = align[i];
            this.out += a ? `<${tag} align="${a}">` : `<${tag}>`;
            if (cell) this.inlines(cell.children);
            this.out += `</${tag}>`;
            this.cr();
        }
        this.out += '</tr>';
        this.cr();
    }

    // -- inlines ------------------------------------------------------------

    private inlines(nodes: readonly Node[]): void {
        for (const node of nodes) this.inline(node);
    }

    private inline(node: Node): void {
        switch (node.type) {
            case 'text':
                this.out += escapeXml((node as Code).value);
                return;
            case 'emphasis':
                this.wrap('em', node as Parent);
                return;
            case 'strong':
                this.wrap('strong', node as Parent);
                return;
            case 'delete':
                this.wrap('del', node as Parent);
                return;
            case 'inlineCode':
                this.out += `<code>${escapeXml((node as Code).value)}</code>`;
                return;
            case 'break':
                this.out += '<br />\n';
                return;
            case 'link': {
                const link = node as Link;
                this.link(link.url, link.title, link.children);
                return;
            }
            case 'image': {
                const image = node as Image;
                this.image(image.url, image.title, image.alt);
                return;
            }
            case 'linkReference': {
                const ref = node as LinkReference;
                const def = this.definitions.get(ref.identifier);
                if (def) {
                    this.link(def.url, def.title, ref.children);
                } else {
                    this.out += '[';
                    this.inlines(ref.children);
                    this.out += ']' + this.referenceSuffix(ref);
                }
                return;
            }
            case 'imageReference': {
                const ref = node as ImageReference;
                const def = this.definitions.get(ref.identifier);
                if (def) this.image(def.url, def.title, ref.alt);
                else this.out += `![${escapeXml(ref.alt ?? '')}]` + this.referenceSuffix(ref);
                return;
            }
            case 'html':
                this.out += (node as Code).value;
                return;
            default:
                this.unknown(node, () => this.inlines((node as Parent).children));
        }
    }

    private wrap(tag: string, node: Parent): void {
        this.out += `<${tag}>`;
        this.inlines(node.children);
        this.out += `</${tag}>`;
    }

    private link(url: string, title: string | null | undefined, children: readonly Node[]): void {
        this.out += `<a href="${escapeXml(normalizeUri(url))}"`;
        if (title) this.out += ` title="${escapeXml(title)}"`;
        this.out += '>';
        this.inlines(children);
        this.out += '</a>';
    }

    private image(url: string, title: string | null | undefined, alt: string | null | undefined): void {
        this.out += `<img src="${escapeXml(normalizeUri(url))}" alt="${escapeXml(alt ?? '')}"`;
        if (title) this.out += ` title="${escapeXml(title)}"`;
        this.out += ' />';
    }

    /** The bracket tail of an unresolved reference: `[]` for collapsed, `[label]` for full. */
    private referenceSuffix(ref: LinkReference | ImageReference): string {
        if (ref.referenceType === 'collapsed') return '[]';
        if (ref.referenceType === 'full') return `[${escapeXml(ref.label ?? ref.identifier)}]`;
        return '';
    }

    /** A node type this renderer does not know: its children, else its escaped value, else nothing. */
    private unknown(node: Node, children: () => void): void {
        if (Array.isArray((node as Parent).children)) children();
        else if (typeof (node as Code).value === 'string') this.out += escapeXml((node as Code).value);
    }
}
