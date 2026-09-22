const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const workspaceMock = require("./workspace-mock.cjs");

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
  const output = process.env.SCREENSHOT_DIR || path.resolve(__dirname, "../../../docs/previews");
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
  const france = { ...country, code: "FR", name: "France", emoji: "🇫🇷", capital: "Paris", currency: "EUR" };
  const serverProject = {
    id: 77,
    name: "My trip",
    description: "",
    start_date: null,
    places: [],
  };
  let refreshRequests = 0;
  let loginCount = 0;
  let layoutPlaces = [];
  const resolvePlace = (id) => layoutPlaces.find((p) => p.place_id === id) || place;
  let workspace = workspaceMock([], resolvePlace);
  const signIn = async () => {
    await page.locator('dialog [name="username"]').fill("browser-test");
    await page.locator('dialog [name="password"]').fill("not-a-real-password");
    await page.locator('dialog button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("#account-label").textContent === "Account");
  };
  let placeQueries = [];
  const placeSorts = [];
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
      return reply(200, { results: [country, france] });
    if (url.pathname === "/api/countries/UA/") return reply(200, country);
    if (url.pathname === "/api/countries/FR/") return reply(200, france);
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
      placeSorts.push(url.searchParams.get("sort"));
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
    if (url.pathname === "/api/auth/login/") {
      loginCount++;
      if (loginCount === 2) workspace = workspaceMock([serverProject], resolvePlace);
      return reply(200, { access: "expired", refresh: "refresh-one" });
    }
    if (url.pathname === "/api/auth/token/refresh/") {
      refreshRequests += 1;
      return reply(200, { access: "fresh", refresh: "refresh-two" });
    }
    if (url.pathname === "/api/auth/logout/") return reply(200, {});
    if (req.headers().authorization !== "Bearer fresh") return reply(401, {});
    if (await workspace(route)) return;
    return reply(404, {});
  });
  try {
    await page.goto(base);
    await page.locator("#country-info strong").waitFor();
    assert.match(await page.locator("#country-info").textContent(), /UAH/);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.fonts.check('18px "Country Flags"', '🇺🇦')));
    assert.match(await page.locator('#country-select option[value="FR"]').textContent(), /🇫🇷/);
    await page.locator("#country-select").focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => document.querySelector("#country-info").textContent.includes("EUR"));
    assert.equal(await page.locator(".country-flag").textContent(), "🇫🇷");
    await page.locator("#country-select").selectOption("");
    assert.match(await page.locator("#country-info").textContent(), /around the world/);
    await page.locator("#country-select").selectOption("UA");
    await page.waitForFunction(() => document.querySelector("#country-info").textContent.includes("UAH"));
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
    assert.equal(placeSorts[0], "highlights");
    await page.locator('#sight-sort').selectOption('distance');
    await page.locator('#places-grid .art-card').waitFor();
    assert.equal(placeSorts.at(-1), 'distance');
    assert.match(await page.locator('#places-context').textContent(), /Nearest first/);
    await page.locator('[data-category="leisure.park"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#places-grid .art-card"),
    );
    assert.ok(placeQueries.includes("leisure.park"));
    assert.equal(await page.locator('#sight-sort-field').isVisible(), false);
    assert.equal(detailRequests, 1, "Category changes reuse cached details");
    await page.locator('#places-grid [data-action="save"]').click();
    await page.locator('dialog [name="username"]').waitFor();
    assert.equal(await page.locator('#places-grid [data-action="save"]').getAttribute('aria-pressed'), 'false');
    await signIn();
    await page.waitForFunction(() => document.querySelector('#places-grid [data-action="save"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#city-query').inputValue(), 'Lviv');
    await page.locator('[data-nav="saved"]').click();
    assert.equal(await page.locator("#saved-grid .art-card").count(), 1);
    await page.reload();
    await page.locator("#saved-grid .art-card").waitFor();
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
          'dialog a[href*="creativecommons.org"]:visible, dialog a[href*="commons.wikimedia.org"]:visible, dialog a[href*="wikipedia.org"]:visible',
        )
        .count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator("dialog").innerText(),
      /Photo found by name|source and licence|contributors · source/,
    );
    await page.locator('.detail-sources summary').click();
    assert.ok(await page.locator('dialog a[href*="creativecommons.org"]').isVisible());
    await page.locator('.detail-sources summary').click();
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
    await page.waitForFunction(() => document.querySelector('[data-action="delete-trip"]').disabled);
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
    await page.locator('.trip-card').waitFor({ state: 'hidden' });
    assert.equal(await page.locator(".trip-card").count(), 0);

    await page.locator("#account-button").click();
    await page.locator('dialog button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('dialog').open);
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
    assert.equal(refreshRequests, 2);
    await page.locator('[data-action="trip-detail"]').click();
    await page.getByRole("button", { name: "Add place +", exact: true }).click();
    await page.waitForURL("**/#collection");
    assert.equal(await page.locator("dialog").isVisible(), false);
    assert.equal(await page.locator("#discover-view").isVisible(), true);
    await page.locator("#city-query").fill("Lviv");
    await page.locator("#destination-form button").click();
    await page.locator('[data-action="select-city"]').first().click();
    await page.locator('#places-grid [data-action="add-place"]').first().click();
    await page.locator('dialog [name="project_id"]').selectOption("77");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator("[data-visited]").check();
    await page.waitForFunction(() => document.querySelector('[data-action="delete-trip"]').disabled);
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
    // Mixed photo coverage: missing, failed image, failed provider and real photo.
    const examples = [
      ["Old Town Monument", "tourism.sights", ""],
      ["City History Museum", "entertainment.museum", "https://upload.wikimedia.org/broken-card.png"],
      ["Botanical Garden", "leisure.park", ""],
      ["Corner Coffee", "catering.cafe", ""],
      ["The Old Courtyard Restaurant", "catering.restaurant", ""],
      ["Historic City Theatre", "tourism.sights", "https://upload.wikimedia.org/layout-test.jpg"],
    ].map(([name, category, image_url], index) => ({
      ...city, place_id: `layout-${index}`, name, categories: [category],
      latitude: city.latitude + index / 100, address: `${index + 1} Market Square, Lviv, Ukraine`, image_url,
    }));
    layoutPlaces = examples;
    await page.route("https://upload.wikimedia.org/broken-card.png", (route) => route.abort());
    await page.route("https://upload.wikimedia.org/layout-test.jpg", (route) => route.fulfill({
      contentType: "image/jpeg", body: fs.readFileSync(path.resolve(__dirname, "../../static/travel/images/chicago.jpg")),
    }));
    let layoutDetails = 0;
    await page.route("**/api/places/**", (route) => {
      const url = new URL(route.request().url());
      const item = examples.find((p) => url.pathname === `/api/places/${p.place_id}/`);
      if (item) layoutDetails++;
      return route.fulfill({
        status: item?.place_id === "layout-3" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(item?.place_id === "layout-3" ? { code: "provider_unavailable" } : item || { results: examples.map((p) => ({ ...p, image_url: "" })), has_more: false }),
      });
    });
    await page.locator('[data-category="tourism.sights"]').click();
    await page.locator('[data-place-id="layout-5"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-place-id="layout-5"] img');
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(layoutDetails, 6);
    assert.equal(await page.locator("#places-grid .place-illustration").count(), 5);
    assert.equal(await page.locator("#places-grid img").count(), 1);
    assert.doesNotMatch(await page.locator("#places-grid").textContent(), /No photo|Finding a photo|Photo temporarily unavailable/);
    assert.ok((await page.locator('[data-place-id="layout-0"]').boundingBox()).height < 260);
    await page.locator('[data-place-id="layout-0"] [data-action="save"]').click();
    await signIn();
    await page.waitForFunction(() => document.querySelector('[data-place-id="layout-0"] [data-action="save"]').getAttribute('aria-pressed') === 'true');
    await page.locator('[data-nav="saved"]').click();
    assert.equal(await page.locator('#saved-grid [data-place-id="layout-0"] .place-illustration').count(), 1);
    await page.locator('[data-nav="discover"]').click();
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Mixed cards overflow at ${width}`);
      if (width === 390 || width === 1440) {
        await page.locator("#places-grid").screenshot({
          path: path.join(output, `place-cards-${width}.png`),
        });
      }
    }
    await page.locator("#destination-form").screenshot({ path: path.join(output, "country-flags.png") });
    // Descriptions remain optional; a missing image never occupies half the dialog.
    await page.locator('#places-grid [data-place-id="layout-0"] .title-button').click();
    await page.locator('dialog .art-detail.text-only').waitFor();
    assert.equal(await page.locator('dialog .location-art, dialog img').count(), 0);
    assert.equal(await page.locator('dialog .place-story').count(), 0);
    assert.doesNotMatch(await page.locator('dialog').innerText(), /No English description|temporarily unavailable|Discover this place in person/);
    await page.locator('dialog').screenshot({ path: path.join(output, 'place-detail-no-description.png') });
    await page.locator('#close-modal').click();

    // Failed descriptions can be retried even after the detail was cached.
    let storyRequests = 0;
    await page.route('**/api/places/layout-3/', (route) => {
      storyRequests++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        ...examples[3], description: storyRequests === 1 ? '' : '<script>unsafe()</script> A neighbourhood café. ' + 'A verified description of this place. '.repeat(20),
        wikipedia_status: storyRequests === 1 ? 'unavailable' : 'found',
      }) });
    });
    await page.locator('#places-grid [data-place-id="layout-3"] .title-button').click();
    await page.locator('[data-action="retry-description"]').waitFor();
    assert.doesNotMatch(await page.locator('dialog').innerText(), /Wikipedia is temporarily unavailable/);
    await page.locator('[data-action="retry-description"]').click();
    await page.locator('dialog .place-story').waitFor();
    assert.equal(storyRequests, 2);
    assert.equal(await page.locator('dialog .place-story script').count(), 0);
    assert.match(await page.locator('dialog .place-story').textContent(), /neighbourhood café/);
    assert.equal(await page.locator('dialog .story-more').getAttribute('open'), null);
    await page.locator('dialog .story-more summary').click();
    assert.ok(await page.locator('dialog .story-more p').isVisible());
    await page.locator('#close-modal').click();

    // A cached URL can still fail when the detail dialog tries to load it.
    await page.locator('#places-grid [data-place-id="layout-1"] .title-button').click();
    await page.locator('dialog .art-detail.text-only').waitFor();
    assert.equal(await page.locator('dialog img').count(), 0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth), `Detail overflow at ${width}`);
    }
    await page.locator('#close-modal').click();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: photos, country flags, discovery, guest save/login continuation, account CRUD, bookmarks, notes, visited protection, JWT refresh, retry states and responsive layout.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
