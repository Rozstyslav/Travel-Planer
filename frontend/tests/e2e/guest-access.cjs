const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const workspaceMock = require("./workspace-mock.cjs");

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const writes = [];
    const place = { place_id: "geo-1", source_id: "osm:n:1", name: "Town Hall", latitude: 49.84, longitude: 24.03, categories: [] };
    let workspace = workspaceMock([], () => place);
    let expire = false;
    let failSaved = false;
    let currentUser = null;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("tp-trips-v2", JSON.stringify([{ id: 1, name: "Old guest trip", places: [] }]));
      localStorage.setItem("tp-saved-v2", JSON.stringify([{ place_id: "old", name: "Old bookmark" }]));
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/api/auth/login/") {
        currentUser = { id: request.postDataJSON().username === "second" ? 2 : 1, username: request.postDataJSON().username, email: "traveller@example.com" };
        if (request.postDataJSON().username === "second") workspace = workspaceMock([], () => place);
        return reply(200, { access: "test", refresh: "test", user: currentUser });
      }
      if (path === "/api/auth/me/") return reply(200, currentUser);
      if (path === "/api/auth/logout/") return reply(200, {});
      if (path === "/api/auth/token/refresh/") return reply(401, {});
      if (/^\/api\/(projects|saved)\//.test(path)) {
        if (request.method() !== "GET") writes.push(path);
        if (expire) return reply(401, {});
        if (failSaved && path === "/api/saved/") return reply(503, {});
        return workspace(route);
      }
      if (path === "/api/places/geo-1/") return reply(200, place);
      return reply(200, { results: [] });
    });
    const base = process.env.BASE_URL || "http://127.0.0.1:8000";
    const login = async (username = "first") => {
      await page.locator('dialog [name="username"]').fill(username);
      await page.locator('dialog [name="password"]').fill("password");
      await page.locator('dialog button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector("#account-label").textContent === "Account");
    };
    const logout = async () => {
      await page.locator("#account-button").click();
      await page.locator('dialog button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector("#account-label").textContent === "Sign in" && !document.querySelector('dialog').open);
    };
    await page.goto(`${base}/#trips`);
    await page.locator('#trips-view .section-heading [data-action="create-trip"]').waitFor();
    assert.doesNotMatch(await page.locator('#trips-grid').innerText(), /Old guest trip/);
    await page.locator('#trips-view .section-heading [data-action="create-trip"]').click();
    await login();
    await page.locator('dialog [name="name"]').fill("My collection");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator('dialog [data-action="edit-trip"]').waitFor();
    await page.locator('#close-modal').click();
    await logout();
    assert.equal(await page.locator('.trip-card').count(), 0);
    await page.goto(`${base}/#saved`);
    await page.locator('#saved-view [data-workspace-note] [data-action="login"]').waitFor();
    assert.equal(await page.locator('#saved-grid .art-card').count(), 0);
    await page.evaluate(async () => {
      const { showAddPlace } = await import("travel/pages/trips.js");
      await showAddPlace("geo-1");
    });
    assert.match(await page.locator('dialog').innerText(), /Sign in to add this place/);
    await login();
    await page.locator('dialog [name="project_id"]').waitFor();
    await page.locator('dialog button[type="submit"]').click();
    await page.locator('[data-visited]').waitFor();
    await page.locator('#close-modal').click();
    await logout();

    // Cancelling a save prompt must not save later during an unrelated login.
    const writeCount = writes.length;
    await page.evaluate(async () => (await import("travel/pages/saved.js")).toggleSave("geo-1"));
    await page.locator('dialog [name="username"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#account-button').click();
    await login();
    await page.locator('#saved-grid .empty-state').waitFor();
    assert.equal(writes.length, writeCount);
    await page.evaluate(async () => (await import("travel/pages/saved.js")).toggleSave("geo-1"));
    await page.locator('#saved-grid .art-card').waitFor();
    await page.reload();
    await page.locator('#saved-grid .art-card').waitFor();
    await logout();
    await page.locator('#account-button').click();
    await login('second');
    await page.locator('#saved-grid .empty-state').waitFor();
    assert.equal(await page.locator('#saved-grid .art-card').count(), 0);

    // Failed loading is recoverable, and an expired session never falls back to guest writes.
    failSaved = true;
    await page.reload();
    await page.locator('#saved-grid [data-action="retry-saved"]').waitFor();
    failSaved = false;
    await page.locator('#saved-grid [data-action="retry-saved"]').click();
    await page.locator('#saved-grid .empty-state').waitFor();
    await page.locator('[data-nav="trips"]').click();
    await page.locator('#trips-grid [data-action="create-trip"]').click();
    await page.locator('dialog [name="name"]').fill('Expired attempt');
    expire = true;
    await page.locator('dialog button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#account-label').textContent === 'Sign in');
    assert.equal(await page.locator('.trip-card').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tp-trips-v2')).length), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: guest gates, legacy data isolation, create/add continuation, cancelled intent, persistent saves, account switch, retry and expiry.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
