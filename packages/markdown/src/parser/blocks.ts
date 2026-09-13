/**
 * Block parser: the CommonMark open-container-stack algorithm (spec appendix
 * A, in the shape of commonmark.js), producing mdast block nodes with
 * positions and reconciliation keys.
 *
 * Per line: (1) each open container is asked whether the line continues it,
 * (2) new block starts are tried on the remainder — plugin block extensions
 * first, then indented code, fences, ATX headings, setext underlines, GFM
 * table delimiter rows, thematic breaks, blockquotes, list items — and (3)
 * what is left is a lazy paragraph continuation, a line of the open leaf, or
 * a new paragraph. Closing a block finalises it: paragraphs give up leading
 * link reference definitions, lists decide their tightness, unterminated
 * fences stay `open`.
 *
 * Streaming safety lives in the caller's contract, not here: this parser
 * happily parses a partial document (an open fence, a half list) and never
 * throws; the incremental engine decides which blocks are final.
 */

import type {
    AlignType,
    BlockContent,
    Code,
    Definition,
    Heading,
    HeadingDepth,
    ListItem,
    PhrasingContent,
    Point,
    Position,
    Root,
    Table,
    TableCell,
    TableRow,
} from '../ast/index.js';
import { childKey, topKey } from '../ast/index.js';
import type {
    BlockFinishContext,
    BlockState,
    BlockSyntaxExtension,
    LineInfo,
    ResolvedMarkdownPlugins,
} from '../plugin/index.js';
import { NO_MARKDOWN_PLUGINS } from '../plugin/index.js';
import { parseInline } from './inline.js';
import {
    isSpaceOrTab,
    matchTableDelimiter,
    scanDefinition,
    splitTableRowWithOffsets,
    unescapeString,
} from './scanner.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ParseBlocksOptions {
    plugins?: ResolvedMarkdownPlugins;
    /** Absolute offset of `src[0]` in the whole document (incremental parsing). */
    baseOffset?: number;
    /** 1-based line number of the first line of `src`. */
    baseLine?: number;
    /** Index of the first top-level block (for `b-<i>` keys). */
    baseIndex?: number;
}

export interface ParseBlocksResult {
    children: BlockContent[];
    /** Absolute offset just past the last character of `src`. */
    endOffset: number;
    /** The point at the end of `src`. */
    end: Point;
    /**
     * How many trailing top-level blocks were still open when the input ended
     * (and could therefore still change if more text arrived). Usually 1; 0
     * when the input ends with a blank line after the last block; more when a
     * paragraph split into link reference definitions at the end.
     */
    openCount: number;
}

// ---------------------------------------------------------------------------
// Internal block representation
// ---------------------------------------------------------------------------

type BlockType =
    | 'document'
    | 'blockquote'
    | 'list'
    | 'item'
    | 'paragraph'
    | 'heading'
    | 'thematicBreak'
    | 'fencedCode'
    | 'indentedCode'
    | 'table'
    | 'extension'
    | 'definition';

interface ListData {
    ordered: boolean;
    bulletChar: string;
    start: number;
    delimiter: string;
    /** Content column offset relative to the marker start. */
    padding: number;
    /** Indentation (columns) of the marker. */
    markerOffset: number;
}

interface Line {
    text: string;
    /** Absolute offset of `text[0]`. */
    offset: number;
}

interface Block {
    type: BlockType;
    parent: Block | null;
    children: Block[];
    open: boolean;
    startLine: number;
    startOffset: number;
    endLine: number;
    endOffset: number;
    lastLineBlank: boolean;
    lastLineChecked: boolean;
    /** Text lines added to a leaf. */
    lines: Line[];
    // list
    listData?: ListData;
    tight?: boolean;
    // fenced code
    fenceChar?: string;
    fenceLength?: number;
    fenceOffset?: number;
    closed?: boolean;
    /** Closed by the end of the input rather than by a following line. */
    closedAtEof?: boolean;
    /** The line being processed when the block was closed. */
    closedByLine?: number;
    // heading
    depth?: HeadingDepth;
    content?: Line;
    // table
    align?: AlignType[];
    skipNextLine?: boolean;
    // extension
    // oxlint-disable-next-line no-explicit-any
    ext?: BlockSyntaxExtension<any, any>;
    extState?: BlockState;
    extResult?: BlockContent;
    // definition
    definition?: Definition;
}

function makeBlock(type: BlockType, parent: Block | null, line: number, offset: number): Block {
    return {
        type,
        parent,
        children: [],
        open: true,
        startLine: line,
        startOffset: offset,
        endLine: line,
        endOffset: offset,
        lastLineBlank: false,
        lastLineChecked: false,
        lines: [],
    };
}

function canContain(parent: BlockType, child: BlockType): boolean {
    switch (parent) {
        case 'document':
        case 'blockquote':
        case 'item':
            return child !== 'item';
        case 'list':
            return child === 'item';
        default:
            return false;
    }
}

