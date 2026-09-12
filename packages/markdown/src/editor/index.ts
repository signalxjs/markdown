/**
 * `@sigx/markdown/editor` — the platform-neutral block-tree editor core.
 *
 * No DOM here: this entry runs in Node, in the browser and on the Lynx
 * background thread. A platform view (`@sigx/markdown/editor/dom`,
 * `@sigx/lynx-markdown/editor`) renders the blocks, implements the
 * `InlineSurface` / `CodeSurface` contracts and wires them through the bridge.
 */

export { createEditor, blocksOf } from './editor.js';
export type { Editor, EditorOptions, EditorListener } from './editor.js';

export {
    createState,
    normalizeDoc,
    buildIndex,
    makeState,
    emptyDoc,
    textSelection,
    blockSelection,
    selectionRange,
    selectionEquals,
    isContainerType,
    EDITABLE_TYPES,
} from './state.js';
export type {
    EditorState,
    EditorSelection,
    TextSelection,
    BlockSelection,
    Point,
    BlockIndex,
    BlockEntry,
    EditorBlock,
    EditorParent,
    CreateStateOptions,
} from './state.js';

export { applyStep, invertStep, applyMove, updateBlock, updateChildren, rekey, rekeyChildren, flatOf, getBlock, StepError } from './steps.js';
export type { Step, StepContext } from './steps.js';

export { applyTransaction, mapSelection, transaction } from './transaction.js';
export type { Transaction, TransactionMeta, TransactionOrigin, AppliedTransaction } from './transaction.js';

export { createHistory } from './history.js';
export type { History, HistoryEntry, HistoryOptions } from './history.js';

export {
    ATOM_CHAR,
    toFlat,
    toInline,
    flatEquals,
    spliceFlat,
    sliceFlat,
    concatFlat,
    marksAt,
    toggleMark as toggleFlatMark,
    addMark,
    removeMark,
    normalizeSpans,
    mergeAdjacent,
    isPhrasingNode,
} from './inline-flat.js';
export type { InlineFlat, InlineSpan, InlineKindSpec, InlineFlatOptions } from './inline-flat.js';

export { createSchema, builtinBlockEditors } from './schema.js';
export type { Schema, BlockEditorSpec, BlockMenuEntry, SurfaceKind } from './schema.js';

export * as commands from './commands.js';
export { commands as commandRegistry, selectedBlockKeys } from './commands.js';
export type { Command, CommandContext, CommandName, Dispatch, ListKind } from './commands.js';

export { keyName, keyNames, normalizeKeyName, canonicalKey } from './keys.js';
export type { KeyEventLike, KeyPlatform } from './keys.js';
export { baseKeymap, resolveKeymap, runKeymap } from './keymap.js';
export type { KeyName, Keymap, KeymapBinding, ResolvedKeymap, HistoryCommand } from './keymap.js';

export { baseInputRules, enterInputRules, applyInputRules, applyEnterRules, isInputRuleEntry, TRIGGER_CHARS } from './input-rules.js';
export type { InputRule, InputRuleContext, EnterRule } from './input-rules.js';

export { toolbarState, defaultToolbarItems } from './toolbar.js';
export type { ToolbarItem, ToolbarState, ToolbarContext } from './toolbar.js';

export { createTriggerSessionManager, placeSuggestionPopup } from './trigger/index.js';
export type {
    TriggerItem,
    TriggerSpec,
    TriggerSelectApi,
    TriggerSession,
    TriggerSessionManager,
    TriggerSessionManagerOptions,
    CaretRect as PopupCaretRect,
    PopupPlacement,
    PlaceSuggestionPopupOptions,
} from './trigger/index.js';

export type {
    InlineSurface,
    InlineSurfaceInit,
    InlineSurfaceEvents,
    CodeSurface,
    CodeSurfaceInit,
    CodeSurfaceEvents,
    AnySurface,
    SurfaceHost,
    PlatformInfo,
    Range,
    CaretRect,
    BoundaryKey,
    SurfaceChangeEvent,
    SurfaceSelectionEvent,
    SurfaceBoundaryEvent,
    SurfacePasteEvent,
} from './surface.js';

export { createInlineBridge, createCodeBridge, diffFlat, clampRange } from './bridge.js';
export type { BridgeHost, InlineBridge, CodeBridge } from './bridge.js';

export { editorSlice } from './plugin.js';
export type { EditorPlugin, EditorPluginSlice } from './plugin.js';
