const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");

// Use a real HTTP cache: Playwright routing would disable browser caching.
(async () => {
  const upstream = process.env.BASE_URL || "http://127.0.0.1:8000";
  let oldPage = true;
  let legacyRequests = 0;
  const assets = [];
  const country = { code: "CH", name: "Switzerland", emoji: "🇨🇭", languages: [] };
  const city = { place_id: "bern", name: "Bern", latitude: 46.948, longitude: 7.447, country_code: "CH" };
  const place = { ...city, place_id: "helvetiaplatz", name: "Helvetiaplatz", categories: ["tourism.sights"], image_url: "" };
  const proxy = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, upstream);
      if (url.pathname.startsWith("/api/")) {
        const data = {
          "/api/countries/": { results: [country] },
          "/api/countries/CH/": country,
          "/api/cities/": { results: [city] },
          "/api/places/": { results: [place], has_more: false },
          "/api/places/helvetiaplatz/": place,
          "/api/wikipedia/": { found: false },
        }[url.pathname];
        response.writeHead(data ? 200 : 404, { "Content-Type": "application/json" });
        return response.end(JSON.stringify(data || {}));
      }
      if (/\/(?:app\.(js|css)|js\/.*\.js)$/.test(url.pathname)) {
        assets.push(request.url);
        if (!url.search) {
          legacyRequests++;
          response.writeHead(200, {
            "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css",
            "Cache-Control": "public, max-age=86400",
          });
          return response.end(url.pathname.endsWith(".js") ? "window.legacyAsset = true;" : "body { color: red; }");
        }
      }
      const result = await fetch(url);
      response.writeHead(result.status, {
        "Content-Type": result.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": result.headers.get("cache-control") || "no-cache",
      });
      if (url.pathname === "/") {
        const html = await result.text();
        response.end(oldPage ? html.replace(/\?v=[a-f0-9]+/g, "") : html);
      } else response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(502);
      response.end(error.message);
    }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const url = `http://127.0.0.1:${proxy.address().port}/`;
    await page.goto(url);
    assert.equal(await page.evaluate(() => window.legacyAsset), true);
    await page.reload();
    assert.equal(legacyRequests, 2, "Old CSS and JS really are served from browser cache");
    oldPage = false;
    await page.reload();
    await page.locator('#country-select option[value="CH"]').waitFor({ state: "attached" });
    assert.equal(await page.evaluate(() => window.legacyAsset), undefined);
    assert.equal(legacyRequests, 2);
    assert.ok(assets.some((url) => /app\.css\?v=[a-f0-9]{16}$/.test(url)));
    assert.ok(assets.some((url) => /app\.js\?v=[a-f0-9]{16}$/.test(url)));
    const modules = assets.filter((url) => url.includes('/travel/js/'));
    assert.ok(modules.length > 0, 'The module entry point loads its dependencies');
    assert.ok(modules.every((url) => /\?v=[a-f0-9]{16}$/.test(url)), 'Every module bypasses stale cached code');
    await page.locator("#country-select").selectOption("CH");
    await page.locator(".country-flag").waitFor();
    assert.equal(await page.locator(".country-flag").textContent(), "🇨🇭");
    assert.ok(await page.evaluate(async () => (await document.fonts.load('18px "Country Flags"', '🇨🇭')).length > 0));
    await page.locator("#city-query").fill("Bern");
    await page.locator('#destination-form button[type="submit"]').click();
    await page.locator('[data-action="select-city"]').click();
    const card = page.locator("#places-grid .art-card");
    await card.locator(".place-illustration").waitFor();
    assert.ok((await card.boundingBox()).height < 260, "Cached old layout is replaced by compact cards");
    assert.equal(await card.locator(".location-art").count(), 0);
    console.log("PASS: normal reload bypasses cached old CSS/JS; compact cards and Swiss flag load.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => proxy.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