function acceptsLines(type: BlockType): boolean {
    return type === 'paragraph' || type === 'fencedCode' || type === 'indentedCode' || type === 'table' || type === 'extension';
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

const RE_ATX = /^#{1,6}(?:[ \t]+|$)/;
const RE_ATX_CLOSE_ONLY = /^[ \t]*#+[ \t]*$/;
const RE_ATX_CLOSE = /[ \t]+#+[ \t]*$/;
const RE_FENCE_OPEN = /^`{3,}(?!.*`)|^~{3,}/;
const RE_FENCE_CLOSE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const RE_SETEXT = /^(?:=+|-+)[ \t]*$/;
const RE_THEMATIC = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const RE_BULLET = /^[*+-]/;
const RE_ORDERED = /^(\d{1,9})([.)])/;
const RE_MAYBE_SPECIAL = /^[#`~*+_=<>0-9\-|:]/;

class BlockParser {
    private readonly plugins: ResolvedMarkdownPlugins;
    private readonly entities: ReadonlyMap<string, string> | undefined;
    private readonly baseOffset: number;
    private readonly baseLine: number;

    private doc: Block;
    private tip: Block;
    private oldtip: Block;
    private lastMatchedContainer: Block;
    private allClosed = true;

    // Per-line state.
    private line = '';
    private lineStart = 0;
    private lineNumber = 0;
    private offset = 0;
    private column = 0;
    private nextNonspace = 0;
    private nextNonspaceColumn = 0;
    private indent = 0;
    private indented = false;
    private blank = false;
    private partiallyConsumedTab = false;
    private lastLineLength = 0;
    private prevLineStart = 0;
    /** End offset of the most recent line that is not entirely whitespace. */
    private lastContentLineEnd = 0;
    /** The same, as it was before the current line was seen. */
    private prevContentLineEnd = 0;

    constructor(options: ParseBlocksOptions) {
        this.plugins = options.plugins ?? NO_MARKDOWN_PLUGINS;
        this.entities = this.plugins.entities.size ? this.plugins.entities : undefined;
        this.baseOffset = options.baseOffset ?? 0;
        this.baseLine = options.baseLine ?? 1;
        this.lastContentLineEnd = this.baseOffset;
        this.doc = makeBlock('document', null, this.baseLine, this.baseOffset);
        this.tip = this.doc;
        this.oldtip = this.doc;
        this.lastMatchedContainer = this.doc;
    }

    // -- driver -------------------------------------------------------------

    parse(src: string): { doc: Block; endOffset: number; endLine: number; lastLineStart: number } {
        let pos = 0;
        let lineNumber = this.baseLine - 1;
        const n = src.length;
        // A trailing newline does not start a new (empty) line.
        const stop = n > 0 && src.charCodeAt(n - 1) === 10 ? n - 1 : n;
        let lastStart = 0;
        while (pos <= stop) {
            let nl = src.indexOf('\n', pos);
            if (nl === -1 || nl > stop) nl = stop;
            if (pos === stop && stop !== n && n > 0) {
                // Source ended with '\n': no further line.
                break;
            }
            lineNumber++;
            lastStart = pos;
            this.incorporateLine(src.slice(pos, nl), this.baseOffset + pos, lineNumber);
            if (nl >= stop) break;
            pos = nl + 1;
        }
        if (n === 0) lineNumber = this.baseLine - 1;
        // Close everything.
        this.lastLineLength = this.line.length;
        while (this.tip) {
            this.tip.closedAtEof = true;
            this.finalize(this.tip, this.lineNumber, this.lineStart);
        }
        return { doc: this.doc, endOffset: this.baseOffset + n, endLine: Math.max(lineNumber, this.baseLine - 1), lastLineStart: lastStart };
    }

    // -- line scanning --------------------------------------------------------

    private findNextNonspace(): void {
        const ln = this.line;
        let i = this.offset;
        let cols = this.column;
        let c: string | undefined;
        while (i < ln.length) {
            c = ln[i];
            if (c === ' ') {
                i++;
                cols++;
            } else if (c === '\t') {
                i++;
                cols += 4 - (cols % 4);
            } else {
                break;
            }
        }
        this.blank = i >= ln.length;
        this.nextNonspace = i;
        this.nextNonspaceColumn = cols;
        this.indent = cols - this.column;
        this.indented = this.indent >= 4;
    }

    private advanceNextNonspace(): void {
        this.offset = this.nextNonspace;
        this.column = this.nextNonspaceColumn;
        this.partiallyConsumedTab = false;
    }

    private advanceOffset(count: number, columns: boolean): void {
        const ln = this.line;
        let c: string | undefined;
        while (count > 0 && (c = ln[this.offset]) !== undefined) {
            if (c === '\t') {
                const charsToTab = 4 - (this.column % 4);
                if (columns) {
                    this.partiallyConsumedTab = charsToTab > count;
                    const charsToAdvance = Math.min(count, charsToTab);
                    this.column += charsToAdvance;
                    this.offset += this.partiallyConsumedTab ? 0 : 1;
                    count -= charsToAdvance;
                } else {
                    this.partiallyConsumedTab = false;
                    this.column += charsToTab;
                    this.offset += 1;
                    count -= 1;
                }
            } else {
                this.partiallyConsumedTab = false;
                this.offset += 1;
                this.column += 1;
                count -= 1;
            }
        }
    }

    private addLine(): void {
        const block = this.tip;
        if (block.skipNextLine) {
            block.skipNextLine = false;
            return;
        }
        let prefix = '';
        let offset = this.offset;
        if (this.partiallyConsumedTab) {
            offset += 1;
            const charsToTab = 4 - (this.column % 4);
            prefix = ' '.repeat(charsToTab);
        }
        block.lines.push({ text: prefix + this.line.slice(offset), offset: this.lineStart + offset });
    }

    private lineInfo(): LineInfo {
        return {
            text: this.line.slice(this.offset),
            indent: this.indent,
            offset: this.lineStart + this.offset,
            line: this.lineNumber,
            blank: this.blank,
        };
    }

    // -- tree ops ---------------------------------------------------------------

    private addChild(type: BlockType, offset: number): Block {
        while (!canContain(this.tip.type, type)) this.finalize(this.tip, this.lineNumber - 1, this.prevLineStart);
        const block = makeBlock(type, this.tip, this.lineNumber, this.lineStart + offset);
        this.tip.children.push(block);
        this.tip = block;
        return block;
    }

    private closeUnmatchedBlocks(): void {
        if (this.allClosed) return;
        while (this.oldtip !== this.lastMatchedContainer) {
            const parent = this.oldtip.parent!;
            this.finalize(this.oldtip, this.lineNumber - 1, this.prevLineStart);
            this.oldtip = parent;
        }
        this.allClosed = true;
    }

    private finalize(block: Block, lineNumber: number, lineStartOfEnd: number): void {
        const above = block.parent;
        block.open = false;
        block.endLine = lineNumber;
        block.closedByLine = this.lineNumber;
        // A block ends at the end of its last non-blank line, never on the
        // blank line (or EOF newline) that closed it.
        const contentEnd = lineNumber >= this.lineNumber ? this.lastContentLineEnd : this.prevContentLineEnd;
        block.endOffset = Math.max(block.startOffset, Math.min(lineStartOfEnd + this.lastLineLength, contentEnd));
        switch (block.type) {
            case 'paragraph':
                this.finalizeParagraph(block);
                break;
            case 'fencedCode':
                if (block.closed !== true) block.closed = false;
                break;
            case 'indentedCode':
                while (block.lines.length && /^[ \t]*$/.test(block.lines[block.lines.length - 1].text)) block.lines.pop();
                break;
            case 'list':
                this.finalizeList(block);
                break;
            case 'extension':
                this.finalizeExtension(block);
                break;
            default:
                break;
        }
        this.tip = above as Block;
    }

    private finalizeParagraph(block: Block): void {
        // Peel link reference definitions off the head of the paragraph.
        if (block.lines.length === 0) return;
        if (!block.lines[0].text.startsWith('[')) return;
        const content = block.lines.map((l) => l.text).join('\n');
        let pos = 0;
        const defs: Block[] = [];
        while (content[pos] === '[') {
            const def = scanDefinition(content, pos, this.entities);
            if (!def) break;
            const start = contentOffset(block.lines, pos);
            const endIdx = def.end > 0 && content[def.end - 1] === '\n' ? def.end - 1 : def.end;
            const end = contentOffset(block.lines, endIdx);
            const dblock = makeBlock('definition', block.parent, block.startLine, start);
            dblock.open = false;
            dblock.closedAtEof = block.closedAtEof;
            dblock.closedByLine = this.lineNumber;
            dblock.endOffset = end;
            dblock.definition = {
                type: 'definition',
                identifier: def.identifier,
                label: def.label,
                url: def.url,
                title: def.title,
            };
            defs.push(dblock);
            pos = def.end;
        }
        if (defs.length === 0) return;
        const parent = block.parent!;
        const idx = parent.children.indexOf(block);
        parent.children.splice(idx, 0, ...defs);
        // Rebuild the paragraph's lines from the remaining content.
        const rest = content.slice(pos);
        if (!/[^ \t\n]/.test(rest)) {
            parent.children.splice(parent.children.indexOf(block), 1);
            return;
        }
        const newStart = contentOffset(block.lines, pos);
        const lines: Line[] = [];
        let off = newStart;
        for (const text of rest.split('\n')) {
            lines.push({ text, offset: off });
            off += text.length + 1;
        }
        block.lines = lines;
        block.startOffset = newStart;
        block.startLine = block.startLine + (content.slice(0, pos).match(/\n/g) ?? []).length;
    }

    private finalizeList(block: Block): void {
        let tight = true;
        const items = block.children;
        for (let i = 0; i < items.length && tight; i++) {
            const item = items[i];
            if (endsWithBlankLine(item) && i < items.length - 1) {
                tight = false;
                break;
            }
            const subs = item.children;
            for (let j = 0; j < subs.length; j++) {
                if (endsWithBlankLine(subs[j]) && (i < items.length - 1 || j < subs.length - 1)) {
                    tight = false;
                    break;
                }
            }
        }
        block.tight = tight;
    }

    private finalizeExtension(block: Block): void {
        const ext = block.ext!;
        const state = block.extState!;
        const ctx: BlockFinishContext = {
            open: false,
            parseInline: (text, offset) => this.inlineAt(text, offset),
            parseBlocks: (lines) => this.nestedBlocks(lines),
            position: this.positionOf(block),
        };
        // `open` is decided by the incremental engine; the parser reports EOF closure through `closed`.
        ctx.open = block.closed !== true;
        try {
            block.extResult = ext.finish(state, ctx) as BlockContent;
        } catch (err) {
            if (__DEV__) console.warn(`[@sigx/markdown] Block extension "${ext.name}" threw in finish(); emitting its lines as a paragraph.`, err);
            block.extResult = undefined;
        }
    }

    // -- the line loop --------------------------------------------------------------

    private incorporateLine(ln: string, lineStart: number, lineNumber: number): void {
        this.prevLineStart = this.lineStart;
        this.line = ln;
        this.lineStart = lineStart;
        this.lineNumber = lineNumber;
        this.prevContentLineEnd = this.lastContentLineEnd;
        if (/[^ \t]/.test(ln)) this.lastContentLineEnd = lineStart + ln.length;
        this.offset = 0;
        this.column = 0;
        this.blank = false;
        this.partiallyConsumedTab = false;

        this.oldtip = this.tip;
        let container: Block = this.doc;

        // 1. Match open containers.
        let lastChild: Block | undefined;
        let consumed = false;
        while ((lastChild = container.children[container.children.length - 1]) && lastChild.open) {
            container = lastChild;
            this.findNextNonspace();
            const r = this.continueBlock(container);
            if (r === 1) {
                container = container.parent!;
                break;
            }
            if (r === 2) {
                consumed = true;
                break;
            }
        }
        if (consumed) {
            this.lastLineLength = ln.length;
            return;
        }

        this.allClosed = container === this.oldtip;
        this.lastMatchedContainer = container;

        let matchedLeaf = container.type !== 'paragraph' && acceptsLines(container.type);

        // 2. Try new block starts.
        while (!matchedLeaf) {
            this.findNextNonspace();
            const rest = ln.slice(this.nextNonspace);
            const trigger = rest[0];
            const maybeExt = trigger !== undefined && this.plugins.blockTriggers.has(trigger);
            if (!this.indented && !maybeExt && !RE_MAYBE_SPECIAL.test(rest)) {
                this.advanceNextNonspace();
                break;
            }
            const res = this.tryStarts(container, rest, maybeExt);
            if (res === 1) {
                container = this.tip;
            } else if (res === 2) {
                container = this.tip;
                matchedLeaf = true;
            } else {
                this.advanceNextNonspace();
                break;
            }
        }

        // 3. What remains is a text line.
        if (!this.allClosed && !this.blank && this.tip.type === 'paragraph') {
            // Lazy paragraph continuation.
            this.addLine();
        } else {
            this.closeUnmatchedBlocks();
            if (this.blank && container.children.length) {
                container.children[container.children.length - 1].lastLineBlank = true;
            }
            const t = container.type;
            const lastLineBlank =
                this.blank &&
                !(
                    t === 'blockquote' ||
                    t === 'fencedCode' ||
                    (t === 'item' && container.children.length === 0 && container.startLine === this.lineNumber)
                );
            let cont: Block | null = container;
            while (cont) {
                cont.lastLineBlank = lastLineBlank;
                cont = cont.parent;
            }
            if (acceptsLines(t)) {
                this.addLine();
            } else if (this.offset < ln.length && !this.blank) {
                container = this.addChild('paragraph', this.offset);
                this.advanceNextNonspace();
                this.addLine();
            }
        }
        this.lastLineLength = ln.length;
    }

    /** 0 = matched (keep going), 1 = not matched, 2 = line fully consumed. */
    private continueBlock(container: Block): 0 | 1 | 2 {
        const ln = this.line;
        switch (container.type) {
            case 'document':
            case 'list':
                return 0;
            case 'blockquote':
                if (!this.indented && ln[this.nextNonspace] === '>') {
                    this.advanceNextNonspace();
                    this.advanceOffset(1, false);
                    if (isSpaceOrTab(ln[this.offset])) this.advanceOffset(1, true);
                    return 0;
                }
                return 1;
            case 'item': {
                const data = container.listData!;
                if (this.blank) {
                    if (container.children.length === 0) return 1; // blank line after an empty item
                    this.advanceNextNonspace();
                    return 0;
                }
                if (this.indent >= data.markerOffset + data.padding) {
                    this.advanceOffset(data.markerOffset + data.padding, true);
                    return 0;
                }
                return 1;
            }
            case 'heading':
            case 'thematicBreak':
            case 'definition':
                return 1;
            case 'fencedCode': {
                if (this.indent <= 3 && ln[this.nextNonspace] === container.fenceChar) {
                    const m = RE_FENCE_CLOSE.exec(ln.slice(this.nextNonspace));
                    if (m && m[0].length >= container.fenceLength!) {
                        container.closed = true;
                        this.lastLineLength = ln.length;
                        this.finalize(container, this.lineNumber, this.lineStart);
                        return 2;
                    }
                }
                // Skip the fence's own indentation on content lines.
                let i = container.fenceOffset!;
                while (i > 0 && isSpaceOrTab(ln[this.offset])) {
                    this.advanceOffset(1, true);
                    i--;
                }
                return 0;
            }
            case 'indentedCode':
                if (this.indent >= 4) {
                    this.advanceOffset(4, true);
                    return 0;
                }
                if (this.blank) {
                    this.advanceNextNonspace();
                    return 0;
                }
                return 1;
            case 'paragraph':
                return this.blank ? 1 : 0;
            case 'table': {
                if (this.blank) return 1;
                const rest = ln.slice(this.nextNonspace);
                if (!this.indented && this.startsAnotherBlock(rest)) return 1;
                return 0;
            }
            case 'extension': {
                const ext = container.ext!;
                let r: 'continue' | 'close' | 'consume-and-close';
                try {
                    r = ext.continue(this.lineInfo(), container.extState!);
                } catch (err) {
                    if (__DEV__) console.warn(`[@sigx/markdown] Block extension "${ext.name}" threw in continue(); closing the block.`, err);
                    r = 'close';
                }
                if (r === 'continue') return 0;
                if (r === 'consume-and-close') {
                    this.addLine();
                    container.closed = true;
                    this.lastLineLength = ln.length;
                    this.finalize(container, this.lineNumber, this.lineStart);
                    return 2;
                }
                container.closed = true;
                return 1;
            }
        }
    }

    /** Whether `rest` (the line from its first non-space char) would start a non-paragraph block. */
    private startsAnotherBlock(rest: string): boolean {
        if (rest[0] === '>') return true;
        if (RE_ATX.test(rest)) return true;
        if (RE_FENCE_OPEN.test(rest)) return true;
        if (RE_THEMATIC.test(rest)) return true;
        if (RE_BULLET.test(rest) && (rest.length === 1 || isSpaceOrTab(rest[1]))) return true;
        const om = RE_ORDERED.exec(rest);
        if (om && (rest.length === om[0].length || isSpaceOrTab(rest[om[0].length]))) return true;
        return false;
    }

    /** 0 = no start matched, 1 = container start matched, 2 = leaf start matched. */
    private tryStarts(container: Block, rest: string, maybeExt: boolean): 0 | 1 | 2 {
        const ln = this.line;

        // Plugin block extensions.
        if (maybeExt && !this.indented) {
            const paragraphOpen = container.type === 'paragraph';
            const trigger = rest[0];
            for (const ext of this.plugins.block) {
                if (ext.triggerChars.indexOf(trigger) === -1) continue;
                if (paragraphOpen && !ext.interruptsParagraph) continue;
                let started: { meta?: unknown; consumed?: boolean } | null = null;
                const info: LineInfo = {
                    text: ln.slice(this.offset),
                    indent: this.indent,
                    offset: this.lineStart + this.offset,
                    line: this.lineNumber,
                    blank: this.blank,
                };
                try {
                    started = ext.start(info, { paragraphOpen });
                } catch (err) {
                    if (__DEV__) console.warn(`[@sigx/markdown] Block extension "${ext.name}" threw in start(); ignored.`, err);
                    started = null;
                }
                if (!started) continue;
                this.closeUnmatchedBlocks();
                const block = this.addChild('extension', this.nextNonspace);
                block.ext = ext;
                block.extState = { lines: [], meta: started.meta };
                if (started.consumed === false) block.skipNextLine = true;
                return 2;
            }
        }

        if (!this.indented) {
            // Blockquote.
            if (rest[0] === '>') {
                this.advanceNextNonspace();
                this.advanceOffset(1, false);
                if (isSpaceOrTab(ln[this.offset])) this.advanceOffset(1, true);
                this.closeUnmatchedBlocks();
                this.addChild('blockquote', this.nextNonspace);
                return 1;
            }

            // ATX heading.
            const atx = RE_ATX.exec(rest);
            if (atx) {
                this.advanceNextNonspace();
                this.advanceOffset(atx[0].length, false);
                this.closeUnmatchedBlocks();
                const block = this.addChild('heading', this.nextNonspace);
                block.depth = (atx[0].trim().length) as HeadingDepth;
                let text = ln.slice(this.offset);
                let contentOffsetInLine = this.offset;
                if (RE_ATX_CLOSE_ONLY.test(text)) text = '';
                else text = text.replace(RE_ATX_CLOSE, '');
                const leading = /^[ \t]*/.exec(text)![0].length;
                text = text.slice(leading).replace(/[ \t]+$/, '');
                contentOffsetInLine += leading;
                block.content = { text, offset: this.lineStart + contentOffsetInLine };
                this.advanceOffset(ln.length - this.offset, false);
                return 2;
            }

            // Fenced code.
            const fence = RE_FENCE_OPEN.exec(rest);
            if (fence) {
                const fenceLength = fence[0].length;
                this.closeUnmatchedBlocks();
                const block = this.addChild('fencedCode', this.nextNonspace);
                block.fenceLength = fenceLength;
                block.fenceChar = fence[0][0];
                block.fenceOffset = this.indent;
                this.advanceNextNonspace();
                this.advanceOffset(fenceLength, false);
                return 2;
            }

            // Setext heading (or a table delimiter row) under a one-line-or-more paragraph.
            if (container.type === 'paragraph') {
                if (RE_SETEXT.test(rest)) {
                    this.closeUnmatchedBlocks();
                    const converted = this.convertParagraphToHeading(container, rest[0] === '=' ? 1 : 2);
                    if (converted) {
                        this.advanceOffset(ln.length - this.offset, false);
                        return 2;
                    }
                    // The paragraph was only definitions and is gone: the
                    // underline is ordinary text in a fresh paragraph.
                    return 1;
                }
                if (container.lines.length === 1 && rest.indexOf('-') !== -1) {
                    const align = matchTableDelimiter(rest);
                    if (align) {
                        const header = splitTableRowWithOffsets(container.lines[0].text);
                        if (header.length === align.length) {
                            this.closeUnmatchedBlocks();
                            container.type = 'table';
                            container.align = align;
                            container.skipNextLine = true;
                            this.advanceOffset(ln.length - this.offset, false);
                            return 2;
                        }
                    }
                }
            }

            // Thematic break.
            if (RE_THEMATIC.test(rest)) {
                this.closeUnmatchedBlocks();
                this.addChild('thematicBreak', this.nextNonspace);
                this.advanceOffset(ln.length - this.offset, false);
                return 2;
            }
        }

        // List item.
        if (!this.indented || container.type === 'list') {
            const data = this.parseListMarker(container);
            if (data) {
                this.closeUnmatchedBlocks();
                if (this.tip.type !== 'list' || !listsMatch(container.listData, data)) {
                    const list = this.addChild('list', this.nextNonspace);
                    list.listData = data;
                }
                const item = this.addChild('item', this.nextNonspace);
                item.listData = data;
                return 1;
            }
        }

        // Indented code.
        if (this.indented && this.tip.type !== 'paragraph' && !this.blank) {
            this.advanceOffset(4, true);
            this.closeUnmatchedBlocks();
            this.addChild('indentedCode', this.offset);
            return 2;
        }

        return 0;
    }

    private convertParagraphToHeading(paragraph: Block, depth: HeadingDepth): boolean {
        // Definitions at the head of the paragraph are not heading content.
        this.finalizeParagraph(paragraph);
        const parent = paragraph.parent!;
        if (parent.children.indexOf(paragraph) === -1) {
            // The paragraph was entirely definitions: the underline is a new paragraph.
            this.tip = parent;
            return false;
        }
        paragraph.type = 'heading';
        paragraph.depth = depth;
        const text = paragraph.lines.map((l) => l.text).join('\n').replace(/[ \t]+$/, '');
        paragraph.content = { text, offset: paragraph.lines[0].offset };
        paragraph.lines = [];
        this.tip = paragraph;
        return true;
    }

    private parseListMarker(container: Block): ListData | null {
        const ln = this.line;
        const rest = ln.slice(this.nextNonspace);
        if (this.indent >= 4) return null;
        let match: RegExpExecArray | null;
        const data: ListData = {
            ordered: false,
            bulletChar: '',
            start: 1,
            delimiter: '',
            padding: 0,
            markerOffset: this.indent,
        };
        if ((match = RE_BULLET.exec(rest))) {
            data.bulletChar = match[0][0];
        } else if ((match = RE_ORDERED.exec(rest)) && (container.type !== 'paragraph' || match[1] === '1')) {
            data.ordered = true;
            data.start = parseInt(match[1], 10);
            data.delimiter = match[2];
        } else {
            return null;
        }
        // The marker must be followed by whitespace or the end of the line.
        const nextc = ln[this.nextNonspace + match[0].length];
        if (!(nextc === undefined || nextc === '\t' || nextc === ' ')) return null;
        // An item interrupting a paragraph cannot start with a blank line.
        if (container.type === 'paragraph' && !/[^ \t]/.test(ln.slice(this.nextNonspace + match[0].length))) return null;

        this.advanceNextNonspace();
        this.advanceOffset(match[0].length, true);
        const spacesStartCol = this.column;
        const spacesStartOffset = this.offset;
        do {
            this.advanceOffset(1, true);
        } while (this.column - spacesStartCol < 5 && isSpaceOrTab(ln[this.offset]));
        const blankItem = ln[this.offset] === undefined;
        const spacesAfterMarker = this.column - spacesStartCol;
        if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
            data.padding = match[0].length + 1;
            this.column = spacesStartCol;
            this.offset = spacesStartOffset;
            if (isSpaceOrTab(ln[this.offset])) this.advanceOffset(1, true);
        } else {
            data.padding = match[0].length + spacesAfterMarker;
        }
        return data;
    }

    // -- helpers for extensions --------------------------------------------------

    private inlineAt(text: string, offset?: number): PhrasingContent[] {
        return parseInline(text, {
            plugins: this.plugins,
            pointAt: offset === undefined ? undefined : (i) => this.pointAt(offset + i),
        });
    }

    private nestedBlocks(lines: readonly LineInfo[]): BlockContent[] {
        if (lines.length === 0) return [];
        const src = lines.map((l) => l.text).join('\n');
        const nested = new BlockParser({
            plugins: this.plugins,
            baseOffset: lines[0].offset,
            baseLine: lines[0].line,
        });
        const { doc } = nested.parse(src);
        return nested.toChildren(doc, 'x');
    }

    private positionOf(block: Block): Position {
        return { start: this.pointAt(block.startOffset), end: this.pointAt(block.endOffset) };
    }

    // Points are computed lazily from the offsets we recorded per line; the
    // converter fills a line table first (see `toChildren`).
    private lineStarts: number[] = [];
    private pointAt(offset: number): Point {
        const starts = this.lineStarts;
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return { line: this.baseLine + lo, column: offset - (starts[lo] ?? this.baseOffset) + 1, offset };
    }
    private recordLineStart(lineStart: number): void {
        this.lineStarts.push(lineStart);
    }

    // -- conversion to mdast ------------------------------------------------------

    toChildren(doc: Block, keyPrefix: string | number): BlockContent[] {
        const out: BlockContent[] = [];
        let index = typeof keyPrefix === 'number' ? keyPrefix : 0;
        for (const child of doc.children) {
            const key = typeof keyPrefix === 'number' ? topKey(index) : childKey(keyPrefix, index);
            const node = this.toNode(child, key);
            if (node) {
                out.push(node);
                index++;
            }
        }
        return out;
    }

    private toNode(block: Block, key: string): BlockContent | null {
        const pos = this.positionOf(block);
        switch (block.type) {
            case 'paragraph': {
                if (block.lines.length === 0) return null;
                return { type: 'paragraph', key, children: this.inlineLines(block.lines), position: pos };
            }
            case 'heading': {
                const content = block.content!;
                const node: Heading = {
                    type: 'heading',
                    key,
                    depth: block.depth!,
                    children: content.text ? this.inlineAt(content.text, content.offset) : [],
                    position: pos,
                };
                return node;
            }
            case 'thematicBreak':
                return { type: 'thematicBreak', key, position: pos };
            case 'blockquote':
                return { type: 'blockquote', key, children: this.toChildren(block, key), position: pos };
            case 'list': {
                const data = block.listData!;
                const items: ListItem[] = [];
                block.children.forEach((item, i) => {
                    const itemKey = childKey(key, i);
                    const checked = extractTask(item);
                    const children = this.toChildren(item, itemKey);
                    const node: ListItem = {
                        type: 'listItem',
                        key: itemKey,
                        spread: itemIsSpread(item),
                        children,
                        position: this.positionOf(item),
                    };
                    if (checked !== null) node.checked = checked;
                    items.push(node);
                });
                return {
                    type: 'list',
                    key,
                    ordered: data.ordered,
                    start: data.ordered ? data.start : null,
                    spread: !block.tight,
                    children: items,
                    position: pos,
                };
            }
            case 'fencedCode': {
                const info = block.lines.length ? unescapeString(block.lines[0].text.trim(), this.entities) : '';
                const value = block.lines.slice(1).map((l) => l.text).join('\n');
                const sp = info.search(/[ \t]/);
                const lang = info === '' ? null : sp === -1 ? info : info.slice(0, sp);
                const meta = sp === -1 ? null : info.slice(sp).trim() || null;
                const node: Code = { type: 'code', key, lang, meta, value, position: pos };
                if (block.closed === false) node.open = true;
                return node;
            }
            case 'indentedCode':
                return { type: 'code', key, lang: null, meta: null, value: block.lines.map((l) => l.text).join('\n'), position: pos };
            case 'table':
                return this.toTable(block, key, pos);
            case 'definition':
                return { ...block.definition!, key, position: pos };
            case 'extension': {
                if (block.extResult) {
                    const node = block.extResult as BlockContent & { key?: string };
                    node.key = key;
                    if (!node.position) node.position = pos;
                    return node;
                }
                // Extension failed: degrade to a paragraph of its lines.
                const lines = block.extState?.lines.map((l) => ({ text: l.text, offset: l.offset })) ?? block.lines;
                if (lines.length === 0) return null;
                return { type: 'paragraph', key, children: this.inlineLines(lines), position: pos };
            }
            default:
                return null;
        }
    }

    private toTable(block: Block, key: string, pos: Position): Table {
        const align = block.align!;
        const width = align.length;
        const rows: TableRow[] = [];
        block.lines.forEach((line, ri) => {
            const cells = splitTableRowWithOffsets(line.text);
            const rowKey = childKey(key, ri);
            const cellNodes: TableCell[] = [];
            for (let ci = 0; ci < width; ci++) {
                const cell = cells[ci];
                const cellKey = childKey(rowKey, ci);
                const node: TableCell = {
                    type: 'tableCell',
                    key: cellKey,
                    children: cell && cell.text ? this.inlineAt(cell.text, line.offset + cell.start) : [],
                };
                if (cell) {
                    node.position = {
                        start: this.pointAt(line.offset + cell.start),
                        end: this.pointAt(line.offset + cell.start + cell.text.length),
                    };
                }
                cellNodes.push(node);
            }
            rows.push({
                type: 'tableRow',
                key: rowKey,
                children: cellNodes,
                position: { start: this.pointAt(line.offset), end: this.pointAt(line.offset + line.text.length) },
            });
        });
        return { type: 'table', key, align, children: rows, position: pos };
    }

    /** Inline-parse paragraph lines joined by '\n', mapping content indexes back to source offsets. */
    private inlineLines(lines: Line[]): PhrasingContent[] {
        // A paragraph's final whitespace is not content (and never a hard break).
        const text = lines.map((l) => l.text).join('\n').replace(/[ \t]+$/, '');
        return parseInline(text, {
            plugins: this.plugins,
            pointAt: (i) => this.pointAt(contentOffset(lines, i)),
        });
    }

    /** Build the line table from the parsed source (called once before conversion). */
    indexLines(src: string): void {
        this.lineStarts = [this.baseOffset];
        for (let i = 0; i < src.length; i++) {
            if (src.charCodeAt(i) === 10) this.lineStarts.push(this.baseOffset + i + 1);
        }
        void this.recordLineStart;
    }
}

