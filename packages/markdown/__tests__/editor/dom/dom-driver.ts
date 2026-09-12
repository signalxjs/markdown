/**
 * A happy-dom driver for the DOM surfaces: emulates what a browser does for a
 * keystroke (`beforeinput` → DOM edit → `input`), a boundary key (`keydown`,
 * then the editing sequence when nothing cancelled it) and an IME session.
 */

import type { BoundaryKey, InlineSurface } from '../../../src/editor/surface.js';
import type { SurfaceDriver } from '../../../src/testing/index.js';
import type { DomInlineSurface } from '../../../src/editor/dom/inline-surface.js';

const hostOf = (s: InlineSurface): HTMLElement => (s as DomInlineSurface).host;

function domRange(host: HTMLElement): Range | null {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!host.contains(r.startContainer) || !host.contains(r.endContainer)) return null;
    return r;
}

function fire(host: HTMLElement, type: string, init: InputEventInit & { inputType?: string }): boolean {
    const e = new InputEvent(type, { bubbles: true, cancelable: type === 'beforeinput', ...init });
    return host.dispatchEvent(e);
}

/** Replace the current selection with `text` in the DOM and collapse after it. */
function replaceSelection(host: HTMLElement, text: string): void {
    const r = domRange(host);
    if (!r) return;
    r.deleteContents();
    const sel = document.getSelection()!;
    if (text) {
        const node = document.createTextNode(text);
        r.insertNode(node);
        sel.collapse(node, text.length);
    } else {
        sel.collapse(r.startContainer, r.startOffset);
    }
    // Drop empty text nodes the edit left behind, as a browser would.
    for (const t of Array.from(host.childNodes)) if (t.nodeType === 3 && !t.textContent) t.remove();
}

function extendBackward(host: HTMLElement): boolean {
    const r = domRange(host);
    if (!r || !r.collapsed) return !!r;
    const { startContainer: n, startOffset: o } = r;
    if (n.nodeType === 3 && o > 0) r.setStart(n, o - 1);
    else return false;
    return true;
}

function extendForward(host: HTMLElement): boolean {
    const r = domRange(host);
    if (!r || !r.collapsed) return !!r;
    const { endContainer: n, endOffset: o } = r;
    if (n.nodeType === 3 && o < (n.textContent ?? '').length) r.setEnd(n, o + 1);
    else return false;
    return true;
}

export function insertText(surface: InlineSurface, text: string): void {
    const host = hostOf(surface);
    if (host.getAttribute('contenteditable') !== 'true') return;
    if (!fire(host, 'beforeinput', { inputType: 'insertText', data: text })) return;
    replaceSelection(host, text);
    fire(host, 'input', { inputType: 'insertText', data: text });
}

export function keydown(surface: InlineSurface, key: string, init: KeyboardEventInit = {}): boolean {
    const host = hostOf(surface);
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    return host.dispatchEvent(e);
}

export const domDriver: SurfaceDriver = {
    type: insertText,
    press(surface, key: BoundaryKey) {
        const host = hostOf(surface);
        const [mods, base] = key.includes('-') ? [key.slice(0, key.lastIndexOf('-')), key.slice(key.lastIndexOf('-') + 1)] : ['', key];
        const init: KeyboardEventInit = { shiftKey: mods.includes('Shift'), metaKey: mods.includes('Mod'), ctrlKey: false };
        if (!keydown(surface, base, init)) return;
        // Nothing cancelled the key: do what the browser would.
        if (base === 'Backspace') {
            if (!extendBackward(host)) return;
            if (!fire(host, 'beforeinput', { inputType: 'deleteContentBackward' })) return;
            replaceSelection(host, '');
            fire(host, 'input', { inputType: 'deleteContentBackward' });
        } else if (base === 'Delete') {
            if (!extendForward(host)) return;
            if (!fire(host, 'beforeinput', { inputType: 'deleteContentForward' })) return;
            replaceSelection(host, '');
            fire(host, 'input', { inputType: 'deleteContentForward' });
        } else if (base === 'Enter') {
            const type = init.shiftKey ? 'insertLineBreak' : 'insertParagraph';
            if (!fire(host, 'beforeinput', { inputType: type })) return;
            replaceSelection(host, '\n');
            fire(host, 'input', { inputType: type });
        }
    },
    setCaret(surface, offset) {
        surface.setSelection({ start: offset, end: offset });
    },
    compose(surface, updates, committed) {
        const host = hostOf(surface);
        host.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        let composedLength = 0;
        const replaceComposed = (text: string) => {
            const r = domRange(host);
            if (!r) return;
            if (composedLength && r.startContainer.nodeType === 3) r.setStart(r.startContainer, r.startOffset - composedLength);
            replaceSelection(host, text);
            composedLength = text.length;
        };
        for (const u of updates) {
            fire(host, 'beforeinput', { inputType: 'insertCompositionText', data: u, isComposing: true });
            replaceComposed(u);
            fire(host, 'input', { inputType: 'insertCompositionText', data: u, isComposing: true });
        }
        replaceComposed(committed);
        host.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: committed }));
        // Firefox order: the final input event lands after compositionend.
        fire(host, 'input', { inputType: 'insertCompositionText', data: committed, isComposing: false });
        return true;
    },
};
