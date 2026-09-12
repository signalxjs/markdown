/**
 * `@sigx/markdown/testing` — helpers for tests of the package and of
 * consumers: the spec-conformance HTML renderer, tree normalisation for
 * structural comparison, and the streaming harness. Platform-free; sits on
 * top of every other folder and nothing imports from it.
 */

export { strip, stripPositions } from './strip.js';
export { toHtml } from './html.js';
export type { ToHtmlOptions } from './html.js';
export { feed, seededChunks } from './feed.js';
export type { FeedEngine } from './feed.js';
export { createFakeInlineSurface, createFakeCodeSurface } from './fake-surface.js';
export type { FakeInlineSurface, FakeCodeSurface, SurfaceCall } from './fake-surface.js';
export { runInlineSurfaceConformance } from './surface-conformance.js';
export type { ConformanceHarness, SurfaceDriver } from './surface-conformance.js';
