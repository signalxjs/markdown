/**
 * `@sigx/markdown` — the root entry.
 *
 * Re-exports only: the AST, the plugin contract, the parser and incremental
 * engine, the serializer, the render engine and the stream helper each live in
 * their own folder with an `index.ts` public surface (see AGENTS.md
 * "Packages"). Platform code (`./dom`, `./editor/dom`) never leaks in here, so
 * this entry runs on the web, on Lynx and in the terminal alike.
 */

export * from './ast/index.js';
export * from './schema/index.js';
export * from './document/index.js';
export * from './plugin/index.js';
export * from './parser/index.js';
export * from './serializer/index.js';
export * from './markdown/index.js';
export * from './render/index.js';
export * from './stream/index.js';
export * from './plugins/index.js';
