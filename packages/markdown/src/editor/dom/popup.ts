/**
 * Small popup helpers shared by the block menu and the suggestion popup:
 * dismiss on an outside pointer-down or Escape, anchor-relative placement
 * inside the editor root, and roving focus over a list of items.
 */

/** Call `onDismiss` on a pointer-down outside `el` (and its anchor) or on Escape. Returns the disposer. */
export function onDismiss(el: HTMLElement, onDismissFn: () => void, anchor?: HTMLElement | null): () => void {
    const d = el.ownerDocument;
    const onPointerDown = (e: PointerEvent): void => {
        const target = e.target as Node | null;
        if (!target) return;
        if (el.contains(target) || (anchor && anchor.contains(target))) return;
        onDismissFn();
    };
    const onKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDismissFn();
        }
    };
    d.addEventListener('pointerdown', onPointerDown, true);
    d.addEventListener('keydown', onKeydown, true);
    return () => {
        d.removeEventListener('pointerdown', onPointerDown, true);
        d.removeEventListener('keydown', onKeydown, true);
    };
}

export interface AnchoredPosition {
    left: number;
    top: number;
}

/** Position a popup below (or above when there is no room) an anchor, in the coordinate space of `container` (which must be positioned). */
export function anchoredPosition(anchor: Element, container: Element, popupHeight: number, gap = 4): AnchoredPosition {
    const a = anchor.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const viewportHeight = container.ownerDocument.defaultView?.innerHeight ?? Infinity;
    const below = a.bottom + gap;
    const fits = below + popupHeight <= viewportHeight || a.top - gap - popupHeight < 0;
    const top = fits ? below - c.top : a.top - gap - popupHeight - c.top;
    return { left: a.left - c.left, top };
}

/** Roving-focus keyboard handling for a vertical list of `[role=menuitem]` / `[role=option]` elements. Returns whether the key was handled. */
export function roveList(list: HTMLElement, e: KeyboardEvent, selector: string): boolean {
    const items = Array.from(list.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');
    if (!items.length) return false;
    const active = list.ownerDocument.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    let next: number | null = null;
    switch (e.key) {
        case 'ArrowDown':
            next = index < 0 ? 0 : (index + 1) % items.length;
            break;
        case 'ArrowUp':
            next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
            break;
        case 'Home':
            next = 0;
            break;
        case 'End':
            next = items.length - 1;
            break;
    }
    if (next === null) return false;
    e.preventDefault();
    items[next].focus();
    return true;
}
