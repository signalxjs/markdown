/**
 * `@sigx/markdown` — the root entry.
 *
 * Re-exports only: the AST, the plugin contract, the parser and incremental
 * engine, the serializer, the render engine and the stream helper each live in
 * their own folder with an `index.ts` public surface (see AGENTS.md
 * "Packages"). Platform code (`./dom`, `./editor/dom`) never leaks in here, so
 * this entry runs on the web, on Lynx and in the terminal alike.
 */

/** The JSON document format version `toJSON()` writes and `fromJSON()` accepts. */
export const CURRENT_VERSION = 1;
