const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const workspaceMock = require("./workspace-mock.cjs");

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const deletions = [];
    let failDelete = false;
    const trip = { id: 77, name: "Lviv weekend", places: Array.from({ length: 10 }, (_, index) => ({
      id: index + 1, place_id: `geo-${index}`, source_id: `osm:n:${index}`,
      name: `Stop ${index + 1}`, address: "Lviv, Ukraine", latitude: 49.84, longitude: 24.03,
      visited: index === 0, notes: index === 0 ? "A note to remove" : "",
    })) };
    const workspace = workspaceMock([trip]);
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => sessionStorage.setItem("tp-session-v1", JSON.stringify({ access: "test", refresh: "test" })));
    await page.route("**/api/**", async route => {
      const request = route.request();
      if (request.method() === "DELETE") {
        deletions.push(new URL(request.url()).pathname);
        if (failDelete) return route.fulfill({ status: 503, json: {} });
      }
      if (await workspace(route)) return;
      return route.fulfill({ json: { results: [] } });
    });
    const base = process.env.BASE_URL || "http://127.0.0.1:8000";
    const openTrip = () => page.locator('#trips-grid [data-action="trip-detail"]').click();
    const remove = () => page.locator('dialog [data-action="remove-place"]').first().click();
    const confirm = () => page.getByRole("button", { name: "Remove place", exact: true }).click();
    await page.goto(`${base}/#trips`);
    await openTrip();
    assert.ok(await page.locator('dialog [data-action="explore"]').isDisabled());
    await remove();
    assert.match(await page.locator('dialog .modal-description').innerText(), /Stop 1.*Lviv weekend/s);
    await page.getByRole("button", { name: "Keep place" }).click();
    assert.equal(deletions.length, 0);
    assert.equal(await page.locator('dialog .place-row').count(), 10);

    failDelete = true;
    await remove();
    await confirm();
    await page.locator('dialog .form-error').waitFor();
    assert.equal(trip.places.length, 10);
    failDelete = false;
    await confirm();
    await page.locator('dialog .place-row').first().waitFor();
    assert.equal(await page.locator('dialog .place-row').count(), 9);
    assert.match(await page.locator('dialog .place-row h3').first().innerText(), /01 \/ Stop 2/);
    assert.match(await page.locator('dialog .trip-detail-top').innerText(), /Visited 0 of 9/);
    assert.ok(await page.locator('dialog [data-action="explore"]').isEnabled());
    assert.ok(await page.locator('dialog [data-action="delete-trip"]').isEnabled());
    assert.equal(deletions[0], "/api/projects/77/places/1/");
    assert.equal(deletions[1], "/api/projects/77/places/1/");
    await page.locator('#close-modal').click();
    await page.reload();
    await openTrip();
    assert.equal(await page.locator('dialog .place-row').count(), 9);

    await page.setViewportSize({ width: 320, height: 900 });
    assert.ok(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
    await remove();
    assert.ok(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.getByRole("button", { name: "Keep place" }).click();
    for (let remaining = 9; remaining > 0; remaining--) {
      await remove();
      await confirm();
      await page.locator('dialog [data-action="edit-trip"]').waitFor();
      assert.equal(await page.locator('dialog .place-row').count(), remaining - 1);
    }
    await page.getByRole("heading", { name: "Room for new experiences" }).waitFor();
    assert.match(await page.locator('dialog .trip-detail-top').innerText(), /Visited 0 of 0/);
    assert.equal(await page.locator('#trips-grid .trip-card').count(), 1);
    assert.deepEqual(errors, []);
    console.log("PASS: place removal confirmation, cancel, retry, visited counts, capacity, persistence, mobile layout and empty trip.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
