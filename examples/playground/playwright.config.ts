/**
 * Playwright config for the playground e2e suite.
 *
 * Serves the BUILT app (`vite preview`), so build first — locally
 * `pnpm build && pnpm --filter playground-example build`, in CI the `e2e`
 * job does exactly that before `pnpm --filter playground-example e2e`.
 * Chromium only: the suite checks the markdown DOM, not browser quirks.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'pnpm preview',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000
    }
});
