/**
 * The surface contracts — what a platform implements so the core can edit
 * through it. The core owns block structure; each inline container
 * (paragraph, heading, table cell) is edited by an `InlineSurface` (a DOM
 * `contenteditable`, a native `<sigx-richtext>` on Lynx, a terminal buffer),
 * each code block by a `CodeSurface`. Surfaces are dumb: they render a flat
 * model, report what the user did, and accept commands. Every cross-block
 * behaviour (Enter, Backspace at the edge, arrows across blocks, Tab) is a
 * `boundary` event the core answers by running its keymap.
 */

import type { InlineFlat } from './inline-flat.js';

export interface Range {
    start: number;
    end: number;
}

/** A caret rectangle in the surface's own coordinate space (px on web, dp on Lynx). */
export interface CaretRect {
    x: number;
    y: number;
    height: number;
}

export type BoundaryKey =
    | 'Enter'
    | 'Shift-Enter'
    | 'Mod-Enter'
    | 'Backspace'
    | 'Delete'
    | 'ArrowUp'
    | 'ArrowDown'
    | 'ArrowLeft'
    | 'ArrowRight'
    | 'Tab'
    | 'Shift-Tab'
    | 'Escape';

export interface SurfaceChangeEvent {
    /** The surface's whole content after the change. */
    flat: InlineFlat;
    /** The selection after the change, when known. */
    selection: Range | null;
    /** An IME composition is in progress: the change is provisional. */
    composing: boolean;
    /** The minimal edit, when the surface knows it (typing); otherwise the core diffs `flat`. */
    replaced?: { from: number; to: number; insert: InlineFlat };
}

export interface SurfaceSelectionEvent {
    range: Range;
    caret: CaretRect | null;
}

export interface SurfaceBoundaryEvent {
    key: BoundaryKey;
    range: Range;
    /** For ArrowUp/Down: the caret's x so the neighbour can land under it. */
    goalX?: number;
}

export interface SurfacePasteEvent {
    text: string;
    markdown?: string;
    html?: string;
    range: Range;
}

/** Events an inline surface raises. `boundary` returns whether the core consumed the key (the surface must then not perform its default). */
export interface InlineSurfaceEvents {
    change(e: SurfaceChangeEvent): void;
    selection(e: SurfaceSelectionEvent): void;
    boundary(e: SurfaceBoundaryEvent): boolean;
    /** Any other key the platform can report (DOM forwards every keydown; Lynx omits). Returns whether the core consumed it. */
    keydown?(name: string, range: Range): boolean;
    paste(e: SurfacePasteEvent): boolean;
    focus(): void;
    blur(): void;
    compositionStart(): void;
    compositionEnd(flat: InlineFlat): void;
}

export interface InlineSurfaceInit {
    key: string;
    blockType: string;
    attrs: Record<string, unknown>;
    flat: InlineFlat;
    readOnly: boolean;
    placeholder?: string;
    events: InlineSurfaceEvents;
}

/** Commands an inline surface accepts. `setInline` must be a no-op when the content already equals `flat` (the echo guard). */
export interface InlineSurface {
    setInline(flat: InlineFlat, opts?: { rev?: number }): void;
    setAttrs(blockType: string, attrs: Record<string, unknown>): void;
    setSelection(range: Range): void;
    focus(target?: { edge: 'start' | 'end' } | { offset: number } | { line: 'first' | 'last'; x: number }): void;
    blur(): void;
    getFlat(): InlineFlat;
    getSelection(): Range | null;
    caretRect(): CaretRect | null;
    /** The offset on the first/last visual line closest to `x` (for arrow navigation across blocks). May approximate. */
    offsetAtX(line: 'first' | 'last', x: number): number;
    isComposing(): boolean;
    setReadOnly(readOnly: boolean): void;
    setPlaceholder?(placeholder: string | undefined): void;
    destroy(): void;
}

export interface CodeSurfaceEvents {
    change(e: { value: string; selection: Range | null; composing: boolean }): void;
    selection(e: SurfaceSelectionEvent): void;
    /** `Backspace` only when the value is empty; `ArrowUp`/`ArrowDown` only on the first/last line. */
    boundary(e: SurfaceBoundaryEvent): boolean;
    /** Any other key the platform can report (chords such as `Mod-z`). Returns whether the core consumed it. */
    keydown?(name: string, range: Range): boolean;
    langChange?(lang: string | null): void;
    focus(): void;
    blur(): void;
}

export interface CodeSurfaceInit {
    key: string;
    value: string;
    lang: string | null;
    readOnly: boolean;
    events: CodeSurfaceEvents;
}

export interface CodeSurface {
    setValue(value: string): void;
    getValue(): string;
    setLang(lang: string | null): void;
    setSelection(range: Range): void;
    focus(target?: { edge: 'start' | 'end' } | { offset: number }): void;
    blur(): void;
    getSelection(): Range | null;
    setReadOnly(readOnly: boolean): void;
    destroy(): void;
}

export type AnySurface = InlineSurface | CodeSurface;

export interface PlatformInfo {
    isMac: boolean;
    hasHardwareKeyboard: boolean;
    /** Whether `caretRect` is relative to the editor root or to the block element. */
    caretRectSpace: 'editor' | 'block';
}

/** What a platform view hands the core. The core never creates surfaces itself — the view's block components do. */
export interface SurfaceHost {
    platform: PlatformInfo;
    /** Viewport metrics for popup placement: window on web, screen minus keyboard on Lynx. */
    viewport(): { width: number; height: number; keyboardHeight: number };
}
