/**
 * `DomCodeSurface` — a `<textarea>` implementing `CodeSurface`.
 *
 * Plain text in, plain text out. Enter inserts a newline here (the browser's
 * default); the boundaries are Backspace on an empty value, ArrowUp on the
 * first line, ArrowDown on the last line, Escape and Mod-Enter (`exitCode`).
 * Tab inserts two spaces. Every chord is forwarded through `keydown` so the
 * editor's history wins over the textarea's own.
 */

import { keyNames } from '../keys.js';
import type { KeyPlatform } from '../keys.js';
import type { BoundaryKey, CodeSurface, CodeSurfaceInit, Range as TextRange } from '../surface.js';

export interface DomCodeSurfaceOptions {
    platform: KeyPlatform;
    /** Indentation inserted by Tab. Default two spaces. */
    indent?: string;
}

export interface DomCodeSurface extends CodeSurface {
    readonly textarea: HTMLTextAreaElement;
    readonly key: string;
}

export function createDomCodeSurface(textarea: HTMLTextAreaElement, init: CodeSurfaceInit, opts: DomCodeSurfaceOptions): DomCodeSurface {
    const { events } = init;
    const indent = opts.indent ?? '  ';
    let readOnly = init.readOnly;
    let composing = false;
    let known = init.value;
    let lastRange: TextRange | null = null;

    textarea.value = init.value;
    textarea.readOnly = readOnly;
    textarea.setAttribute('spellcheck', 'false');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.wrap = 'off';
    autosize();

    function autosize(): void {
        // `field-sizing: content` does this in CSS where supported; the fallback measures.
        textarea.style.height = 'auto';
        const h = textarea.scrollHeight;
        if (h > 0) textarea.style.height = `${h}px`;
    }

    const range = (): TextRange => {
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        return { start: Math.min(start, end), end: Math.max(start, end) };
    };

    function report(): void {
        const value = textarea.value;
        autosize();
        if (!composing && value === known) return;
        known = value;
        events.change({ value, selection: range(), composing });
    }

    const boundary = (key: BoundaryKey, r: TextRange): boolean => events.boundary({ key, range: r });

    const onKeydown = (e: KeyboardEvent): void => {
        if (readOnly || composing || e.isComposing || e.keyCode === 229) return;
        const r = range();
        const value = textarea.value;
        const mod = e.ctrlKey || e.metaKey;
        let consumed: boolean | null = null;
        switch (e.key) {
            case 'Enter':
                if (mod) consumed = boundary('Mod-Enter', r);
                else consumed = false;
                break;
            case 'Backspace':
                if (value.length === 0 && !mod && !e.altKey) consumed = boundary('Backspace', r);
                else consumed = false;
                break;
            case 'ArrowUp':
                if (!mod && !e.altKey && !e.shiftKey && r.start === r.end && !value.slice(0, r.start).includes('\n')) consumed = boundary('ArrowUp', r);
                else consumed = false;
                break;
            case 'ArrowDown':
                if (!mod && !e.altKey && !e.shiftKey && r.start === r.end && !value.slice(r.end).includes('\n')) consumed = boundary('ArrowDown', r);
                else consumed = false;
                break;
            case 'Tab':
                if (mod || e.altKey) break;
                if (e.shiftKey) {
                    consumed = boundary('Shift-Tab', r);
                    break;
                }
                textarea.setRangeText(indent, r.start, r.end, 'end');
                report();
                consumed = true;
                break;
            case 'Escape':
                consumed = boundary('Escape', r);
                break;
        }
        if (consumed === null) {
            const named = e.key.length > 1 && e.key !== 'Unidentified' && e.key !== 'Dead';
            if ((mod || e.altKey || named) && events.keydown) {
                consumed = false;
                for (const name of keyNames(e, opts.platform)) {
                    if (events.keydown(name, r)) {
                        consumed = true;
                        break;
                    }
                }
            } else consumed = false;
        }
        if (consumed) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const onBeforeInput = (e: InputEvent): void => {
        if (readOnly) {
            e.preventDefault();
            return;
        }
        if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
            e.preventDefault();
            events.keydown?.(e.inputType === 'historyUndo' ? 'Mod-z' : 'Mod-Shift-z', range());
        }
    };

    const onInput = (): void => {
        if (readOnly) return;
        report();
    };

    const onCompositionStart = (): void => {
        composing = true;
    };

    const onCompositionEnd = (): void => {
        composing = false;
        report();
    };

    const onSelect = (): void => {
        const r = range();
        if (lastRange && lastRange.start === r.start && lastRange.end === r.end) return;
        lastRange = r;
        events.selection({ range: r, caret: null });
    };

    const onFocus = (): void => events.focus();
    const onBlur = (): void => events.blur();

    textarea.addEventListener('keydown', onKeydown);
    textarea.addEventListener('beforeinput', onBeforeInput as EventListener);
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('compositionstart', onCompositionStart);
    textarea.addEventListener('compositionend', onCompositionEnd);
    textarea.addEventListener('select', onSelect);
    textarea.addEventListener('keyup', onSelect);
    textarea.addEventListener('mouseup', onSelect);
    textarea.addEventListener('focus', onFocus);
    textarea.addEventListener('blur', onBlur);

    const surface: DomCodeSurface = {
        textarea,
        key: init.key,
        setValue(value) {
            if (value === textarea.value) {
                known = value;
                return;
            }
            const r = range();
            known = value;
            textarea.value = value;
            textarea.setSelectionRange(Math.min(r.start, value.length), Math.min(r.end, value.length));
            autosize();
        },
        getValue: () => textarea.value,
        setLang(lang) {
            if (lang) textarea.setAttribute('data-lang', lang);
            else textarea.removeAttribute('data-lang');
        },
        setSelection(r) {
            const len = textarea.value.length;
            const start = Math.max(0, Math.min(r.start, len));
            const end = Math.max(0, Math.min(r.end, len));
            textarea.setSelectionRange(start, end);
            lastRange = { start, end };
        },
        focus(target) {
            if (textarea.ownerDocument.activeElement !== textarea) textarea.focus({ preventScroll: true });
            const len = textarea.value.length;
            let offset: number;
            if (!target) offset = lastRange?.start ?? len;
            else if ('edge' in target) offset = target.edge === 'start' ? 0 : len;
            else offset = target.offset;
            surface.setSelection({ start: offset, end: offset });
        },
        blur() {
            if (textarea.ownerDocument.activeElement === textarea) textarea.blur();
        },
        getSelection: () => (textarea.ownerDocument.activeElement === textarea ? range() : lastRange),
        setReadOnly(next) {
            readOnly = next;
            textarea.readOnly = next;
        },
        destroy() {
            textarea.removeEventListener('keydown', onKeydown);
            textarea.removeEventListener('beforeinput', onBeforeInput as EventListener);
            textarea.removeEventListener('input', onInput);
            textarea.removeEventListener('compositionstart', onCompositionStart);
            textarea.removeEventListener('compositionend', onCompositionEnd);
            textarea.removeEventListener('select', onSelect);
            textarea.removeEventListener('keyup', onSelect);
            textarea.removeEventListener('mouseup', onSelect);
            textarea.removeEventListener('focus', onFocus);
            textarea.removeEventListener('blur', onBlur);
        },
    };
    return surface;
}
