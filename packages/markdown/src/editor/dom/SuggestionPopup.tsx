/**
 * `<SuggestionPopup>` — the listbox a trigger session (`@` mentions, `/`
 * commands) shows next to the caret. The caret never leaves the surface:
 * the editor root intercepts ArrowUp/Down, Enter, Tab and Escape while a
 * session is open and drives `active` / `select` / `close` here.
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import type { TriggerItem, TriggerSession } from '../trigger/index.js';
import { placeSuggestionPopup, type PopupPlacement } from '../trigger/index.js';
import type { CaretRect } from '../surface.js';
import { suggestPart } from './anatomy.js';

export type SuggestionRenderItem = (item: TriggerItem, active: boolean) => JSXElement;

export type SuggestionPopupProps =
    & Define.Prop<'session', TriggerSession, true>
    & Define.Prop<'active', number, true>
    & Define.Prop<'caret', CaretRect | null>
    & Define.Prop<'container', { width: number; height: number; top: number }>
    & Define.Prop<'onPick', (item: TriggerItem) => void, true>
    & Define.Prop<'onHover', (index: number) => void>
    & Define.Prop<'renderItem', SuggestionRenderItem>
    & Define.Prop<'width', number>
    & Define.Prop<'maxHeight', number>
    & Define.Prop<'id', string>;

export const SuggestionPopup = component<SuggestionPopupProps>(({ props }) => {
    const onPointerDown = (e: PointerEvent): void => {
        e.preventDefault();
    };
    return () => {
        const { session, active } = props;
        const width = props.width ?? 280;
        const maxHeight = props.maxHeight ?? 240;
        const container = props.container ?? { width: 0, height: 0, top: 0 };
        const win = typeof window !== 'undefined' ? window : null;
        const placement: PopupPlacement = props.caret
            ? placeSuggestionPopup({
                  caretRect: props.caret,
                  containerTop: container.top,
                  containerWidth: container.width,
                  containerHeight: container.height,
                  screenHeight: win?.innerHeight ?? 800,
                  keyboardHeight: 0,
                  popupWidth: width,
                  maxPopupHeight: maxHeight,
              })
            : { placement: 'below', left: 0, top: 0, maxHeight };
        const style =
            placement.placement === 'below'
                ? `position:absolute;left:${placement.left}px;top:${placement.top ?? 0}px;width:${width}px;max-height:${placement.maxHeight}px`
                : `position:absolute;left:${placement.left}px;bottom:${placement.bottom ?? 0}px;width:${width}px;max-height:${placement.maxHeight}px`;
        const id = props.id ?? 'markdown-suggest';
        return (
            <div {...suggestPart('root')} data-state="open" data-placement={placement.placement} data-trigger={session.plugin} style={style} onPointerDown={onPointerDown}>
                <div {...suggestPart('list')} id={id} role="listbox" aria-label="Suggestions" aria-activedescendant={session.items[active] ? `${id}-${active}` : undefined}>
                    {session.items.map((item, i) => (
                        <div
                            key={item.id}
                            {...suggestPart('item')}
                            id={`${id}-${i}`}
                            role="option"
                            aria-selected={i === active ? 'true' : 'false'}
                            data-active={i === active ? '' : undefined}
                            onPointerMove={() => props.onHover?.(i)}
                            onClick={() => props.onPick(item)}
                        >
                            {props.renderItem ? props.renderItem(item, i === active) : item.label}
                        </div>
                    ))}
                    {!session.items.length && session.loading ? <div {...suggestPart('loading')}>Loading…</div> : null}
                    {!session.items.length && !session.loading ? <div {...suggestPart('empty')}>No results</div> : null}
                </div>
            </div>
        );
    };
});
