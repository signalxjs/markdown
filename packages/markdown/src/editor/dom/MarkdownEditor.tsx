/**
 * `<MarkdownEditor>` — the web block editor.
 *
 * One `createEditor()` instance per component; every root block renders as
 * a keyed `<BlockView>`, so structural sharing in the state means an
 * untouched block is never re-rendered or re-mounted. Two-way binding through
 * the `markdown` (string) and `document` (mdast `Root`) models — bind either
 * or both; the editor writes back after every committed transaction and
 * ignores its own echo. Toolbar, block handles + menu, slash commands and
 * mention suggestions are the built-in chrome; every element carries
 * `data-scope` / `data-part` attributes for styling.
 *
 * On the server (and before mount) the same document renders through
 * `<MarkdownView>`, so SSR output is the read-only markup.
 *
 * @example
 * ```tsx
 * const state = signal({ md: '# Hi' });
 * <MarkdownEditor model:markdown={[state, 'md']} placeholder="Write…" />
 * ```
 */

import { signal as createSignal, watch } from '@sigx/reactivity';
import { component, mergeProps, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { defineProvide } from '@sigx/runtime-core';
import type { Root } from '../../ast/index.js';
import { createDomComponents, MarkdownView, type DomMarkdownComponents } from '../../dom/index.js';
import { parseMarkdown } from '../../parser/index.js';
import type { MarkdownPlugin } from '../../plugin/index.js';
import { toMarkdown } from '../../serializer/index.js';
import { deleteBlock, escapeToText, focusEnd, focusNeighbour, selectedBlockKeys, type Command } from '../commands.js';
import { createEditor, type Editor } from '../editor.js';
import type { InputRule } from '../input-rules.js';
import { keyNames } from '../keys.js';
import type { Keymap } from '../keymap.js';
import type { EditorSelection, EditorState } from '../state.js';
import { textSelection } from '../state.js';
import type { ToolbarItem } from '../toolbar.js';
import type { Transaction } from '../transaction.js';
import { createTriggerSessionManager, type TriggerItem, type TriggerSelectApi, type TriggerSession, type TriggerSessionManager } from '../trigger/index.js';
import { commands as commandRegistry } from '../commands.js';
import { editorPart, flag } from './anatomy.js';
import { BlockView } from './BlockView.js';
import { BlockMenu } from './BlockMenu.js';
import { createEditorView, useEditorView, type EditorView } from './context.js';
import { track } from './context.js';
import type { AtomRenderer } from './inline-dom.js';
import { defaultAtomRenderer } from './inline-dom.js';
import { SuggestionPopup, type SuggestionRenderItem } from './SuggestionPopup.js';
import { EditorToolbar, type ToolbarRenderItem } from './Toolbar.js';
import { pluginAtomRenderers } from './plugin-atoms.js';

export interface MarkdownEditorChange {
    markdown: string;
    document: Root;
    transaction: Transaction;
}

/** The imperative API exposed through `ref`. */
export interface MarkdownEditorController {
    readonly editor: Editor;
    getMarkdown(): string;
    getDocument(): Root;
    setMarkdown(markdown: string): void;
    setDocument(doc: Root): void;
    /** Run a command (a function or a registered name). */
    run(command: Command | string): boolean;
    focus(target?: 'start' | 'end'): void;
    blur(): void;
    clear(): void;
    undo(): boolean;
    redo(): boolean;
}

export type MarkdownEditorProps = Define.WithAttrs<
    /** Two-way bound markdown source. */
    & Define.Model<'markdown', string>
    /** Two-way bound mdast document (wins over `markdown` for the initial value). */
    & Define.Model<'document', Root>
    & Define.Prop<'defaultMarkdown', string>
    & Define.Prop<'defaultDocument', Root>
    /** Plugins (syntax, serializer, components and editor slices). Captured at mount. */
    & Define.Prop<'plugins', readonly MarkdownPlugin[]>
    /** Components for void blocks and the SSR/read-only rendering (overrides of the default DOM map). */
    & Define.Prop<'components', Partial<DomMarkdownComponents>>
    /** Extra atom renderers by node type (images, mentions, plugin atoms). */
    & Define.Prop<'atoms', Record<string, AtomRenderer>>
    /** `true` / `'top'` renders the toolbar above the content, `'bottom'` below, `false` none. Default `true`. */
    & Define.Prop<'toolbar', boolean | 'top' | 'bottom'>
    & Define.Prop<'toolbarItems', readonly ToolbarItem[]>
    & Define.Prop<'renderToolbarItem', ToolbarRenderItem>
    & Define.Prop<'renderSuggestion', SuggestionRenderItem>
    /** Block handles (the ⋮⋮ button opening the block menu). Default `true`. */
    & Define.Prop<'blockHandles', boolean>
    & Define.Prop<'readOnly', boolean>
    & Define.Prop<'placeholder', string>
    & Define.Prop<'autofocus', boolean>
    /** Extra keymap layered over the base and plugin keymaps. */
    & Define.Prop<'keymap', Keymap>
    /** `false` disables input rules; an array replaces the base set. */
    & Define.Prop<'inputRules', readonly InputRule[] | false>
    & Define.Prop<'onChange', (e: MarkdownEditorChange) => void>
    & Define.Prop<'onSelectionChange', (selection: EditorSelection) => void>
    & Define.Event<'ready', MarkdownEditorController>
>;

const OWN_PROPS = [
    'markdown',
    'document',
    'defaultMarkdown',
    'defaultDocument',
    'plugins',
    'components',
    'atoms',
    'toolbar',
    'toolbarItems',
    'renderToolbarItem',
    'renderSuggestion',
    'blockHandles',
    'readOnly',
    'placeholder',
    'autofocus',
    'keymap',
    'inputRules',
    'onChange',
    'onSelectionChange',
    'onReady',
] as const;

const clone = <T,>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T;

function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
    return /mac|iphone|ipad|ipod/i.test(p);
}

