const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) =>
      route.fulfill({ json: { results: [] } }),
    );
    const base = process.env.BASE_URL || "http://127.0.0.1:8000";
    for (const view of ["trips", "saved", "discover"]) {
      await page.goto(`${base}/#${view}`);
      await page.reload();
      assert.equal(await page.locator(`#${view}-view`).isVisible(), true);
      assert.equal(await page.locator(".view:visible").count(), 1);
    }
    await page.locator('[data-nav="trips"]').click();
    await page.locator("#trips-grid .empty-state").waitFor();
    assert.match(
      await page.locator("#trips-grid").innerText(),
      /It starts with curiosity/,
    );
    await page.locator('#trips-grid [data-action="create-trip"]').click();
    const name = '<img src=x onerror="window.unsafe = true"> & "Trip"';
    const description = "</textarea><script>window.unsafe = true</script>";
    await page.locator('dialog [name="name"]').fill(name);
    await page.locator('dialog [name="description"]').fill(description);
    await page.locator('dialog button[type="submit"]').click();
    await page.locator('dialog [data-action="edit-trip"]').waitFor();
    assert.equal(await page.locator("#modal-title").textContent(), name);
    assert.equal(await page.locator("#trips-grid h2").textContent(), name);
    assert.equal(await page.locator("dialog script").count(), 0);
    assert.equal(await page.evaluate(() => window.unsafe), undefined);
    await page.locator('dialog [data-action="edit-trip"]').click();
    assert.equal(await page.locator('dialog [name="name"]').inputValue(), name);
    assert.equal(
      await page.locator('dialog [name="description"]').inputValue(),
      description,
    );
    await page.locator("#close-modal").click();
    await page.locator('[data-trip-filter="complete"]').click();
    assert.match(
      await page.locator("#trips-grid").innerText(),
      /Nothing here yet/,
    );
    await page.locator('[data-trip-filter="all"]').click();
    assert.equal(await page.locator(".trip-card").count(), 1);
    await page.locator('.trip-card [data-action="trip-detail"]').click();
    await page.locator('dialog [data-action="edit-trip"]').click();
    await page.locator('dialog [name="name"]').fill("Вихідні у Парижі");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator('dialog [data-action="edit-trip"]').waitFor();
    assert.equal(await page.locator('.trip-association-icon').textContent(), "🥐");
    assert.equal(await page.locator('.trip-association-flag').textContent(), "🇫🇷");
    assert.equal(await page.locator('.trip-route-art').count(), 0);
    await page.locator('dialog [data-action="edit-trip"]').click();
    await page.locator('dialog [name="name"]').fill("Somewhere new");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator('dialog [data-action="edit-trip"]').waitFor();
    assert.equal(await page.locator('.trip-association').count(), 0);
    assert.equal(await page.locator('.trip-route-art').count(), 1);
    await page.locator("#close-modal").click();
    await page.locator('[data-nav="saved"]').click();
    await page.locator("#saved-grid .empty-state").waitFor();
    assert.match(
      await page.locator("#saved-grid").innerText(),
      /Save your first place/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: direct navigation, page empty states, trip filters and safe text/form template bindings.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
