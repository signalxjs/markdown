/**
 * `@sigx/richtext-markdown` — markdown as a `DocumentFormat` for
 * `@sigx/richtext`: the CommonMark + GFM parser, the incremental engine, the
 * serializer, `markdownFormat`, the node specs markdown adds to the standard
 * vocabulary and the markdown syntax-extension contract plugins fill under
 * `formats.markdown`. Platform-free; the editor preset is `./editor` and the
 * spec-conformance HTML renderer `./testing`.
 */

export * from './parser/index.js';
export * from './serializer/index.js';
export * from './plugin/index.js';
export { markdownFormat } from './format.js';
export type { MarkdownFormatOptions } from './format.js';
export { markdownNodes, markdownSchema } from './nodes.js';
export type { DefinitionsEnv } from './nodes.js';
export { collectDefinitions } from './definitions.js';
export { mentionPlugin, mentionMarkdown, mentionSyntax, serializeMention } from './mention.js';
