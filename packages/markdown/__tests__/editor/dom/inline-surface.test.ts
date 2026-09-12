import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDomInlineSurface } from '../../../src/editor/dom/inline-surface.js';
import type { DomInlineSurface } from '../../../src/editor/dom/inline-surface.js';
import { ATOM_CHAR } from '../../../src/editor/inline-flat.js';
import type { InlineFlat } from '../../../src/editor/inline-flat.js';
import type { InlineSurfaceEvents, InlineSurfaceInit } from '../../../src/editor/surface.js';
import { runInlineSurfaceConformance } from '../../../src/testing/index.js';
import { domDriver, insertText, keydown } from './dom-driver.js';

const created: DomInlineSurface[] = [];

function create(init: InlineSurfaceInit): DomInlineSurface {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const s = createDomInlineSurface(host, init, { platform: { isMac: true } });
    created.push(s);
    return s;
}

afterEach(() => {
    for (const s of created.splice(0)) {
        s.destroy();
        s.host.remove();
    }
});

describe('DomInlineSurface conformance', () => {
    runInlineSurfaceConformance({ create, driver: domDriver, it, expect, cleanup: (s) => s.destroy() });
});

function events(over: Partial<InlineSurfaceEvents> = {}): InlineSurfaceEvents & { log: string[] } {
    const log: string[] = [];
    return {
        log,
        change: (e) => {
            log.push(`change:${e.flat.text}:${e.composing}`);
        },
        selection: (e) => {
            log.push(`sel:${e.range.start}-${e.range.end}`);
        },
        boundary: (e) => {
            log.push(`boundary:${e.key}`);
            return true;
        },
        keydown: (name) => {
            log.push(`key:${name}`);
            return name === 'Mod-b';
        },
        paste: (e) => {
            log.push(`paste:${e.text}:${e.markdown ?? ''}`);
            return true;
        },
        focus: () => {
            log.push('focus');
        },
        blur: () => {
            log.push('blur');
        },
        compositionStart: () => {
            log.push('cstart');
        },
        compositionEnd: (f) => {
            log.push(`cend:${f.text}`);
        },
        ...over,
    };
}

const make = (flat: InlineFlat, ev = events()) => ({ surface: create({ key: 'b-0', blockType: 'paragraph', attrs: {}, flat, readOnly: false, events: ev }), ev });