/** Keys the editor root handles itself while a block selection is active (the surfaces are blurred then). */
const BLOCK_KEYS: Record<string, Command> = {
    Backspace: deleteBlock,
    Delete: deleteBlock,
    Enter: escapeToText,
};

export const MarkdownEditor = component<MarkdownEditorProps, MarkdownEditorController>(({ props, expose, emit, onMounted, onUnmounted, signal }) => {
    const plugins = props.plugins ?? [];
    const parse = (md: string): Root => parseMarkdown(md, { plugins });
    const serialize = (doc: Root): string => toMarkdown(doc, { plugins });

    let rootEl: HTMLElement | null = null;
    const mounted = signal(false);
    let lastEmittedMarkdown: string | null = null;
    let lastEmittedDoc: Root | null = null;

    // -- the view context -------------------------------------------------

    const atoms = new Map<string, AtomRenderer>([['image', imageAtom], ...pluginAtomRenderers(plugins)]);
    for (const [type, render] of Object.entries(props.atoms ?? {})) atoms.set(type, render);

    const defaults = createDomComponents({});
    const components = (): DomMarkdownComponents => (props.components ? { ...defaults, ...props.components } : defaults);

    let view!: EditorView;

    const offsetAt = (key: string, edge: 'first' | 'last'): number => {
        const s = view.surfaces.get(key);
        if (!s) return edge === 'first' ? 0 : Number.MAX_SAFE_INTEGER;
        if ('offsetAtX' in s && view.goalX !== undefined) return s.offsetAtX(edge, view.goalX);
        return edge === 'first' ? 0 : Number.MAX_SAFE_INTEGER;
    };

    const editor = createEditor({
        doc: clone(props.document?.value ?? props.defaultDocument ?? parse(props.markdown?.value ?? props.defaultMarkdown ?? '')),
        plugins,
        keymap: { ArrowUp: focusNeighbour('up', offsetAt), ArrowDown: focusNeighbour('down', offsetAt), ...props.keymap },
        inputRules: props.inputRules,
        platform: { isMac: isMacPlatform(), hasHardwareKeyboard: true, caretRectSpace: 'editor' },
        parse,
        readOnly: props.readOnly ?? false,
        onChange: ({ state, transaction }) => {
            const doc = state.doc;
            lastEmittedDoc = doc;
            let md: string | null = null;
            const markdown = (): string => (md ??= serialize(doc));
            if (props.markdown) {
                lastEmittedMarkdown = markdown();
                props.markdown.value = lastEmittedMarkdown;
            }
            if (props.document) props.document.value = doc;
            if (props.onChange) props.onChange({ markdown: markdown(), document: doc, transaction });
        },
        onSelectionChange: (selection) => props.onSelectionChange?.(selection),
    });

    view = createEditorView({
        editor,
        atoms,
        root: () => rootEl,
        readOnly: () => editor.readOnly,
        placeholder: () => props.placeholder,
        handles: () => props.blockHandles !== false && !editor.readOnly,
        components,
    });
    defineProvide(useEditorView, () => view);

    // -- models in -----------------------------------------------------------

    watch(
        () => props.markdown?.value,
        (md) => {
            if (typeof md !== 'string' || md === lastEmittedMarkdown) return;
            lastEmittedMarkdown = md;
            editor.setMarkdown(md);
        },
    );
    watch(
        () => props.document?.value,
        (doc) => {
            if (!doc || doc === lastEmittedDoc || doc === editor.state.doc) return;
            editor.setDocument(clone(doc));
        },
    );
    watch(
        () => props.readOnly ?? false,
        (ro) => {
            if (editor.readOnly !== ro) {
                editor.readOnly = ro;
                for (const s of view.surfaces.values()) s.setReadOnly(ro);
            }
        },
    );

    // -- trigger sessions ----------------------------------------------------

    let session: TriggerSession | null = null;
    const sessionRev = createSignal(0);
    const active = createSignal(0);
    const triggers: TriggerSessionManager | null = editor.triggers.length
        ? createTriggerSessionManager({
              triggers: editor.triggers,
              onUpdate: (s) => {
                  session = s;
                  sessionRev.value++;
                  if (!s) active.value = 0;
                  else if (active.value >= s.items.length) active.value = Math.max(0, s.items.length - 1);
              },
          })
        : null;

    const pick = (item: TriggerItem): void => {
        const s = session;
        if (!s || !triggers) return;
        const spec = editor.triggers.find((t) => t.plugin === s.plugin)?.spec;
        if (!spec) return;
        const api: TriggerSelectApi = {
            replaceQuery(slice) {
                editor.dispatch({
                    steps: [{ type: 'replaceInline', key: s.key, from: s.anchor, to: s.caret, slice }],
                    selection: textSelection(s.key, s.anchor + slice.text.length),
                    meta: { origin: 'command' },
                });
            },
            range: { key: s.key, from: s.anchor, to: s.caret },
            commands: commandRegistry,
            dispatch: editor.dispatch,
            state: editor.state,
            run: (command) => editor.run(command),
        };
        triggers.close();
        spec.onSelect(item, api);
    };

    const stopListen = editor.listen((tr, state) => {
        syncTriggers(state);
        // A block selection moves keyboard focus to the root (surfaces blur).
        if (state.selection?.mode === 'block' && view.hasFocus() && tr.meta.origin !== 'external') view.focusRoot();
    });

    function syncTriggers(state: EditorState): void {
        if (!triggers) return;
        const sel = state.selection;
        if (sel?.mode === 'text') {
            const flat = editor.flatOf(sel.anchor.key);
            if (flat) {
                triggers.syncText(sel.anchor.key, flat.text);
                triggers.syncCaret(sel.anchor.key, sel.anchor.offset === sel.head.offset ? sel.anchor.offset : -1);
                return;
            }
        }
        triggers.close();
    }

    // -- root events ---------------------------------------------------------

    const onCaptureKeydown = (e: KeyboardEvent): void => {
        const s = session;
        if (!s || e.isComposing) return;
        switch (e.key) {
            case 'ArrowDown':
                if (s.items.length) active.value = (active.value + 1) % s.items.length;
                break;
            case 'ArrowUp':
                if (s.items.length) active.value = (active.value - 1 + s.items.length) % s.items.length;
                break;
            case 'Enter':
            case 'Tab': {
                const item = s.items[active.value];
                if (!item) {
                    triggers?.close();
                    return;
                }
                pick(item);
                break;
            }
            case 'Escape':
                triggers?.close();
                break;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    };

    const onRootKeydown = (e: KeyboardEvent): void => {
        if (e.target !== rootEl || editor.readOnly) return;
        const sel = editor.state.selection;
        if (sel?.mode === 'block') {
            const direct = BLOCK_KEYS[e.key];
            if (direct && !e.ctrlKey && !e.metaKey && !e.altKey) {
                if (editor.run(direct)) e.preventDefault();
                return;
            }
        }
        for (const name of keyNames(e, editor.platform)) {
            if (editor.runKey(name)) {
                e.preventDefault();
                return;
            }
        }
    };

    const onContentPointerDown = (e: PointerEvent): void => {
        // A click in the empty space below the last block puts the caret at the end.
        if (e.target !== e.currentTarget || editor.readOnly) return;
        e.preventDefault();
        editor.run(focusEnd);
        const sel = editor.state.selection;
        if (sel?.mode === 'text') view.focusBlock(sel.anchor.key, { edge: 'end' });
    };

    const onCopy = (e: ClipboardEvent): void => {
        const sel = editor.state.selection;
        if (sel?.mode !== 'block' || !e.clipboardData) return;
        const keys = new Set(selectedBlockKeys(editor.state));
        const blocks = editor.state.doc.children.filter((b) => keys.has(b.key!));
        const md = serialize({ type: 'root', children: blocks });
        e.clipboardData.setData('text/markdown', md);
        e.clipboardData.setData('text/plain', md);
        e.preventDefault();
    };

    const onCut = (e: ClipboardEvent): void => {
        if (editor.state.selection?.mode !== 'block' || editor.readOnly) return;
        onCopy(e);
        editor.run(deleteBlock);
    };

    const onFocusIn = (): void => view.focusIn();
    const onFocusOut = (): void => {
        view.focusOut();
        setTimeout(() => {
            if (!view.hasFocus()) {
                triggers?.close();
                view.closeBlockMenu();
            }
        }, 0);
    };

    const setRoot = (el: HTMLElement | null): void => {
        if (rootEl === el) return;
        rootEl?.removeEventListener('keydown', onCaptureKeydown, true);
        rootEl = el;
        el?.addEventListener('keydown', onCaptureKeydown, true);
    };

    // -- controller ------------------------------------------------------------

    const controller: MarkdownEditorController = {
        editor,
        getMarkdown: () => serialize(editor.state.doc),
        getDocument: () => editor.state.doc,
        setMarkdown: (md) => void editor.setMarkdown(md),
        setDocument: (doc) => editor.setDocument(clone(doc)),
        run: (command) => editor.run(command),
        focus: (target = 'end') => {
            const cmd = target === 'start' ? commandRegistry.focusStart : focusEnd;
            editor.run(cmd);
            const sel = editor.state.selection;
            if (sel?.mode === 'text') view.focusBlock(sel.anchor.key, { edge: target });
            else view.focusRoot();
        },
        blur: () => {
            const activeEl = rootEl?.ownerDocument.activeElement as HTMLElement | null;
            if (activeEl && rootEl?.contains(activeEl)) activeEl.blur();
        },
        clear: () => void editor.run(commandRegistry.clear),
        undo: () => editor.undo(),
        redo: () => editor.redo(),
    };
    expose(controller);

    onMounted(() => {
        mounted.value = true;
        emit('ready', controller);
        if (props.autofocus) queueMicrotask(() => controller.focus('end'));
    });

    onUnmounted(() => {
        stopListen();
        triggers?.close();
        setRoot(null);
        editor.destroy();
    });

    const rootAttrs = mergeProps(
        () => {
            const rest: Record<string, unknown> = { ...props };
            for (const key of OWN_PROPS) delete rest[key];
            delete rest['model:markdown'];
            delete rest['model:document'];
            return rest;
        },
        () => editorPart('root'),
    );

    return (): JSXElement => {
        if (!mounted.value) {
            track(editor.rev.value);
            return (
                <div {...rootAttrs} data-readonly="" data-ssr="">
                    <MarkdownView root={editor.state.doc} plugins={plugins} components={props.components} />
                </div>
            );
        }
        track(editor.rev.value, editor.selRev.value);
        const state = editor.state;
        const toolbar = props.toolbar ?? true;
        const bar = toolbar ? <EditorToolbar items={props.toolbarItems} renderItem={props.renderToolbarItem} /> : null;
        track(sessionRev.value);
        const s = session;
        const caret = s ? (view.surfaces.get(s.key) as { caretRect?: () => { x: number; y: number; height: number } | null } | undefined)?.caretRect?.() ?? null : null;
        const rect = rootEl?.getBoundingClientRect();
        const selectedCount = state.selection?.mode === 'block' ? selectedBlockKeys(state).length : 0;
        return (
            <div
                {...rootAttrs}
                ref={setRoot}
                tabIndex={-1}
                style="position:relative"
                data-readonly={flag(editor.readOnly)}
                data-mode={state.selection?.mode ?? 'none'}
                data-composing={flag(state.composing)}
                onKeyDown={onRootKeydown}
                onFocusIn={onFocusIn}
                onFocusOut={onFocusOut}
                onCopy={onCopy}
                onCut={onCut}
            >
                {toolbar === true || toolbar === 'top' ? bar : null}
                <div {...editorPart('content')} onPointerDown={onContentPointerDown}>
                    {state.doc.children.map((block) => (
                        <BlockView key={block.key} block={block} />
                    ))}
                </div>
                {toolbar === 'bottom' ? bar : null}
                <BlockMenu />
                {s ? (
                    <SuggestionPopup
                        session={s}
                        active={active.value}
                        caret={caret}
                        container={rect ? { width: rect.width, height: rect.height, top: rect.top } : undefined}
                        onPick={pick}
                        onHover={(i) => (active.value = i)}
                        renderItem={props.renderSuggestion}
                    />
                ) : null}
                <div {...editorPart('live')} aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">
                    {selectedCount ? `${selectedCount} block${selectedCount === 1 ? '' : 's'} selected` : ''}
                </div>
            </div>
        );
    };
});

/** The default image atom: an `<img>` chip with the alt text as its label. */
function imageAtom(span: { attrs?: Record<string, string> }, d: Document): HTMLElement {
    const el = d.createElement('span');
    const img = d.createElement('img');
    img.setAttribute('src', span.attrs?.url ?? '');
    img.setAttribute('alt', span.attrs?.alt ?? '');
    if (span.attrs?.title) img.setAttribute('title', span.attrs.title);
    img.setAttribute('loading', 'lazy');
    el.appendChild(img);
    return el;
}

export { defaultAtomRenderer };
