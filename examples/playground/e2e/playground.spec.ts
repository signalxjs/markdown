import { expect, test, type Page } from '@playwright/test';

/** `data-part` → count, for every descendant of `#<id>` (the root itself excluded). */
async function partCounts(page: Page, id: string): Promise<Record<string, number>> {
    return page.locator(`#${id} [data-part]`).evaluateAll((els) => {
        const counts: Record<string, number> = {};
        for (const el of els) {
            const part = el.getAttribute('data-part')!;
            counts[part] = (counts[part] ?? 0) + 1;
        }
        return counts;
    });
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#static[data-part="root"]')).toBeVisible();
});

test('renders the sample document', async ({ page }) => {
    const view = page.locator('#static');
    await expect(view.locator('[data-part="heading"][data-depth="1"]')).toHaveText('@sigx/richtext playground');
    await expect(view.locator('[data-part="table"]')).toHaveCount(1);
    await expect(view.locator('[data-part="code"][data-lang="ts"]')).toHaveCount(1);
    // The mention plugin is on by default: `@[Andy](u1)` renders through the app's slot.
    await expect(view.locator('[data-part="mention"]')).toHaveText('@Andy');
    // A task list renders checkboxes.
    await expect(view.locator('[data-part="list-item"][data-task]')).toHaveCount(3);
});

test('streaming keeps block identity and ends with the static structure', async ({ page }) => {
    await expect(page.getByTestId('stream-status')).toHaveText('idle');
    await page.getByTestId('stream-start').click();
    await expect(page.getByTestId('stream-status')).toHaveText('streaming');

    // Tag the first paragraph as soon as the live parse produces it.
    const firstParagraph = page.locator('#streamed [data-part="paragraph"]').first();
    await expect(firstParagraph).toBeAttached();
    await firstParagraph.evaluate((el) => {
        (el as HTMLElement & { __probe?: number }).__probe = 1;
    });

    // The whole sample streams in ~5s at 3 chars / 16ms.
    await expect(page.getByTestId('stream-status')).toHaveText('done', { timeout: 20_000 });

    // Same element: the block was finalized in place, never re-mounted.
    const probe = await firstParagraph.evaluate((el) => (el as HTMLElement & { __probe?: number }).__probe);
    expect(probe).toBe(1);

    // And the streamed tree is structurally the static tree.
    const streamed = await partCounts(page, 'streamed');
    const stat = await partCounts(page, 'static');
    expect(streamed).toEqual(stat);
    expect(await page.locator('#streamed').innerText()).toBe(await page.locator('#static').innerText());
});

test('Shiki highlights the ts fence when toggled on', async ({ page }) => {
    const body = page.locator('#static [data-part="code"][data-lang="ts"] [data-part="code-body"]');
    await expect(body.locator('span[data-line]')).toHaveCount(0);

    await page.getByTestId('toggle-shiki').check();

    // shiki (and its grammars) load lazily on the first toggle.
    await expect(body.locator('span[data-line]').first()).toBeAttached({ timeout: 20_000 });
    expect(await body.locator('span[data-line]').count()).toBeGreaterThanOrEqual(4);
    expect(await body.locator('span[data-line] span[style*="color"]').count()).toBeGreaterThan(0);
    // Highlighting never changes the text.
    await expect(body).toContainText('export function greet(name: string): string {');
});

test('the copy button puts the fence content on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const block = page.locator('#static [data-part="code"][data-lang="ts"]');
    const expected = await block.locator('[data-part="code-body"]').evaluate((el) => el.textContent);
    expect(expected).toContain('export function greet');

    const button = block.locator('[data-part="copy"]');
    await expect(button).toHaveText('Copy');
    await button.click();
    await expect(button).toHaveText('Copied');

    // Chromium on Windows hands plain text to the system clipboard with CRLF
    // line endings; the component wrote exactly `value`.
    const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(clipboard).toBe(expected);
});

test('onLink intercepts link clicks instead of navigating', async ({ page }) => {
    const before = page.url();
    const link = page.locator('#static [data-part="link"]').first();
    const href = await link.getAttribute('href');
    expect(href).toBe('https://sigx.dev/markdown/');

    await link.click();

    await expect(page.getByTestId('last-link')).toHaveText('https://sigx.dev/markdown/');
    expect(page.url()).toBe(before);
    // Still the same document — nothing navigated.
    await expect(page.locator('#static[data-part="root"]')).toBeVisible();
});