/** Map a content index (into lines joined by '\n') to an absolute source offset. */
function contentOffset(lines: readonly Line[], index: number): number {
    let i = index;
    for (let k = 0; k < lines.length; k++) {
        const len = lines[k].text.length;
        if (i <= len) return lines[k].offset + i;
        i -= len + 1;
    }
    const last = lines[lines.length - 1];
    return last ? last.offset + last.text.length : 0;
}

function listsMatch(a: ListData | undefined, b: ListData): boolean {
    return !!a && a.ordered === b.ordered && a.delimiter === b.delimiter && a.bulletChar === b.bulletChar;
}

function endsWithBlankLine(block: Block): boolean {
    let b: Block | undefined = block;
    while (b) {
        if (b.lastLineBlank) return true;
        const t = b.type;
        if (!b.lastLineChecked && (t === 'list' || t === 'item')) {
            b.lastLineChecked = true;
            b = b.children[b.children.length - 1];
        } else {
            b.lastLineChecked = true;
            break;
        }
    }
    return false;
}

/** Whether a list item's own children are separated by blank lines (mdast `listItem.spread`). */
function itemIsSpread(item: Block): boolean {
    const subs = item.children;
    for (let j = 0; j < subs.length - 1; j++) {
        if (subs[j].lastLineBlank) return true;
    }
    return false;
}

