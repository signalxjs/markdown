import { describe, expect, it } from 'vitest';
import { placeSuggestionPopup } from '../../../src/editor/trigger/position.js';

describe('placeSuggestionPopup', () => {
    const base = {
        caretRect: { x: 30, y: 100, height: 18 },
        containerTop: 400,
        containerWidth: 320,
        containerHeight: 140,
        screenHeight: 800,
        keyboardHeight: 300,
        popupWidth: 240,
        maxPopupHeight: 220,
    };

    it('places above the caret by default (bottom-anchored)', () => {
        const pos = placeSuggestionPopup(base);
        expect(pos.placement).toBe('above');
        expect(pos.bottom).toBe(140 - 100 + 4);
        expect(pos.top).toBeUndefined();
    });

    it('flips below when there is no room above', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 4, height: 18 },
        });
        expect(pos.placement).toBe('below');
        expect(pos.top).toBe(4 + 18 + 4);
    });

    it('clamps maxHeight so the popup never extends under the keyboard', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 4, height: 18 },
            // keyboard top at 500; caret bottom at 22 → space below ≈ 474, clamp at maxPopupHeight
        });
        expect(pos.maxHeight).toBeLessThanOrEqual(base.maxPopupHeight);

        const tight = placeSuggestionPopup({
            ...base,
            containerTop: 350,
            caretRect: { x: 30, y: 10, height: 18 },
            screenHeight: 800,
            keyboardHeight: 380, // keyboard top at 420 — just below the caret
        });
        // 420 - (350+10+18) - 4 = 38 below; above has 350+10-4 = 356.
        expect(tight.placement).toBe('above');
        expect(tight.maxHeight).toBeLessThanOrEqual(base.maxPopupHeight);
    });

    it('never exceeds the available space, even below one row', () => {
        // Caret near the top of a screen-top container, keyboard nearly
        // covering everything: both sides are tight, above wins, and the
        // popup must shrink to the space rather than overflow.
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 20, height: 18 },
            screenHeight: 800,
            keyboardHeight: 770, // keyboard top at 30 — almost no room anywhere
        });
        expect(pos.placement).toBe('above');
        expect(pos.maxHeight).toBeLessThanOrEqual(20 - 4); // spaceAbove
    });

    it('clamps left so the popup stays inside the container', () => {
        const pos = placeSuggestionPopup({ ...base, caretRect: { x: 310, y: 100, height: 18 } });
        expect(pos.left).toBe(320 - 240);
        expect(placeSuggestionPopup({ ...base, containerWidth: 100 }).left).toBe(0);
    });

    // A composer inside a bottom sheet: the sheet's panel is laid out pinned to
    // the page bottom and then slid DOWN by a transform, so for a tall panel
    // the layout frame puts the composer near the page top (containerTop 10)
    // — no room "above", lots "below" → the popup flips down, and once the
    // transform is applied that lands it behind the keyboard. The measured
    // VIEWPORT frame has the composer where it actually is: docked above a
    // 300px keyboard.
    it('stays above the caret when the container is measured in viewport coords', () => {
        const composer = {
            ...base,
            containerHeight: 60,
            caretRect: { x: 12, y: 20, height: 18 },
            keyboardHeight: 300,
        };
        // Measured (viewport): composer sits just above the keyboard top (500).
        expect(placeSuggestionPopup({ ...composer, containerTop: 430 }).placement).toBe('above');
        // Layout frame (the bug): the untransformed box is near the top.
        expect(placeSuggestionPopup({ ...composer, containerTop: 10 }).placement).toBe('below');
    });

    it('honors an explicit placement instead of measuring for room', () => {
        // No room above at all (container at the very top), yet a host that
        // knows its layout can still pin the side.
        const cramped = { ...base, containerTop: 0, caretRect: { x: 30, y: 4, height: 18 } };
        expect(placeSuggestionPopup(cramped).placement).toBe('below');
        expect(placeSuggestionPopup({ ...cramped, prefer: 'above' }).placement).toBe('above');
        expect(placeSuggestionPopup({ ...base, prefer: 'below' }).placement).toBe('below');
        // 'auto' is the documented default and must match omitting it.
        expect(placeSuggestionPopup({ ...base, prefer: 'auto' })).toEqual(placeSuggestionPopup(base));
    });

    it('still clamps against the keyboard when the side is pinned', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 20, height: 18 },
            keyboardHeight: 770, // keyboard top at 30 — almost nothing below
            prefer: 'below',
        });
        expect(pos.placement).toBe('below');
        // Caret bottom (38) is already past the keyboard top (30) — nothing
        // fits, so the list collapses rather than painting under the keyboard.
        expect(pos.maxHeight).toBe(0);
    });

    it('a desktop host passes keyboardHeight 0', () => {
        const pos = placeSuggestionPopup({ ...base, containerTop: 0, caretRect: { x: 30, y: 4, height: 18 }, keyboardHeight: 0 });
        expect(pos.placement).toBe('below');
        expect(pos.maxHeight).toBe(220);
    });
});
