const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = process.env.BASE_URL || "http://127.0.0.1:8000";
  const output = path.resolve(__dirname, "../../../docs/previews");
  fs.mkdirSync(output, { recursive: true });
  const city = {
    place_id: "city-1",
    name: "Lviv",
    address: "Lviv, Ukraine",
    country_code: "UA",
    city: "Lviv",
    region: "Lviv Oblast",
    latitude: 49.84,
    longitude: 24.03,
  };
  const place = {
    ...city,
    place_id: "geo-1",
    source_id: "osm:n:1",
    name: "Lviv Town Hall",
    categories: ["tourism.sights"],
    description: "A historic building in central Lviv.",
    image_url: "https://upload.wikimedia.org/test-place.png",
    image_source_url: "https://commons.wikimedia.org/wiki/File:Test-place.png",
    wikipedia_url: "https://en.wikipedia.org/wiki/Lviv",
    wikipedia_title: "Lviv Town Hall",
    wikipedia_match: "linked",
    wikipedia_status: "found",
    image_match: "search",
  };
  const country = {
    code: "UA",
    name: "Ukraine",
    native: "Україна",
    emoji: "🇺🇦",
    capital: "Kyiv",
    currency: "UAH",
    languages: [{ name: "Ukrainian", native: "Українська" }],
  };
  const serverProject = {
    id: 77,
    name: "Shared trip",
    description: "",
    start_date: null,
    places: [],
  };
  let refreshRequests = 0;
  let placeQueries = [];
  let failCities = false;
  let detailRequests = 0;
  await page.route("https://upload.wikimedia.org/test-place.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const reply = (status, body) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/countries/")
      return reply(200, { results: [country] });
    if (url.pathname === "/api/countries/UA/") return reply(200, country);
    if (url.pathname === "/api/cities/")
      return failCities
        ? reply(503, { provider: "Geoapify", code: "provider_unavailable" })
        : reply(200, {
            results: [
              city,
              {
                ...city,
                place_id: "city-2",
                region: "Dnipropetrovsk Oblast",
                latitude: 47.861591,
                longitude: 33.551559,
              },
              {
                ...city,
                place_id: "city-3",
                region: "Mykolaiv Oblast",
                latitude: 47.8922869,
                longitude: 31.091311,
              },
            ],
          });
    if (url.pathname === "/api/places/") {
      placeQueries.push(url.searchParams.get("categories"));
      return reply(200, {
        results: [
          { ...place, image_url: "", description: "" },
          {
            ...place,
            place_id: "duplicate",
            source_id: "osm:r:2",
            image_url: "",
            description: "",
          },
        ],
        has_more: false,
      });
    }
    if (url.pathname === "/api/places/geo-1/") {
      detailRequests++;
      return reply(200, place);
    }
    if (url.pathname === "/api/wikipedia/")
      return reply(200, {
        found: true,
        title: "Lviv",
        description: "A city with a rich history.",
        image_url: "",
        url: "https://en.wikipedia.org/wiki/Lviv",
        match: "search",
      });
    if (url.pathname === "/api/auth/token/")
      return reply(200, { access: "expired", refresh: "refresh-one" });
    if (url.pathname === "/api/auth/token/refresh/") {
      refreshRequests += 1;
      return reply(200, { access: "fresh", refresh: "refresh-two" });
    }
    if (url.pathname === "/api/auth/logout/") return reply(200, {});
    if (req.headers().authorization !== "Bearer fresh") return reply(401, {});
    if (url.pathname === "/api/projects/") return reply(200, [serverProject]);
    if (
      url.pathname === "/api/projects/77/places/" &&
      req.method() === "POST"
    ) {
      assert.deepEqual(req.postDataJSON(), { place_id: "geo-1" });
      const item = { ...place, id: 18, notes: "", visited: false };
      serverProject.places.push(item);
      return reply(201, item);
    }
    if (
      url.pathname === "/api/projects/77/places/18/" &&
      req.method() === "PATCH"
    ) {
      Object.assign(serverProject.places[0], req.postDataJSON());
      return reply(200, serverProject.places[0]);
    }
    return reply(404, {});
  });
  try {
    await page.goto(base);
    await page.locator("#country-info strong").waitFor();
    assert.match(await page.locator("#country-info").textContent(), /UAH/);
    await page.locator("#city-query").fill("Lviv");
    await page.locator("#destination-form button").click();
    await page.locator('.city-primary [data-action="select-city"]').waitFor();
    assert.equal(await page.locator(".city-option:visible").count(), 1);
    assert.match(
      await page.locator(".city-primary").textContent(),
      /Lviv Oblast/,
    );
    await page.locator(".other-cities summary").click();
    assert.equal(await page.locator(".city-option:visible").count(), 3);
    assert.match(
      await page.locator(".other-cities").textContent(),
      /Dnipropetrovsk Oblast/,
    );
    await page.locator(".other-cities summary").click();
    await page.locator('[data-action="select-city"]').first().click();
    await page.locator("#places-grid .art-card").waitFor();
    await page.locator("#places-grid .art-card").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const img = document.querySelector("#places-grid .art-image-button img");
      return img?.complete && img.naturalWidth > 0 && !img.dataset.fallback;
    });
    assert.equal(detailRequests, 1, "Cards load photos automatically");
    assert.match(
      await page.locator("#places-grid .card-image-credit").textContent(),
      /Photo found by name/,
    );
    const maps = new URL(
      await page.locator("#places-grid .coordinates-link").getAttribute("href"),
    );
    assert.equal(maps.origin, "https://www.openstreetmap.org");
    assert.equal(maps.searchParams.get("mlat"), "49.84");
    assert.equal(maps.searchParams.get("mlon"), "24.03");
    assert.equal(maps.hash, "#map=17/49.84/24.03");
    assert.equal(
      await page.locator("#places-grid .art-card").count(),
      1,
      "Duplicate provider records show one card",
    );
    assert.equal(placeQueries[0], "tourism.sights");
    await page.locator('[data-category="leisure.park"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#places-grid .art-card"),
    );
    assert.ok(placeQueries.includes("leisure.park"));
    assert.equal(detailRequests, 1, "Category changes reuse cached details");
    await page.locator('#places-grid [data-action="save"]').click();
    await page.locator('[data-nav="saved"]').click();
    assert.equal(await page.locator("#saved-grid .art-card").count(), 1);
    await page.reload();
    assert.equal(await page.locator("#saved-grid .art-card").count(), 1);
    await page
      .locator('#saved-grid [data-action="place-detail"]')
      .first()
      .click();
    await page.locator('dialog [data-action="add-place"]').waitFor();
    assert.ok(
      (
        await page.locator("dialog .coordinates-link").getAttribute("href")
      ).includes("openstreetmap.org/"),
    );
    assert.match(
      await page.locator("dialog").textContent(),
      /A historic building/,
    );
    assert.equal(
      await page
        .locator(
          'dialog a[href*="creativecommons.org"], dialog a[href*="commons.wikimedia.org"], dialog a[href*="wikipedia.org"]',
        )
        .count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator("dialog").textContent(),
      /Photo found by name|source and licence|contributors · source/,
    );
    await page.locator('dialog [data-action="add-place"]').click();
    await page.locator('[data-action="create-with-place"]').click();
    await page.locator('[name="name"]').fill("Weekend in Lviv");
    await page
      .locator('textarea[name="description"]')
      .fill("A walk through the old town.");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator("[data-visited]").waitFor();
    assert.equal(await page.locator(".place-row .coordinates-link").count(), 1);
    await page.locator('[data-action="edit-notes"]').click();
    await page
      .locator('[name="notes"]')
      .fill("<script>unsafe()</script> Climb the tower.");
    await page.locator('dialog button[type="submit"]').click();
    assert.equal(await page.locator(".place-notes script").count(), 0);
    await page.locator("[data-visited]").check();
    assert.equal(
      await page.locator('[data-action="delete-trip"]').isDisabled(),
      true,
    );
    await page.locator('[data-action="edit-notes"]').click();
    await page
      .locator('[name="notes"]')
      .fill("Climb the tower for a view over the city.");
    await page.locator('dialog button[type="submit"]').click();
    await page.screenshot({ path: path.join(output, "trip-detail.png") });
    await page.locator("#close-modal").click();
    await page.reload();
    await page.locator('[data-action="trip-detail"]').click();
    assert.equal(await page.locator("[data-visited]").isChecked(), true);
    await page.locator("[data-visited]").uncheck();
    await page.locator('[data-action="delete-trip"]').click();
    await page.locator('dialog button[type="submit"]').click();
    assert.equal(await page.locator(".trip-card").count(), 0);

    await page.locator("#account-button").click();
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator("#account-button")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.locator("#account-button").click();
    await page.locator('[name="username"]').fill("browser-test");
    await page.locator('[name="password"]').fill("not-a-real-password");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator(".trip-card").waitFor();
    assert.equal(refreshRequests, 1);
    await page.locator('[data-action="trip-detail"]').click();
    await page.locator('[data-action="pick-place"]').click();
    await page.locator('[data-action="pick-result"]').click();
    await page.locator("[data-visited]").check();
    assert.equal(serverProject.places[0].visited, true);
    await page.locator("#close-modal").click();
    await page.locator("#account-button").click();
    await page.locator('dialog button[type="submit"]').click();
    await page.waitForFunction(
      () => document.querySelector("#account-label").textContent === "Sign in",
    );

    await page.locator('[data-nav="discover"]').click();
    await page.locator("#city-query").fill("Lviv");
    failCities = true;
    await page.locator("#destination-form button").click();
    await page.locator("#city-results .error-state").waitFor();
    failCities = false;
    await page.locator('[data-action="retry-cities"]').click();
    await page.locator('[data-action="select-city"]').first().click();
    await page.locator("#places-grid .art-card").waitFor();
    await page.locator("#toast").waitFor({ state: "hidden" });
    await page.evaluate(() => document.fonts.ready);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Overflow at ${width}`,
      );
      if (width === 390)
        await page.screenshot({
          path: path.join(output, "mobile.png"),
          fullPage: true,
        });
      if (width === 1440)
        await page.screenshot({
          path: path.join(output, "desktop.png"),
          fullPage: true,
        });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: automatic photos, image source labels, OpenStreetMap, countries, cities, category search, Wikipedia, bookmarks, guest CRUD, notes, visited protection, JWT refresh, server integration, retry states, keyboard and responsive layout.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