describe('DomInlineSurface', () => {
    it('sets the contenteditable host up with the a11y and state attributes', () => {
        const { surface } = make({ text: '', spans: [] });
        expect(surface.host.getAttribute('contenteditable')).toBe('true');
        expect(surface.host.getAttribute('role')).toBe('textbox');
        expect(surface.host.hasAttribute('data-empty')).toBe(true);
        surface.setInline({ text: 'x', spans: [] });
        expect(surface.host.hasAttribute('data-empty')).toBe(false);
        surface.setPlaceholder!('Write…');
        expect(surface.host.getAttribute('data-placeholder')).toBe('Write…');
        surface.setReadOnly(true);
        expect(surface.host.getAttribute('contenteditable')).toBe('false');
    });

    it('reports focus, blur and selection changes with the surface range', () => {
        const { surface, ev } = make({ text: 'hello', spans: [] });
        surface.focus({ offset: 2 });
        expect(ev.log).toContain('focus');
        expect(ev.log).toContain('sel:2-2');
        surface.setSelection({ start: 1, end: 4 });
        expect(ev.log).toContain('sel:1-4');
        surface.blur();
        expect(ev.log).toContain('blur');
    });

    it('forwards chords and named keys to the keymap and cancels consumed ones', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.focus({ offset: 1 });
        expect(keydown(surface, 'b', { metaKey: true })).toBe(false);
        expect(ev.log).toContain('key:Mod-b');
        expect(keydown(surface, 'i', { metaKey: true })).toBe(true);
        expect(ev.log).toContain('key:Mod-i');
        // Plain typing never reaches the keymap.
        keydown(surface, 'x');
        expect(ev.log.filter((l) => l === 'key:x').length).toBe(0);
        // Shift-arrows off the edge line are keymap bindings, not boundaries.
        keydown(surface, 'ArrowUp', { shiftKey: true });
        expect(ev.log).toContain('key:Shift-ArrowUp');
        expect(ev.log.some((l) => l.startsWith('boundary:'))).toBe(false);
    });

    it('reports selection changes only while the host has focus', () => {
        const { surface, ev } = make({ text: 'hello', spans: [] });
        surface.focus({ offset: 1 });
        expect(ev.log).toContain('sel:1-1');
        // Focus moves elsewhere (the editor root) while the DOM range stays in the host.
        const other = document.createElement('div');
        other.tabIndex = -1;
        document.body.appendChild(other);
        other.focus();
        const before = ev.log.length;
        document.getSelection()!.collapse(surface.host.firstChild, 3);
        expect(ev.log.length).toBe(before);
        expect(ev.log).not.toContain('sel:3-3');
        other.remove();
    });

    it('Mod-a selects the block text first and reaches the keymap only once everything is selected', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.focus({ offset: 1 });
        expect(keydown(surface, 'a', { metaKey: true })).toBe(true);
        expect(ev.log).not.toContain('key:Mod-a');
        surface.setSelection({ start: 0, end: 2 });
        keydown(surface, 'a', { metaKey: true });
        expect(ev.log).toContain('key:Mod-a');
        // An empty block has nothing to select: straight to the keymap.
        const empty = make({ text: '', spans: [] });
        empty.surface.focus({ offset: 0 });
        keydown(empty.surface, 'a', { metaKey: true });
        expect(empty.ev.log).toContain('key:Mod-a');
    });

    it('reports arrows at the edges, Tab and Escape as boundaries and consumes them', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.focus({ offset: 0 });
        expect(keydown(surface, 'ArrowLeft')).toBe(false);
        expect(keydown(surface, 'ArrowUp')).toBe(false);
        surface.focus({ offset: 2 });
        expect(keydown(surface, 'ArrowRight')).toBe(false);
        expect(keydown(surface, 'ArrowDown')).toBe(false);
        surface.focus({ offset: 1 });
        expect(keydown(surface, 'ArrowLeft')).toBe(true);
        expect(keydown(surface, 'ArrowRight')).toBe(true);
        keydown(surface, 'Tab');
        keydown(surface, 'Tab', { shiftKey: true });
        keydown(surface, 'Escape');
        keydown(surface, 'Enter', { metaKey: true });
        expect(ev.log.filter((l) => l.startsWith('boundary:'))).toEqual([
            'boundary:ArrowLeft',
            'boundary:ArrowUp',
            'boundary:ArrowRight',
            'boundary:ArrowDown',
            'boundary:Tab',
            'boundary:Shift-Tab',
            'boundary:Escape',
            'boundary:Mod-Enter',
        ]);
    });

    it('routes a virtual keyboard Enter and edge deletes through beforeinput', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.focus({ offset: 0 });
        const fire = (inputType: string) => surface.host.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
        expect(fire('insertParagraph')).toBe(false);
        expect(fire('deleteContentBackward')).toBe(false);
        surface.focus({ offset: 1 });
        expect(fire('deleteContentBackward')).toBe(true);
        surface.focus({ offset: 2 });
        expect(fire('deleteContentForward')).toBe(false);
        expect(fire('insertLineBreak')).toBe(false);
        expect(ev.log.filter((l) => l.startsWith('boundary:'))).toEqual(['boundary:Enter', 'boundary:Backspace', 'boundary:Delete', 'boundary:Shift-Enter']);
    });

    it('cancels native formatting and history commands and routes them through the keymap', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.focus({ offset: 1 });
        const fire = (inputType: string) => surface.host.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
        expect(fire('formatBold')).toBe(false);
        expect(fire('historyUndo')).toBe(false);
        expect(fire('formatUnderline')).toBe(false);
        expect(fire('insertFromDrop')).toBe(false);
        expect(ev.log).toContain('key:Mod-b');
        expect(ev.log).toContain('key:Mod-z');
    });

    it('hands paste to the core with plain text and markdown flavours', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.focus({ offset: 1 });
        const data = { getData: (t: string) => (t === 'text/plain' ? 'hi' : t === 'text/markdown' ? '# hi' : '') };
        const e = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: data });
        expect(surface.host.dispatchEvent(e)).toBe(false);
        expect(ev.log).toContain('paste:hi:# hi');
    });

    it('setInline restores the caret when the host is focused and skips equal content', () => {
        const { surface, ev } = make({ text: 'hello', spans: [] });
        surface.focus({ offset: 3 });
        const before = surface.host.innerHTML;
        surface.setInline({ text: 'hello', spans: [] });
        expect(surface.host.innerHTML).toBe(before);
        surface.setInline({ text: 'hello world', spans: [{ start: 6, end: 11, type: 'strong' }] });
        expect(surface.host.innerHTML).toBe('hello <strong>world</strong>');
        expect(surface.getSelection()).toEqual({ start: 3, end: 3 });
        expect(ev.log.filter((l) => l.startsWith('change')).length).toBe(0);
    });

    it('typing reads the DOM back including marks the browser kept', () => {
        const { surface, ev } = make({ text: 'ab', spans: [{ start: 0, end: 2, type: 'strong' }] });
        surface.focus({ offset: 1 });
        insertText(surface, 'X');
        expect(ev.log.at(-1)).toBe('change:aXb:false');
        expect(surface.getFlat()).toEqual({ text: 'aXb', spans: [{ start: 0, end: 3, type: 'strong' }] });
    });

    it('does not report a change when the browser left the content equal', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.focus({ offset: 1 });
        surface.host.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true }));
        expect(ev.log.some((l) => l.startsWith('change'))).toBe(false);
    });

    it('keeps atoms intact through the read-back after typing next to them', () => {
        const atoms = new Map([['mention', (s: { attrs?: Record<string, string> }, d: Document) => Object.assign(d.createElement('span'), { textContent: '@' + s.attrs!.label })]]);
        const host = document.createElement('div');
        document.body.appendChild(host);
        const ev = events();
        const flat: InlineFlat = { text: `a${ATOM_CHAR}`, spans: [{ start: 1, end: 2, type: 'mention', attrs: { id: '1', label: 'x' } }] };
        const surface = createDomInlineSurface(host, { key: 'b-0', blockType: 'paragraph', attrs: {}, flat, readOnly: false, events: ev }, { platform: { isMac: false }, atoms });
        created.push(surface);
        surface.focus({ edge: 'end' });
        insertText(surface, '!');
        expect(surface.getFlat()).toEqual({ text: `a${ATOM_CHAR}!`, spans: [{ start: 1, end: 2, type: 'mention', attrs: { id: '1', label: 'x' } }] });
        expect(host.querySelector('[data-atom]')!.textContent).toBe('@x');
    });

    it('tells the host when emptiness changes', () => {
        const onEmpty = vi.fn();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const surface = createDomInlineSurface(host, { key: 'b-0', blockType: 'paragraph', attrs: {}, flat: { text: '', spans: [] }, readOnly: false, events: events() }, { platform: { isMac: false }, onEmpty });
        created.push(surface);
        surface.setInline({ text: 'a', spans: [] });
        surface.setInline({ text: '', spans: [] });
        expect(onEmpty.mock.calls).toEqual([[false], [true]]);
    });

    it('destroy removes the listeners', () => {
        const { surface, ev } = make({ text: 'ab', spans: [] });
        surface.destroy();
        surface.focus({ offset: 0 });
        keydown(surface, 'Enter');
        expect(ev.log.some((l) => l.startsWith('boundary:'))).toBe(false);
    });
});
