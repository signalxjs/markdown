/**
 * `@sigx/richtext/testing` — helpers for tests of the package and of
 * consumers: tree normalisation for structural comparison, the streaming
 * harness, fake surfaces and the surface conformance suite. Platform-free;
 * sits on top of every other folder and nothing imports from it. The
 * spec-conformance HTML renderer is `@sigx/richtext-markdown/testing`.
 */

export { strip, stripPositions } from './strip.js';
export { feed, seededChunks } from './feed.js';
export type { FeedEngine } from './feed.js';
export { createFakeInlineSurface, createFakeCodeSurface } from './fake-surface.js';
export type { FakeInlineSurface, FakeCodeSurface, SurfaceCall } from './fake-surface.js';
export { runInlineSurfaceConformance } from './surface-conformance.js';
export type { ConformanceHarness, SurfaceDriver } from './surface-conformance.js';
