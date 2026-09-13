/**
 * A plain client-side SignalX app. `sigx()` keeps `@sigx/reactivity` a single
 * module instance (it aliases every installed `@sigx/*` package and its
 * `exports` subpaths to one built copy — `@sigx/richtext` resolves to
 * `packages/richtext/dist`, so run `pnpm build` at the repo root first).
 */
import { defineConfig } from 'vite';
import sigx from '@sigx/vite';

export default defineConfig({
    // JSX compiles to sigx's runtime, not React's. Vite 8 transforms with
    // oxc, so this is where the import source is declared — tsconfig's
    // `jsxImportSource` only informs the type checker.
    oxc: { jsx: { runtime: 'automatic', importSource: 'sigx' } },
    plugins: [sigx()],
    server: { port: 5173 },
    // The Playwright suite (`playwright.config.ts`) serves the built app here.
    preview: { port: 4173, strictPort: true }
});