/**
 * Detect a GFM task marker (`[ ]` / `[x]` followed by whitespace) at the start
 * of an item's first paragraph and strip it from the source line before
 * inline parsing, so `[x]` never becomes a reference. Returns the checked
 * state, or `null` when the item is not a task.
 */
function extractTask(item: Block): boolean | null {
    const first = item.children[0];
    if (!first || first.type !== 'paragraph' || first.lines.length === 0) return null;
    const line = first.lines[0];
    const m = /^\[([ xX])\][ \t]+(?=[^ \t])/.exec(line.text);
    if (!m) return null;
    first.lines[0] = { text: line.text.slice(m[0].length), offset: line.offset + m[0].length };
    return m[1].toLowerCase() === 'x';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a (normalised) source string into top-level block nodes. `src` must be
 * line-ending-normalised (see `normalizeSource`).
 */
export function parseBlocks(src: string, options: ParseBlocksOptions = {}): ParseBlocksResult {
    const parser = new BlockParser(options);
    parser.indexLines(src);
    const { doc, endOffset, endLine } = parser.parse(src);
    // Trailing top-level blocks that may still change: those closed by the
    // end of the input, and — when the last line has no line ending yet —
    // those closed BY that last line, which may still turn into something
    // else (`Foo\n    ` closes the paragraph as a blank line, but `Foo\n    ba`
    // is a lazy continuation).
    const lastLineComplete = src.length === 0 || src.charCodeAt(src.length - 1) === 10;
    const lastLineBlank = !/[^ \t]/.test(src.slice(src.lastIndexOf('\n') + 1));
    let openCount = 0;
    for (let i = doc.children.length - 1; i >= 0; i--) {
        const b = doc.children[i];
        const closedByLastLine = !lastLineComplete && b.closedByLine === endLine;
        if (b.closedAtEof || (closedByLastLine && mutableWhenClosedBy(b, lastLineBlank))) openCount++;
        else break;
    }
    const children = parser.toChildren(doc, options.baseIndex ?? 0);
    openCount = Math.min(openCount, children.length);
    const end = endPoint(src, options.baseOffset ?? 0, options.baseLine ?? 1);
    return { children, endOffset, end, openCount };
}

/**
 * Whether a block closed by the still-unterminated last line could reopen or
 * change if that line grows. A blank line may become anything (a lazy
 * continuation, a marker). A non-blank line that started a new block may
 * stop being one once extended (`aaa\n#` → `aaa\n#x` is a paragraph
 * continuation; `- a\n*` → `- a\n**` is a lazy continuation of the item;
 * ```` ``` ```` → ```` ```x ```` is no longer a closing fence), so every
 * block that can absorb a continuation line stays open. Only a heading, a
 * thematic break or an indented code block can never be rejoined.
 */
function mutableWhenClosedBy(block: Block, lastLineBlank: boolean): boolean {
    if (lastLineBlank) return true;
    return block.type !== 'heading' && block.type !== 'thematicBreak' && block.type !== 'indentedCode';
}

function endPoint(src: string, baseOffset: number, baseLine: number): Point {
    let line = baseLine;
    let lastStart = 0;
    for (let i = 0; i < src.length; i++) {
        if (src.charCodeAt(i) === 10) {
            line++;
            lastStart = i + 1;
        }
    }
    return { line, column: src.length - lastStart + 1, offset: baseOffset + src.length };
}

/** Build a `Root` from parsed children (no document-level position). */
export function makeRoot(children: BlockContent[]): Root {
    return { type: 'root', children };
}
