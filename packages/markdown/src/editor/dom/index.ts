/**
 * `@sigx/markdown/editor/dom` — the web block editor: `<MarkdownEditor>`,
 * its chrome, the contenteditable and textarea surfaces, and the DOM pieces
 * of the reference plugins (mention chips).
 */

export { MarkdownEditor } from './MarkdownEditor.js';
export type { MarkdownEditorProps, MarkdownEditorController, MarkdownEditorChange } from './MarkdownEditor.js';
export { BlockView } from './BlockView.js';
export type { BlockViewProps } from './BlockView.js';
export { InlineBlock } from './InlineBlock.js';
export type { InlineBlockProps } from './InlineBlock.js';
export { CodeBlockEditor } from './CodeBlockEditor.js';
export type { CodeBlockEditorProps } from './CodeBlockEditor.js';
export { EditorToolbar } from './Toolbar.js';
export type { EditorToolbarProps, ToolbarRenderItem } from './Toolbar.js';
export { BlockMenu } from './BlockMenu.js';
export { SuggestionPopup } from './SuggestionPopup.js';
export type { SuggestionPopupProps, SuggestionRenderItem } from './SuggestionPopup.js';

export { useEditorView, createEditorView } from './context.js';
export type { EditorView, CreateViewOptions, BlockMenuRequest } from './context.js';

export { createDomInlineSurface } from './inline-surface.js';
export type { DomInlineSurface, DomInlineSurfaceOptions } from './inline-surface.js';
export { createDomCodeSurface } from './code-surface.js';
export type { DomCodeSurface, DomCodeSurfaceOptions } from './code-surface.js';
export { renderInline, readInline, offsetToPoint, pointToOffset, hostLength, nodeLength, defaultAtomRenderer, ATOM_ATTR, MARK_ATTR, BREAK_ATTR, ATTRS_ATTR } from './inline-dom.js';
export type { AtomRenderer, RenderOptions, DomPoint } from './inline-dom.js';
export { selectionFor, rangeIn, caretClientRect, relativeCaretRect, onEdgeLine, pointFromClient } from './selection.js';

export { createDomMentionPlugin, mentionChip } from './mention.js';
export type { DomMentionOptions } from './mention.js';
export { domEditorSlice, pluginAtomRenderers } from './plugin-atoms.js';
export type { DomEditorSlice } from './plugin-atoms.js';

export {
    EDITOR_SCOPE,
    TOOLBAR_SCOPE,
    BLOCK_MENU_SCOPE,
    SUGGEST_SCOPE,
    editorPart,
    toolbarPart,
    blockMenuPart,
    suggestPart,
    scopedPart,
} from './anatomy.js';
export type { EditorPart, ToolbarPart, BlockMenuPart, SuggestPart, ScopedPartAttrs } from './anatomy.js';
