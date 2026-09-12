import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const __dirname = import.meta.dirname;

export default defineConfig({
    // `__DEV__` is the compile-time dev flag package sources guard on; the build
    // (vite.config.ts) replaces it in the dists, so tests must define it too.
    define: {
        __DEV__: 'true'
    },
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx'
        }
    },
    test: {
        environment: 'happy-dom',
        include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**'],
        globals: true,
        typecheck: {
            enabled: true,
            include: ['packages/**/__tests__/**/*.test-d.ts']
        },
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**/*.{ts,tsx}'],
            exclude: ['**/*.d.ts', '**/index.ts']
        }
    },
    resolve: {
        // Subpaths before the bare name: vitest matches aliases in order and a
        // bare `@sigx/markdown` entry first would swallow `@sigx/markdown/dom`.
        alias: [
            { find: '@sigx/markdown/dom', replacement: resolve(__dirname, 'packages/markdown/src/dom/index.ts') },
            { find: '@sigx/markdown/shiki', replacement: resolve(__dirname, 'packages/markdown/src/shiki/index.ts') },
            { find: '@sigx/markdown/editor', replacement: resolve(__dirname, 'packages/markdown/src/editor/index.ts') },
            { find: '@sigx/markdown/testing', replacement: resolve(__dirname, 'packages/markdown/src/testing/index.ts') },
            { find: /^@sigx\/markdown$/, replacement: resolve(__dirname, 'packages/markdown/src/index.ts') }
        ]
    }
});
